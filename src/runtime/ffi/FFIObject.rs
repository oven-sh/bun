use core::ffi::c_void;

use bun_core::ZigString;
use bun_jsc::host_fn::DomCall;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSFunction, JSGlobalObject, JSObject, JSUint8Array,
    JSValue, JsResult,
};

// Non-throwing `toInvalidArguments` shim — see ffi_body.rs for rationale.
use super::ffi_body::GlobalObjectFfiExt as _;

/// Reinterpret a user-supplied raw address (from `bun:ffi` JS land) as a
/// JSC typed-array bytes deallocator. Centralized so the `usize → fn ptr`
/// reinterpretation lives in one place.
///
/// # Safety
/// `addr` must be either `0` or the address of a function with signature
/// `extern "C" fn(*mut c_void, *mut c_void)`. This is user-supplied via
/// `bun:ffi`; a bad value will crash when JSC invokes it.
#[allow(deprecated)] // jsc::c::JSTypedArrayBytesDeallocator
#[inline(always)]
unsafe fn deallocator_from_addr(addr: usize) -> jsc::c::JSTypedArrayBytesDeallocator {
    // SAFETY: `JSTypedArrayBytesDeallocator` is
    // `Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>`, which under
    // the null-pointer optimisation is layout-compatible with a single
    // pointer-sized word — exactly `usize` here. `0` round-trips to `None`.
    unsafe { core::mem::transmute::<usize, jsc::c::JSTypedArrayBytesDeallocator>(addr) }
}

/// Port of Zig `JSValue.createBufferWithCtx(global, slice, ctx, callback)` —
/// unlike `JSValue::create_buffer` (which hard-codes `MarkedArrayBuffer_deallocator`),
/// this variant passes the caller's (possibly null) deallocator through, so FFI-owned
/// memory is only freed by the user-supplied callback.
#[allow(deprecated, non_snake_case)]
#[inline]
fn create_buffer_with_ctx(
    global: &JSGlobalObject,
    slice: &mut [u8],
    ctx: *mut c_void,
    callback: jsc::c::JSTypedArrayBytesDeallocator,
) -> JSValue {
    unsafe extern "C" {
        fn JSBuffer__bufferFromPointerAndLengthAndDeinit(
            global: *const JSGlobalObject,
            ptr: *mut u8,
            len: usize,
            ctx: *mut c_void,
            deallocator: jsc::c::JSTypedArrayBytesDeallocator,
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
// In Zig these are `@extern`ed by the comptime `DOMCall(...)` type-generator;
// here we declare them directly since the `#[bun_jsc::dom_call]` proc-macro is
// not yet implemented.
// TODO(port): move to <area>_sys
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

pub fn new_cstring(
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

// TODO(port): `DOMCall("FFI", @This(), "ptr", ...)` is a comptime type-generator that
// emits a DOMJIT fast-path descriptor + slow-path host fn. Phase B needs a proc-macro
// or codegen step (`bun_jsc::dom_call!`). Represented here as a const descriptor.
// PORT NOTE: the `DOMEffect.forRead(.TypedArrayProperties)` argument is consumed by
// the C++ codegen, not the runtime descriptor; it lives in the generated
// `ZigLazyStaticFunctions-inlines.h` already.
pub const DOM_CALL: DomCall = DomCall {
    class_name: "FFI",
    function_name: "ptr",
    put: FFI__ptr__put,
};

pub fn to_js(global_object: &JSGlobalObject) -> JSValue {
    // Zig: `inline for (comptime std.meta.fieldNames(@TypeOf(fields)))` — comptime
    // reflection over an anonymous struct. Unrolled manually here; keep in sync with
    // `FIELDS` below.
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

    // TODO(port): same DOMCall codegen note as `DOM_CALL` above. In Zig this is an
    // anonymous struct of 12 `DOMCall(...)` values iterated via `inline for`.
    // PORT NOTE: the `DOMEffect.forRead(.World)` argument is encoded on the C++ side
    // (generated `Reader__*__put` in ZigLazyStaticFunctions-inlines.h); the runtime
    // descriptor here only needs the `put` extern.
    pub const DOM_CALLS: &[(&str, DomCall)] = &[
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
        // PORT NOTE: hoisted from repeated inline checks; identical body in every reader.
        if arguments.is_empty() || !arguments[0].is_number() {
            return Err(global_object.throw_invalid_arguments(format_args!("Expected a pointer")));
        }
        let off = if arguments.len() > 1 {
            usize::try_from(arguments[1].to_int32()).expect("int cast")
        } else {
            0usize
        };
        Ok(arguments[0].as_ptr_address() + off)
    }

    /// Read a `T` from a user-supplied raw address (unaligned, `*align(1)` in Zig).
    ///
    /// Single audited primitive for all `bun:ffi` `read.*` host functions
    /// (slow-path and DOMJIT fast-path alike).
    ///
    /// # Safety
    /// `addr` must point to `size_of::<T>()` readable bytes. The address is
    /// JS-supplied and **not validated** — a bad value is UB, matching the
    /// `bun:ffi` contract (`@as(*align(1) const T, @ptrFromInt(addr)).*`).
    #[inline(always)]
    pub(super) unsafe fn read_unaligned_at<T: Copy>(addr: usize) -> T {
        // SAFETY: precondition delegated to caller (see fn-level Safety doc).
        unsafe { (addr as *const T).read_unaligned() }
    }

    pub fn u8(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<u8>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn u16(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<u16>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn u32(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<u32>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn ptr(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<u64>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn i8(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<i8>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn i16(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<i16>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn i32(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<i32>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn intptr(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<i64>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn f32(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<f32>(addr) };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn f64(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<f64>(addr) };
        Ok(JSValue::js_number(value))
    }
    pub fn i64(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<i64>(addr) };
        Ok(JSValue::from_int64_no_truncate(global_object, value))
    }
    pub fn u64(
        global_object: &JSGlobalObject,
        _: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `read_unaligned_at`.
        let value = unsafe { read_unaligned_at::<u64>(addr) };
        Ok(JSValue::from_uint64_no_truncate(global_object, value))
    }

    // ── fast-path (DOMJIT, no type checks) readers ────────────────────────────
    // These are `callconv(jsc.conv)` in Zig — called directly from JIT code.
    // TODO(port): `#[bun_jsc::host_call]` emits the correct ABI ("sysv64" on
    // win-x64, "C" elsewhere). Raw pointers are intentional (FFI boundary).

    #[bun_jsc::host_call]
    pub extern "C" fn u8_without_type_checks(
        _: *mut JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<u8>(addr) };
        JSValue::js_number(value as f64)
    }
    #[bun_jsc::host_call]
    pub extern "C" fn u16_without_type_checks(
        _: *mut JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<u16>(addr) };
        JSValue::js_number(value as f64)
    }
    #[bun_jsc::host_call]
    pub extern "C" fn u32_without_type_checks(
        _: *mut JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<u32>(addr) };
        JSValue::js_number(value as f64)
    }
    #[bun_jsc::host_call]
    pub extern "C" fn ptr_without_type_checks(
        _: *mut JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<u64>(addr) };
        JSValue::js_number(value as f64)
    }
    #[bun_jsc::host_call]
    pub extern "C" fn i8_without_type_checks(
        _: *mut JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<i8>(addr) };
        JSValue::js_number(value as f64)
    }
    #[bun_jsc::host_call]
    pub extern "C" fn i16_without_type_checks(
        _: *mut JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<i16>(addr) };
        JSValue::js_number(value as f64)
    }
    #[bun_jsc::host_call]
    pub extern "C" fn i32_without_type_checks(
        _: *mut JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<i32>(addr) };
        JSValue::js_number(value as f64)
    }
    #[bun_jsc::host_call]
    pub extern "C" fn intptr_without_type_checks(
        _: *mut JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<i64>(addr) };
        JSValue::js_number(value as f64)
    }
    #[bun_jsc::host_call]
    pub extern "C" fn f32_without_type_checks(
        _: *mut JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<f32>(addr) };
        JSValue::js_number(value as f64)
    }
    #[bun_jsc::host_call]
    pub extern "C" fn f64_without_type_checks(
        _: *mut JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<f64>(addr) };
        JSValue::js_number(value)
    }
    #[bun_jsc::host_call]
    pub extern "C" fn u64_without_type_checks(
        global: &JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<u64>(addr) };
        JSValue::from_uint64_no_truncate(global, value)
    }
    #[bun_jsc::host_call]
    pub extern "C" fn i64_without_type_checks(
        global: &JSGlobalObject,
        _: *mut c_void,
        raw_addr: i64,
        offset: i32,
    ) -> JSValue {
        let addr = usize::try_from(raw_addr).expect("int cast")
            + usize::try_from(offset).expect("int cast");
        // SAFETY: see `read_unaligned_at` (JIT-validated address).
        let value = unsafe { read_unaligned_at::<i64>(addr) };
        JSValue::from_int64_no_truncate(global, value)
    }
}

pub fn ptr(global_this: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JSValue {
    match arguments.len() {
        0 => ptr_(global_this, JSValue::ZERO, None),
        1 => ptr_(global_this, arguments[0], None),
        _ => ptr_(global_this, arguments[0], Some(arguments[1])),
    }
}

#[bun_jsc::host_call]
pub extern "C" fn ptr_without_type_checks(
    _: *mut JSGlobalObject,
    _: *mut c_void,
    array: *mut JSUint8Array,
) -> JSValue {
    // SAFETY: `array` is a live JSUint8Array cell on the JS thread.
    JSValue::from_ptr_address(unsafe { (*array).ptr() } as usize)
}

fn ptr_(global_this: &JSGlobalObject, value: JSValue, byte_offset: Option<JSValue>) -> JSValue {
    if value.is_empty() {
        return JSValue::NULL;
    }

    let Some(array_buffer) = value.as_array_buffer(global_this) else {
        // PORT NOTE: `JSType` derives `Debug` only; Zig used `@tagName`.
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
    // const Sizes = @import("../../jsc/sizes.zig");
    // assert(addr == @intFromPtr(value.asEncoded().ptr) + Sizes.Bun_FFI_PointerOffsetToTypedArrayVector);

    if let Some(off) = byte_offset {
        if !off.is_empty_or_undefined_or_null() {
            if !off.is_number() {
                return global_this
                    .to_invalid_arguments(format_args!("Expected number for byteOffset"));
            }
        }

        let bytei64 = off.to_int64();
        if bytei64 < 0 {
            addr = addr.saturating_sub(usize::try_from(bytei64 * -1).expect("int cast"));
        } else {
            addr += usize::try_from(bytei64).expect("int cast");
        }

        if addr > array_buffer.ptr as usize + array_buffer.byte_len as usize {
            return global_this.to_invalid_arguments(format_args!("byteOffset out of bounds"));
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

    if addr == 0xDEADBEEF || addr == 0xaaaaaaaa || addr == 0xAAAAAAAA {
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
/// of unknown lifetime — never freed by Rust.
// TODO(port): lifetime — verify all consumers treat this as borrow-of-FFI-memory.
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

    // if (!std.math.isFinite(num)) {
    //     return .{ .err = globalThis.toInvalidArguments("ptr must be a finite number.", .{}) };
    // }

    // Zig: `@as(usize, @bitCast(num))` — `num` is already `usize` (asPtrAddress), so
    // bitcast is a no-op. Preserved as identity assignment.
    let mut addr: usize = num;

    if let Some(byte_off) = byte_offset {
        if byte_off.is_number() {
            let off = byte_off.to_int64();
            if off < 0 {
                addr = addr.saturating_sub(usize::try_from(off * -1).expect("int cast"));
            } else {
                addr = addr.saturating_add(usize::try_from(off).expect("int cast"));
            }

            if addr == 0 {
                return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
                    "ptr cannot be zero, that would segfault Bun :("
                )));
            }

            if !byte_off.as_number().is_finite() {
                return ValueOrError::Err(
                    global_this.to_invalid_arguments(format_args!("ptr must be a finite number.")),
                );
            }
        } else if !byte_off.is_empty_or_undefined_or_null() {
            // do nothing
        } else {
            return ValueOrError::Err(
                global_this.to_invalid_arguments(format_args!("Expected number for byteOffset")),
            );
        }
    }

    if addr == 0xDEADBEEF || addr == 0xaaaaaaaa || addr == 0xAAAAAAAA {
        return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
            "ptr to invalid memory, that would segfault Bun :("
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

            if length_i > i64::try_from(MAX_ADDRESSABLE_MEMORY).expect("int cast") {
                return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
                    "length exceeds max addressable memory. This usually means a bug in your code."
                )));
            }

            let length = usize::try_from(length_i).expect("int cast");
            return ValueOrError::Slice(addr as *mut u8, length);
        }
    }

    // Zig: `bun.span(@as([*:0]u8, @ptrFromInt(addr)))` — scan for NUL terminator.
    // SAFETY: caller asserts `addr` points at a NUL-terminated C string.
    let len = unsafe { bun_core::ffi::cstr(addr as *const core::ffi::c_char) }
        .to_bytes()
        .len();
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
        // Zig: `@as(u64, @bitCast(value.toUInt64NoTruncate()))` — already u64; bitcast is no-op.
        let addr: u64 = value.to_uint64_no_truncate();
        if addr > 0 {
            return Some(addr as usize);
        }
    }

    None
}

#[allow(deprecated)] // jsc::c::JSTypedArrayBytesDeallocator — bun_jsc gates the c_api module as deprecated; no replacement path yet.
pub fn to_array_buffer(
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
            let mut callback: jsc::c::JSTypedArrayBytesDeallocator = None;
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

            // SAFETY: ptr/len came from get_ptr_slice; FFI-owned memory.
            let slice = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
            ArrayBuffer::from_bytes(slice, jsc::JSType::ArrayBuffer).to_js_with_context(
                global_this,
                ctx.unwrap_or(core::ptr::null_mut()),
                callback,
            )
        }
    }
}

#[allow(deprecated)] // jsc::c::JSTypedArrayBytesDeallocator — bun_jsc gates the c_api module as deprecated; no replacement path yet.
pub fn to_buffer(
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
            let mut callback: jsc::c::JSTypedArrayBytesDeallocator = None;
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
            if callback.is_some() || ctx.is_some() {
                return Ok(create_buffer_with_ctx(
                    global_this,
                    slice,
                    ctx.unwrap_or(core::ptr::null_mut()),
                    callback,
                ));
            }

            // Spec (FFIObject.zig:596): `jsc.JSValue.createBuffer(globalThis, slice)`
            // — installs `MarkedArrayBuffer_deallocator` so the slice is `mi_free`d
            // on GC. Matches Zig exactly (including the free-foreign-memory footgun).
            Ok(JSValue::create_buffer(global_this, slice))
        }
    }
}

pub fn to_cstring_buffer(
    global_this: &JSGlobalObject,
    value: JSValue,
    byte_offset: Option<JSValue>,
    value_length: Option<JSValue>,
) -> JSValue {
    match get_ptr_slice(global_this, value, byte_offset, value_length) {
        ValueOrError::Err(err) => err,
        ValueOrError::Slice(ptr, len) => {
            // SAFETY: ptr/len came from get_ptr_slice; FFI-owned memory.
            let slice = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
            create_buffer_with_ctx(global_this, slice, core::ptr::null_mut(), None)
        }
    }
}

pub fn getter(global_object: &JSGlobalObject, _: &JSObject) -> JSValue {
    to_js(global_object)
}

// ── `fields` host-fn thunks ──────────────────────────────────────────────────
// Zig `fields` is an anonymous struct of `jsc.host_fn.wrapStaticMethod(...)`
// values iterated via comptime reflection in `toJS`. `wrapStaticMethod` is a
// comptime fn-signature reflector that decodes `CallFrame` arguments into the
// target's parameter types (see src/jsc/host_fn.zig:654). Rust has no
// `@typeInfo`, so the eight wrappers are unrolled manually here — each body is
// exactly what `wrapStaticMethod(.., auto_protect=false)` would emit for that
// signature (only the `*JSGlobalObject` / `JSValue` / `?JSValue` / `ZigString`
// arms are exercised by this table).

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

/// `wrapStaticMethod` decode arm for `ZigString`.
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

/// Wrap a `JsHostFnZig` body into the raw `JSHostFn` ABI — runtime half of
/// Zig's `toJSHostFn`. Mints a fresh `unsafe extern jsc.conv fn` per call site
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
    // PORT NOTE: `print`/`callback`/`link_symbols`/`close_callback` live on the
    // Phase-A `ffi_body::FFI` (real, compiled bodies) — not yet hoisted onto the
    // canonical `crate::ffi::FFI`. They are static (no `&self`), so type identity
    // is irrelevant; route to them directly until the two `FFI` structs merge.
    use super::super::ffi_body::FFI as FfiImpl;

    // viewSource → FFI::print(global, JSValue, ?JSValue) -> JsResult<JSValue>
    pub fn view_source(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let mut iter = args.slice().iter();
        let object = eat_required(global, &mut iter)?;
        let is_callback = next_eat(&mut iter);
        FfiImpl::print(global, object, is_callback)
    }

    // dlopen → FFI::open(global, ZigString, JSValue) -> JSValue
    pub fn dlopen(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let mut iter = args.slice().iter();
        let name = eat_zig_string(global, &mut iter)?;
        let object = eat_required(global, &mut iter)?;
        Ok(FfiImpl::open(global, name, object))
    }

    // callback → FFI::callback(global, JSValue, JSValue) -> JsResult<JSValue>
    pub fn callback(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let mut iter = args.slice().iter();
        let interface = eat_required(global, &mut iter)?;
        let js_callback = eat_required(global, &mut iter)?;
        FfiImpl::callback(global, interface, js_callback)
    }

    // linkSymbols → FFI::link_symbols(global, JSValue) -> JSValue
    pub fn link_symbols(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<1>();
        let mut iter = args.slice().iter();
        let object = eat_required(global, &mut iter)?;
        Ok(FfiImpl::link_symbols(global, object))
    }

    // toBuffer → to_buffer(global, JSValue, ?JSValue×4) -> JsResult<JSValue>
    pub fn to_buffer(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
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
    pub fn to_array_buffer(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
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
    pub fn close_callback(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<1>();
        let mut iter = args.slice().iter();
        let ctx = eat_required(global, &mut iter)?;
        Ok(FfiImpl::close_callback(global, ctx))
    }

    // CString → new_cstring(global, JSValue, ?JSValue, ?JSValue) -> JsResult<JSValue>
    pub fn cstring(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<3>();
        let mut iter = args.slice().iter();
        let value = eat_required(global, &mut iter)?;
        let byte_offset = next_eat(&mut iter);
        let length = next_eat(&mut iter);
        new_cstring(global, value, byte_offset, length)
    }
}

// Represented here as a const slice of (name, JSHostFn) so `to_js` can iterate.
// PORT NOTE: cannot be `const` — `wrap_host_fn!` expands to a block expression
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
    // std.math.maxInt(u56)
    (1usize << 56) - 1
}

// ported from: src/runtime/ffi/FFIObject.zig
