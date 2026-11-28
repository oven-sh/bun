//! Reads the bundles of locales back.

use crate::parallel;
use crate::resb::{Bundle, Res};
use bun_icu_format::Words;
use bun_icu_format::bundles::Bundles;
use bun_icu_format::key::Key;
use bun_icu_format::locales::Link;
use bun_icu_format::package::{Package, TREES};
use bun_icu_format::record::Record;
use bun_icu_format::schema::{MAX_PARTS, ROOT, Schema};
use bun_icu_format::text::item;
use std::collections::BTreeMap;

struct Reader<'a> {
    keys: &'a [u8],
    schema: Schema<'a>,
    record: Record<'a>,
    link: Link,
    names: Words<'a>,
    /// By part.
    images: BTreeMap<usize, Vec<u16>>,
}

impl<'a> Reader<'a> {
    fn key(&self, offset: u16) -> &'a str {
        let key = &self.keys[offset.into()..];
        let length = key.iter().take_while(|&&byte| byte != 0).count();
        str::from_utf8(&key[..length]).expect("ASCII")
    }

    fn host(&self, part: usize) -> Res<'a> {
        let host = self.schema.host(part);
        let children = host.places().iter().map(usize::from).filter_map(|place| {
            let (key, target) = host.child(place).expect("a child");
            let key = self.key(key);
            assert!(host.place_for(Key::new(key.as_bytes())) == Some(place));
            let value = if !self.record.has(target.part()) {
                let units = (self.link.offset_for(target)?.into()..).map(|at| self.names.at(at));
                Res::String(units.take_while(|&unit| unit != 0).collect())
            } else if let Some(image) = self.images.get(&target.part()) {
                let item = image[item::index_of(target.slot(), image.len())];
                self.item(image, Some(item).filter(|&item| item != 0)?)
            } else {
                self.host(target.part())
            };
            Some((key, value))
        });
        Res::Table(children.collect())
    }

    fn item(&self, image: &[u16], item: u16) -> Res<'a> {
        let (&count, rest) =
            (image[(item & item::OFFSET_MASK).into()..].split_first()).expect("a unit");
        let (count, kind) = (usize::from(count), item >> item::KIND_SHIFT);
        let items = |items: &[u16]| -> Vec<_> {
            (items[..count].iter().map(|&it| self.item(image, it))).collect()
        };
        if kind == item::STRING {
            assert!(count >> 10 == 0xdc00 >> 10 && rest[count & 0x3ff] == 0);
            Res::String(rest[..count & 0x3ff].to_vec())
        } else if kind == item::SWITCHES {
            Res::Ints(vec![rest[1].into(), rest[3].into()])
        } else if kind == item::ARRAY {
            Res::Array(items(rest))
        } else {
            let keys = rest.iter().map(|&key| self.key(key));
            Res::Table(keys.zip(items(&rest[count..])).collect())
        }
    }
}

pub(crate) fn verify(package: &[u8], expected: &[&Bundle]) {
    let bundles = Bundles(Package::new(package));
    let locales = bundles.locales();
    let trees = (0..locales.count()).map(|it| locales.get(it).trees.count_ones() as usize);
    assert!(trees.sum::<usize>() == expected.len());
    parallel::map(expected, |bundle| {
        let tree = TREES.iter().position(|&it| it == bundle.tree.as_bytes());
        let index = bundles.find(bundle.name.as_bytes());
        let (tree, index) = (tree.expect("a tree"), index.expect("a locale"));
        let locale = locales.get(index);
        assert!(locale.trees >> tree & 1 == 1);
        let (record, mut images) = (bundles.record(locale, tree), BTreeMap::new());
        let schema = bundles.schema(tree);
        let sources: Vec<_> = bundles.sources(index, tree).collect();
        for part in (schema.hosts()..MAX_PARTS).filter(|&part| record.has(part)) {
            let mut keep = |image: &[u16]| _ = images.insert(part, image.to_vec());
            bundles.read_chunk(&sources, tree, part, &mut keep);
        }
        let reader = Reader {
            keys: bundles.keys(tree),
            schema,
            record,
            link: locale.link,
            names: locales.words(),
            images,
        };
        let (tree, name) = (bundle.tree, bundle.name);
        assert!(
            reader.host(ROOT) == bundle.root,
            "{tree}/{name} has changed"
        );
    });
}
