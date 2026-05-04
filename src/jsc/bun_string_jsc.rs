//! JSC bridges for `bun.String` and `SliceWithUnderlyingString`. Keeps
//! `src/string/` free of `JSValue`/`JSGlobalObject`/`CallFrame` types — the
//! original methods are aliased to the free fns here.

use core::fmt;
use std::io::Write as _;

use bun_str::{strings, SliceWithUnderlyingString, String, ZigString};

use crate::{CallFrame, ExceptionValidationScope, JSGlobalObject, JSValue, JsError, JsResult};

// ── extern decls ────────────────────────────────────────────────────────────
// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn BunString__transferToJS(this: *mut String, global_this: *mut JSGlobalObject) -> JSValue;
    fn BunString__toJS(global_object: *mut JSGlobalObject, in_: *const String) -> JSValue;
    fn BunString__toJSWithLength(
        global_object: *mut JSGlobalObject,
        in_: *const String,
        len: usize,
    ) -> JSValue;
    fn BunString__toJSDOMURL(global_object: *mut JSGlobalObject, in_: *mut String) -> JSValue;
    fn BunString__createArray(
        global_object: *mut JSGlobalObject,
        ptr: *const String,
        len: usize,
    ) -> JSValue;
    fn JSC__createError(global: *mut JSGlobalObject, str_: *const String) -> JSValue;
    fn JSC__createTypeError(global: *mut JSGlobalObject, str_: *const String) -> JSValue;
    fn JSC__createRangeError(global: *mut JSGlobalObject, str_: *const String) -> JSValue;

    // bun.cpp.* — declared elsewhere in Zig; surfaced here for the port.
    fn BunString__fromJS(
        global_object: *mut JSGlobalObject,
        value: JSValue,
        out: *mut String,
    ) -> bool;
    fn BunString__toJSON(global_object: *mut JSGlobalObject, this: *mut String) -> JSValue;
    fn BunString__createUTF8ForJS(
        global_object: *mut JSGlobalObject,
        ptr: *const u8,
        len: usize,
    ) -> JSValue;
    fn Bun__parseDate(global_object: *mut JSGlobalObject, this: *mut String) -> f64;
}

// ── bun.String methods ──────────────────────────────────────────────────────
pub fn transfer_to_js(this: &mut String, global_this: &JSGlobalObject) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; `this` is a live &mut String, global_this borrowed for call duration.
    crate::from_js_host_call(global_this, unsafe {
        BunString__transferToJS(this, global_this.as_ptr())
    })
}

pub fn to_error_instance(this: &String, global_object: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into JSC; `this` is a live &String, global_object borrowed for call duration.
    let result = unsafe { JSC__createError(global_object.as_ptr(), this) };
    this.deref();
    result
}

pub fn to_type_error_instance(this: &String, global_object: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into JSC; `this` is a live &String, global_object borrowed for call duration.
    let result = unsafe { JSC__createTypeError(global_object.as_ptr(), this) };
    this.deref();
    result
}

pub fn to_range_error_instance(this: &String, global_object: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into JSC; `this` is a live &String, global_object borrowed for call duration.
    let result = unsafe { JSC__createRangeError(global_object.as_ptr(), this) };
    this.deref();
    result
}

pub fn from_js(value: JSValue, global_object: &JSGlobalObject) -> JsResult<String> {
    let scope = ExceptionValidationScope::new(global_object);
    let mut out: String = String::DEAD;
    // SAFETY: FFI call into JSC; `out` is a valid out-param, global_object borrowed for call duration.
    let ok = unsafe { BunString__fromJS(global_object.as_ptr(), value, &mut out) };

    // If there is a pending exception, but stringifying succeeds, we don't return JSError.
    // We do need to always call hasException() to satisfy the need for an exception check.
    let has_exception = scope.has_exception_or_false_when_assertions_are_disabled();
    if ok {
        debug_assert!(out.tag != bun_str::Tag::Dead);
    } else {
        debug_assert!(has_exception);
    }

    if ok {
        Ok(out)
    } else {
        Err(JsError::Thrown)
    }
}

pub fn to_js(this: &String, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; `this` is a live &String, global_object borrowed for call duration.
    crate::from_js_host_call(global_object, unsafe {
        BunString__toJS(global_object.as_ptr(), this)
    })
}

pub fn to_jsdomurl(this: &mut String, global_object: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into JSC; `this` is a live &mut String, global_object borrowed for call duration.
    unsafe { BunString__toJSDOMURL(global_object.as_ptr(), this) }
}

/// calls toJS on all elements of `array`.
pub fn to_js_array(global_object: &JSGlobalObject, array: &[String]) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; `array` ptr/len from a live slice, global_object borrowed for call duration.
    crate::from_js_host_call(global_object, unsafe {
        BunString__createArray(global_object.as_ptr(), array.as_ptr(), array.len())
    })
}

pub fn to_js_by_parse_json(self_: &mut String, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; `self_` is a live &mut String, global_object borrowed for call duration.
    crate::from_js_host_call(global_object, unsafe {
        BunString__toJSON(global_object.as_ptr(), self_)
    })
}

pub fn create_utf8_for_js(
    global_object: &JSGlobalObject,
    utf8_slice: &[u8],
) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; ptr/len from a live &[u8], global_object borrowed for call duration.
    crate::from_js_host_call(global_object, unsafe {
        BunString__createUTF8ForJS(global_object.as_ptr(), utf8_slice.as_ptr(), utf8_slice.len())
    })
}

pub fn create_format_for_js(
    global_object: &JSGlobalObject,
    args: fmt::Arguments<'_>,
) -> JsResult<JSValue> {
    // PORT NOTE: Zig took `comptime fmt: [:0]const u8, args: anytype`; callers now
    // pass `format_args!("...", ...)` directly.
    let mut builder: Vec<u8> = Vec::new();
    builder.write_fmt(args).expect("unreachable"); // Vec<u8> write cannot fail
    // SAFETY: FFI call into JSC; ptr/len from a live Vec<u8>, global_object borrowed for call duration.
    crate::from_js_host_call(global_object, unsafe {
        BunString__createUTF8ForJS(global_object.as_ptr(), builder.as_ptr(), builder.len())
    })
}

pub fn parse_date(this: &mut String, global_object: &JSGlobalObject) -> JsResult<f64> {
    // SAFETY: FFI call into JSC; `this` is a live &mut String, global_object borrowed for call duration.
    crate::from_js_host_call(global_object, unsafe {
        Bun__parseDate(global_object.as_ptr(), this)
    })
}

#[bun_jsc::host_fn]
pub fn js_get_string_width(
    global_object: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    let args = call_frame.arguments_as_array::<2>();
    let argument = args[0];
    let opts_val = args[1];

    if argument.is_empty() || argument.is_undefined() {
        return Ok(JSValue::js_number(0i32));
    }

    let js_str = argument.to_js_string(global_object)?;
    let view = js_str.view(global_object);

    if view.is_empty() {
        return Ok(JSValue::js_number(0i32));
    }

    let str_ = String::init(view);

    // Parse options: { countAnsiEscapeCodes?: bool, ambiguousIsNarrow?: bool }
    let mut count_ansi: bool = false;
    let mut ambiguous_is_narrow: bool = true;

    if opts_val.is_object() {
        if let Some(v) = opts_val.get_truthy(global_object, b"countAnsiEscapeCodes")? {
            count_ansi = v.to_boolean();
        }
        if let Some(v) = opts_val.get_truthy(global_object, b"ambiguousIsNarrow")? {
            ambiguous_is_narrow = v.to_boolean();
        }
    }

    let width = if count_ansi {
        str_.visible_width(!ambiguous_is_narrow)
    } else {
        str_.visible_width_exclude_ansi_colors(!ambiguous_is_narrow)
    };

    Ok(JSValue::js_number(width))
}

// ── SliceWithUnderlyingString methods ───────────────────────────────────────
pub fn slice_with_underlying_string_to_js(
    this: &mut SliceWithUnderlyingString,
    global_object: &JSGlobalObject,
) -> JsResult<JSValue> {
    slice_with_underlying_string_to_js_with_options(this, global_object, false)
}

pub fn slice_with_underlying_string_transfer_to_js(
    this: &mut SliceWithUnderlyingString,
    global_object: &JSGlobalObject,
) -> JsResult<JSValue> {
    slice_with_underlying_string_to_js_with_options(this, global_object, true)
}

fn slice_with_underlying_string_to_js_with_options(
    this: &mut SliceWithUnderlyingString,
    global_object: &JSGlobalObject,
    transfer: bool,
) -> JsResult<JSValue> {
    if (this.underlying.tag == bun_str::Tag::Dead || this.underlying.tag == bun_str::Tag::Empty)
        && this.utf8.length() > 0
    {
        #[cfg(debug_assertions)]
        {
            if let Some(allocator) = this.utf8.allocator.get() {
                // We should never enter this state.
                debug_assert!(!String::is_wtf_allocator(allocator));
            }
        }

        // TODO(port): `utf8.allocator.get()` checks whether the slice owns an
        // allocator; the Rust `ZigString::Slice` equivalent may expose this
        // differently.
        if this.utf8.allocator.get().is_some() {
            if let Some(utf16) =
                strings::to_utf16_alloc(this.utf8.slice(), false, false).unwrap_or(None)
            {
                this.utf8 = Default::default();
                // PORT NOTE: ownership of `utf16` is transferred to JSC as an
                // external string; do not drop it here.
                let (ptr, len) = (utf16.as_ptr(), utf16.len());
                core::mem::forget(utf16);
                return Ok(ZigString::to_external_u16(ptr, len, global_object));
            } else {
                let js_value =
                    ZigString::init(this.utf8.slice()).to_external_value(global_object);
                // PORT NOTE: ownership of utf8 bytes transferred to JSC via to_external_value; do not Drop.
                core::mem::forget(core::mem::replace(&mut this.utf8, Default::default()));
                return Ok(js_value);
            }
        }

        let result = create_utf8_for_js(global_object, this.utf8.slice());
        if transfer {
            this.utf8 = Default::default();
        }
        return result;
    }

    if transfer {
        this.utf8 = Default::default();
        transfer_to_js(&mut this.underlying, global_object)
    } else {
        to_js(&this.underlying, global_object)
    }
}

// ── escapeRegExp host fns ───────────────────────────────────────────────────
#[bun_jsc::host_fn]
pub fn js_escape_reg_exp(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let input_value = call_frame.argument(0);

    if !input_value.is_string() {
        return global.throw(format_args!("expected string argument"));
    }

    let input = input_value.to_slice(global)?;

    let mut buf: Vec<u8> = Vec::new();

    // PORT NOTE: Zig mapped `error.WriteFailed` → `error.OutOfMemory`; Vec<u8>
    // writes abort on OOM, so no explicit mapping is needed.
    strings::escape_reg_exp(input.slice(), &mut buf);

    let mut output = String::clone_utf8(&buf);

    to_js(&output, global)
}

#[bun_jsc::host_fn]
pub fn js_escape_reg_exp_for_package_name_matching(
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    let input_value = call_frame.argument(0);

    if !input_value.is_string() {
        return global.throw(format_args!("expected string argument"));
    }

    let input = input_value.to_slice(global)?;

    let mut buf: Vec<u8> = Vec::new();

    // PORT NOTE: Zig mapped `error.WriteFailed` → `error.OutOfMemory`; Vec<u8>
    // writes abort on OOM, so no explicit mapping is needed.
    strings::escape_reg_exp_for_package_name_matching(input.slice(), &mut buf);

    let mut output = String::clone_utf8(&buf);

    to_js(&output, global)
}

// ── unicode TestingAPIs ─────────────────────────────────────────────────────
pub mod unicode_testing_apis {
    use super::*;

    /// Used in JS tests, see `internal-for-testing.ts`.
    /// Exercises the `sentinel = true` path of `toUTF16AllocForReal`, which is
    /// otherwise only reachable from Windows-only code (`bun build --compile`
    /// metadata in `src/windows.zig`).
    #[bun_jsc::host_fn]
    pub fn to_utf16_alloc_sentinel(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return global_this.throw(format_args!("toUTF16AllocSentinel: expected 1 argument"));
        }
        let Some(array_buffer) = arguments[0].as_array_buffer(global_this) else {
            return global_this.throw(format_args!("toUTF16AllocSentinel: expected a Uint8Array"));
        };
        let bytes = array_buffer.byte_slice();

        let result = match strings::to_utf16_alloc_for_real(bytes, false, true) {
            Ok(r) => r,
            Err(err) => {
                return global_this.throw_error(err, "toUTF16AllocForReal failed");
            }
        };

        // SAFETY: `to_utf16_alloc_for_real(.., sentinel=true)` writes a NUL at
        // index `len`; the backing allocation is `len + 1` wide.
        debug_assert!(unsafe { *result.as_ptr().add(result.len()) } == 0);

        let out = String::clone_utf16(&result);
        let js = to_js(&out, global_this);
        out.deref();
        js
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/bun_string_jsc.zig (265 lines)
//   confidence: medium
//   todos:      2
//   notes:      from_js_host_call/ExceptionValidationScope/ZigString::Slice allocator API assumed; markBinding(@src()) dropped; utf8-slice ownership transfer in to_external_value uses mem::forget
// ──────────────────────────────────────────────────────────────────────────
