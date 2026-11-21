//! The binary format of resource bundles (`.res`). ICU4C: uresdata.cpp, uresdata.h

use crate::common::bytes::{I32s, U16s, U32s, View, Word};
use crate::common::cstring::{find_byte, split_once};
use crate::common::resource::{ResourceArray, ResourceTable};
use crate::common::slice_ext::{SliceExt, SoftUnwrap, to_index};
use crate::common::udata::{self, UDataMemory};
use crate::common::unicode::ures::*;
use crate::common::uresbund::Entry;
use crate::common::utypes::*;
use std::cmp::Ordering;
use std::ffi::CStr;

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
}

impl Items {
    fn len(self) -> usize {
        match self {
            Self::Strings16(_, length) | Self::Resources(_, length) => length,
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
}

impl ResourceData {
    // ICU4C: uresdata.cpp, res_init
    fn new(
        UDataMemory {
            info,
            memory: bytes,
        }: UDataMemory,
    ) -> Result<Self, UErrorCode> {
        let mut data = Self {
            bytes,
            units: const { U16s::of(EMPTY.0.split_at(2).0) },
            pool: None,
            pool_keys: &[],
            root_res: U32s::of(bytes).at(0),
            local_key_limit: 0,
            pool_string_index_limit: 0,
            pool_string_index16_limit: 0,
            no_fallback: false,
            is_pool_bundle: false,
            uses_pool_bundle: false,
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

    fn index(&self, index: usize) -> u32 {
        U32s::of(self.bytes).at(1 + index)
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

    #[inline]
    fn search(&self, keys: Keys, length: usize, key: &[u8]) -> Option<usize> {
        let (mut start, mut limit) = (0, length);
        while start < limit {
            let middle = (start + limit) / 2;
            match compare_keys(key, self.key_at(keys, middle)) {
                Ordering::Less => limit = middle,
                Ordering::Greater => start = middle + 1,
                Ordering::Equal => return Some(middle),
            }
        }
        None
    }

    #[inline]
    fn item_at(&self, items: Items, i: usize) -> Resource {
        match items {
            Items::Resources(resources, _) => resources.at(i),
            Items::Strings16(units, _) => {
                let offset = u32::from(units.at(i));
                let local = offset.checked_sub(self.pool_string_index16_limit);
                (URES_STRING_V2 as u32) << 28
                    | local.map_or(offset, |local| local + self.pool_string_index_limit)
            }
        }
    }

    /// Returns the bytes after the count at the offset of `res`, and the count, if so many elements of `size` bytes follow.
    #[inline]
    fn split_count32(&self, res: Resource, size: usize) -> Option<(&'static [u8], usize)> {
        let start = match res_get_offset(res) as usize {
            0 => &EMPTY.0,
            offset => self.bytes.get(4 * offset..)?,
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

    fn split_item_count16(&self, res: Resource) -> Option<(U16s<'static>, usize)> {
        split_count16(self.units, res_get_offset(res) as usize)
    }

    /// Returns `None` if `res` is not a table, or if its length is invalid.
    #[inline]
    fn table(&self, res: Resource) -> Option<(Keys, Items)> {
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
                let (keys, length) = self.split_item_count16(res)?;
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
    #[inline]
    fn array(&self, res: Resource) -> Option<Items> {
        match res_get_type(res) {
            URES_ARRAY => self
                .split_count32(res, 4)
                .map(|(items, length)| Items::Resources(U32s::of(items), length)),
            URES_ARRAY16 => self
                .split_item_count16(res)
                .map(|(items, length)| Items::Strings16(items, length)),
            _ => None,
        }
    }

    pub(crate) fn table_item_by_key(&self, table: Resource, key: &[u8]) -> Option<Resource> {
        let (keys, items) = self.table(table)?;
        Some(self.item_at(items, self.search(keys, items.len(), key)?))
    }

    /// Returns the items of a table or an array.
    #[inline]
    fn items(&self, container: Resource) -> Option<Items> {
        if ures_is_table(res_get_type(container)) {
            Some(self.table(container)?.1)
        } else {
            self.array(container)
        }
    }

    pub(crate) fn item_by_index(&self, container: Resource, i: usize) -> Option<Resource> {
        let items = self.items(container)?;
        (i < items.len()).then(|| self.item_at(items, i))
    }

    pub(crate) fn key_by_index(&self, table: Resource, i: usize) -> Option<DataKey> {
        let (keys, items) = self.table(table)?;
        (i < items.len()).then(|| self.key_at(keys, i))
    }

    /// Returns `None` if the length of a table or array is invalid. Other types are checked when read.
    pub(crate) fn count_items(&self, res: Resource) -> Option<usize> {
        if is_container(res_get_type(res)) {
            self.items(res).map(Items::len)
        } else {
            Some(1)
        }
    }

    /// Returns the units from `offset` to the end of this bundle or the pool bundle.
    #[inline]
    fn string_v2_at(&self, offset: u32) -> Option<U16s<'static>> {
        Some(match offset.checked_sub(self.pool_string_index_limit) {
            Some(local) => view_from(self.units, local as usize),
            None => view_from(self.pool?.units, offset as usize),
        })
    }
}

pub(crate) fn res_load(path: Option<&[u8]>, name: &[u8]) -> Result<ResourceData, UErrorCode> {
    ResourceData::new(udata::open_choice(path, b"res", name, |info| {
        info.sizeof_uchar == 2
            && &info.data_format == b"ResB"
            && matches!(info.format_version, [1..=3, ..])
    })?)
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
            (URES_ARRAY | URES_ARRAY16, [b'0'..=b'9', ..]) => {
                data.item_by_index(res, to_index(strtol(key).0))
            }
            _ => data.table_item_by_key(res, key),
        }?;
        *path = rest.unwrap_or_default();
        if !is_container(res_get_type(res)) {
            break;
        }
    }
    Some(res)
}

/// Returns the number at the start of `key`, and whether nothing follows it.
pub(crate) fn strtol(key: &[u8]) -> (i32, bool) {
    let (digits, rest) = key.split_while(u8::is_ascii_digit);
    let add = |number: i32, digit: &u8| {
        number
            .saturating_mul(10)
            .saturating_add(i32::from(digit - b'0'))
    };
    (digits.iter().fold(0, add), rest.is_empty())
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

    /// Returns whether the value is CLDR's "∅∅∅", without a length field or with one of one unit.
    pub(crate) fn is_no_inheritance_marker(&self) -> bool {
        let is_marker = |units: U16s| {
            let start = [0, 1, 2, 3].map(|i| units.get(i).unwrap_or_default());
            matches!(
                start,
                [0x2205, 0x2205, 0x2205, 0] | [0xdc03, 0x2205, 0x2205, 0x2205]
            )
        };
        res_get_type(self.res) == URES_STRING_V2
            && (self.get_data().string_v2_at(res_get_offset(self.res))).is_some_and(is_marker)
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

    fn item_at(&self, items: Items, i: usize) -> Self {
        Self {
            res: self.get_data().item_at(items, i),
            ..*self
        }
    }
}

impl ResourceTable {
    pub(crate) fn get_size(&self) -> usize {
        self.items.len()
    }

    pub(crate) fn get(&self, key: &[u8]) -> Option<ResourceValue> {
        let index = (self.origin.get_data()).search(self.keys, self.get_size(), key)?;
        Some(self.origin.item_at(self.items, index))
    }

    pub(crate) fn key_at(&self, i: usize) -> Option<DataKey> {
        (i < self.get_size()).then(|| self.origin.get_data().key_at(self.keys, i))
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
        let Self {
            origin,
            keys,
            items,
        } = *self;
        (0..items.len()).map(move |i| (origin.get_data().key_at(keys, i), origin.item_at(items, i)))
    }
}

impl ResourceArray {
    pub(crate) fn get_size(&self) -> usize {
        self.items.len()
    }

    pub(crate) fn get(&self, i: usize) -> Option<ResourceValue> {
        (i < self.get_size()).then(|| self.origin.item_at(self.items, i))
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = ResourceValue> + Clone + use<> {
        let Self { origin, items } = *self;
        (0..items.len()).map(move |i| origin.item_at(items, i))
    }
}
