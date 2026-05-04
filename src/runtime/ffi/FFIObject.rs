use core::ffi::c_void;

use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSFunction, JSGlobalObject, JSObject, JSUint8Array,
    JSValue, JsResult,
};
use bun_jsc::host_fn::{DomCall, DomEffect};
use bun_str::{self as strings, ZigString};

// TODO(port): `bun.api.FFI` lives in `src/runtime/ffi/FFI.zig` → `bun_runtime::ffi::FFI`
use crate::ffi::FFI;

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
            bun_str::String::create_utf8_for_js(global_this, bytes)
        }
    }
}

// TODO(port): `DOMCall("FFI", @This(), "ptr", ...)` is a comptime type-generator that
// emits a DOMJIT fast-path descriptor + slow-path host fn. Phase B needs a proc-macro
// or codegen step (`bun_jsc::dom_call!`). Represented here as a const descriptor.
pub const DOM_CALL: DomCall = DomCall::new("FFI", "ptr", DomEffect::for_read(DomEffect::Heap::TypedArrayProperties));

pub fn to_js(global_object: &JSGlobalObject) -> JSValue {
    // Zig: `inline for (comptime std.meta.fieldNames(@TypeOf(fields)))` — comptime
    // reflection over an anonymous struct. Unrolled manually here; keep in sync with
    // `FIELDS` below.
    let object = JSValue::create_empty_object(global_object, FIELDS.len() + 2);

    for &(name, host_fn) in FIELDS {
        if name == "CString" {
            // CString needs to be callable as a constructor for backward compatibility.
            // Pass the same function as the constructor so `new CString(ptr)` works.
            let func = jsc::to_js_host_fn(host_fn);
            object.put(
                global_object,
                ZigString::static_(name),
                JSFunction::create(
                    global_object,
                    name,
                    func,
                    1,
                    jsc::JSFunctionCreateOptions { constructor: Some(func), ..Default::default() },
                ),
            );
        } else {
            object.put(
                global_object,
                ZigString::static_(name),
                JSFunction::create(global_object, name, host_fn, 1, Default::default()),
            );
        }
    }

    DOM_CALL.put(global_object, object);
    object.put(global_object, ZigString::static_("read"), reader::to_js(global_object));

    object
}

pub mod reader {
    use super::*;

    // TODO(port): same DOMCall codegen note as `DOM_CALL` above. In Zig this is an
    // anonymous struct of 12 `DOMCall(...)` values iterated via `inline for`.
    pub const DOM_CALLS: &[(&str, DomCall)] = &[
        ("u8", DomCall::new("Reader", "u8", DomEffect::for_read(DomEffect::Heap::World))),
        ("u16", DomCall::new("Reader", "u16", DomEffect::for_read(DomEffect::Heap::World))),
        ("u32", DomCall::new("Reader", "u32", DomEffect::for_read(DomEffect::Heap::World))),
        ("ptr", DomCall::new("Reader", "ptr", DomEffect::for_read(DomEffect::Heap::World))),
        ("i8", DomCall::new("Reader", "i8", DomEffect::for_read(DomEffect::Heap::World))),
        ("i16", DomCall::new("Reader", "i16", DomEffect::for_read(DomEffect::Heap::World))),
        ("i32", DomCall::new("Reader", "i32", DomEffect::for_read(DomEffect::Heap::World))),
        ("i64", DomCall::new("Reader", "i64", DomEffect::for_read(DomEffect::Heap::World))),
        ("u64", DomCall::new("Reader", "u64", DomEffect::for_read(DomEffect::Heap::World))),
        ("intptr", DomCall::new("Reader", "intptr", DomEffect::for_read(DomEffect::Heap::World))),
        ("f32", DomCall::new("Reader", "f32", DomEffect::for_read(DomEffect::Heap::World))),
        ("f64", DomCall::new("Reader", "f64", DomEffect::for_read(DomEffect::Heap::World))),
    ];

    pub fn to_js(global_this: &JSGlobalObject) -> JSValue {
        let obj = JSValue::create_empty_object(global_this, DOM_CALLS.len());
        for (_, dc) in DOM_CALLS {
            dc.put(global_this, obj);
        }
        obj
    }

    // ── slow-path (type-checked) readers ──────────────────────────────────────

    #[inline(always)]
    fn addr_from_args(global_object: &JSGlobalObject, arguments: &[JSValue]) -> JsResult<usize> {
        // PORT NOTE: hoisted from repeated inline checks; identical body in every reader.
        if arguments.is_empty() || !arguments[0].is_number() {
            return global_object.throw_invalid_arguments(format_args!("Expected a pointer"));
        }
        let off = if arguments.len() > 1 {
            usize::try_from(arguments[1].to::<i32>()).unwrap()
        } else {
            0usize
        };
        Ok(arguments[0].as_ptr_address() + off)
    }

    pub fn u8(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: caller-supplied raw address; `read_unaligned` matches Zig `*align(1)`.
        let value = unsafe { (addr as *const u8).read_unaligned() };
        Ok(JSValue::js_number(value))
    }
    pub fn u16(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const u16).read_unaligned() };
        Ok(JSValue::js_number(value))
    }
    pub fn u32(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const u32).read_unaligned() };
        Ok(JSValue::js_number(value))
    }
    pub fn ptr(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const u64).read_unaligned() };
        Ok(JSValue::js_number(value))
    }
    pub fn i8(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const i8).read_unaligned() };
        Ok(JSValue::js_number(value))
    }
    pub fn i16(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const i16).read_unaligned() };
        Ok(JSValue::js_number(value))
    }
    pub fn i32(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const i32).read_unaligned() };
        Ok(JSValue::js_number(value))
    }
    pub fn intptr(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const i64).read_unaligned() };
        Ok(JSValue::js_number(value))
    }
    pub fn f32(global_object: &JSGlobalObject, _: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
        let addr = addr_from_args(global_object, arguments)?;
        // SAFETY: see `u8`.
        let value = unsafe { (addr as *const f32).read_unaligned() };
        Ok(JSValue::js_number(value))
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
// TODO(port): proc-macro — `#[bun_jsc::wrap_static_method]` to adapt these fns.
// Represented here as a const slice of (name, host_fn) so `to_js` can iterate.
const FIELDS: &[(&str, jsc::JSHostFnZig)] = &[
    ("viewSource", jsc::host_fn::wrap_static_method!(FFI::print)),
    ("dlopen", jsc::host_fn::wrap_static_method!(FFI::open)),
    ("callback", jsc::host_fn::wrap_static_method!(FFI::callback)),
    ("linkSymbols", jsc::host_fn::wrap_static_method!(FFI::link_symbols)),
    ("toBuffer", jsc::host_fn::wrap_static_method!(to_buffer)),
    ("toArrayBuffer", jsc::host_fn::wrap_static_method!(to_array_buffer)),
    ("closeCallback", jsc::host_fn::wrap_static_method!(FFI::close_callback)),
    ("CString", jsc::host_fn::wrap_static_method!(new_cstring)),
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
