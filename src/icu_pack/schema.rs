//! Decides which tables of a tree are hosts, and what shares a chunk and a class.

use crate::codes::to_bytes;
use crate::keys::Keys;
use crate::pieces::Texts;
use crate::resb::{Bundle, Res, split_once};
use bun_icu_format::key::Key;
use bun_icu_format::schema::{Host, Leaf, MAX_PARTS, Node, Target};
use bun_icu_format::text::{MAX_LEAVES, item};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

/// The languages that tell which rows have similar text.
const SAMPLES: [&str; 48] = [
    "am", "ar", "de", "el", "en", "es", "fi", "hi", "hu", "ko", "pl", "ru", "sw", "th", "tr", "vi",
    "bn", "cy", "cs", "et", "eu", "fa", "fr", "ga", "he", "hy", "id", "is", "ja", "ka", "kk", "km",
    "lt", "lv", "ml", "mn", "my", "si", "so", "sq", "sr", "sv", "ta", "te", "ur", "yo", "zh", "zu",
];

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    String,
    Switches,
    Table,
    Array,
    /// A string or an array.
    Either,
}

/// The union of what the bundles have at a path.
#[derive(Default)]
pub(crate) struct Shape<'a> {
    bundles: usize,
    characters: usize,
    not_ascii: usize,
    /// Hashes of the pieces of the text in some languages.
    pieces: BTreeSet<u32>,
    is_string: bool,
    is_switches: bool,
    table: Option<BTreeMap<&'a str, Shape<'a>>>,
    array: Option<Vec<Shape<'a>>>,
}

impl<'a> Shape<'a> {
    pub(crate) fn of(bundles: &[&Bundle<'a>]) -> Self {
        let mut shape = Self::default();
        for bundle in bundles {
            let sample = SAMPLES.iter().position(|&it| it == bundle.name);
            shape.add(&bundle.root, sample);
        }
        shape
    }

    fn all_pieces(&self, pieces: &mut BTreeSet<u32>) {
        pieces.extend(&self.pieces);
        self.children().for_each(|it| it.1.all_pieces(pieces));
    }

    /// Returns the number of characters.
    fn add(&mut self, res: &Res<'a>, sample: Option<usize>) -> usize {
        let characters = match res {
            Res::String(text) => {
                self.is_string = true;
                self.not_ascii += text.iter().filter(|&&unit| unit >= 0x80).count();
                if let Some(sample) = sample {
                    let hash = |piece: &[u16; 4]| {
                        let add = |hash: u32, &it| (hash ^ u32::from(it)).wrapping_mul(0x0100_0193);
                        piece.iter().fold(sample as u32, add)
                    };
                    self.pieces.extend(text.array_windows().map(hash));
                }
                text.len() + 1
            }
            Res::Ints(values) => {
                assert!(matches!(values[..], [0 | 1, 0 | 1]));
                self.is_switches = true;
                1
            }
            Res::Array(items) => {
                let shapes = self.array.get_or_insert_default();
                shapes.resize_with(shapes.len().max(items.len()), Self::default);
                shapes
                    .iter_mut()
                    .zip(items)
                    .map(|(it, item)| it.add(item, sample))
                    .sum()
            }
            Res::Table(items) => {
                let shapes = self.table.get_or_insert_default();
                let add = |(key, item): &(_, _)| shapes.entry(*key).or_default().add(item, sample);
                items.iter().map(add).sum()
            }
            _ => panic!("a locale has only text"),
        };
        self.bundles += 1;
        self.characters += characters;
        characters
    }

    fn kind(&self) -> Kind {
        match (self.is_string, self.is_switches, &self.table, &self.array) {
            (true, false, None, None) => Kind::String,
            (false, true, None, None) => Kind::Switches,
            (false, false, Some(_), None) => Kind::Table,
            (false, false, None, Some(_)) => Kind::Array,
            (true, false, None, Some(_)) => Kind::Either,
            _ => panic!("no other kinds share a path"),
        }
    }

    fn children(&self) -> impl Iterator<Item = (&'a str, &Self)> {
        let of_table = self.table.iter().flatten().map(|(&key, it)| (key, it));
        of_table.chain(self.array.iter().flatten().map(|it| ("#", it)))
    }

    fn is_leaf(&self) -> bool {
        self.is_string || self.is_switches
    }

    fn leaves(&self) -> usize {
        usize::from(self.is_leaf()) + self.children().map(|it| it.1.leaves()).sum::<usize>()
    }

    pub(crate) fn for_each_key(&self, f: &mut impl FnMut(&'a str)) {
        for (key, child) in self.children() {
            if self.table.is_some() {
                f(key);
            }
            child.for_each_key(f);
        }
    }

    /// Appends what `res` has at each leaf.
    fn extract(&self, res: Option<&Res>, out: &mut Texts) {
        if self.is_leaf() {
            out.push(match res {
                Some(Res::String(text)) => Some(text.clone()),
                Some(Res::Ints(values)) => Some(vec![(0x30 | values[0] | values[1] << 1) as u16]),
                _ => None,
            });
        }
        for (i, (key, child)) in self.children().enumerate() {
            let item = match res {
                Some(Res::Array(items)) => items.get(i),
                res => res.and_then(|res| res.get(key)),
            };
            child.extract(item, out);
        }
    }
}

fn is_host(tree: &str, path: &[&str], shape: &Shape) -> bool {
    shape.kind() == Kind::Table
        && match (tree, path) {
            ("", ["calendar" | "fields" | "listPattern" | "NumberElements"]) => true,
            ("", ["calendar" | "fields", _]) => true,
            ("", ["calendar", _, "availableFormats" | "intervalFormats"]) => true,
            ("", ["NumberElements", _] | ["NumberElements", _, _]) => shape.leaves() > 16,
            ("curr", [table]) => !matches!(*table, "CurrencyUnitPatterns" | "currencySpacing"),
            ("lang", [table]) => {
                !matches!(*table, "Types" | "Types%short" | "localeDisplayPattern")
            }
            (_, []) | ("region" | "unit" | "zone", [_]) | ("unit", [_, _]) => true,
            _ => false,
        }
}

/// Chunks are cut from a section between its rows.
struct Place {
    section: String,
    row: String,
}

fn without_width(key: &str) -> &str {
    split_once(key, b'-').map_or(key, |it| it.0)
}

fn place_of(tree: &str, path: &[&str]) -> Place {
    let place = |section: &[&str], row: &[&str]| Place {
        section: section.join("/"),
        row: row.join("/"),
    };
    match (tree, path) {
        ("", &["calendar", calendar, table, ..]) => {
            let section = match table {
                "monthNames" | "monthPatterns" => "months",
                "DateTimePatterns" | "DateTimePatterns%atTime" => "styles",
                "appendItems" | "availableFormats" => "skeletons",
                "cyclicNameSets" | "intervalFormats" => table,
                _ => "days",
            };
            place(&[calendar, section], &path[2..])
        }
        ("", &["fields", field, "dn"]) => place(&["dn"], &[without_width(field)]),
        ("", &["fields", field, _]) => place(&[without_width(field)], &[]),
        ("", &["listPattern", style]) => place(&["lists"], &[without_width(style)]),
        (
            "",
            [
                "NumberElements",
                "latn",
                "miscPatterns" | "patterns" | "symbols",
            ],
        ) => place(&["numbers"], path),
        ("", &["NumberElements", "default" | "minimumGroupingDigits"]) => place(&["numbers"], path),
        ("", ["NumberElements", _]) => place(&["systems"], path),
        ("", &["NumberElements", system, _]) => place(&["system", system], path),
        ("curr", &[_, code]) => place(&["names"], &[code]),
        ("curr", [_]) => place(&["patterns"], path),
        ("lang", &["Languages" | "Languages%short", code]) => place(&["languages"], &[code]),
        ("lang", &["Scripts" | "Scripts%short", code]) => place(&["scripts"], &[code]),
        ("lang", &["Variants", code]) => place(&["variants"], &[code]),
        ("lang", ["Types" | "Types%short"]) => place(&["types"], &[]),
        ("region", &[_, code]) => place(&["names"], &[code]),
        ("unit", &[_, category, unit]) => place(&["names"], &[category, unit]),
        ("zone", &[_, zone]) => match split_once(zone, b':') {
            None => place(&["formats"], &[zone]),
            Some(_) => place(&["cities"], &[zone]),
        },
        _ => place(path, &[]),
    }
}

/// Whether the last key of `path` predicts the text of the first child.
fn has_key(tree: &str, path: &[&str]) -> bool {
    match (tree, path) {
        ("curr", ["Currencies", _]) => true,
        ("zone", [_, zone]) => split_once(zone, b':').is_some_and(|it| it.0 != "meta"),
        _ => false,
    }
}

/// `share` tells how many of the bundles that have much have the node, from 0 to 3.
fn class_of(tree: &str, path: &[&str], share: usize) -> String {
    let share = ["rare", "some", "many", "most"][share];
    let parts: &[&str] = match (tree, path) {
        ("", &["calendar", calendar, table]) => &[table, &(calendar == "gregorian").to_string()],
        (
            "",
            &[
                "calendar",
                _,
                table @ ("availableFormats" | "intervalFormats"),
                _,
            ],
        ) => &[table, share],
        ("", &["calendar", _, "intervalFormats", _, _]) => &["interval"],
        ("", &["calendar", _, "eras", width, _]) => &["era", width],
        ("", &["calendar", _, "dayPeriod", _, _, period]) => &["period", period],
        (
            "",
            &[
                "calendar",
                _,
                table @ ("appendItems" | "dayOfMonthNames" | "monthPatterns"),
                ..,
            ],
        ) => &[table, "part"],
        ("", ["calendar", _, rest @ ..]) => rest,
        ("", &["fields", field, part]) => &[part, split_once(field, b'-').map_or("", |it| it.1)],
        ("", &["fields", _, "relative", offset]) => &["relative", offset],
        ("", &["fields", field, _, _, form]) => &[
            "relative",
            form,
            split_once(field, b'-').map_or("", |it| it.1),
        ],
        ("", ["fields", _, rest @ ..]) => rest,
        ("", &["listPattern", _, part]) => &["list", part],
        ("", &["NumberElements", _, style, _, _]) => &[style, "power", share],
        ("", &["NumberElements", _, style, _, _, form]) => &[style, form],
        ("", ["NumberElements", _, rest @ ..]) => rest,
        ("", &[table, ..]) => &[table, "part"],
        ("curr", &[table, _]) if table != "CurrencyUnitPatterns" => &[table, share],
        ("curr", &[table, _, ref rest @ ..]) if table != "CurrencyUnitPatterns" => {
            &[table, &rest.join("/")]
        }
        ("lang" | "region", &[table, _]) => &[table, share],
        ("lang", &[table, _, _]) => &[table],
        ("unit", &[table, _, _]) => &[table, share],
        ("unit", &[table, _, _, "case", ..]) => &[table, "case"],
        ("unit", &[table, _, _, form]) => &[table, form],
        ("zone", &[_, zone, ref rest @ ..]) => {
            let kind = split_once(zone, b':').map_or("format", |it| match it.0 {
                "meta" => "meta",
                _ => "city",
            });
            &[kind, rest.first().unwrap_or(&share)]
        }
        _ => path,
    };
    format!("{tree}:{}", parts.join("/"))
}

type Path<'a> = Vec<&'a str>;

pub(crate) struct Schema<'s, 'a> {
    pub(crate) bytes: Vec<u8>,
    pub(crate) hosts: Vec<Path<'a>>,
    chunks: Vec<Vec<(Path<'a>, &'s Shape<'a>)>>,
    /// By chunk: the names of the classes of the leaves, and where the leaves are in `bytes`.
    pub(crate) classes: Vec<(Vec<String>, usize)>,
}

struct Writer<'k> {
    tree: &'k str,
    keys: &'k Keys<'k>,
    words: Vec<u16>,
    nodes: BTreeMap<Vec<u16>, u16>,
    /// The flags and the class of each leaf of the current chunk.
    leaves: Vec<(u8, String)>,
}

/// About so many bundles of a tree have most of what there is.
const LARGE_BUNDLES: usize = 125;
/// The number of characters of such a bundle after which a chunk ends.
const CHUNK_CHARACTERS: usize = 400;

impl Writer<'_> {
    fn container(&mut self, kind: u16, children: &[u16], keys: &[u16]) -> u16 {
        let head = kind << Node::KIND_SHIFT | children.len() as u16;
        let node = [&[head], children, keys].concat();
        *self.nodes.entry(node).or_insert_with_key(|node| {
            self.words.extend(node);
            (self.words.len() - node.len()) as u16
        })
    }

    fn node<'a>(&mut self, path: &mut Path<'a>, shape: &Shape<'a>) -> u16 {
        if shape.is_leaf() {
            let share = (shape.bundles * 4 / LARGE_BUNDLES).min(3);
            // Patterns and codes are ASCII in nearly all languages.
            let flags = if shape.not_ascii * 6 < shape.characters {
                Leaf::IS_VERBATIM
            } else {
                0
            };
            self.leaves.push((flags, class_of(self.tree, path, share)));
        }
        let mut children = Vec::new();
        for (key, child) in shape.children() {
            path.push(key);
            children.push(self.node(path, child));
            path.pop();
        }
        match shape.kind() {
            Kind::String => Node::STRING,
            Kind::Switches => Node::SWITCHES,
            Kind::Array => self.container(item::ARRAY, &children, &[]),
            Kind::Either => {
                let array = self.container(item::ARRAY, &children, &[]);
                self.container(Node::EITHER, &[Node::STRING, array], &[])
            }
            Kind::Table => {
                let keys: Vec<_> = shape.children().map(|it| self.keys.offset(it.0)).collect();
                self.container(item::TABLE, &children, &keys)
            }
        }
    }
}

type Found<'s, 'a> = Vec<(Path<'a>, &'s Shape<'a>)>;

fn find_parts<'s, 'a>(
    tree: &str,
    path: &mut Path<'a>,
    shape: &'s Shape<'a>,
    [hosts, slots]: &mut [Found<'s, 'a>; 2],
) -> bool {
    if is_host(tree, path, shape) {
        hosts.push((path.clone(), shape));
        true
    } else {
        slots.push((path.clone(), shape));
        false
    }
}

fn visit<'s, 'a>(
    tree: &str,
    path: &mut Path<'a>,
    shape: &'s Shape<'a>,
    found: &mut [Found<'s, 'a>; 2],
) {
    if !matches!(path[..], ["%%ALIAS" | "%%Parent"]) && find_parts(tree, path, shape, found) {
        for (key, child) in shape.children() {
            path.push(key);
            visit(tree, path, child, found);
            path.pop();
        }
    }
}

fn cut_chunks<'s, 'a>(tree: &str, slots: Found<'s, 'a>) -> Vec<Found<'s, 'a>> {
    let mut sections: BTreeMap<_, BTreeMap<_, Found>> = BTreeMap::new();
    for slot in slots {
        let Place { section, row, .. } = place_of(tree, &slot.0);
        let rows = sections.entry(section).or_default();
        rows.entry(row).or_default().push(slot);
    }
    let mut chunks = Vec::new();
    for rows in sections.into_values() {
        let is_sorted = tree.is_empty();
        let rows = rows.into_values().map(|row| {
            let mut pieces = BTreeSet::new();
            row.iter().for_each(|it| it.1.all_pieces(&mut pieces));
            (row, pieces)
        });
        let mut rows: Vec<_> = rows.collect();
        let bundles = |row: &Found| row.iter().map(|it| it.1.bundles).max().unwrap_or(0);
        if !is_sorted {
            rows.sort_by_key(|row| Reverse(bundles(&row.0)));
        }
        let (mut chunk, mut pieces) = (Found::new(), BTreeSet::new());
        while !rows.is_empty() {
            let similarity = |&i: &usize| {
                let shared = rows[i].1.intersection(&pieces).count();
                (shared * 1000 / (rows[i].1.len() + 100), Reverse(i))
            };
            let next = (0..rows.len())
                .max_by_key(similarity)
                .filter(|_| !is_sorted);
            let row = &rows[next.unwrap_or(0)].0;
            let sum =
                |of: fn(&Shape) -> usize, slots: &Found| slots.iter().map(|it| of(it.1)).sum();
            let (characters, leaves): (usize, usize) = (
                sum(|it| it.characters, &chunk),
                sum(|it| it.leaves(), &chunk) + sum(|it| it.leaves(), row),
            );
            if characters >= CHUNK_CHARACTERS * LARGE_BUNDLES
                || chunk.len() + row.len() > Target::MAX_SLOTS
                || leaves > MAX_LEAVES
            {
                chunks.push(std::mem::take(&mut chunk));
                pieces.clear();
                continue;
            }
            let row = rows.remove(next.unwrap_or(0));
            chunk.extend(row.0);
            pieces.extend(row.1);
        }
        chunks.push(chunk);
    }
    // What many bundles have comes first, so that it makes long runs.
    chunks.sort_by_key(|chunk| Reverse(chunk.iter().map(|it| it.1.bundles).max()));
    chunks
}

/// Returns a place for each key, and the seeds that lead there.
fn find_places(keys: &[&str]) -> (Vec<u16>, Vec<u16>) {
    const KEYS_PER_SEED: usize = 4;
    let mut seeds = vec![0; keys.len().div_ceil(KEYS_PER_SEED)];
    let mut by_seed = vec![Vec::new(); seeds.len()];
    for (index, key) in keys.iter().enumerate() {
        let hash = Key::new(key.as_bytes()).hash();
        by_seed[Host::index_of_seed(hash, seeds.len())].push((index, hash));
    }
    let mut by_seed: Vec<_> = by_seed.iter().zip(&mut seeds).collect();
    by_seed.sort_by_key(|it| Reverse(it.0.len()));
    let (mut places, mut taken) = (vec![0; keys.len()], BTreeSet::new());
    for (hashes, seed) in by_seed {
        let with =
            |seed| (hashes.iter()).map(move |it| Host::place_with_seed(it.1, seed, keys.len()));
        let fits = |&seed: &u16| {
            let places: BTreeSet<_> = with(seed).collect();
            places.len() == hashes.len() && places.is_disjoint(&taken)
        };
        *seed = (0..=u16::MAX).find(fits).expect("a seed");
        for (&(index, _), place) in hashes.iter().zip(with(*seed)) {
            places[index] = place as u16;
            taken.insert(place);
        }
    }
    (places, seeds)
}

impl<'s, 'a> Schema<'s, 'a> {
    pub(crate) fn new(tree: &str, root: &'s Shape<'a>, keys: &Keys) -> Self {
        let mut found = [Vec::new(), Vec::new()];
        visit(tree, &mut Vec::new(), root, &mut found);
        let [mut hosts, slots] = found;
        hosts.sort_by_key(|host| Reverse(host.1.bundles));
        let chunks = cut_chunks(tree, slots);
        let parts = hosts.len() + chunks.len();
        assert!(parts <= MAX_PARTS);

        let mut writer = Writer {
            tree,
            keys,
            words: vec![0; 2 + parts],
            nodes: BTreeMap::new(),
            leaves: Vec::new(),
        };
        let mut targets = BTreeMap::from([
            (vec!["%%ALIAS"], Target::ALIAS.0),
            (vec!["%%Parent"], Target::PARENT.0),
        ]);
        let target = |part: usize, slot: usize| (part << Target::SLOT_BITS | slot) as u16;
        targets.extend((hosts.iter().enumerate()).map(|(i, it)| (it.0.clone(), target(i, 0))));
        let (mut records, mut classes) = (Vec::new(), Vec::new());
        for (part, chunk) in (hosts.len()..).zip(&chunks) {
            let (mut slots, mut texts_of_keys) = (Vec::new(), Vec::new());
            for (slot, (path, shape)) in chunk.iter().enumerate() {
                targets.insert(path.clone(), target(part, slot));
                let first_leaf = writer.leaves.len();
                slots.push(writer.node(&mut path.clone(), shape));
                if has_key(tree, path) {
                    let key = path[path.len() - 1];
                    let text = key.bytes().rev().take_while(|&it| it != b':').count();
                    texts_of_keys.push(keys.offset(key) + (key.len() - text) as u16);
                    writer.leaves[first_leaf].0 |= Leaf::HAS_KEY;
                }
            }
            let (mut flags, names): (Vec<_>, Vec<_>) = writer.leaves.drain(..).unzip();
            assert!(names.len() <= MAX_LEAVES);
            let counts = [names.len(), slots.len(), texts_of_keys.len()].map(|it| it as u16);
            flags.resize(names.len().next_multiple_of(2), 0);
            let flags = flags.as_chunks().0.iter().map(|&it| u16::from_le_bytes(it));
            let before_leaves = [&counts[..], &slots, &texts_of_keys].concat();
            classes.push((names, before_leaves.len()));
            records.push(before_leaves.into_iter().chain(flags).collect());
        }
        let host_records = hosts.iter().map(|(path, shape)| {
            let children: Vec<_> = shape.children().map(|it| it.0).collect();
            let (places, seeds) = find_places(&children);
            let mut pairs = vec![[0; 2]; children.len()];
            for (&key, &place) in children.iter().zip(&places) {
                let target = targets[&[path, &[key][..]].concat()];
                pairs[usize::from(place) / 2] = [keys.offset(key), target];
            }
            let counts = [children.len(), seeds.len()].map(|it| it as u16);
            [&counts, pairs.as_flattened(), &places, &seeds].concat()
        });
        let mut words = writer.words;
        words[..2].copy_from_slice(&[hosts.len() as u16, chunks.len() as u16]);
        for (part, record) in host_records.chain(records).enumerate() {
            words[2 + part] = u16::try_from(words.len()).expect("16 bits");
            words.extend::<Vec<u16>>(record);
        }
        for (part, (_, at)) in (hosts.len()..).zip(&mut classes) {
            *at = 2 * (usize::from(words[2 + part]) + *at);
        }
        Self {
            bytes: to_bytes(&words),
            hosts: hosts.into_iter().map(|host| host.0).collect(),
            chunks,
            classes,
        }
    }

    pub(crate) fn chunk_count(&self) -> usize {
        self.chunks.len()
    }

    /// Gives numbers to the classes in `numbers`. The others have 0.
    pub(crate) fn number_classes(&mut self, numbers: &BTreeMap<String, u8>) {
        for (names, at) in &self.classes {
            for (leaf, name) in self.bytes[*at..].iter_mut().zip(names) {
                *leaf |= numbers.get(name).copied().unwrap_or(0);
            }
        }
    }

    /// Returns what `root` has at each leaf of a chunk, unless it has nothing.
    pub(crate) fn extract(&self, chunk: usize, root: &Res) -> Option<Texts> {
        let slots = &self.chunks[chunk];
        let mut values = Vec::new();
        for (path, shape) in slots {
            shape.extract(root.at(path), &mut values);
        }
        values.iter().any(Option::is_some).then_some(values)
    }
}
