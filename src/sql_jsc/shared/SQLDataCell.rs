use core::ptr;

use crate::jsc::{ExternColumnIdentifier, JSGlobalObject, JSValue, JsError, JsResult};
use bun_collections::StringHashMap;
use bun_core::UnwrapOrOom as _;
use bun_core::WTFString;
use bun_sql::shared::ColumnIdentifier;

/// `DataCell` in SQLClient.cpp, which only reads it.
#[repr(C)]
pub struct SQLDataCell {
    value: Value,
    is_indexed_column: u8,
    index: u32,
}

/// `DataCellTag` and `DataCellValue`.
#[repr(C, u8)]
#[expect(dead_code, reason = "C++ reads the payloads")]
enum Value {
    Null = 0,
    String(Option<WTFString>) = 1,
    Float8(f64) = 2,
    Int4(i32) = 3,
    Int8(i64) = 4,
    Bool(bool) = 5,
    Date(f64) = 6,
    Bytea(Array<u8>) = 7,
    Json(Option<WTFString>) = 8,
    Array(Array<SQLDataCell>) = 9,
    Raw(Raw) = 10,
    Uint4(u32) = 11,
    Uint8(u64) = 12,
    /// Numbers and nulls as JS holds them. None of them is a GC cell.
    Numbers(Array<JSValue>) = 13,
    Int32Array(Raw) = 14,
    Float32Array(Raw) = 15,
}

/// A `Vec<T>` with a layout that C++ knows.
#[repr(C)]
struct Array<T> {
    ptr: *mut T,
    len: u32,
    cap: u32,
}

impl<T> Array<T> {
    fn new(items: Vec<T>) -> Array<T> {
        debug_assert!(items.capacity() <= u32::MAX as usize);
        let (ptr, len, cap) = items.into_raw_parts();
        Array {
            ptr,
            len: len as u32,
            cap: cap as u32,
        }
    }
}

impl<T> Drop for Array<T> {
    fn drop(&mut self) {
        // SAFETY: the parts that `new` took from a `Vec<T>`.
        drop(unsafe { Vec::from_raw_parts(self.ptr, self.len as usize, self.cap as usize) });
    }
}

/// Borrowed from the message that is being decoded.
#[repr(C)]
struct Raw {
    ptr: *const u8,
    len: u64,
}

impl Raw {
    fn new<T>(items: &[T]) -> Raw {
        Raw {
            ptr: items.as_ptr().cast(),
            len: items.len() as u64,
        }
    }
}

// SQLClient.cpp asserts the same.
bun_core::assert_ffi_layout!(SQLDataCell, 32, 8; is_indexed_column @ 24, index @ 28);

impl SQLDataCell {
    fn new(value: Value) -> SQLDataCell {
        SQLDataCell {
            value,
            is_indexed_column: 0,
            index: 0,
        }
    }

    #[inline]
    pub(crate) fn null() -> SQLDataCell {
        SQLDataCell::new(Value::Null)
    }

    /// A `Null`-tagged cell pre-classified for `column` at ordinal `position`,
    /// so that the cells a short DataRow has left out still carry
    /// the right named/indexed/duplicate flag into `toJS`.
    #[inline]
    pub(crate) fn null_for_column(position: u32, column: &ColumnIdentifier) -> SQLDataCell {
        let mut cell = SQLDataCell::null();
        cell.set_column(position, column);
        cell
    }

    /// Tags the cell with the column it was decoded for, in the encoding
    /// SQLClient.cpp's `DataCell` reads: `is_indexed_column` is 0 for a named
    /// column, 1 for an array-index name (the object key is that number, not the
    /// ordinal `position`, so indexed cells can land out of order) and 2 for a
    /// duplicate, which object-mode results skip.
    #[inline]
    pub(crate) fn set_column(&mut self, position: u32, column: &ColumnIdentifier) {
        self.is_indexed_column = match column {
            ColumnIdentifier::Duplicate(_) => 2,
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
        SQLDataCell::new(Value::Int4(value))
    }

    #[inline]
    pub(crate) fn uint4(value: u32) -> SQLDataCell {
        SQLDataCell::new(Value::Uint4(value))
    }

    #[inline]
    pub(crate) fn int8(value: i64) -> SQLDataCell {
        SQLDataCell::new(Value::Int8(value))
    }

    #[inline]
    pub(crate) fn uint8(value: u64) -> SQLDataCell {
        SQLDataCell::new(Value::Uint8(value))
    }

    #[inline]
    pub(crate) fn float8(value: f64) -> SQLDataCell {
        SQLDataCell::new(Value::Float8(value))
    }

    #[inline]
    pub(crate) fn bool(value: bool) -> SQLDataCell {
        SQLDataCell::new(Value::Bool(value))
    }

    #[inline]
    pub(crate) fn date(value: f64) -> SQLDataCell {
        SQLDataCell::new(Value::Date(value))
    }

    /// Empty input has no string, which C++ renders as the empty string.
    #[inline]
    pub(crate) fn string(bytes: &[u8]) -> SQLDataCell {
        SQLDataCell::new(Value::String(
            bun_core::String::clone_utf8(bytes).into_wtf(),
        ))
    }

    /// Empty input has no string, which C++ renders as `null`.
    #[inline]
    pub(crate) fn json(bytes: &[u8]) -> SQLDataCell {
        SQLDataCell::new(Value::Json(bun_core::String::clone_utf8(bytes).into_wtf()))
    }

    pub(crate) fn bytea(bytes: Vec<u8>) -> SQLDataCell {
        SQLDataCell::new(Value::Bytea(Array::new(bytes)))
    }

    pub(crate) fn array(cells: Vec<SQLDataCell>) -> SQLDataCell {
        SQLDataCell::new(Value::Array(Array::new(cells)))
    }

    /// An array of numbers and nulls. A GC cell among them would not be kept alive.
    pub(crate) fn numbers(values: Vec<JSValue>) -> SQLDataCell {
        SQLDataCell::new(Value::Numbers(Array::new(values)))
    }

    /// For each element 4 bytes of size and 4 of value, big-endian, as the PostgreSQL server sends them.
    pub(crate) fn int32_array(elements: &[[u8; 8]]) -> SQLDataCell {
        SQLDataCell::new(Value::Int32Array(Raw::new(elements)))
    }

    /// As [`SQLDataCell::int32_array`].
    pub(crate) fn float32_array(elements: &[[u8; 8]]) -> SQLDataCell {
        SQLDataCell::new(Value::Float32Array(Raw::new(elements)))
    }

    /// `bytes` has to outlive the cell.
    pub(crate) fn raw(bytes: &[u8]) -> SQLDataCell {
        SQLDataCell::new(Value::Raw(Raw::new(bytes)))
    }

    /// `construct_object_from_data_cell` with the column names of `cached_structure`.
    pub(crate) fn to_js_object(
        global_object: &JSGlobalObject,
        array: JSValue,
        structure: JSValue,
        cells: &mut [SQLDataCell],
        flags: Flags,
        result_mode: u8,
        cached_structure: Option<&crate::shared::CachedStructure>,
    ) -> JsResult<JSValue> {
        let (names, names_count) = match cached_structure.and_then(|c| c.fields.as_deref()) {
            Some(f) => (f.as_ptr().cast_mut(), f.len() as u32),
            None => (ptr::null_mut(), 0),
        };

        SQLDataCell::construct_object_from_data_cell(
            global_object,
            array,
            structure,
            cells.as_mut_ptr(),
            cells.len() as u32,
            flags,
            result_mode,
            names,
            names_count,
        )
    }

    // TODO: cppbind isn't yet able to detect slice parameters when the next is uint32_t
    pub(crate) fn construct_object_from_data_cell(
        global_object: &JSGlobalObject,
        encoded_array_value: JSValue,
        encoded_structure_value: JSValue,
        cells: *mut SQLDataCell,
        count: u32,
        flags: Flags,
        result_mode: u8,
        // Accepts both a raw `*mut` (null == None) and an explicit
        // `Option<*mut _>`; collapsed to a raw pointer for the FFI call below.
        names_ptr: impl Into<Option<*mut ExternColumnIdentifier>>,
        names_count: u32,
    ) -> JsResult<JSValue> {
        let names_ptr: *mut ExternColumnIdentifier = names_ptr.into().unwrap_or(ptr::null_mut());
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
            cells,
            count,
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
        // The verdict of an earlier pass, when the other columns may have had other names.
        if let ColumnIdentifier::Duplicate(name) = &mut *name_or_index {
            *name_or_index = ColumnIdentifier::init(core::mem::take(name).into());
        }
        match &mut *name_or_index {
            ColumnIdentifier::Name(name) => {
                let found_existing = seen_fields.get_or_put(name).unwrap_or_oom().found_existing;
                if found_existing {
                    *name_or_index = ColumnIdentifier::Duplicate(core::mem::take(name));
                    flags.insert(Flags::HAS_DUPLICATE_COLUMNS);
                }

                flags.insert(Flags::HAS_NAMED_COLUMNS);
            }
            ColumnIdentifier::Index(index) => {
                let index = *index;
                if seen_numbers.contains(&index) {
                    let mut digits = bun_core::fmt::ItoaBuf::new();
                    *name_or_index = ColumnIdentifier::Duplicate(
                        bun_core::fmt::itoa(&mut digits, index).to_vec(),
                    );
                    flags.insert(Flags::HAS_DUPLICATE_COLUMNS);
                } else {
                    seen_numbers.push(index);
                }

                flags.insert(Flags::HAS_INDEXED_COLUMNS);
            }
            ColumnIdentifier::Duplicate(_) => unreachable!(),
        }
    }

    flags
}

// Declared inline rather than in a dedicated `*_sys` crate: this is the only
// extern this crate calls and its sole consumer is the wrapper above.
unsafe extern "C" {
    // `&JSGlobalObject` is ABI-identical to a non-null `*const JSGlobalObject`;
    // remaining params are by-value scalars + raw (ptr,len) slice pairs that
    // the C++ side bounds-checks against `count`/`names_count`. The sole call
    // site is the safe `construct_object_from_data_cell` wrapper above, which
    // already accepts the same raw-pointer shape from safe code, so the
    // memory-validity contract is identical → `safe fn`.
    pub(crate) safe fn JSC__constructObjectFromDataCell(
        global: &JSGlobalObject,
        encoded_array_value: JSValue,
        encoded_structure_value: JSValue,
        cells: *mut SQLDataCell,
        count: u32,
        flags: Flags,
        result_mode: u8,
        names: *mut ExternColumnIdentifier,
        names_count: u32,
    ) -> JSValue;
}
