//! The binary format of resource bundles (`.res`). ICU4C: uresdata.cpp, uresdata.h

use crate::common::bytes::{I32s, U16s, U32s, View, Word};
use crate::common::cstring::{find_byte, find_last_byte, split_once};
use crate::common::linked::{Child, Text};
use crate::common::resource::{ResourceArray, ResourceTable};
use crate::common::slice_ext::{SliceExt, SoftUnwrap, to_index};
use crate::common::udata::{self, Data, Places, UDataInfo, UDataMemory};
use crate::common::unicode::ures::*;
use crate::common::uresbund::Entry;
use crate::common::utypes::*;
use bun_icu_format::key::Key;
use bun_icu_format::schema::{Host, ROOT};
use bun_icu_format::text::item;
use std::cmp::Ordering;
use std::ffi::{CStr, c_long};

const URES_TABLE32: i32 = 4;
const URES_TABLE16: i32 = 5;
const URES_STRING_V2: i32 = 6;
const URES_ARRAY16: i32 = 9;

const URES_INDEX_LENGTH: usize = 0;
const URES_INDEX_KEYS_TOP: usize = 1;
const URES_INDEX_MAX_TABLE_LENGTH: usize = 4;
const URES_INDEX_ATTRIBUTES: usize = 5;
const URES_INDEX_16BIT_TOP: usize = 6;
const URES_INDEX_POOL_CHECKSUM: usize = 7;

const URES_ATT_NO_FALLBACK: u32 = 1;
const URES_ATT_IS_POOL_BUNDLE: u32 = 2;
const URES_ATT_USES_POOL_BUNDLE: u32 = 4;

/// The type in bits 31..28, and an offset or an integer in bits 27..0.
pub(crate) type Resource = u32;

/// In a `Text` the offset is the rank of an image and an offset in it, and `URES_TABLE32` is a host.
const RANK_SHIFT: u32 = 16;
const RANK_OF_LINKS: usize = 0xfff;

fn host_resource(part: usize) -> Resource {
    (URES_TABLE32 as u32) << 28 | part as u32
}

/// `rank` is shifted.
#[inline]
fn resource_in_image(rank: u32, item: u16) -> Resource {
    const TYPES: u32 = (URES_STRING_V2 | URES_TABLE16 << 4 | URES_ARRAY16 << 8) as u32
        | (URES_INT_VECTOR as u32) << 12;
    let type_ = TYPES >> (4 * (item >> item::KIND_SHIFT));
    type_ << 28 | rank | u32::from(item & item::OFFSET_MASK)
}

#[inline(always)]
fn resource_of(child: Child) -> Resource {
    match child {
        Child::Host(part) => host_resource(part),
        Child::Item { rank, item } => resource_in_image((rank as u32) << RANK_SHIFT, item),
        Child::Link(offset) => {
            (URES_STRING_V2 as u32) << 28 | (RANK_OF_LINKS as u32) << RANK_SHIFT | u32::from(offset)
        }
    }
}

pub(crate) const RES_PATH_SEPARATOR: u8 = b'/';

pub(crate) fn res_get_type(res: Resource) -> i32 {
    (res >> 28) as i32
}

fn res_get_offset(res: Resource) -> u32 {
    res & 0x0fff_ffff
}

pub(crate) fn ures_is_table(type_: i32) -> bool {
    matches!(type_, URES_TABLE | URES_TABLE16 | URES_TABLE32)
}

fn is_container(type_: i32) -> bool {
    ures_is_table(type_) || matches!(type_, URES_ARRAY | URES_ARRAY16)
}

/// The length 0, followed by zeros.
#[repr(align(4))]
struct Empty([u8; 8]);

static EMPTY: Empty = Empty([0; 8]);

/// The bytes from a key to the end of its bundle. A key without a NUL reads as empty.
#[derive(Clone, Copy)]
pub(crate) struct DataKey(&'static [u8]);

impl DataKey {
    #[inline]
    pub(crate) fn as_bytes(self) -> &'static [u8] {
        self.0.slice(..find_byte(self.0, 0).soft_unwrap())
    }

    /// Returns 0 for the empty key.
    pub(crate) fn first_byte(self) -> u8 {
        self.0.at(0)
    }

    pub(crate) fn as_c_str(self) -> &'static CStr {
        CStr::from_bytes_until_nul(self.0).ok().soft_unwrap()
    }
}

/// A string in the data, including the NUL at its length.
#[derive(Clone, Copy)]
pub(crate) struct DataString(&'static [[u8; 2]]);

impl DataString {
    pub(crate) const EMPTY: Self = Self(EMPTY.0.as_chunks().0.split_at(2).1.split_at(1).0);

    /// Returns `None` unless the unit at `length` is a NUL.
    #[inline]
    fn new(rest: U16s<'static>, length: usize) -> Option<Self> {
        let units = rest
            .as_bytes()
            .as_chunks()
            .0
            .get(..=length)
            .filter(|units| units.last() == Some(&[0; 2]));
        crate::common::soft_assert!(units.is_some());
        units.map(Self)
    }

    #[inline]
    pub(crate) fn units(self) -> U16s<'static> {
        U16s::from_chunks(self.0.split_last().map_or(&[], |(_nul, units)| units))
    }

    /// Returns the units up to the first NUL, for callers that take a C string.
    pub(crate) fn until_nul(self) -> U16s<'static> {
        self.units().until_nul()
    }

    /// Returns whether the text is "∅∅∅".
    #[inline]
    pub(crate) fn is_empty_sets(self) -> bool {
        const EMPTY_SET: [u8; 2] = 0x2205_u16.to_ne_bytes();
        matches!(self.0, [EMPTY_SET, EMPTY_SET, EMPTY_SET, _])
    }

    #[inline]
    pub(crate) fn as_ptr(self) -> *const u16 {
        self.0.as_ptr().cast()
    }
}

/// The key offsets of a table. The view extends to the end of the bundle.
#[derive(Clone, Copy)]
pub(crate) enum Keys {
    Offsets16(U16s<'static>),
    Offsets32(I32s<'static>),
}

/// The items of a table or an array and their number. The view extends to the end of the bundle.
#[derive(Clone, Copy)]
pub(crate) enum Items {
    Strings16(U16s<'static>, usize),
    Resources(U32s<'static>, usize),
    /// With the shifted rank.
    InImage(U16s<'static>, u16, u32),
    /// Some of them can be absent.
    OfHost(Host<'static>),
}

impl Items {
    /// The number of places.
    #[inline]
    fn len(self) -> usize {
        match self {
            Self::Strings16(_, length) | Self::Resources(_, length) => length,
            Self::InImage(_, length, _) => length.into(),
            Self::OfHost(host) => host.len(),
        }
    }
}

fn view_from<T: Word<N> + 'static, const N: usize>(
    view: View<'static, T, N>,
    start: usize,
) -> View<'static, T, N> {
    view.slice_clamped(start..usize::MAX)
}

/// Returns the units after `index` and the count at `index`.
fn split_count16(units: U16s<'static>, index: usize) -> Option<(U16s<'static>, usize)> {
    units
        .get(index)
        .map(|count| (view_from(units, index + 1), count.into()))
}

#[inline(always)]
fn rank_of(offset: u32) -> u32 {
    offset >> RANK_SHIFT << RANK_SHIFT
}

#[inline(always)]
fn units_in_image(text: &Text, offset: u32) -> U16s<'static> {
    let image = text.units((offset >> RANK_SHIFT) as usize);
    view_from(image, (offset as u16).into())
}

#[inline(always)]
fn table_in_text(text: &Text, res: Resource) -> Option<(Keys, Items)> {
    let offset = res_get_offset(res);
    match res_get_type(res) {
        URES_TABLE16 => {
            let (keys, length) = split_count16(units_in_image(text, offset), 0)?;
            let items = Items::InImage(view_from(keys, length), length as u16, rank_of(offset));
            Some((Keys::Offsets16(keys), items))
        }
        URES_TABLE32 => {
            let host = text.host(offset as usize);
            let keys = U16s::of(host.keys().as_bytes());
            Some((Keys::Offsets16(keys), Items::OfHost(host)))
        }
        _ => None,
    }
}

/// Without a NUL `table_key` is not equal to any key.
#[inline]
fn compare_keys(key: &[u8], DataKey(table_key): DataKey) -> Ordering {
    if let Some((c1, c2)) = key.iter().zip(table_key).find(|(c1, c2)| c1 != c2) {
        // Perf: `cmp` would test for equality again.
        return if c1 < c2 {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }
    match table_key.get(key.len()) {
        Some(0) => Ordering::Equal,
        Some(_) => Ordering::Less,
        None => Ordering::Greater,
    }
}

#[inline(always)]
fn place_in_image(pool: &[u8], offsets: U16s, length: usize, key: &[u8]) -> Option<usize> {
    let search = |key: Key| binary_search(length, |i| key.compare(pool, offsets.get(i)?));
    // Perf: short keys get a loop of their own.
    match key.len() {
        ..8 => search(Key::new(key)),
        _ => search(Key::new(key)),
    }
}

#[inline(always)]
fn binary_search(length: usize, compare: impl Fn(usize) -> Option<Ordering>) -> Option<usize> {
    let (mut start, mut limit) = (0, length);
    while start < limit {
        let middle = (start + limit) / 2;
        match compare(middle)? {
            Ordering::Less => limit = middle,
            Ordering::Greater => start = middle + 1,
            Ordering::Equal => return Some(middle),
        }
    }
    None
}

pub(crate) struct ResourceData {
    bytes: &'static [u8],
    units: U16s<'static>,
    pool: Option<&'static ResourceData>,
    pool_keys: &'static [u8],
    pub(crate) root_res: Resource,
    local_key_limit: i32,
    pool_string_index_limit: u32,
    pool_string_index16_limit: u32,
    pub(crate) no_fallback: bool,
    is_pool_bundle: bool,
    pub(crate) uses_pool_bundle: bool,
    /// Keys and binaries are in the forms of the linked package.
    pub(crate) is_image: bool,
    text: Option<Box<Text>>,
}

/// What `count_items` returns for a table that `count_present` has to read.
pub(crate) const UNCOUNTED: usize = usize::MAX;

impl ResourceData {
    /// The root is the empty string.
    pub(crate) fn empty() -> Self {
        Self {
            bytes: &[],
            units: const { U16s::of(EMPTY.0.split_at(2).0) },
            pool: None,
            pool_keys: &[],
            root_res: 0,
            local_key_limit: 0,
            pool_string_index_limit: 0,
            pool_string_index16_limit: 0,
            no_fallback: false,
            is_pool_bundle: false,
            uses_pool_bundle: false,
            is_image: false,
            text: None,
        }
    }

    fn of_image(
        bytes: &'static [u8],
        pool_keys: &'static [u8],
        root_res: Resource,
        no_fallback: bool,
    ) -> Self {
        Self {
            bytes,
            units: U16s::of(bytes),
            pool_keys,
            root_res,
            no_fallback,
            is_image: true,
            ..Self::empty()
        }
    }

    fn of_text(text: Box<Text>) -> Self {
        Self {
            pool_keys: text.keys(),
            root_res: host_resource(ROOT),
            is_image: true,
            text: Some(text),
            ..Self::empty()
        }
    }

    /// Returns whether the root table can have a key like "%%Parent", which sorts before digits and letters.
    pub(crate) fn may_have_links(&self) -> bool {
        match &self.text {
            Some(text) => text.link.exists(),
            None => (self.key_by_index(self.root_res, 0)).is_some_and(|it| it.first_byte() <= b'%'),
        }
    }

    // ICU4C: uresdata.cpp, res_init
    fn new(
        UDataMemory {
            info,
            memory: bytes,
        }: UDataMemory,
    ) -> Result<Self, UErrorCode> {
        let mut data = Self {
            bytes,
            root_res: U32s::of(bytes).get(0).unwrap_or_default(),
            ..Self::empty()
        };
        if !ures_is_table(res_get_type(data.root_res)) {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        if let [1, 0, ..] = info.format_version {
            data.local_key_limit = 0x10000;
            return Ok(data);
        }
        let index_length = (data.index(URES_INDEX_LENGTH) & 0xff) as usize;
        if index_length <= URES_INDEX_MAX_TABLE_LENGTH {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        let keys_top = data.index(URES_INDEX_KEYS_TOP).cast_signed();
        if keys_top > 1 + index_length as i32 {
            data.local_key_limit = keys_top.wrapping_mul(4);
        }
        if let [3, ..] = info.format_version {
            data.pool_string_index_limit = data.index(URES_INDEX_LENGTH) >> 8;
        }
        if index_length > URES_INDEX_ATTRIBUTES {
            let attributes = data.index(URES_INDEX_ATTRIBUTES);
            data.no_fallback = attributes & URES_ATT_NO_FALLBACK != 0;
            data.is_pool_bundle = attributes & URES_ATT_IS_POOL_BUNDLE != 0;
            data.uses_pool_bundle = attributes & URES_ATT_USES_POOL_BUNDLE != 0;
            data.pool_string_index_limit |= (attributes & 0xf000) << 12;
            data.pool_string_index16_limit = attributes >> 16;
        }
        if (data.is_pool_bundle || data.uses_pool_bundle)
            && index_length <= URES_INDEX_POOL_CHECKSUM
        {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        if index_length > URES_INDEX_16BIT_TOP
            && data.index(URES_INDEX_16BIT_TOP).cast_signed() > keys_top
        {
            data.units = view_from(U16s::of(bytes), to_index(keys_top).saturating_mul(2));
        }
        Ok(data)
    }

    /// Returns 0 if the file is too short.
    fn index(&self, index: usize) -> u32 {
        U32s::of(self.bytes).get(1 + index).unwrap_or_default()
    }

    pub(crate) fn use_pool(&mut self, pool: &'static Self) -> Result<(), UErrorCode> {
        if !pool.is_pool_bundle
            || self.index(URES_INDEX_POOL_CHECKSUM) != pool.index(URES_INDEX_POOL_CHECKSUM)
        {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        self.pool_keys = pool
            .bytes
            .slice(4 * (1 + (pool.index(URES_INDEX_LENGTH) & 0xff) as usize)..);
        self.pool = Some(pool);
        Ok(())
    }

    #[inline]
    fn key_at(&self, keys: Keys, i: usize) -> DataKey {
        DataKey(match keys {
            Keys::Offsets16(offsets) => match i32::from(offsets.at(i)) {
                offset if offset < self.local_key_limit => self.bytes.slice(to_index(offset)..),
                offset => self
                    .pool_keys
                    .slice(to_index(offset.wrapping_sub(self.local_key_limit))..),
            },
            Keys::Offsets32(offsets) => match offsets.at(i) {
                offset @ 0.. => self.bytes.slice(to_index(offset)..),
                offset => self.pool_keys.slice(to_index(offset & i32::MAX)..),
            },
        })
    }

    fn search(&self, keys: Keys, items: Items, key: &[u8]) -> Option<usize> {
        match (keys, items) {
            (_, Items::OfHost(host)) => {
                let key = Key::new(key);
                let place = host.place_for(key)?;
                (key.compare(self.pool_keys, host.child(place)?.0)?.is_eq()).then_some(place)
            }
            (Keys::Offsets16(offsets), _) if self.is_image => {
                place_in_image(self.pool_keys, offsets, items.len(), key)
            }
            _ => binary_search(items.len(), |i| {
                Some(compare_keys(key, self.key_at(keys, i)))
            }),
        }
    }

    #[inline(always)]
    fn item_at(&self, items: Items, place: usize) -> Option<Resource> {
        Some(match items {
            Items::Resources(resources, _) => resources.at(place),
            Items::Strings16(units, _) => {
                let offset = u32::from(units.at(place));
                let local = offset.checked_sub(self.pool_string_index16_limit);
                (URES_STRING_V2 as u32) << 28
                    | local.map_or(offset, |local| local + self.pool_string_index_limit)
            }
            Items::InImage(units, _, rank) => resource_in_image(rank, units.at(place)),
            Items::OfHost(host) => self.child_of_host(host, place)?,
        })
    }

    #[inline(never)]
    fn child_of_host(&self, host: Host, place: usize) -> Option<Resource> {
        (self.text.as_ref()?.child(host.child(place)?.1)).map(resource_of)
    }

    /// Returns the place and the resource of the first child that is present from the index `next` on, which passes it.
    #[inline(never)]
    fn next_child_of_host(&self, host: Host, next: &mut usize) -> Option<(usize, Resource)> {
        let text = self.text.as_ref()?;
        (host.places().from(*next).iter()).find_map(|place| {
            *next += 1;
            let child = text.child(host.child(place.into())?.1)?;
            Some((place.into(), resource_of(child)))
        })
    }

    #[cold]
    fn places_of_host(&self, host: Host) -> impl Iterator<Item = usize> {
        let mut next = 0;
        std::iter::from_fn(move || Some(self.next_child_of_host(host, &mut next)?.0))
    }

    /// Returns the place of the item with the index `i`.
    #[inline]
    fn place_of(&self, items: Items, i: usize) -> Option<usize> {
        match items {
            Items::OfHost(host) => self.places_of_host(host).nth(i),
            _ => (i < items.len()).then_some(i),
        }
    }

    #[inline]
    fn count(&self, items: Items) -> usize {
        match items {
            Items::OfHost(host) => self.places_of_host(host).count(),
            _ => items.len(),
        }
    }

    /// Returns the units from `offset` to the end of the bundle or the image.
    #[inline(always)]
    fn units_from(&self, offset: u32) -> U16s<'static> {
        match &self.text {
            None => view_from(self.units, offset as usize),
            Some(text) => units_in_image(text, offset),
        }
    }

    /// Returns the bytes after the count at the offset of `res`, and the count, if so many elements of `size` bytes follow.
    #[inline]
    fn split_count32(&self, res: Resource, size: usize) -> Option<(&'static [u8], usize)> {
        let start = match res_get_offset(res) {
            0 => &EMPTY.0,
            offset if self.text.is_some() => self.units_from(offset).as_bytes(),
            offset => self.bytes.get(4 * offset as usize..)?,
        };
        let (count, rest) = start.split_first_chunk()?;
        let count = to_index(i32::from_ne_bytes(*count));
        crate::common::soft_assert!(count <= rest.len() / size);
        (count <= rest.len() / size).then_some((rest, count))
    }

    /// Reads a string or an alias with a 32-bit length.
    fn string32(&self, res: Resource) -> Option<DataString> {
        self.split_count32(res, 2)
            .and_then(|(rest, length)| DataString::new(U16s::of(rest), length))
    }

    /// Returns `None` if `res` is not a table, or if its length is invalid.
    #[inline(always)]
    fn table(&self, res: Resource) -> Option<(Keys, Items)> {
        match &self.text {
            None => self.table_in_file(res),
            Some(text) => table_in_text(text, res),
        }
    }

    #[inline(always)]
    fn table_in_file(&self, res: Resource) -> Option<(Keys, Items)> {
        let offset = res_get_offset(res) as usize;
        Some(match res_get_type(res) {
            URES_TABLE if offset == 0 => (
                Keys::Offsets16(U16s::EMPTY),
                Items::Resources(U32s::EMPTY, 0),
            ),
            URES_TABLE => {
                let (keys, length) = split_count16(U16s::of(self.bytes), 2 * offset)?;
                let items = view_from(U32s::of(self.bytes), offset + 1 + length / 2);
                (Keys::Offsets16(keys), Items::Resources(items, length))
            }
            URES_TABLE16 => {
                let (keys, length) = split_count16(self.units, offset)?;
                (
                    Keys::Offsets16(keys),
                    Items::Strings16(view_from(keys, length), length),
                )
            }
            URES_TABLE32 => {
                let (keys, length) = self.split_count32(res, 8)?;
                (
                    Keys::Offsets32(I32s::of(keys)),
                    Items::Resources(view_from(U32s::of(keys), length), length),
                )
            }
            _ => return None,
        })
    }

    /// Returns `None` if `res` is not an array, or if its length is invalid.
    #[inline(always)]
    fn array(&self, res: Resource) -> Option<Items> {
        let offset = res_get_offset(res);
        match (res_get_type(res), &self.text) {
            (URES_ARRAY, _) => self
                .split_count32(res, 4)
                .map(|(items, length)| Items::Resources(U32s::of(items), length)),
            (URES_ARRAY16, None) => split_count16(self.units, offset as usize)
                .map(|(items, length)| Items::Strings16(items, length)),
            (URES_ARRAY16, Some(text)) => split_count16(units_in_image(text, offset), 0)
                .map(|(items, length)| Items::InImage(items, length as u16, rank_of(offset))),
            _ => None,
        }
    }

    /// Perf: each kind of table in the linked package has a function without the branches for the others.
    #[inline(never)]
    pub(crate) fn table_item_by_key(&self, table: Resource, key: &[u8]) -> Option<Resource> {
        let offset = res_get_offset(table);
        match (&self.text, res_get_type(table)) {
            (Some(text), URES_TABLE32) => self.item_of_host(text, offset, key),
            (Some(text), URES_TABLE16) => self.item_in_text(text, offset, key),
            (None, _) if self.is_image => self.item_in_image(table, key),
            _ => self.item_in_file(table, key),
        }
    }

    #[inline(never)]
    fn item_of_host(&self, text: &Text, part: u32, key: &[u8]) -> Option<Resource> {
        let (host, key) = (text.host(part as usize), Key::new(key));
        let (candidate, target) = host.child(host.place_for(key)?)?;
        let is_found = text.may_have(target) && key.compare(self.pool_keys, candidate)?.is_eq();
        is_found.then(|| text.child(target).map(resource_of))?
    }

    #[inline(never)]
    fn item_in_text(&self, text: &Text, offset: u32, key: &[u8]) -> Option<Resource> {
        let (keys, length) = split_count16(units_in_image(text, offset), 0)?;
        let place = place_in_image(self.pool_keys, keys, length, key)?;
        Some(resource_in_image(
            rank_of(offset),
            keys.get(length + place)?,
        ))
    }

    #[inline(never)]
    fn item_in_image(&self, table: Resource, key: &[u8]) -> Option<Resource> {
        let (Keys::Offsets16(keys), items) = self.table_in_file(table)? else {
            return None;
        };
        self.item_at(
            items,
            place_in_image(self.pool_keys, keys, items.len(), key)?,
        )
    }

    #[inline(never)]
    fn item_in_file(&self, table: Resource, key: &[u8]) -> Option<Resource> {
        let (keys, items) = self.table(table)?;
        self.item_at(items, self.search(keys, items, key)?)
    }

    /// Returns the copy of `key` that the data have.
    #[cold]
    pub(crate) fn find_key(&self, table: Resource, key: &[u8]) -> Option<DataKey> {
        let (keys, items) = self.table(table)?;
        let place = self.search(keys, items, key)?;
        (self.item_at(items, place)).map(|_| self.key_at(keys, place))
    }

    #[inline]
    pub(crate) fn item_by_index(&self, container: Resource, i: usize) -> Option<Resource> {
        if ures_is_table(res_get_type(container)) {
            return self.table_item_by_index(container, i);
        }
        let items = self.array(container)?;
        (i < items.len()).then(|| self.item_at(items, i))?
    }

    #[inline(never)]
    fn table_item_by_index(&self, table: Resource, i: usize) -> Option<Resource> {
        let (_, items) = self.table(table)?;
        self.item_at(items, self.place_of(items, i)?)
    }

    pub(crate) fn key_by_index(&self, table: Resource, i: usize) -> Option<DataKey> {
        let (keys, items) = self.table(table)?;
        Some(self.key_at(keys, self.place_of(items, i)?))
    }

    /// Returns `None` if the length of a table or array is invalid. Other types are checked when read.
    #[inline]
    pub(crate) fn count_items(&self, res: Resource) -> Option<usize> {
        match res_get_type(res) {
            URES_TABLE16 | URES_ARRAY16 => {
                (self.units_from(res_get_offset(res)).get(0)).map(usize::from)
            }
            URES_TABLE32 if self.text.is_some() => Some(UNCOUNTED),
            URES_ARRAY => self.array(res).map(Items::len),
            URES_TABLE | URES_TABLE32 => self.table_in_file(res).map(|it| it.1.len()),
            _ => Some(1),
        }
    }

    #[cold]
    pub(crate) fn count_present(&self, table: Resource) -> usize {
        self.table(table).map_or(0, |it| self.count(it.1))
    }

    /// Returns the units from `offset` to the end of this bundle or the pool bundle.
    #[inline]
    fn string_v2_at(&self, offset: u32) -> Option<U16s<'static>> {
        Some(match offset.checked_sub(self.pool_string_index_limit) {
            Some(local) => self.units_from(local),
            None => view_from(self.pool?.units, offset as usize),
        })
    }
}

pub(crate) fn res_load(
    path: Option<&[u8]>,
    name: &[u8],
    places: Places,
) -> Result<ResourceData, UErrorCode> {
    let is_acceptable = |info: &UDataInfo| {
        info.sizeof_uchar == 2
            && &info.data_format == b"ResB"
            && matches!(info.format_version, [1..=3, ..])
    };
    match udata::open_bundle(path, name, is_acceptable, places)? {
        Data::Item(item) => ResourceData::new(item),
        Data::Image {
            bytes,
            keys,
            root,
            no_fallback,
        } => Ok(ResourceData::of_image(bytes, keys, root, no_fallback)),
        Data::Text(text) => Ok(ResourceData::of_text(text)),
    }
}

pub(crate) fn res_get_data_string(data: &ResourceData, res: Resource) -> Option<DataString> {
    match res_get_type(res) {
        URES_STRING => data.string32(res),
        URES_STRING_V2 => {
            let units = data.string_v2_at(res_get_offset(res))?;
            let unit = |at| i32::from(units.at(at));
            let (start, length) = match i32::from(units.get(0)?) {
                ..0xdc00 | 0xe000.. => {
                    let units = units.as_bytes().as_chunks().0;
                    return units
                        .get(..=units.iter().position(|&unit| unit == [0; 2])?)
                        .map(DataString);
                }
                first @ ..0xdfef => (1, first & 0x3ff),
                first @ ..0xdfff => (2, (first - 0xdfef) << 16 | unit(1)),
                0xdfff => (3, unit(1) << 16 | unit(2)),
            };
            DataString::new(view_from(units, start), to_index(length))
        }
        _ => None,
    }
}

/// Follows `path` ("zoneStrings/3/2") through tables and arrays, and leaves the unresolved part in `path`.
pub(crate) fn res_find_resource(
    data: &ResourceData,
    mut res: Resource,
    path: &mut &[u8],
) -> Option<Resource> {
    while !path.is_empty() {
        let (key, rest) = split_once(path, RES_PATH_SEPARATOR);
        res = match (res_get_type(res), key) {
            (_, []) => None,
            (URES_ARRAY | URES_ARRAY16, _) => match strtol(key) {
                (index, true) => data.item_by_index(res, to_index(index)),
                _ => None,
            },
            _ => data.table_item_by_key(res, key),
        }?;
        *path = rest.unwrap_or_default();
        if !is_container(res_get_type(res)) {
            break;
        }
    }
    Some(res)
}

/// Returns the last key of `path`, all of which `res_find_resource` follows, unless it is an index into an array.
#[cold]
pub(crate) fn res_find_last_key(
    data: &ResourceData,
    res: Resource,
    path: &[u8],
) -> Option<DataKey> {
    let path = path.strip_suffix(&[RES_PATH_SEPARATOR]).unwrap_or(path);
    let start = find_last_byte(path, RES_PATH_SEPARATOR).map_or(0, |at| at + 1);
    let (mut to_container, key) = path.split_soft(start);
    data.find_key(res_find_resource(data, res, &mut to_container)?, key)
}

/// Returns `(int32_t)strtol(s, &end, 10)` and whether `*end == 0`.
pub(crate) fn strtol(s: &[u8]) -> (i32, bool) {
    let (sign, number) = match s.split_while(|c| matches!(c, b' ' | b'\t'..=b'\r')).1 {
        [b'-', number @ ..] => (-1, number),
        [b'+', number @ ..] | number => (1, number),
    };
    let (digits, rest) = number.split_while(u8::is_ascii_digit);
    let add = |value: c_long, digit: &u8| {
        value
            .saturating_mul(10)
            .saturating_add(sign * c_long::from(digit - b'0'))
    };
    // Without digits `end` is `s`.
    let is_at_end = rest.is_empty() && digits.is_empty() == s.is_empty();
    (digits.iter().fold(0, add) as i32, is_at_end)
}

#[derive(Clone, Copy)]
pub(crate) struct ResourceValue {
    /// The bundle file that contains the resource.
    pub(crate) entry: Entry,
    /// The bundle file that was opened, in which an alias "/LOCALE/..." is resolved.
    pub(crate) valid_locale_entry: Entry,
    pub(crate) res: Resource,
}

impl ResourceValue {
    /// Returns another resource of the same lookup.
    pub(crate) fn with(self, entry: Entry, res: Resource) -> Self {
        Self { entry, res, ..self }
    }

    pub(crate) fn get_data(&self) -> &'static ResourceData {
        &self.entry.data
    }

    #[inline]
    pub(crate) fn get_type(&self) -> UResType {
        match res_get_type(self.res) {
            URES_TABLE32 | URES_TABLE16 => URES_TABLE,
            URES_STRING_V2 => URES_STRING,
            URES_ARRAY16 => URES_ARRAY,
            public => public,
        }
    }

    pub(crate) fn is_alias(&self) -> bool {
        res_get_type(self.res) == URES_ALIAS
    }

    pub(crate) fn get_string(&self) -> Result<U16s<'static>, UErrorCode> {
        self.get_data_string().map(DataString::units)
    }

    pub(crate) fn get_data_string(&self) -> Result<DataString, UErrorCode> {
        res_get_data_string(self.get_data(), self.res).ok_or(U_RESOURCE_TYPE_MISMATCH)
    }

    pub(crate) fn get_unicode_string(&self) -> Result<Vec<u16>, UErrorCode> {
        self.get_string()?.try_to_vec()
    }

    /// Returns whether the value is CLDR's "∅∅∅". The offset 0 and a length field of two or three units do not match.
    pub(crate) fn is_no_inheritance_marker(&self) -> bool {
        let is_marker = |units: U16s| {
            let start = [0, 1, 2, 3].map(|i| units.get(i).unwrap_or_default());
            matches!(
                start,
                [0x2205, 0x2205, 0x2205, 0] | [0xdc03, 0x2205, 0x2205, 0x2205]
            )
        };
        let (data, offset) = (self.get_data(), res_get_offset(self.res));
        match res_get_type(self.res) {
            URES_STRING_V2 if offset != 0 => data.string_v2_at(offset).is_some_and(is_marker),
            URES_STRING => data
                .string32(self.res)
                .is_some_and(DataString::is_empty_sets),
            _ => false,
        }
    }

    /// Returns the elements of a binary or an integer vector, each of `size` bytes.
    fn payload(&self, type_: i32, size: usize) -> Result<&'static [u8], UErrorCode> {
        let found = if res_get_type(self.res) == type_ {
            self.get_data().split_count32(self.res, size)
        } else {
            None
        };
        found
            .map(|(rest, count)| rest.slice(..size * count))
            .ok_or(U_RESOURCE_TYPE_MISMATCH)
    }

    pub(crate) fn get_alias_string(&self) -> Result<U16s<'static>, UErrorCode> {
        let alias = self.is_alias().then(|| self.get_data().string32(self.res));
        (alias.flatten().map(DataString::units)).ok_or(U_RESOURCE_TYPE_MISMATCH)
    }

    pub(crate) fn get_int(&self) -> Result<i32, UErrorCode> {
        if res_get_type(self.res) == URES_INT {
            Ok((self.res << 4).cast_signed() >> 4)
        } else {
            Err(U_RESOURCE_TYPE_MISMATCH)
        }
    }

    pub(crate) fn get_int_vector(&self) -> Result<I32s<'static>, UErrorCode> {
        self.payload(URES_INT_VECTOR, 4).map(I32s::of)
    }

    pub(crate) fn get_binary(&self) -> Result<&'static [u8], UErrorCode> {
        self.payload(URES_BINARY, 1)
    }

    #[inline(always)]
    pub(crate) fn get_array(&self) -> Result<ResourceArray, UErrorCode> {
        let items = self
            .get_data()
            .array(self.res)
            .ok_or(U_RESOURCE_TYPE_MISMATCH)?;
        Ok(ResourceArray {
            origin: *self,
            items,
        })
    }

    /// Perf: to read a table that has just been returned in memory stalls.
    #[inline(always)]
    pub(crate) fn get_table(&self) -> Result<ResourceTable, UErrorCode> {
        let (keys, items) = self
            .get_data()
            .table(self.res)
            .ok_or(U_RESOURCE_TYPE_MISMATCH)?;
        Ok(ResourceTable {
            origin: *self,
            keys,
            items,
        })
    }

    #[inline]
    fn item_at(&self, items: Items, place: usize) -> Option<Self> {
        let res = self.get_data().item_at(items, place)?;
        Some(Self { res, ..*self })
    }
}

impl ResourceTable {
    pub(crate) fn get_size(&self) -> usize {
        self.origin.get_data().count(self.items)
    }

    pub(crate) fn get(&self, key: &[u8]) -> Option<ResourceValue> {
        let place = (self.origin.get_data()).search(self.keys, self.items, key)?;
        self.origin.item_at(self.items, place)
    }

    pub(crate) fn key_at(&self, i: usize) -> Option<DataKey> {
        let data = self.origin.get_data();
        Some(data.key_at(self.keys, data.place_of(self.items, i)?))
    }

    pub(crate) fn iter(
        &self,
    ) -> impl Iterator<Item = (&'static [u8], ResourceValue)> + Clone + use<> {
        self.iter_data_keys()
            .map(|(key, value)| (key.as_bytes(), value))
    }

    pub(crate) fn iter_data_keys(
        &self,
    ) -> impl Iterator<Item = (DataKey, ResourceValue)> + Clone + use<> {
        TableItems {
            table: *self,
            length: self.items.len(),
            next: 0,
        }
    }
}

#[derive(Clone)]
struct TableItems {
    table: ResourceTable,
    length: usize,
    next: usize,
}

impl Iterator for TableItems {
    type Item = (DataKey, ResourceValue);

    #[inline(always)]
    fn next(&mut self) -> Option<Self::Item> {
        let (origin, data) = (self.table.origin, self.table.origin.get_data());
        let (place, res) = match self.table.items {
            Items::OfHost(host) => data.next_child_of_host(host, &mut self.next)?,
            items if self.next < self.length => {
                self.next += 1;
                (self.next - 1, data.item_at(items, self.next - 1)?)
            }
            _ => return None,
        };
        let key = data.key_at(self.table.keys, place);
        Some((key, ResourceValue { res, ..origin }))
    }
}

impl ResourceArray {
    pub(crate) fn get_size(&self) -> usize {
        self.items.len()
    }

    pub(crate) fn get(&self, i: usize) -> Option<ResourceValue> {
        (i < self.get_size()).then(|| self.origin.item_at(self.items, i))?
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = ResourceValue> + Clone + use<> {
        let Self { origin, items } = *self;
        (0..items.len()).map_while(move |i| origin.item_at(items, i))
    }
}
