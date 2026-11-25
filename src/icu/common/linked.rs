//! Finds items in the linked package, and expands the text of locales when it is first read.

use crate::common::bytes::U16s;
use crate::common::cstring::find_last_byte;
use crate::common::memory::{
    defer_oom, get_or_try_init, try_box, try_to_vec, try_with_capacity, try_zeroed,
};
use crate::common::slice_ext::SliceExt;
use crate::common::udata::Data;
use crate::common::umutex::{OnceBox, OnceUnits};
use crate::common::utypes::{U_INVALID_FORMAT_ERROR, UErrorCode};
use crate::sys::package::{abort_for_removed_language, linked};
use bun_core::{slice_as_bytes, slice_as_bytes_mut};
use bun_icu_format::bundles::{Bundles, Source};
use bun_icu_format::locales::{FileKind, Files, Link};
use bun_icu_format::package::{FILES, FIRST_TREE_COLUMN, Package, REMOVED, TOMBSTONED, TREES};
use bun_icu_format::record::Record;
use bun_icu_format::schema::{Host, MAX_PARTS, Schema, Target};
use bun_icu_format::squeezed::{MAX_ITEMS, Squeezed};
use bun_icu_format::text::item;
use std::sync::OnceLock;

fn exists(package: Package, item: usize) -> bool {
    match package.flags(item) {
        0 => true,
        REMOVED => false,
        _ => abort_for_removed_language(),
    }
}

/// `path` is like "coll/de.res", and `bundle` is the tree and the name if it is a bundle. `accept` gets a file with its header.
pub(crate) fn find(
    path: &[u8],
    bundle: Option<(&[u8], &[u8])>,
    accept: &mut dyn FnMut(&'static [u8]) -> Option<Data>,
) -> Result<Option<Data>, UErrorCode> {
    let (package, bundles) = (linked(), Bundles(linked()));
    let tree = bundle.and_then(|(tree, _)| TREES.iter().position(|&it| it == tree));
    if let (Some(tree), Some((_, name))) = (tree, bundle)
        && let Some(index) = bundles.find(name)
    {
        let locale = bundles.locales().get(index);
        let exists = locale.trees >> tree & 1 != 0 && exists(package, bundles.cell(locale, tree));
        let text = exists.then(|| Text::new(bundles, index, tree));
        return Ok(text.transpose()?.map(Data::Text));
    }
    let file = Files::new(package.item(FILES)).find(path);
    let Some(file) = file.filter(|file| exists(package, file.item)) else {
        return Ok(None);
    };
    let bytes = match file.is_squeezed {
        true => expand(package, file.item)?,
        false => package.item(file.item),
    };
    Ok(match file.kind {
        FileKind::Plain => accept(bytes),
        FileKind::Bundle { root, no_fallback } => Some(Data::Image {
            bytes,
            keys: bundles.keys(tree.unwrap_or(0)),
            root,
            no_fallback,
        }),
    })
}

fn expand(package: Package<'static>, item: usize) -> Result<&'static [u8], UErrorCode> {
    static EXPANDED: [OnceBox<Vec<u16>>; MAX_ITEMS] = [const { OnceBox::new() }; _];
    let squeezed = Squeezed::new(package.item(item));
    let cell = EXPANDED
        .get(squeezed.number)
        .ok_or(U_INVALID_FORMAT_ERROR)?;
    let units = cell.get_or_try_init(|| {
        let mut units = try_zeroed((squeezed.base_length + squeezed.length) / 2)?;
        let bytes = slice_as_bytes_mut(&mut units);
        if squeezed.base_length != 0 {
            Squeezed::new(package.item(item - 1)).expand(bytes.slice_mut(..squeezed.base_length));
        }
        squeezed.expand(bytes);
        Ok(units)
    })?;
    Ok(slice_as_bytes(units).slice(squeezed.base_length..))
}

/// Returns an item that `ICU_DATA` does not replace.
pub(crate) fn file(path: &[u8]) -> Option<&'static [u8]> {
    let package = linked();
    let file = Files::new(package.item(FILES)).find(path)?;
    exists(package, file.item).then(|| package.item(file.item))
}

/// Only the linked package is trusted to have sound data in the formats of `bun_icu_format`.
pub(crate) fn contains(bytes: &[u8]) -> bool {
    linked().contains(bytes)
}

/// Returns whether opening the bundle for `base_name` in the main tree would end the process.
pub(crate) fn is_language_removed(base_name: &[u8]) -> bool {
    let bundles = Bundles(linked());
    let names = std::iter::successors(Some(base_name), |name| {
        name.get(..find_last_byte(name, b'_')?)
    });
    let found = names
        .filter_map(|name| bundles.find(name))
        .map(|index| bundles.locales().get(index))
        .find(|locale| locale.trees & 1 != 0);
    found.is_some_and(|locale| {
        bundles
            .0
            .flags(bundles.0.cell(locale.unit, FIRST_TREE_COLUMN))
            == TOMBSTONED
    })
}

/// The bundle of a locale.
pub(crate) struct Text {
    schema: Schema<'static>,
    record: Record<'static>,
    /// By the rank of the chunk.
    images: Vec<OnceUnits>,
    sources: OnceLock<Vec<Source<'static>>>,
    locale: u16,
    tree: u8,
    hosts: u8,
    pub(crate) link: Link,
    names_of_locales: U16s<'static>,
}

/// What a host has at a key.
#[derive(Clone, Copy)]
pub(crate) enum Child {
    Host(usize),
    /// An item of the image at `rank`.
    Item {
        rank: usize,
        item: u16,
    },
    /// The offset of a string among the names of locales.
    Link(u16),
}

impl Text {
    fn new(bundles: Bundles<'static>, index: usize, tree: usize) -> Result<Box<Self>, UErrorCode> {
        let locale = bundles.locales().get(index);
        let record = bundles.record(locale, tree);
        let mut images = try_with_capacity(record.chunks())?;
        images.resize_with(record.chunks(), OnceUnits::default);
        let schema = bundles.schema(tree);
        try_box(Self {
            schema,
            record,
            images,
            sources: OnceLock::new(),
            locale: index as u16,
            tree: tree as u8,
            hosts: schema.hosts() as u8,
            link: locale.link,
            names_of_locales: U16s::of(bundles.locales().words().as_bytes()),
        })
    }

    pub(crate) fn keys(&self) -> &'static [u8] {
        Bundles(linked()).keys(self.tree.into())
    }

    #[inline]
    pub(crate) fn host(&self, part: usize) -> Host<'static> {
        self.schema.host(part)
    }

    #[inline(always)]
    pub(crate) fn may_have(&self, target: Target) -> bool {
        self.record.has(target.part()) || target.part() >= MAX_PARTS
    }

    /// Returns `None` if the bundle lacks it, or if allocation fails.
    #[inline(always)]
    pub(crate) fn child(&self, target: Target) -> Option<Child> {
        let part = target.part();
        if !self.record.has(part) {
            return self.link.offset_for(target).map(Child::Link);
        } else if part < self.hosts.into() {
            return Some(Child::Host(part));
        }
        let rank = self.record.rank(part);
        let cached = self.images.get(rank)?;
        let image = cached.get().or_else(|| self.expand(part, cached))?;
        let item = U16s::from_chunks(image).at(item::index_of(target.slot(), image.len()));
        (item != 0).then_some(Child::Item { rank, item })
    }

    #[cold]
    #[inline(never)]
    fn expand(&self, chunk: usize, cached: &OnceUnits) -> Option<&'static [[u8; 2]]> {
        let (bundles, tree) = (Bundles(linked()), self.tree.into());
        let sources = get_or_try_init(&self.sources, || {
            let mut sources = try_with_capacity(bundles.levels(self.locale.into()).count())?;
            sources.extend(bundles.sources(self.locale.into(), tree));
            Ok(sources)
        });
        let keep = &mut |image: &_| _ = defer_oom(try_to_vec(image)).map(|copy| cached.set(copy));
        bundles.read_chunk(defer_oom(sources)?, tree, chunk, keep);
        cached.get()
    }

    /// Returns an image that `child` has led to, or else the units that links lead to.
    #[inline]
    pub(crate) fn units(&self, rank: usize) -> U16s<'static> {
        match self.images.get(rank).and_then(OnceUnits::get) {
            Some(image) => U16s::from_chunks(image),
            None => self.names_of_locales,
        }
    }
}
