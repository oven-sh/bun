use core::ptr;

use crate::jsc::{ExternColumnIdentifier, JSGlobalObject, JSType, JSValue, JsError, JsResult};
use bun_collections::StringHashMap;
use bun_core::UnwrapOrOom as _;
use bun_core::wtf::WTFStringImpl;
use bun_sql::shared::{ColumnIdentifier, Data};

// Note: This entire type is passed by pointer across FFI to C++
// (`JSC__constructObjectFromDataCell`), which copies what it needs out of each
// cell. Field layout is load-bearing. A cell owns nothing: every pointer in
// `Value` borrows either the connection's read buffer or the row's
// [`CellStorage`], which the decoder keeps alive until the C++ call returns.
// `free_value` stays in the layout for SQLClient.cpp and is always 0.

#[repr(C)]
#[derive(Copy, Clone)]
pub struct SQLDataCell {
    pub(crate) tag: Tag,

    pub(crate) value: Value,
    pub(crate) free_value: u8,
    pub(crate) is_indexed_column: u8,
    pub(crate) index: u32,
}

/// Owns the heap data one row's cells point into — decoded strings, unescaped
/// `bytea`, text-array element vectors, byte-swapped typed arrays — until C++
/// has copied them into JS values.
#[derive(Default)]
pub struct CellStorage {
    strings: Vec<bun_core::String>,
    bytes: Vec<Box<[u8]>>,
    arrays: Vec<Vec<SQLDataCell>>,
}

impl CellStorage {
    /// Keep `string` alive for the row and return the `StringImpl*` C++ reads
    /// (null for a non-WTF/empty string).
    pub(crate) fn hold_string(&mut self, string: bun_core::String) -> WTFStringImpl {
        let ptr = string.leak_wtf_impl();
        if !ptr.is_null() {
            self.strings.push(bun_core::String::adopt_wtf_impl(ptr));
        }
        ptr
    }

    /// Keep `bytes` alive for the row and return where they now live.
    pub(crate) fn hold_bytes(&mut self, bytes: Box<[u8]>) -> &[u8] {
        self.bytes.push(bytes);
        self.bytes.last().unwrap()
    }

    /// Keep `cells` alive for the row and return the array header C++ reads.
    pub(crate) fn hold_array(&mut self, mut cells: Vec<SQLDataCell>) -> Array {
        let array = Array {
            ptr: cells.as_mut_ptr(),
            len: cells.len() as u32,
            cap: cells.capacity() as u32,
        };
        self.arrays.push(cells);
        array
    }
}

impl Default for SQLDataCell {
    fn default() -> Self {
        Self {
            tag: Tag::Null,
            value: Value { null: 0 },
            free_value: 0,
            is_indexed_column: 0,
            index: 0,
        }
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Tag {
    Null = 0,
    String = 1,
    Float8 = 2,
    Int4 = 3,
    Int8 = 4,
    Bool = 5,
    Date = 6,
    DateWithTimeZone = 7,
    Bytea = 8,
    Json = 9,
    Array = 10,
    TypedArray = 11,
    Raw = 12,
    Uint4 = 13,
    Uint8 = 14,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub union Value {
    pub(crate) null: u8,
    // Borrowed from the row's `CellStorage` (or null).
    pub(crate) string: WTFStringImpl,
    pub(crate) float8: f64,
    pub(crate) int4: i32,
    pub(crate) int8: i64,
    pub(crate) bool_: u8, // `bool` is a Rust keyword
    pub(crate) date: f64,
    pub(crate) date_with_time_zone: f64,
    pub(crate) bytea: [usize; 2],
    // Borrowed from the row's `CellStorage` (or null).
    pub(crate) json: WTFStringImpl,
    pub(crate) array: Array,
    pub(crate) typed_array: TypedArray,
    pub(crate) raw: Raw,
    pub(crate) uint4: u32,
    pub(crate) uint8: u64,
}

/// Header of a `Vec<SQLDataCell>` held in the row's [`CellStorage`]; C++
/// reads `ptr[..len]`.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct Array {
    pub(crate) ptr: *mut SQLDataCell,
    pub(crate) len: u32,
    pub(crate) cap: u32,
}

impl Default for Array {
    fn default() -> Self {
        Self {
            ptr: ptr::null_mut(),
            len: 0,
            cap: 0,
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct Raw {
    pub(crate) ptr: *const u8,
    pub(crate) len: u64,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct TypedArray {
    // Borrowed from the row's `CellStorage`; thin raw ptrs for the
    // #[repr(C)] FFI layout (a Rust slice ref is a fat pointer).
    pub(crate) head_ptr: *mut u8,
    pub(crate) ptr: *mut u8,
    pub(crate) len: u32,
    pub(crate) byte_len: u32,
    pub(crate) type_: JSType, // `type` is a Rust keyword
}

impl SQLDataCell {
    #[inline]
    pub(crate) fn null() -> SQLDataCell {
        SQLDataCell::default()
    }

    /// A `Null`-tagged cell pre-classified for `column` at ordinal `position`,
    /// seeding the row buffer so cells a short DataRow never fills still carry
    /// the right named/indexed/duplicate flag into `toJS`.
    #[inline]
    pub(crate) fn null_for_column(position: u32, column: &ColumnIdentifier) -> SQLDataCell {
        let mut cell = SQLDataCell::null();
        cell.set_column(position, column);
        cell
    }

    /// Tags the cell with the column it was decoded for, in the encoding
    /// SQLClient.cpp's `DataCell` reads: `is_indexed_column` is 0 for a named
    /// column, 1 for an all-digits name (the object key is that number, not the
    /// ordinal `position`, so indexed cells can land out of order) and 2 for a
    /// duplicate, which object-mode results skip.
    #[inline]
    pub(crate) fn set_column(&mut self, position: u32, column: &ColumnIdentifier) {
        self.is_indexed_column = match column {
            ColumnIdentifier::Duplicate => 2,
            ColumnIdentifier::Index(_) => 1,
            ColumnIdentifier::Name(_) => 0,
        };
        self.index = match column {
            ColumnIdentifier::Index(i) => *i,
            _ => position,
        };
    }

    #[inline]
    pub(crate) fn int4(value: i32) -> SQLDataCell {
        SQLDataCell {
            tag: Tag::Int4,
            value: Value { int4: value },
            ..Default::default()
        }
    }

    #[inline]
    pub(crate) fn uint4(value: u32) -> SQLDataCell {
        SQLDataCell {
            tag: Tag::Uint4,
            value: Value { uint4: value },
            ..Default::default()
        }
    }

    #[inline]
    pub(crate) fn int8(value: i64) -> SQLDataCell {
        SQLDataCell {
            tag: Tag::Int8,
            value: Value { int8: value },
            ..Default::default()
        }
    }

    #[inline]
    pub(crate) fn uint8(value: u64) -> SQLDataCell {
        SQLDataCell {
            tag: Tag::Uint8,
            value: Value { uint8: value },
            ..Default::default()
        }
    }

    #[inline]
    pub(crate) fn float8(value: f64) -> SQLDataCell {
        SQLDataCell {
            tag: Tag::Float8,
            value: Value { float8: value },
            ..Default::default()
        }
    }

    #[inline]
    pub(crate) fn bool(value: bool) -> SQLDataCell {
        SQLDataCell {
            tag: Tag::Bool,
            value: Value { bool_: value as u8 },
            ..Default::default()
        }
    }

    #[inline]
    pub(crate) fn date(value: f64) -> SQLDataCell {
        SQLDataCell {
            tag: Tag::Date,
            value: Value { date: value },
            ..Default::default()
        }
    }

    #[inline]
    pub(crate) fn date_with_tz(value: f64) -> SQLDataCell {
        SQLDataCell {
            tag: Tag::DateWithTimeZone,
            value: Value {
                date_with_time_zone: value,
            },
            ..Default::default()
        }
    }

    /// String cell: clones `bytes` into a WTFStringImpl held by `storage`.
    /// Empty input becomes a null pointer, which the C++ side (SQLClient.cpp)
    /// renders as the empty string.
    #[inline]
    pub(crate) fn string(storage: &mut CellStorage, bytes: &[u8]) -> SQLDataCell {
        SQLDataCell {
            tag: Tag::String,
            value: Value {
                string: clone_utf8_or_null(storage, bytes),
            },
            ..Default::default()
        }
    }

    /// JSON cell: clones `bytes` into a WTFStringImpl held by `storage`. Empty
    /// input becomes a null pointer, which the C++ side (SQLClient.cpp)
    /// renders as `null`.
    #[inline]
    pub(crate) fn json(storage: &mut CellStorage, bytes: &[u8]) -> SQLDataCell {
        SQLDataCell {
            tag: Tag::Json,
            value: Value {
                json: clone_utf8_or_null(storage, bytes),
            },
            ..Default::default()
        }
    }

    /// `bytea` cell borrowing `bytes` (the read buffer or the row's storage).
    #[inline]
    pub(crate) fn bytea(bytes: &[u8]) -> SQLDataCell {
        SQLDataCell {
            tag: Tag::Bytea,
            value: Value {
                bytea: [bytes.as_ptr() as usize, bytes.len()],
            },
            ..Default::default()
        }
    }

    pub(crate) fn raw<'a>(optional_bytes: impl IntoOptionalData<'a>) -> SQLDataCell {
        if let Some(bytes) = optional_bytes.into_optional_data() {
            let bytes_slice = bytes.slice();
            return SQLDataCell {
                tag: Tag::Raw,
                value: Value {
                    raw: Raw {
                        ptr: bytes_slice.as_ptr(),
                        len: bytes_slice.len() as u64,
                    },
                },
                ..Default::default()
            };
        }
        // TODO: check empty and null fields
        SQLDataCell::null()
    }

    /// Shared wrapper around `construct_object_from_data_cell` used by the
    /// per-row `to_js` paths (postgres `Putter`, mysql `Row`): extracts the
    /// cached-structure column names and forwards the cells.
    pub(crate) fn to_js_object(
        global_object: &JSGlobalObject,
        array: JSValue,
        structure: JSValue,
        cells: &mut [SQLDataCell],
        flags: Flags,
        result_mode: u8,
        cached_structure: Option<&crate::shared::CachedStructure>,
    ) -> JsResult<JSValue> {
        let names = cached_structure.and_then(|c| c.fields.as_deref());
        SQLDataCell::construct_object_from_data_cell(
            global_object,
            array,
            structure,
            cells,
            flags,
            result_mode,
            names,
        )
    }

    pub(crate) fn construct_object_from_data_cell(
        global_object: &JSGlobalObject,
        encoded_array_value: JSValue,
        encoded_structure_value: JSValue,
        cells: &mut [SQLDataCell],
        flags: Flags,
        result_mode: u8,
        names: Option<&[ExternColumnIdentifier]>,
    ) -> JsResult<JSValue> {
        let (names_ptr, names_count) = match names {
            Some(n) => (n.as_ptr(), n.len() as u32),
            None => (ptr::null(), 0),
        };
        // Open an `ExceptionValidationScope` so the C++
        // `DECLARE_THROW_SCOPE` inside
        // SQLClient.cpp's `toJS` (depth 0 → depth 1) has its post-call
        // `m_needExceptionCheck` satisfied here instead of tripping the next
        // `DECLARE_TOP_EXCEPTION_SCOPE` constructor's verifier. The macro is a
        // no-op in release and a real C++ scope under debug/ASAN.
        bun_jsc::validation_scope!(scope, global_object);

        let value = JSC__constructObjectFromDataCell(
            global_object,
            encoded_array_value,
            encoded_structure_value,
            cells.as_mut_ptr(),
            cells.len() as u32,
            flags,
            result_mode,
            names_ptr,
            names_count,
        );
        scope.assert_exception_presence_matches(value.is_empty());
        if value.is_empty() {
            return Err(JsError::Thrown);
        }
        Ok(value)
    }
}

/// Coercion helper for `raw()` call sites. Lets callers pass `&Data`, `&mut Data`,
/// `Option<&Data>`, or `Option<&mut Data>` without wrapping.
pub trait IntoOptionalData<'a> {
    fn into_optional_data(self) -> Option<&'a Data>;
}
impl<'a> IntoOptionalData<'a> for &'a Data {
    #[inline]
    fn into_optional_data(self) -> Option<&'a Data> {
        Some(self)
    }
}
impl<'a> IntoOptionalData<'a> for &'a mut Data {
    #[inline]
    fn into_optional_data(self) -> Option<&'a Data> {
        Some(&*self)
    }
}
impl<'a> IntoOptionalData<'a> for Option<&'a Data> {
    #[inline]
    fn into_optional_data(self) -> Option<&'a Data> {
        self
    }
}
impl<'a> IntoOptionalData<'a> for Option<&'a mut Data> {
    #[inline]
    fn into_optional_data(self) -> Option<&'a Data> {
        self.map(|d| &*d)
    }
}

/// Clones the bytes into a fresh `WTFStringImpl` held by `storage`. Empty
/// input maps to a null pointer instead of allocating an empty string.
#[inline]
fn clone_utf8_or_null(storage: &mut CellStorage, bytes: &[u8]) -> WTFStringImpl {
    if !bytes.is_empty() {
        storage.hold_string(bun_core::String::clone_utf8(bytes))
    } else {
        ptr::null_mut()
    }
}

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Copy, Clone, Default)]
    pub struct Flags: u32 {
        const HAS_INDEXED_COLUMNS   = 1 << 0;
        const HAS_NAMED_COLUMNS     = 1 << 1;
        const HAS_DUPLICATE_COLUMNS = 1 << 2;
        // remaining 29 bits: padding
    }
}

/// Rewrites repeated column identifiers to [`ColumnIdentifier::Duplicate`] and
/// accumulates the column-set [`Flags`]. Callers pass the columns in reverse
/// order so the LAST occurrence of a repeated name/index keeps its identifier.
pub(crate) fn dedupe_columns<'a>(
    columns: impl ExactSizeIterator<Item = &'a mut ColumnIdentifier>,
) -> Flags {
    let mut seen_numbers: Vec<u32> = Vec::new();
    // StringHashMap clones to an owned `Box<[u8]>` key. Fine for a transient
    // dedup set.
    let mut seen_fields: StringHashMap<()> = StringHashMap::default();
    seen_fields.reserve(columns.len());

    let mut flags = Flags::default();
    for name_or_index in columns {
        match &*name_or_index {
            ColumnIdentifier::Name(name) => {
                // reshaped for borrowck — compute `found_existing` before
                // mutating `*name_or_index`.
                let found_existing = seen_fields
                    .get_or_put(name.slice())
                    .unwrap_or_oom()
                    .found_existing;
                if found_existing {
                    *name_or_index = ColumnIdentifier::Duplicate;
                    flags.insert(Flags::HAS_DUPLICATE_COLUMNS);
                }

                flags.insert(Flags::HAS_NAMED_COLUMNS);
            }
            ColumnIdentifier::Index(index) => {
                let index = *index;
                if seen_numbers.contains(&index) {
                    *name_or_index = ColumnIdentifier::Duplicate;
                    flags.insert(Flags::HAS_DUPLICATE_COLUMNS);
                } else {
                    seen_numbers.push(index);
                }

                flags.insert(Flags::HAS_INDEXED_COLUMNS);
            }
            ColumnIdentifier::Duplicate => {
                flags.insert(Flags::HAS_DUPLICATE_COLUMNS);
            }
        }
    }

    flags
}

// Declared inline rather than in a dedicated `*_sys` crate: this is the only
// extern this crate calls and its sole consumer is the wrapper above.
unsafe extern "C" {
    // `&JSGlobalObject` is ABI-identical to a non-null `*const JSGlobalObject`;
    // remaining params are by-value scalars + (ptr,len) pairs the sole caller
    // (`construct_object_from_data_cell` above) takes from live slices, which
    // the C++ side reads within `count`/`names_count` → `safe fn`.
    safe fn JSC__constructObjectFromDataCell(
        global: &JSGlobalObject,
        encoded_array_value: JSValue,
        encoded_structure_value: JSValue,
        cells: *mut SQLDataCell,
        count: u32,
        flags: Flags,
        result_mode: u8,
        names: *const ExternColumnIdentifier,
        names_count: u32,
    ) -> JSValue;
}
