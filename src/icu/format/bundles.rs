//! Reads the bundles of locales from a package.

use crate::locales::{Locale, Locales};
use crate::model::{Map, Model};
use crate::package::{
    FIRST_SCHEMA, FIRST_TREE_COLUMN, KEYS, LOCALES, MODEL_COLUMN, NUMBER_CODES, Package, keys_of,
};
use crate::record::{Record, record_in};
use crate::schema::Schema;
use crate::text::Levels;

/// The number of locales that are read for a chunk: the locale, the one that it refers to, and so on.
pub const MAX_LEVELS: usize = 3;

#[derive(Clone, Copy)]
pub struct Bundles<'a>(pub Package<'a>);

/// What a level is read from.
pub struct Source<'a> {
    model: Model<'a>,
    record: Record<'a>,
    coded: &'a [u8],
}

impl<'a> Bundles<'a> {
    /// The pool of keys and what follows it.
    #[inline]
    pub fn keys(self, tree: usize) -> &'a [u8] {
        self.0.from_item(keys_of(tree))
    }

    /// Returns the index of a locale.
    #[inline]
    pub fn find(self, name: &[u8]) -> Option<usize> {
        self.locales().find(self.0.item(KEYS), name)
    }

    #[inline]
    pub fn locales(self) -> Locales<'a> {
        Locales::new(self.0.item(LOCALES))
    }

    #[inline]
    pub fn schema(self, tree: usize) -> Schema<'a> {
        Schema::new(self.0.item(FIRST_SCHEMA + tree))
    }

    /// The item that has the bundle.
    #[inline]
    pub fn cell(self, locale: Locale, tree: usize) -> usize {
        self.0.cell(locale.unit, FIRST_TREE_COLUMN + tree)
    }

    pub fn record(self, locale: Locale, tree: usize) -> Record<'a> {
        let cell = self.cell(locale, tree);
        let start = record_in(self.0.item(cell), locale.record);
        let record = start.and_then(|start| self.0.from_item(cell).get(start..));
        Record::new(record.unwrap_or_default(), self.schema(tree).hosts())
    }

    /// Returns the locale at `index` and those that are read with it.
    pub fn levels(self, index: usize) -> impl Iterator<Item = Locale> {
        let (locales, mut next) = (self.locales(), Some(index));
        let step = move || {
            let locale = locales.get(next?);
            next = next
                .filter(|&it| it != locale.reference)
                .map(|_| locale.reference);
            Some(locale)
        };
        core::iter::from_fn(step).take(MAX_LEVELS)
    }

    /// Returns what the chunks of a bundle are read from. `locale` is an index.
    pub fn sources(self, locale: usize, tree: usize) -> impl Iterator<Item = Source<'a>> {
        self.levels(locale).map(move |locale| {
            let record = self.record(locale, tree);
            Source {
                model: Model::new(self.0.from_item(self.0.cell(locale.unit, MODEL_COLUMN))),
                coded: record.coded(),
                record,
            }
        })
    }

    /// Passes the image of the chunk `part` of a bundle to `take`.
    pub fn read_chunk(
        self,
        sources: &[Source],
        tree: usize,
        part: usize,
        take: &mut dyn FnMut(&[u16]),
    ) -> Option<()> {
        let numbers = self.0.item(NUMBER_CODES).as_chunks().0.as_chunks().0;
        let numbers = numbers.as_chunks().0.first_chunk()?;
        let mut levels = Levels::new(self.schema(tree).chunk(part));
        levels.read_keys(self.keys(tree));
        for (level, source) in sources.iter().rev().enumerate() {
            let (model, record) = (&source.model, &source.record);
            if record.has(part) {
                let map = if level > 0 { model.map } else { Map::default() };
                let coded = source.coded.get(record.offset(record.rank(part))..)?;
                levels.read_level(model, map, numbers, coded)?;
            }
        }
        take(levels.image(&sources.first()?.model));
        Some(())
    }
}
