use core::ptr;
use core::slice;

use crate::jsc::{ExternColumnIdentifier, JSGlobalObject, JSType, JSValue, JsError, JsResult};
use bun_sql::shared::Data;
// `?bun.WTF.StringImpl` in Zig is a nullable thin pointer; the Rust port
// re-exports it as `WTFStringImpl = *mut WTFStringImplStruct`.
use bun_string::wtf::{WTFStringImpl, WTFStringImplStruct};

// PORT NOTE: This entire type is `extern struct` in Zig and is passed by pointer
// across FFI to C++ (`JSC__constructObjectFromDataCell`). Field layout is
// load-bearing. LIFETIMES.tsv classifies several pointer fields as owned/shared/
// borrowed (Vec / RefPtr / &[u8]), but those Rust types either change size
// (fat slice ptrs) or add Drop semantics that a `#[repr(C)] union` cannot host
// without `ManuallyDrop`. Raw thin pointers are kept for FFI fidelity; ownership
// semantics from LIFETIMES.tsv are noted per-field below and enforced in
// `deinit`. Phase B: revisit once the C++ side is ported.

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
        Self { ptr: ptr::null_mut(), len: 0, cap: 0 }
    }
}

impl Array {
    pub fn slice(&mut self) -> &mut [SQLDataCell] {
        if self.ptr.is_null() {
            return &mut [];
        }
        // SAFETY: ptr is non-null and points to at least `len` initialized cells
        // (invariant upheld by producers in DataCell.zig).
        unsafe { slice::from_raw_parts_mut(self.ptr, self.len as usize) }
    }

    pub fn allocated_slice(&mut self) -> &mut [SQLDataCell] {
        if self.ptr.is_null() {
            return &mut [];
        }
        // SAFETY: ptr is non-null and the allocation has capacity `cap`.
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
        Self { ptr: ptr::null(), len: 0 }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct TypedArray {
    // LIFETIMES.tsv: BORROW_PARAM → Option<&'a [u8]>. Kept as thin raw ptr for
    // #[repr(C)] FFI layout (a Rust slice ref is a fat pointer). free_value=0
    // for typed_array producers, so deinit's free path is effectively dead for
    // borrowed buffers.
    pub head_ptr: *mut u8,
    // LIFETIMES.tsv: BORROW_FIELD → sub-slice of head_ptr; same rationale.
    pub ptr: *mut u8,
    pub len: u32,
    pub byte_len: u32,
    pub type_: JSType, // `type` is a Rust keyword
}

impl TypedArray {
    pub fn slice(&mut self) -> &mut [u8] {
        if self.ptr.is_null() {
            return &mut [];
        }
        // SAFETY: ptr is non-null and valid for `len` bytes.
        unsafe { slice::from_raw_parts_mut(self.ptr, self.len as usize) }
    }

    pub fn byte_slice(&mut self) -> &mut [u8] {
        if self.head_ptr.is_null() {
            return &mut [];
        }
        // SAFETY: head_ptr is non-null and valid for `len` bytes.
        // PORT NOTE: Zig uses `self.len` here (not `byte_len`) — preserved verbatim.
        unsafe { slice::from_raw_parts_mut(self.head_ptr, self.len as usize) }
    }
}

impl SQLDataCell {
    // PORT NOTE: kept as an explicit method, not `impl Drop` — this type is
    // #[repr(C)], lives inside a C union, is bulk-passed to C++ by pointer, and
    // freeing is gated on `free_value`. See PORTING.md §Idiom map (FFI types
    // keep explicit destroy).
    pub fn deinit(&mut self) {
        if self.free_value == 0 {
            return;
        }

        match self.tag {
            Tag::String => {
                // SAFETY: tag == String ⇒ `string` is the active union field;
                // non-null ⇒ points to a live WTF::StringImpl.
                let p = unsafe { self.value.string };
                if !p.is_null() {
                    unsafe { (*p).deref() };
                }
            }
            Tag::Json => {
                // SAFETY: tag == Json ⇒ `json` is the active union field;
                // non-null ⇒ points to a live WTF::StringImpl.
                let p = unsafe { self.value.json };
                if !p.is_null() {
                    unsafe { (*p).deref() };
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
                // SAFETY: bytea[0]/bytea[1] are ptr/len of a buffer allocated
                // via the global allocator (Zig: bun.default_allocator).
                // TODO(port): verify allocation size == len (Zig free() uses slice.len).
                unsafe {
                    drop(Box::<[u8]>::from_raw(slice::from_raw_parts_mut(p, len)))
                };
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
                let ta = unsafe { &mut self.value.typed_array };
                let bs = ta.byte_slice();
                if !bs.is_empty() {
                    // SAFETY: head_ptr was allocated via the global allocator
                    // when free_value != 0.
                    // TODO(port): LIFETIMES.tsv marks this BORROW (free_value=0
                    // at all call sites) — this branch may be dead; preserved
                    // to match Zig.
                    unsafe {
                        drop(Box::<[u8]>::from_raw(bs as *mut [u8]))
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
        // Zig: `?[*]ExternColumnIdentifier` — nullable many-pointer maps to a
        // raw `*mut` (null == None) for FFI; callers pass `ptr::null_mut()`
        // for the absent case.
        names_ptr: *mut ExternColumnIdentifier,
        names_count: u32,
    ) -> JsResult<JSValue> {
        // TODO(port): bun.Environment.ci_assert — when set, wrap this call in
        // `ExceptionValidationScope` and `assert_exception_presence_matches`.
        // TODO(b2-blocked): bun_jsc::ExceptionValidationScope (ci_assert path)

        // SAFETY: forwarding to C++ with caller-provided buffers.
        let value = unsafe {
            JSC__constructObjectFromDataCell(
                global_object,
                encoded_array_value,
                encoded_structure_value,
                cells,
                count,
                flags,
                result_mode,
                names_ptr,
                names_count,
            )
        };
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
    pub fn JSC__constructObjectFromDataCell(
        global: *const JSGlobalObject,
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/shared/SQLDataCell.zig (187 lines)
//   confidence: medium
//   todos:      5
//   notes:      #[repr(C)] FFI layout forced raw ptrs over LIFETIMES.tsv types (Vec/&[u8]/RefPtr); ownership enforced in deinit() instead. Phase B: confirm RefPtr<WTFStringImpl> niche-optimizes to thin ptr inside union, and map ci_assert feature.
// ──────────────────────────────────────────────────────────────────────────
