//! Reads `icudt79l.dat` from stdin, and writes the data package of `bun_icu` to stdout (src/icu/README.md).

mod codes;
mod collation;
mod dictionary;
mod fast_latin;
mod files;
mod image;
mod keys;
mod likely;
mod maps;
mod package;
mod parallel;
mod pieces;
mod reach;
mod resb;
mod runs;
mod schema;
mod squeezed;
mod text;
mod tries;
mod verify;
mod zones;

use bun_icu_format::locales::File;
use bun_icu_format::package::{
    FIRST_SCHEMA, FIRST_TREE_WITH_KEYS, FIXED_ITEMS, PADDING, TREES, keys_of,
};
use keys::{Keys, Pools};
use package::{Entry, Named};
use resb::{Bundle, Res, split_once};
use schema::{Schema, Shape};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};

fn main() -> std::io::Result<()> {
    let mut input = Vec::new();
    std::io::stdin().read_to_end(&mut input)?;
    let items = resb::read_package(&input);
    let mut bundles = reach::reachable(resb::read_bundles(&items));
    let root_collation = pack_collations(items[ROOT_COLLATION], &mut bundles);
    for bundle in &mut bundles {
        zones::pack(bundle.root.items_mut("Zones"));
        if let [_, Res::Ints(entries), .., Res::Binary(trie)] =
            &mut bundle.root.items_mut("likely")[..]
        {
            likely::pack(trie, entries);
        }
    }

    let is_text = |it: &&Bundle| reach::is_locale(it.name) && TREES.contains(&it.tree.as_bytes());
    let (text, others): (Vec<_>, Vec<_>) = bundles.iter().partition(is_text);
    let shapes = TREES.map(|tree| {
        let of_tree = text.iter().copied().filter(|it| it.tree.as_bytes() == tree);
        Shape::of(&of_tree.collect::<Vec<_>>())
    });
    let shapes = || tree_names().zip(&shapes);
    let mut keys: Vec<_> = text.iter().map(|it| ("", it.name)).collect();
    shapes().for_each(|(tree, it)| it.for_each_key(&mut |key| keys.push((tree, key))));
    (others.iter()).for_each(|it| it.root.for_each_key(&mut |key| keys.push((it.tree, key))));
    let keys = Pools::new(&keys);
    let schemas = shapes().map(|(tree, shape)| Schema::new(tree, shape, keys.of(tree)));
    let packed = text::Text::new(&text, &keys, schemas.collect()).pack();

    let mut groups: BTreeMap<_, Vec<_>> = BTreeMap::new();
    for &bundle in &others {
        groups.entry(group_of(bundle)).or_default().push(bundle);
    }
    let mut named: Vec<_> = groups
        .iter()
        .map(|(group, bundles)| image_of(keys.of(group.0), bundles))
        .collect();
    named.extend(parallel::map(&reach::FILES, |&path| Named {
        bytes: match split_once(path, b'.') {
            _ if path == ROOT_COLLATION => root_collation.clone(),
            Some((_, "dict")) => dictionary::pack(items[path]),
            _ => files::without_unread_parts(path, items[path]),
        },
        ..plain(path.into())
    }));
    squeeze(&mut named);

    let package = assemble(&keys, &packed, &named);
    verify::verify(&package, &text);
    std::io::stdout().write_all(&package)
}

fn tree_names() -> impl Iterator<Item = &'static str> {
    (TREES.into_iter()).map(|tree| str::from_utf8(tree).expect("ASCII"))
}

fn plain(path: String) -> Named {
    let (root, no_fallback) = (File::PLAIN, false);
    Named {
        bytes: Vec::new(),
        files: vec![Entry {
            path,
            root,
            no_fallback,
        }],
        is_squeezed: false,
    }
}

const ROOT_COLLATION: &str = "coll/ucadata.icu";

/// Replaces the tailorings, and returns the root.
fn pack_collations(root: &[u8], bundles: &mut [Bundle]) -> Vec<u8> {
    let collations = bundles.iter_mut().filter(|it| it.tree == "coll");
    let tailorings: Vec<_> = collations.flat_map(|it| it.root.binaries()).collect();
    let distinct: BTreeSet<_> = tailorings.iter().map(|it| (*it).clone()).collect();
    let packed = collation::pack(
        root,
        &distinct.iter().map(Vec::as_slice).collect::<Vec<_>>(),
    );
    (tailorings.into_iter()).for_each(|it| *it = packed.tailorings[&it[..]].clone());
    packed.root
}

/// Bundles that `--trim` removes together share an item, unless they are squeezed.
fn group_of<'a>(bundle: &Bundle<'a>) -> (&'a str, &'a str) {
    match (bundle.tree, bundle.name) {
        ("coll", "en" | "en_US" | "res_index" | "root") => ("coll", "root"),
        ("coll", name) => ("coll", reach::language_of(name)),
        ("brkitr", _) if bundle.root.get("exceptions").is_none() => ("brkitr", ""),
        ("", "plurals" | "pluralRanges") => ("", "plurals"),
        ("", "grammaticalFeatures" | "units") => ("", "units"),
        ("", name) if name == "dayPeriods" || reach::is_cold(name) => ("", name),
        ("", _) | ("zone", "root") => ("", ""),
        other => other,
    }
}

/// Squeezes what is read as a whole, and rarely.
fn squeeze(named: &mut [Named]) {
    let (mut number, mut before) = (0, (String::new(), Vec::new()));
    for item in named {
        let path = &item.files[0].path;
        let is_rare = match split_once(path, b'/') {
            Some(("brkitr", _)) => !path.ends_with(".dict") && item.files.len() == 1,
            Some(("rbnf", _) | ("curr", "supplementalData.res") | ("unit", "root.res")) => true,
            _ => path.strip_suffix(".res").is_some_and(reach::is_cold),
        };
        if is_rare {
            let is_variant = matches!(
                (&before.0[..], &path[..]),
                ("brkitr/sent.brk", "brkitr/sent_el.brk")
                    | ("brkitr/word.brk", "brkitr/word_POSIX.brk")
            );
            let squeezed = squeezed::squeeze(
                number,
                if is_variant { &before.1 } else { &[] },
                &item.bytes,
            );
            before = (path.clone(), std::mem::replace(&mut item.bytes, squeezed));
            (number, item.is_squeezed) = (number + 1, true);
        }
    }
}

fn image_of(keys: &Keys, bundles: &[&Bundle]) -> Named {
    let roots: Vec<_> = bundles.iter().map(|it| &it.root).collect();
    let (bytes, roots) = image::write_image(keys, &roots);
    let files = bundles.iter().zip(roots).map(|(bundle, root)| Entry {
        path: match bundle.tree {
            "" => format!("{}.res", bundle.name),
            tree => format!("{tree}/{}.res", bundle.name),
        },
        root,
        no_fallback: bundle.no_fallback,
    });
    Named {
        bytes,
        files: files.collect(),
        is_squeezed: false,
    }
}

/// What most programs read comes first.
fn assemble(keys: &Pools, text: &text::Packed, named: &[Named]) -> Vec<u8> {
    let is_late = |it: &&Named| {
        matches!(
            split_once(&it.files[0].path, b'/'),
            Some(("brkitr" | "coll" | "rbnf", _))
        )
    };
    let (after, before): (Vec<_>, Vec<_>) = named.iter().partition(is_late);
    let after_cells = FIXED_ITEMS + before.len() + text.cells.len();
    let indexed = (FIXED_ITEMS..)
        .zip(&before)
        .chain((after_cells..).zip(&after));
    // The names tell `--trim` what they belong to.
    let trees = tree_names().enumerate().skip(FIRST_TREE_WITH_KEYS);
    let of_trees = trees.flat_map(|(index, tree)| {
        [(FIRST_SCHEMA + index, "schema"), (keys_of(index), "keys")]
            .map(|(item, name)| (item, plain(format!("{tree}/{name}"))))
    });
    let of_trees: Vec<_> = of_trees.collect();
    let of_trees = of_trees.iter().map(|it| (it.0, &it.1));
    let files = package::directory(indexed.map(|it| (it.0, *it.1)).chain(of_trees));
    let mut keys = keys.0.values().map(|it| &it.bytes);
    let fixed = (keys.next().into_iter()).chain([&text.locales, &files, &text.number_codes]);
    let fixed = fixed.chain(&text.schemas).chain(keys);
    let before = fixed.chain(before.iter().map(|it| &it.bytes));
    let before: Vec<_> = before.map(Vec::as_slice).collect();
    let after = after.iter().map(|it| &it.bytes[..]);
    let after: Vec<_> = after.chain([&[0; PADDING][..]]).collect();
    package::assemble(&before, &text.cells, &after)
}
