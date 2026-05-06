use core::ffi::c_void;

use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSFunction, JSGlobalObject, JSObject, JSUint8Array,
    JSValue, JsResult,
};
use bun_jsc::host_fn::DomCall;
use bun_str::{self as strings, ZigString};

// TODO(port): `bun.api.FFI` lives in `src/runtime/ffi/FFI.zig` → `crate::ffi::FFI`
#[allow(unused_imports)]
use crate::ffi::FFI;

// ── Local JSValue extension shims (upstream `bun_jsc::JSValue` has not yet ──
// ported `asPtrAddress` / `toUInt64NoTruncate` / `fromUInt64NoTruncate`).
// TODO(port): move to <area>_sys / drop once bun_jsc grows these.
#[allow(non_snake_case)]
unsafe extern "C" {
    fn JSC__JSValue__toUInt64NoTruncate(this: JSValue) -> u64;
    fn JSC__JSValue__fromUInt64NoTruncate(global: *const JSGlobalObject, i: u64) -> JSValue;
    fn JSBuffer__bufferFromPointerAndLengthAndDeinit(
        global: *const JSGlobalObject,
        ptr: *mut u8,
        len: usize,
        ctx: *mut c_void,
        deallocator: jsc::c::JSTypedArrayBytesDeallocator,
    ) -> JSValue;
}

trait JSValueFFIExt: Copy {
    fn as_ptr_address(self) -> usize;
    fn to_uint64_no_truncate(self) -> u64;
}
impl JSValueFFIExt for JSValue {
    /// Spec (JSValue.zig:2097): `@intFromFloat(this.asNumber())`.
    #[inline]
    fn as_ptr_address(self) -> usize {
        self.as_number() as usize
    }
    #[inline]
    fn to_uint64_no_truncate(self) -> u64 {
        // SAFETY: FFI — `self` is a valid encoded JSValue.
        unsafe { JSC__JSValue__toUInt64NoTruncate(self) }
    }
}

#[inline]
fn from_uint64_no_truncate(global: &JSGlobalObject, i: u64) -> JSValue {
    // SAFETY: FFI — `global` is live for the call.
    unsafe { JSC__JSValue__fromUInt64NoTruncate(global, i) }
}

/// Local port of Zig `JSValue.createBuffer(global, slice, ctx, callback)` —
/// upstream `JSValue::create_buffer` hard-codes `MarkedArrayBuffer_deallocator`,
/// which would free FFI-owned memory. This variant passes the caller's
/// (possibly null) deallocator through.
#[inline]
fn create_buffer_with_ctx(
    global: &JSGlobalObject,
    slice: &mut [u8],
    ctx: *mut c_void,
    callback: jsc::c::JSTypedArrayBytesDeallocator,
) -> JSValue {
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
    let object = JSValue::create_empty_object(global_object, FIELDS.len() + 2);

    for &(name, host_fn) in FIELDS {
        // PORT NOTE: `JSFunction::create` takes a raw `JSHostFn` (extern "C" fn
        // pointer); the safe `JSHostFnZig` form needs a per-entry monomorphised
        // thunk via `#[bun_jsc::host_fn]`. All entries currently route through
        // `wrap_static_method_stub`, so a single shared thunk preserves behaviour.
        // TODO(port): replace with `#[bun_jsc::host_fn]`-generated thunks once the
        // `wrap_static_method` proc-macro lands.
        let _ = host_fn;
        let func: jsc::JSHostFn = fields_host_fn_thunk;
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
                    jsc::js_function::CreateJSFunctionOptions { constructor: Some(func), ..Default::default() },
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
    unsafe { (DOM_CALL.put)(global_object as *const _ as *mut _, object) };
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
        ("u8", DomCall { class_name: "Reader", function_name: "u8", put: super::Reader__u8__put }),
        ("u16", DomCall { class_name: "Reader", function_name: "u16", put: super::Reader__u16__put }),
        ("u32", DomCall { class_name: "Reader", function_name: "u32", put: super::Reader__u32__put }),
        ("ptr", DomCall { class_name: "Reader", function_name: "ptr", put: super::Reader__ptr__put }),
        ("i8", DomCall { class_name: "Reader", function_name: "i8", put: super::Reader__i8__put }),
        ("i16", DomCall { class_name: "Reader", function_name: "i16", put: super::Reader__i16__put }),
        ("i32", DomCall { class_name: "Reader", function_name: "i32", put: super::Reader__i32__put }),
        ("i64", DomCall { class_name: "Reader", function_name: "i64", put: super::Reader__i64__put }),
        ("u64", DomCall { class_name: "Reader", function_name: "u64", put: super::Reader__u64__put }),
        ("intptr", DomCall { class_name: "Reader", function_name: "intptr", put: super::Reader__intptr__put }),
        ("f32", DomCall { class_name: "Reader", function_name: "f32", put: super::Reader__f32__put }),
        ("f64", DomCall { class_name: "Reader", function_name: "f64", put: super::Reader__f64__put }),
    ];

    pub fn to_js(global_this: &JSGlobalObject) -> JSValue {
        let obj = JSValue::create_empty_object(global_this, DOM_CALLS.len());
        for (_, dc) in DOM_CALLS {
            // SAFETY: `put` is a C++-side helper; global_this is live for the call.
            unsafe { (dc.put)(global_this as *const _ as *mut _, obj) };
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
            usize::try_from(arguments[1].to_int32()).unwrap()
        } else {
            0usize
        };
        Ok(arguments[0].as_ptr_address() + off)
    }

    pub fn u8(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: caller-supplied raw address; `read_unaligned` matches Zig `*align(1)`.
        let value = unsafe { (addr as *const u8).read_unaligned() };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn u16(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const u16).read_unaligned() };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn u32(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const u32).read_unaligned() };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn ptr(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const u64).read_unaligned() };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn i8(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const i8).read_unaligned() };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn i16(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const i16).read_unaligned() };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn i32(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const i32).read_unaligned() };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn intptr(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const i64).read_unaligned() };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn f32(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const f32).read_unaligned() };
        Ok(JSValue::js_number(value as f64))
    }
    pub fn f64(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const f64).read_unaligned() };
        Ok(JSValue::js_number(value))
    }
    pub fn i64(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const i64).read_unaligned() };
        Ok(JSValue::from_int64_no_truncate(global_object, value))
    }
    pub fn u64(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const u64).read_unaligned() };
        Ok(JSValue::from_uint64_no_truncate(global_object, value))
    }

    // ── fast-path (DOMJIT, no type checks) readers ────────────────────────────
    // These are `callconv(jsc.conv)` in Zig — called directly from JIT code.
    // TODO(port): `#[bun_jsc::host_call]` emits the correct ABI ("sysv64" on
    // win-x64, "C" elsewhere). Raw pointers are intentional (FFI boundary).

    #[bun_jsc::host_call]
    pub extern fn u8_without_type_checks(_: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const u8).read_unaligned() };
        JSValue::js_number(value)
    }
    #[bun_jsc::host_call]
    pub extern fn u16_without_type_checks(_: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const u16).read_unaligned() };
        JSValue::js_number(value)
    }
    #[bun_jsc::host_call]
    pub extern fn u32_without_type_checks(_: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const u32).read_unaligned() };
        JSValue::js_number(value)
    }
    #[bun_jsc::host_call]
    pub extern fn ptr_without_type_checks(_: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const u64).read_unaligned() };
        JSValue::js_number(value)
    }
    #[bun_jsc::host_call]
    pub extern fn i8_without_type_checks(_: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const i8).read_unaligned() };
        JSValue::js_number(value)
    }
    #[bun_jsc::host_call]
    pub extern fn i16_without_type_checks(_: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const i16).read_unaligned() };
        JSValue::js_number(value)
    }
    #[bun_jsc::host_call]
    pub extern fn i32_without_type_checks(_: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const i32).read_unaligned() };
        JSValue::js_number(value)
    }
    #[bun_jsc::host_call]
    pub extern fn intptr_without_type_checks(_: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const i64).read_unaligned() };
        JSValue::js_number(value)
    }
    #[bun_jsc::host_call]
    pub extern fn f32_without_type_checks(_: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const f32).read_unaligned() };
        JSValue::js_number(value)
    }
    #[bun_jsc::host_call]
    pub extern fn f64_without_type_checks(_: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const f64).read_unaligned() };
        JSValue::js_number(value)
    }
    #[bun_jsc::host_call]
    pub extern fn u64_without_type_checks(global: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const u64).read_unaligned() };
        // SAFETY: global is non-null, JS thread.
        JSValue::from_uint64_no_truncate(unsafe { &*global }, value)
    }
    #[bun_jsc::host_call]
    pub extern fn i64_without_type_checks(global: *mut JSGlobalObject, _: *mut c_void, raw_addr: i64, offset: i32) -> JSValue {
        let addr = usize::try_from(raw_addr).unwrap() + usize::try_from(offset).unwrap();
        // SAFETY: JIT-validated address.
        let value = unsafe { (addr as *const i64).read_unaligned() };
        // SAFETY: global is non-null, JS thread.
        JSValue::from_int64_no_truncate(unsafe { &*global }, value)
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
pub extern fn ptr_without_type_checks(
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
        return global_this.to_invalid_arguments(format_args!(
            "Expected ArrayBufferView but received {}",
            <&'static str>::from(value.js_type())
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
            addr = addr.saturating_sub(usize::try_from(bytei64 * -1).unwrap());
        } else {
            addr += usize::try_from(bytei64).unwrap();
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

pub fn get_ptr_slice(
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
                addr = addr.saturating_sub(usize::try_from(off * -1).unwrap());
            } else {
                addr = addr.saturating_add(usize::try_from(off).unwrap());
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

            if length_i > i64::try_from(MAX_ADDRESSABLE_MEMORY).unwrap() {
                return ValueOrError::Err(global_this.to_invalid_arguments(format_args!(
                    "length exceeds max addressable memory. This usually means a bug in your code."
                )));
            }

            let length = usize::try_from(length_i).unwrap();
            return ValueOrError::Slice(addr as *mut u8, length);
        }
    }

    // Zig: `bun.span(@as([*:0]u8, @ptrFromInt(addr)))` — scan for NUL terminator.
    // SAFETY: caller asserts `addr` points at a NUL-terminated C string.
    let len = unsafe { bun_str::ZStr::from_ptr(addr as *const u8) }.len();
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
                    callback = unsafe { core::mem::transmute::<usize, jsc::c::JSTypedArrayBytesDeallocator>(callback_ptr) };

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
                    callback = unsafe { core::mem::transmute::<usize, jsc::c::JSTypedArrayBytesDeallocator>(callback_ptr) };
                } else if !callback_value.is_empty_or_undefined_or_null() {
                    return Ok(global_this.to_invalid_arguments(format_args!(
                        "Expected callback to be a C pointer (number or BigInt)"
                    )));
                }
            }

            // SAFETY: ptr/len came from get_ptr_slice; FFI-owned memory.
            let slice = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
            ArrayBuffer::from_bytes(slice, jsc::JSType::ArrayBuffer)
                .to_js_with_context(global_this, ctx, callback)
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
                    callback = unsafe { core::mem::transmute::<usize, jsc::c::JSTypedArrayBytesDeallocator>(callback_ptr) };

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
                    callback = unsafe { core::mem::transmute::<usize, jsc::c::JSTypedArrayBytesDeallocator>(callback_ptr) };
                } else if !callback_value.is_empty_or_undefined_or_null() {
                    return Ok(global_this.to_invalid_arguments(format_args!(
                        "Expected callback to be a C pointer (number or BigInt)"
                    )));
                }
            }

            // SAFETY: ptr/len came from get_ptr_slice; FFI-owned memory.
            let slice = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
            if callback.is_some() || ctx.is_some() {
                return Ok(JSValue::create_buffer_with_ctx(global_this, slice, ctx, callback));
            }

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
            JSValue::create_buffer(global_this, slice, None)
        }
    }
}

pub fn getter(global_object: &JSGlobalObject, _: &JSObject) -> JSValue {
    to_js(global_object)
}

// Zig `fields` is an anonymous struct of `jsc.host_fn.wrapStaticMethod(...)` values
// iterated via comptime reflection in `toJS`. `wrapStaticMethod` is a comptime
// type-level wrapper that adapts a Zig fn into the JSHostFnZig signature.
// TODO(port): proc-macro — `#[bun_jsc::host_fn(static)]` replaces `wrapStaticMethod`;
// the per-param decode table (see src/jsc/host_fn.rs) is not yet implemented in the
// proc-macro crate. Until it lands, the wrapper is a runtime stub so the static
// `FIELDS` table type-checks. The wrapped paths are preserved verbatim in the macro
// invocations for the eventual proc-macro pass.
fn wrap_static_method_stub(_: &jsc::JSGlobalObject, _: &jsc::CallFrame) -> jsc::JsResult<jsc::JSValue> {
    todo!("blocked_on: bun_jsc::host_fn::wrap_static_method proc-macro")
}
macro_rules! wrap_static_method {
    ($($path:tt)*) => { wrap_static_method_stub };
}

// Represented here as a const slice of (name, host_fn) so `to_js` can iterate.
const FIELDS: &[(&str, jsc::JSHostFnZig)] = &[
    ("viewSource", wrap_static_method!(FFI::print)),
    ("dlopen", wrap_static_method!(FFI::open)),
    ("callback", wrap_static_method!(FFI::callback)),
    ("linkSymbols", wrap_static_method!(FFI::link_symbols)),
    ("toBuffer", wrap_static_method!(to_buffer)),
    ("toArrayBuffer", wrap_static_method!(to_array_buffer)),
    ("closeCallback", wrap_static_method!(FFI::close_callback)),
    ("CString", wrap_static_method!(new_cstring)),
];

const MAX_ADDRESSABLE_MEMORY: usize = u56_max();

const fn u56_max() -> usize {
    // std.math.maxInt(u56)
    (1usize << 56) - 1
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/ffi/FFIObject.zig (650 lines)
//   confidence: medium
//   todos:      5
//   notes:      DOMCall + wrapStaticMethod are comptime codegen → need proc-macro/codegen in Phase B; ValueOrError.Slice carries raw (ptr,len) for FFI-owned memory; reader fns shadow primitive type names (legal Rust).
// ──────────────────────────────────────────────────────────────────────────
