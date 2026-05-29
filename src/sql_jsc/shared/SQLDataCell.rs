use core::ptr;
use core::slice;

use crate::jsc::{ExternColumnIdentifier, JSGlobalObject, JSType, JSValue, JsError, JsResult};
use bun_sql::shared::Data;
// `?bun.WTF.StringImpl` in Zig is a nullable thin pointer; the Rust port
// re-exports it as `WTFStringImpl = *mut WTFStringImplStruct`.
use bun_core::wtf::WTFStringImpl;

#[repr(C)]
#[derive(Copy, Clone)]
pub struct SQLDataCell {
    pub tag: Tag,

    pub value: Value,
    pub free_value: u8,
    pub is_indexed_column: u8,
    pub index: u32,
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
    pub null: u8,
    // LIFETIMES.tsv: SHARED → conceptually `Option<RefPtr<WTFStringImpl>>`.
    // Kept as a raw thin pointer (`*mut WTFStringImplStruct`) because this
    // is a `#[repr(C)] union` crossing FFI; `deinit()` derefs by tag.
    pub string: WTFStringImpl,
    pub float8: f64,
    pub int4: i32,
    pub int8: i64,
    pub bool_: u8, // `bool` is a Rust keyword
    pub date: f64,
    pub date_with_time_zone: f64,
    pub bytea: [usize; 2],
    // LIFETIMES.tsv: SHARED — same rationale as `string`.
    pub json: WTFStringImpl,
    pub array: Array,
    pub typed_array: TypedArray,
    pub raw: Raw,
    pub uint4: u32,
    pub uint8: u64,
}

// Clone/Copy: bitwise — `ptr` is logically OWNED (freed by `deinit`), but the
// type is `#[repr(C)]` POD passed across FFI by value (Zig pattern). Ownership
// is single-writer by convention; never call `deinit` on more than one copy.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct Array {
    // LIFETIMES.tsv: OWNED → Vec<SQLDataCell>. Kept as raw ptr/len/cap because
    // C++ reads these three fields directly across FFI; reconstructed as Vec in
    // `deinit` to free.
    pub ptr: *mut SQLDataCell,
    pub len: u32,
    pub cap: u32,
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

impl Array {
    pub fn slice(&mut self) -> &mut [SQLDataCell] {
        if self.ptr.is_null() {
            return &mut [];
        }
        // SAFETY: ptr is non-null and points to at least `len` initialized
        // cells (invariant upheld by producers — postgres/DataCell.rs decomposes
        // a `Vec<SQLDataCell>` into these fields). Genuine FFI: ptr/len/cap are
        // thin C fields read directly by C++ (SQLClient.cpp), so this cannot be
        // a `Vec` field without breaking ABI.
        unsafe { slice::from_raw_parts_mut(self.ptr, self.len as usize) }
    }

    pub fn allocated_slice(&mut self) -> &mut [SQLDataCell] {
        if self.ptr.is_null() {
            return &mut [];
        }
        // SAFETY: ptr is non-null and the backing allocation spans `cap`
        // `SQLDataCell`s. Producers (DataCell.zig:461 ArrayList) zero-init the
        // full capacity before handing it across FFI, so every element — not
        // just `[..len]` — carries a valid `Tag` discriminant. Genuine FFI:
        // ptr/len/cap are thin C fields read directly by C++ (SQLClient.cpp),
        // so this cannot be a `Vec` without breaking ABI.
        unsafe { slice::from_raw_parts_mut(self.ptr, self.cap as usize) }
    }

    pub fn deinit(&mut self) {
        let p = self.ptr;
        let cap = self.cap as usize;
        self.ptr = ptr::null_mut();
        self.len = 0;
        self.cap = 0;
        if p.is_null() {
            return;
        }
        // SAFETY: LIFETIMES.tsv evidence — ptr/len/cap originate from
        // `ArrayList.items.ptr` (DataCell.zig:461), i.e. a Vec-shaped allocation
        // from the global (mimalloc) allocator. Reconstruct and drop.
        // Elements were already deinit'd by the caller; SQLDataCell has no Drop.
        unsafe { drop(Vec::from_raw_parts(p, 0, cap)) };
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct Raw {
    pub ptr: *const u8,
    pub len: u64,
}

impl Default for Raw {
    fn default() -> Self {
        Self {
            ptr: ptr::null(),
            len: 0,
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct TypedArray {
    pub head_ptr: *mut u8,
    // LIFETIMES.tsv: BORROW_FIELD → sub-slice of head_ptr; same rationale.
    pub ptr: *mut u8,
    pub len: u32,
    pub byte_len: u32,
    pub type_: JSType, // `type` is a Rust keyword
}

impl SQLDataCell {
    pub fn deinit(&mut self) {
        if self.free_value == 0 {
            return;
        }

        match self.tag {
            Tag::String | Tag::Json => {
                // SAFETY: tag ∈ {String, Json} ⇒ the active union field is a
                // `WTFStringImpl` (`string` and `json` are both `*mut
                // WTFStringImplStruct` overlaid at the same union offset, so
                // reading either yields the same pointer). When non-null it
                // points to a live WTF::StringImpl; `as_ref` folds the
                // null-check and deref into one site.
                if let Some(p) = unsafe { self.value.string.as_ref() } {
                    p.deref();
                }
            }
            Tag::Bytea => {
                // SAFETY: tag == Bytea ⇒ `bytea` is the active union field.
                let bytea = unsafe { self.value.bytea };
                if bytea[1] == 0 {
                    return;
                }
                let p = bytea[0] as *mut u8;
                let len = bytea[1];
                // Build the fat pointer with the safe `ptr::slice_from_raw_parts_mut`
                // (no `&mut` reference materialized); only `Box::from_raw` is unsafe.
                // SAFETY: bytea[0]/bytea[1] are ptr/len of a buffer allocated
                // via the global allocator (Zig: bun.default_allocator).
                // TODO(port): verify allocation size == len (Zig free() uses slice.len).
                unsafe { drop(Box::<[u8]>::from_raw(ptr::slice_from_raw_parts_mut(p, len))) };
            }
            Tag::Array => {
                // SAFETY: tag == Array ⇒ `array` is the active union field.
                let array = unsafe { &mut self.value.array };
                for cell in array.slice() {
                    cell.deinit();
                }
                array.deinit();
            }
            Tag::TypedArray => {
                // SAFETY: tag == TypedArray ⇒ `typed_array` is active.
                let ta = unsafe { self.value.typed_array };
                if !ta.head_ptr.is_null() && ta.byte_len != 0 {
                    // Build the fat pointer with the safe
                    // `ptr::slice_from_raw_parts_mut` (no `&mut` reference
                    // materialized); only `Box::from_raw` is unsafe.
                    // Zig's spec uses `self.len`, but `len` is the *element*
                    // count (consumed by SQLClient.cpp as the typed-array
                    // length); for any element wider than u8 that under-reports
                    // the allocation size. Mimalloc's `free` ignores size so
                    // Zig got away with it; Rust's `Box::<[u8]>::from_raw`
                    // layout must match the allocation, hence `byte_len`.
                    // SAFETY: head_ptr was allocated via the global allocator
                    // when free_value != 0.
                    // TODO(port): LIFETIMES.tsv marks this BORROW (free_value=0
                    // at all call sites) — this branch may be dead; preserved
                    // to match Zig.
                    unsafe {
                        drop(Box::<[u8]>::from_raw(ptr::slice_from_raw_parts_mut(
                            ta.head_ptr,
                            ta.byte_len as usize,
                        )))
                    };
                }
            }

            _ => {}
        }
    }

    pub fn raw<'a>(optional_bytes: impl IntoOptionalData<'a>) -> SQLDataCell {
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
        SQLDataCell {
            tag: Tag::Null,
            value: Value { null: 0 },
            ..Default::default()
        }
    }

    // TODO: cppbind isn't yet able to detect slice parameters when the next is uint32_t
    pub fn construct_object_from_data_cell(
        global_object: &JSGlobalObject,
        encoded_array_value: JSValue,
        encoded_structure_value: JSValue,
        cells: *mut SQLDataCell,
        count: u32,
        flags: Flags,
        result_mode: u8,
        names_ptr: impl Into<Option<*mut ExternColumnIdentifier>>,
        names_count: u32,
    ) -> JsResult<JSValue> {
        let names_ptr: *mut ExternColumnIdentifier = names_ptr.into().unwrap_or(ptr::null_mut());
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

/// Coercion helper mirroring Zig's implicit `*const Data` → `?*const Data`
/// promotion at `raw()` call sites. Lets callers pass `&Data`, `&mut Data`,
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

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Copy, Clone, Default)]
    pub struct Flags: u32 {
        const HAS_INDEXED_COLUMNS   = 1 << 0;
        const HAS_NAMED_COLUMNS     = 1 << 1;
        const HAS_DUPLICATE_COLUMNS = 1 << 2;
        // remaining 29 bits: padding (`_: u29 = 0` in Zig)
    }
}

// TODO(port): move to sql_jsc_sys
unsafe extern "C" {
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

// ported from: src/sql_jsc/shared/SQLDataCell.zig
