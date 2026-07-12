use core::ffi::c_void;

use bun_core::ZigString;
use bun_jsc::host_fn::DomCall;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSFunction, JSGlobalObject, JSObject, JSValue, JsResult,
};

/// Reinterpret a user-supplied raw address (from `bun:ffi` JS land) as a
/// JSC typed-array bytes deallocator. Centralized so the `usize → fn ptr`
/// reinterpretation lives in one place.
///
/// # Safety
/// `addr` must be either `0` or the address of a function with signature
/// `extern "C" fn(*mut c_void, *mut c_void)`. This is user-supplied via
/// `bun:ffi`; a bad value will crash when JSC invokes it.
#[inline(always)]
unsafe fn deallocator_from_addr(addr: usize) -> jsc::JSTypedArrayBytesDeallocator {
    // SAFETY: `JSTypedArrayBytesDeallocator` is
    // `Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>`, which under
    // the null-pointer optimisation is layout-compatible with a single
    // pointer-sized word — exactly `usize` here. `0` round-trips to `None`.
    unsafe { core::mem::transmute::<usize, jsc::JSTypedArrayBytesDeallocator>(addr) }
}

/// No-op typed-array bytes deallocator. `JSBuffer__bufferFromPointerAndLengthAndDeinit`
/// requires a non-null deallocator (a null one asserts in debug and is a null call on
/// GC in release), so `toBuffer(ptr)` without a finalizer installs this to get a
/// non-owning Buffer view that never frees the caller's memory.
unsafe extern "C" fn noop_bytes_deallocator(_ptr: *mut c_void, _ctx: *mut c_void) {}

/// Unlike `JSValue::create_buffer` (which hard-codes `MarkedArrayBuffer_deallocator`),
/// this variant passes the caller's (possibly null) deallocator through, so FFI-owned
/// memory is only freed by the user-supplied callback.
#[allow(non_snake_case)]
#[inline]
fn create_buffer_with_ctx(
    global: &JSGlobalObject,
    slice: &mut [u8],
    ctx: *mut c_void,
    callback: jsc::JSTypedArrayBytesDeallocator,
) -> JSValue {
    unsafe extern "C" {
        fn JSBuffer__bufferFromPointerAndLengthAndDeinit(
            global: *const JSGlobalObject,
            ptr: *mut u8,
            len: usize,
            ctx: *mut c_void,
            deallocator: jsc::JSTypedArrayBytesDeallocator,
        ) -> JSValue;
    }
    // SAFETY: `global` is live; slice describes FFI-owned memory whose
    // ownership transfers to JSC (freed via `callback`, or never if None).
    unsafe {
        JSBuffer__bufferFromPointerAndLengthAndDeinit(
            global,
            slice.as_mut_ptr(),
            slice.len(),
            ctx,
            callback,
        )
    }
}

// ── DOM-call C++ put helpers (generated in ZigLazyStaticFunctions-inlines.h) ──
#[allow(non_snake_case)]
unsafe extern "C" {
    fn FFI__ptr__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__u8__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__u16__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__u32__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__ptr__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__i8__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__i16__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__i32__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__i64__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__u64__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__intptr__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__f32__put(global: *mut JSGlobalObject, value: JSValue);
    fn Reader__f64__put(global: *mut JSGlobalObject, value: JSValue);
}

pub(crate) fn new_cstring(
    global_this: &JSGlobalObject,
    value: JSValue,
    byte_offset: Option<JSValue>,
    length_value: Option<JSValue>,
) -> JsResult<JSValue> {
    match get_ptr_slice(global_this, value, byte_offset, length_value) {
        ValueOrError::Err(err) => Ok(err),
        ValueOrError::Slice(ptr, len) => {
            // SAFETY: ptr/len point to FFI-owned memory whose lifetime the caller guarantees.
            let bytes = unsafe { core::slice::from_raw_parts(ptr, len) };
            jsc::bun_string_jsc::create_utf8_for_js(global_this, bytes)
        }
    }
}

// DOMJIT fast-path descriptor + slow-path host fn, represented here as a const
// descriptor. The `DOMEffect.forRead(.TypedArrayProperties)` argument is consumed
// by the C++ codegen, not the runtime descriptor; it lives in the generated
// `ZigLazyStaticFunctions-inlines.h` already.
pub(crate) const DOM_CALL: DomCall = DomCall {
    class_name: "FFI",
    function_name: "ptr",
    put: FFI__ptr__put,
};

pub fn to_js(global_object: &JSGlobalObject) -> JSValue {
    // Unrolled manually; keep in sync with `FIELDS` below.
    let fields = FIELDS();
    let object = JSValue::create_empty_object(global_object, fields.len() + 2);

    for &(name, func) in &fields {
        if name == "CString" {
            // CString needs to be callable as a constructor for backward compatibility.
            // Pass the same function as the constructor so `new CString(ptr)` works.
            object.put(
                global_object,
                name.as_bytes(),
                JSFunction::create(
                    global_object,
                    name,
                    func,
                    1,
                    jsc::js_function::CreateJSFunctionOptions {
                        constructor: Some(func),
                        ..Default::default()
                    },
                ),
            );
        } else {
            object.put(
                global_object,
                name.as_bytes(),
                JSFunction::create(global_object, name, func, 1, Default::default()),
            );
        }
    }

    // SAFETY: `put` is the C++-side `FFI__ptr__put` helper; global_object is live.
    unsafe { (DOM_CALL.put)(std::ptr::from_ref(global_object).cast_mut(), object) };
    object.put(global_object, b"read", reader::to_js(global_object));

    object
}

pub mod reader {
    use super::*;

    // Same DOMCall shape as `DOM_CALL` above. The
    // `DOMEffect.forRead(.World)` argument is encoded on the C++ side
    // (generated `Reader__*__put` in ZigLazyStaticFunctions-inlines.h); the
    // runtime descriptor here only needs the `put` extern.
    pub(crate) const DOM_CALLS: &[(&str, DomCall)] = &[
        (
            "u8",
            DomCall {
                class_name: "Reader",
                function_name: "u8",
                put: super::Reader__u8__put,
            },
        ),
        (
            "u16",
            DomCall {
                class_name: "Reader",
                function_name: "u16",
                put: super::Reader__u16__put,
            },
        ),
        (
            "u32",
            DomCall {
                class_name: "Reader",
                function_name: "u32",
                put: super::Reader__u32__put,
            },
        ),
        (
            "ptr",
            DomCall {
                class_name: "Reader",
                function_name: "ptr",
                put: super::Reader__ptr__put,
            },
        ),
        (
            "i8",
            DomCall {
                class_name: "Reader",
                function_name: "i8",
                put: super::Reader__i8__put,
            },
        ),
        (
            "i16",
            DomCall {
                class_name: "Reader",
                function_name: "i16",
                put: super::Reader__i16__put,
            },
        ),
        (
            "i32",
            DomCall {
                class_name: "Reader",
                function_name: "i32",
                put: super::Reader__i32__put,
            },
        ),
        (
            "i64",
            DomCall {
                class_name: "Reader",
                function_name: "i64",
                put: super::Reader__i64__put,
            },
        ),
        (
            "u64",
            DomCall {
                class_name: "Reader",
                function_name: "u64",
                put: super::Reader__u64__put,
            },
        ),
        (
            "intptr",
            DomCall {
                class_name: "Reader",
                function_name: "intptr",
                put: super::Reader__intptr__put,
            },
        ),
        (
            "f32",
            DomCall {
                class_name: "Reader",
                function_name: "f32",
                put: super::Reader__f32__put,
            },
        ),
        (
            "f64",
            DomCall {
                class_name: "Reader",
                function_name: "f64",
                put: super::Reader__f64__put,
            },
        ),
    ];

    pub fn to_js(global_this: &JSGlobalObject) -> JSValue {
        let obj = JSValue::create_empty_object(global_this, DOM_CALLS.len());
        for (_, dc) in DOM_CALLS {
            // SAFETY: `put` is a C++-side helper; global_this is live for the call.
            unsafe { (dc.put)(std::ptr::from_ref(global_this).cast_mut(), obj) };
        }
        obj
    }

    // ── slow-path (type-checked) readers ──────────────────────────────────────

    #[inline(always)]
    fn addr_from_args(global_object: &JSGlobalObject, arguments: &[JSValue]) -> JsResult<usize> {
        if arguments.is_empty() || !arguments[0].is_number() {
            return Err(global_object.throw_invalid_arguments(format_args!("Expected a pointer")));
        }
        let off = if arguments.len() > 1 && !arguments[1].is_empty_or_undefined_or_null() {
            // Guard the type before `to_int64`, matching ptr()/toBuffer()/
            // toArrayBuffer(): a non-number here would hit `JSC__JSValue__toInt64`,
            // whose ASSERT(isHeapBigInt||isNumber) aborts in debug and is UB in
            // release. `to_int32` (the previous form) had the same hazard.
            if !arguments[1].is_number() {
                return Err(global_object
                    .throw_invalid_arguments(format_args!("Expected number for byteOffset")));
            }
            let off_i64 = arguments[1].to_int64();
            if off_i64 < 0 {
                return Err(global_object
                    .throw_invalid_arguments(format_args!("byteOffset must be non-negative")));
            }
            off_i64 as usize
        } else {
            0usize
        };
        Ok(arguments[0].as_ptr_address().saturating_add(off))
    }

    /// Read a `T` from a user-supplied raw address (unaligned).
    ///
    /// Single audited primitive for all `bun:ffi` `read.*` host functions
    /// (slow-path and DOMJIT fast-path alike).
    ///
    /// # Safety
    /// `addr` must point to `size_of::<T>()` readable bytes. The address is
    /// JS-supplied and **not validated** — a bad value is UB, matching the
    /// `bun:ffi` contract (an unaligned read of `T` at `addr`).
    #[inline(always)]
    pub(super) unsafe fn read_unaligned_at<T: Copy>(addr: usize) -> T {
        // SAFETY: precondition delegated to caller (see fn-level Safety doc).
        unsafe { (addr as *const T).read_unaligned() }
    }

    pub(crate) fn u8(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<u8>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub(crate) fn u16(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<u16>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub(crate) fn u32(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<u32>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub(crate) fn ptr(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<u64>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub(crate) fn i8(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<i8>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub(crate) fn i16(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<i16>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub(crate) fn i32(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<i32>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub(crate) fn intptr(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<i64>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub(crate) fn f32(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<f32>(addr) };
        // The bytes at `addr` are arbitrary; a crafted NaN payload must not
        // reach the NaN-boxed encoding (see `JSValue::purify_nan`).
        Ok(JSValue::js_number(JSValue::purify_nan(value as f64)))
    }
    pub(crate) fn f64(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<f64>(addr) };
        // The bytes at `addr` are arbitrary; a crafted NaN payload must not
        // reach the NaN-boxed encoding (see `JSValue::purify_nan`).
        Ok(JSValue::js_number(JSValue::purify_nan(value)))
    }
    pub(crate) fn i64(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<i64>(addr) };
        Ok(JSValue::from_int64_no_truncate(global_object, value))
    }
    pub(crate) fn u64(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<u64>(addr) };
        Ok(JSValue::from_uint64_no_truncate(global_object, value))
    }

    // The DOMJIT fast-path (no type checks) readers — called directly from
    // JIT code — live on the C++ side (generated
    // `ZigLazyStaticFunctions-inlines.h`); only the slow paths above are here.
}

pub(crate) fn ptr(global_this: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JSValue {
    match arguments.len() {
        0 => ptr_(global_this, JSValue::ZERO, None),
        1 => ptr_(global_this, arguments[0], None),
        _ => ptr_(global_this, arguments[0], Some(arguments[1])),
    }
}

fn ptr_(global_this: &JSGlobalObject, value: JSValue, byte_offset: Option<JSValue>) -> JSValue {
    if value.is_empty() {
        return JSValue::NULL;
    }

    let Some(array_buffer) = value.as_array_buffer(global_this) else {
        return global_this.to_invalid_arguments(format_args!(
            "Expected ArrayBufferView but received {:?}",
            value.js_type()
        ));
    };

    if array_buffer.len == 0 {
        return global_this.to_invalid_arguments(format_args!(
            "ArrayBufferView must have a length > 0. A pointer to empty memory doesn't work"
        ));
    }

    let mut addr: usize = array_buffer.ptr as usize;
    if let Some(off) = byte_offset {
        if !off.is_empty_or_undefined_or_null() {
            if !off.is_number() {
                return global_this
                    .to_invalid_arguments(format_args!("Expected number for byteOffset"));
            }

            // `to_int64` saturates non-finite / out-of-range doubles to i64::MIN,
            // so negating one would overflow (a process abort). A negative
            // byteOffset also points before the view. Reject both up front.
            if !off.as_number().is_finite() {
                return global_this
                    .to_invalid_arguments(format_args!("byteOffset must be a finite number"));
            }
            let bytei64 = off.to_int64();
            if bytei64 < 0 {
                return global_this.to_invalid_arguments(format_args!("byteOffset out of bounds"));
            }
            addr = addr.saturating_add(usize::try_from(bytei64).unwrap_or(usize::MAX));

            if addr > array_buffer.ptr as usize + array_buffer.byte_len as usize {
                return global_this.to_invalid_arguments(format_args!("byteOffset out of bounds"));
            }
        }
    }

    if addr > MAX_ADDRESSABLE_MEMORY {
        return global_this.to_invalid_arguments(format_args!(
            "Pointer is outside max addressible memory, which usually means a bug in your program."
        ));
    }

    if addr == 0 {
        return global_this.to_invalid_arguments(format_args!("Pointer must not be 0"));
    }

    if addr == 0xDEADBEEF || addr == 0xAAAAAAAA || addr == 0xAAAAAAAAAAAAAAAA {
        return global_this.to_invalid_arguments(format_args!(
            "ptr to invalid memory, that would segfault Bun :("
        ));
    }

    if cfg!(debug_assertions) {
        debug_assert!(JSValue::from_ptr_address(addr).as_ptr_address() == addr);
    }

    JSValue::from_ptr_address(addr)
}

/// `union(enum)` → Rust enum.
/// `Slice` carries a raw (ptr, len) because it points at caller-owned FFI memory
/// of unknown lifetime.
// Consumer audit: `new_cstring` copies the bytes into a JS string; both
// `to_array_buffer` and `to_buffer` wrap the pointer non-owningly — the caller's
// finalizer when one is given, otherwise a no-op deallocator (`to_buffer`) or a
// null deallocator (`to_array_buffer`) — so Rust never frees caller-owned memory.
enum ValueOrError {
    Err(JSValue),
    Slice(*mut u8, usize),
}

fn get_ptr_slice(
    global_this: &JSGlobalObject,
    value: JSValue,
    byte_offset: Option<JSValue>,
    byte_length: Option<JSValue>,
) -> ValueOrError {
    if !value.is_number() || value.as_number() < 0.0 || value.as_number() > usize::MAX as f64 {
        return ValueOrError::Err(
            global_this.to_invalid_arguments(format_args!("ptr must be a number.")),
        );
    }

    let num = value.as_ptr_address();
    if num == 0 {
        return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
            "ptr cannot be zero, that would segfault Bun :("
        )));
    }

    let mut addr: usize = num;

    if let Some(byte_off) = byte_offset {
        if byte_off.is_number() {
            // Validate finiteness before the arithmetic: `to_int64` saturates a
            // non-finite / out-of-range double to i64::MIN, and negating i64::MIN
            // overflows (a process abort). `unsigned_abs` maps it safely.
            if !byte_off.as_number().is_finite() {
                return ValueOrError::Err(
                    global_this
                        .to_invalid_arguments(format_args!("byteOffset must be a finite number")),
                );
            }
            let off = byte_off.to_int64();
            if off < 0 {
                addr = addr.saturating_sub(off.unsigned_abs() as usize);
            } else {
                addr = addr.saturating_add(off as usize);
            }

            if addr == 0 {
                return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
                    "ptr cannot be zero, that would segfault Bun :("
                )));
            }
        } else if !byte_off.is_empty_or_undefined_or_null() {
            // A non-number, non-nullish byteOffset is a caller error (matches
            // `ptr_`); an explicit undefined/null means "no offset".
            return ValueOrError::Err(
                global_this.to_invalid_arguments(format_args!("Expected number for byteOffset")),
            );
        }
    }

    if addr == 0xDEADBEEF || addr == 0xAAAAAAAA || addr == 0xAAAAAAAAAAAAAAAA {
        return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
            "ptr to invalid memory, that would segfault Bun :("
        )));
    }

    // Match `ptr_`: reject an address past the addressable range before it is
    // dereferenced. A huge (but finite) byteOffset like 2^63 otherwise reaches
    // the NUL scan / buffer creation below and segfaults on a wild pointer.
    if addr > MAX_ADDRESSABLE_MEMORY {
        return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
            "Pointer is outside max addressible memory, which usually means a bug in your program."
        )));
    }

    if let Some(value_length) = byte_length {
        if !value_length.is_empty_or_undefined_or_null() {
            if !value_length.is_number() {
                return ValueOrError::Err(
                    global_this.to_invalid_arguments(format_args!("length must be a number.")),
                );
            }

            if value_length.as_number() == 0.0 {
                return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
                    "length must be > 0. This usually means a bug in your code."
                )));
            }

            let length_i = value_length.to_int64();
            if length_i < 0 {
                return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
                    "length must be > 0. This usually means a bug in your code."
                )));
            }

            // An ArrayBuffer/Buffer length is a u32 in JSC (`ArrayBuffer::from_bytes`
            // does `u32::try_from(len).expect(...)`); reject a larger length here so
            // it can't panic-abort there. A CString length this large is absurd too.
            if length_i > u32::MAX as i64 {
                return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
                    "length exceeds the maximum ArrayBuffer size (2^32-1). This usually means a bug in your code."
                )));
            }

            let length = usize::try_from(length_i).expect("int cast");
            return ValueOrError::Slice(addr as *mut u8, length);
        }
    }

    // Scan for the NUL terminator.
    // SAFETY: caller asserts `addr` points at a NUL-terminated C string.
    let len = unsafe { bun_core::ffi::cstr(addr as *const core::ffi::c_char) }
        .to_bytes()
        .len();
    // Same u32 ceiling as the explicit-length branch: `to_array_buffer` feeds
    // this into `ArrayBuffer::from_bytes`, which does `u32::try_from(len).expect(...)`.
    if len > u32::MAX as usize {
        return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
            "length exceeds the maximum ArrayBuffer size (2^32-1). This usually means a bug in your code."
        )));
    }
    ValueOrError::Slice(addr as *mut u8, len)
}

fn get_cptr(value: JSValue) -> Option<usize> {
    // pointer to C function
    if value.is_number() {
        let addr = value.as_ptr_address();
        if addr > 0 {
            return Some(addr);
        }
    } else if value.is_big_int() {
        let addr: u64 = value.to_uint64_no_truncate();
        if addr > 0 {
            return Some(addr as usize);
        }
    }

    None
}

pub(crate) fn to_array_buffer(
    global_this: &JSGlobalObject,
    value: JSValue,
    byte_offset: Option<JSValue>,
    value_length: Option<JSValue>,
    finalization_ctx_or_ptr: Option<JSValue>,
    finalization_callback: Option<JSValue>,
) -> JsResult<JSValue> {
    match get_ptr_slice(global_this, value, byte_offset, value_length) {
        ValueOrError::Err(erro) => Ok(erro),
        ValueOrError::Slice(ptr, len) => {
            let mut callback: jsc::JSTypedArrayBytesDeallocator = None;
            let mut ctx: Option<*mut c_void> = None;
            if let Some(callback_value) = finalization_callback {
                if let Some(callback_ptr) = get_cptr(callback_value) {
                    // SAFETY: user-supplied raw fn pointer address.
                    callback = unsafe { deallocator_from_addr(callback_ptr) };

                    if let Some(ctx_value) = finalization_ctx_or_ptr {
                        if let Some(ctx_ptr) = get_cptr(ctx_value) {
                            ctx = Some(ctx_ptr as *mut c_void);
                        } else if !ctx_value.is_undefined_or_null() {
                            return Ok(global_this.to_invalid_arguments(format_args!(
                                "Expected user data to be a C pointer (number or BigInt)"
                            )));
                        }
                    }
                } else if !callback_value.is_empty_or_undefined_or_null() {
                    return Ok(global_this.to_invalid_arguments(format_args!(
                        "Expected callback to be a C pointer (number or BigInt)"
                    )));
                }
            } else if let Some(callback_value) = finalization_ctx_or_ptr {
                if let Some(callback_ptr) = get_cptr(callback_value) {
                    // SAFETY: user-supplied raw fn pointer address.
                    callback = unsafe { deallocator_from_addr(callback_ptr) };
                } else if !callback_value.is_empty_or_undefined_or_null() {
                    return Ok(global_this.to_invalid_arguments(format_args!(
                        "Expected callback to be a C pointer (number or BigInt)"
                    )));
                }
            }

            // SAFETY: ptr/len came from get_ptr_slice; FFI-owned memory. The
            // `bun:ffi` user asserts the pointer stays valid for the object's
            // lifetime and that their finalization callback/ctx pair, if
            // provided, is sound to invoke once at GC — `toArrayBuffer(ptr,
            // ...)` is an inherently trusting FFI API.
            unsafe {
                let slice = core::slice::from_raw_parts_mut(ptr, len);
                ArrayBuffer::from_bytes(slice, jsc::JSType::ArrayBuffer).to_js_with_context(
                    global_this,
                    ctx.unwrap_or(core::ptr::null_mut()),
                    callback,
                )
            }
        }
    }
}

pub(crate) fn to_buffer(
    global_this: &JSGlobalObject,
    value: JSValue,
    byte_offset: Option<JSValue>,
    value_length: Option<JSValue>,
    finalization_ctx_or_ptr: Option<JSValue>,
    finalization_callback: Option<JSValue>,
) -> JsResult<JSValue> {
    match get_ptr_slice(global_this, value, byte_offset, value_length) {
        ValueOrError::Err(err) => Ok(err),
        ValueOrError::Slice(ptr, len) => {
            let mut callback: jsc::JSTypedArrayBytesDeallocator = None;
            let mut ctx: Option<*mut c_void> = None;
            if let Some(callback_value) = finalization_callback {
                if let Some(callback_ptr) = get_cptr(callback_value) {
                    // SAFETY: user-supplied raw fn pointer address.
                    callback = unsafe { deallocator_from_addr(callback_ptr) };

                    if let Some(ctx_value) = finalization_ctx_or_ptr {
                        if let Some(ctx_ptr) = get_cptr(ctx_value) {
                            ctx = Some(ctx_ptr as *mut c_void);
                        } else if !ctx_value.is_empty_or_undefined_or_null() {
                            return Ok(global_this.to_invalid_arguments(format_args!(
                                "Expected user data to be a C pointer (number or BigInt)"
                            )));
                        }
                    }
                } else if !callback_value.is_empty_or_undefined_or_null() {
                    return Ok(global_this.to_invalid_arguments(format_args!(
                        "Expected callback to be a C pointer (number or BigInt)"
                    )));
                }
            } else if let Some(callback_value) = finalization_ctx_or_ptr {
                if let Some(callback_ptr) = get_cptr(callback_value) {
                    // SAFETY: user-supplied raw fn pointer address.
                    callback = unsafe { deallocator_from_addr(callback_ptr) };
                } else if !callback_value.is_empty_or_undefined_or_null() {
                    return Ok(global_this.to_invalid_arguments(format_args!(
                        "Expected callback to be a C pointer (number or BigInt)"
                    )));
                }
            }

            // SAFETY: ptr/len came from get_ptr_slice; FFI-owned memory.
            let slice = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
            // `toBuffer(ptr)` is a non-owning view, like `toArrayBuffer`. Routing
            // the no-finalizer case through `JSValue::create_buffer` would install
            // `MarkedArrayBuffer_deallocator` and `mi_free` the foreign pointer on
            // GC — heap corruption on memory Bun never owned. Use the caller's
            // deallocator when given, else a no-op (a null deallocator is invalid).
            let deallocator = callback.or(Some(noop_bytes_deallocator));
            Ok(create_buffer_with_ctx(
                global_this,
                slice,
                ctx.unwrap_or(core::ptr::null_mut()),
                deallocator,
            ))
        }
    }
}

pub(crate) fn getter(global_object: &JSGlobalObject, _: &JSObject) -> JSValue {
    to_js(global_object)
}

// ── `fields` host-fn thunks ──────────────────────────────────────────────────
// The eight wrappers are unrolled manually here; each decodes its `CallFrame`
// arguments into the target's parameter types (only the `*JSGlobalObject` /
// `JSValue` / `Option<JSValue>` / `ZigString` arms are exercised by this table).

/// Minimal `ArgumentsSlice::nextEat` — pops the next non-consumed argument.
/// `wrapStaticMethod`'s arena/protect machinery is unused for the FFI fields
/// (no `StringOrBuffer` params, `auto_protect=false`), so a bare cursor over
/// `arguments_old(N).slice()` is semantically identical.
#[inline]
fn next_eat<'a>(iter: &mut core::slice::Iter<'a, JSValue>) -> Option<JSValue> {
    iter.next().copied()
}

/// `wrapStaticMethod` decode arm for required `JSValue`.
#[inline]
fn eat_required(
    global: &JSGlobalObject,
    iter: &mut core::slice::Iter<'_, JSValue>,
) -> JsResult<JSValue> {
    next_eat(iter).ok_or_else(|| global.throw_invalid_arguments(format_args!("Missing argument")))
}

/// Decode arm for `ZigString` arguments.
#[inline]
fn eat_zig_string(
    global: &JSGlobalObject,
    iter: &mut core::slice::Iter<'_, JSValue>,
) -> JsResult<ZigString> {
    let string_value = next_eat(iter)
        .ok_or_else(|| global.throw_invalid_arguments(format_args!("Missing argument")))?;
    if string_value.is_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!("Expected string")));
    }
    string_value.get_zig_string(global)
}

/// Wrap a `JsHostFnZig` body into the raw `JSHostFn` ABI. Mints a fresh
/// `unsafe extern jsc.conv fn` per call site
/// so the address is usable in the static `FIELDS` table (Rust forbids
/// fn-pointer const generics, so this is a `macro_rules!` rather than a
/// generic fn). Uses `jsc_host_abi!` so the thunk gets `extern "sysv64"` on
/// Windows-x64 and `extern "C"` elsewhere — matching the `JSHostFn` typedef.
macro_rules! wrap_host_fn {
    ($body:path) => {{
        bun_jsc::jsc_host_abi! {
            unsafe fn thunk(
                global: *mut JSGlobalObject,
                callframe: *mut CallFrame,
            ) -> JSValue {
                // SAFETY: JSC guarantees both pointers are live for the host call.
                let (global, callframe) = unsafe { (&*global, &*callframe) };
                jsc::to_js_host_fn_result(global, $body(global, callframe))
            }
        }
        thunk as jsc::JSHostFn
    }};
}

mod fields {
    use super::*;
    // `print`/`callback`/`link_symbols`/`close_callback` live on
    // `ffi_body::FFI` — not yet hoisted onto the canonical `crate::ffi::FFI`.
    // They are static (no `&self`), so type identity is irrelevant; route to
    // them directly until the two `FFI` structs merge.
    use super::super::ffi_body::FFI as FfiImpl;

    // viewSource → FFI::print(global, JSValue, ?JSValue) -> JsResult<JSValue>
    pub(super) fn view_source(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let mut iter = args.slice().iter();
        let object = eat_required(global, &mut iter)?;
        let is_callback = next_eat(&mut iter);
        FfiImpl::print(global, object, is_callback)
    }

    // dlopen → FFI::open(global, ZigString, JSValue) -> JSValue
    pub(super) fn dlopen(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let mut iter = args.slice().iter();
        let name = eat_zig_string(global, &mut iter)?;
        let object = eat_required(global, &mut iter)?;
        Ok(FfiImpl::open(global, name, object))
    }

    // callback → FFI::callback(global, JSValue, JSValue) -> JsResult<JSValue>
    pub(super) fn callback(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let mut iter = args.slice().iter();
        let interface = eat_required(global, &mut iter)?;
        let js_callback = eat_required(global, &mut iter)?;
        FfiImpl::callback(global, interface, js_callback)
    }

    // linkSymbols → FFI::link_symbols(global, JSValue) -> JSValue
    pub(super) fn link_symbols(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<1>();
        let mut iter = args.slice().iter();
        let object = eat_required(global, &mut iter)?;
        Ok(FfiImpl::link_symbols(global, object))
    }

    // toBuffer → to_buffer(global, JSValue, ?JSValue×4) -> JsResult<JSValue>
    pub(super) fn to_buffer(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<5>();
        let mut iter = args.slice().iter();
        let value = eat_required(global, &mut iter)?;
        let byte_offset = next_eat(&mut iter);
        let length = next_eat(&mut iter);
        let final_ctx = next_eat(&mut iter);
        let final_cb = next_eat(&mut iter);
        super::to_buffer(global, value, byte_offset, length, final_ctx, final_cb)
    }

    // toArrayBuffer → to_array_buffer(global, JSValue, ?JSValue×4) -> JsResult<JSValue>
    pub(super) fn to_array_buffer(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<5>();
        let mut iter = args.slice().iter();
        let value = eat_required(global, &mut iter)?;
        let byte_offset = next_eat(&mut iter);
        let length = next_eat(&mut iter);
        let final_ctx = next_eat(&mut iter);
        let final_cb = next_eat(&mut iter);
        super::to_array_buffer(global, value, byte_offset, length, final_ctx, final_cb)
    }

    // closeCallback → FFI::close_callback(global, JSValue) -> JSValue
    pub(super) fn close_callback(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<1>();
        let mut iter = args.slice().iter();
        let ctx = eat_required(global, &mut iter)?;
        Ok(FfiImpl::close_callback(global, ctx))
    }

    // CString → new_cstring(global, JSValue, ?JSValue, ?JSValue) -> JsResult<JSValue>
    pub(super) fn cstring(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<3>();
        let mut iter = args.slice().iter();
        let value = eat_required(global, &mut iter)?;
        let byte_offset = next_eat(&mut iter);
        let length = next_eat(&mut iter);
        new_cstring(global, value, byte_offset, length)
    }
}

// Represented here as a const slice of (name, JSHostFn) so `to_js` can iterate.
// Cannot be `const` — `wrap_host_fn!` expands to a block expression
// (item + cast), which const-eval rejects in array-literal position. The slice
// is tiny and only built once in `to_js`, so the runtime cost is nil.
#[allow(non_snake_case)]
fn FIELDS() -> [(&'static str, jsc::JSHostFn); 8] {
    [
        ("viewSource", wrap_host_fn!(fields::view_source)),
        ("dlopen", wrap_host_fn!(fields::dlopen)),
        ("callback", wrap_host_fn!(fields::callback)),
        ("linkSymbols", wrap_host_fn!(fields::link_symbols)),
        ("toBuffer", wrap_host_fn!(fields::to_buffer)),
        ("toArrayBuffer", wrap_host_fn!(fields::to_array_buffer)),
        ("closeCallback", wrap_host_fn!(fields::close_callback)),
        ("CString", wrap_host_fn!(fields::cstring)),
    ]
}

const MAX_ADDRESSABLE_MEMORY: usize = u56_max();

const fn u56_max() -> usize {
    (1usize << 56) - 1
}
