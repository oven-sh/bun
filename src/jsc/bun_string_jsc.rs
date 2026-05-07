//! JSC bridges for `bun.String` and `SliceWithUnderlyingString`. Keeps
//! `src/string/` free of `JSValue`/`JSGlobalObject`/`CallFrame` types — the
//! original methods are aliased to the free fns here.

use core::fmt;
use std::io::Write as _;

use bun_string::{strings, SliceWithUnderlyingString, String, Tag, ZigStringSlice};

use crate::zig_string::{self, ZigString};
use crate::{CallFrame, ExceptionValidationScope, JSGlobalObject, JSValue, JsError, JsResult};

// ── extern decls ────────────────────────────────────────────────────────────
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
#[track_caller]
pub fn transfer_to_js(this: &mut String, global_this: &JSGlobalObject) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; `this` is a live &mut String, global_this borrowed for call duration.
    crate::from_js_host_call(global_this, || unsafe {
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

#[track_caller]
pub fn from_js(value: JSValue, global_object: &JSGlobalObject) -> JsResult<String> {
    let mut scope = ExceptionValidationScope::init(global_object);
    let mut out: String = String::DEAD;
    // SAFETY: FFI call into JSC; `out` is a valid out-param, global_object borrowed for call duration.
    let ok = unsafe { BunString__fromJS(global_object.as_ptr(), value, &mut out) };

    // If there is a pending exception, but stringifying succeeds, we don't return JSError.
    // We do need to always call hasException() to satisfy the need for an exception check.
    let has_exception = scope.has_exception_or_false_when_assertions_are_disabled();
    if ok {
        debug_assert!(out.tag() != Tag::Dead);
    } else {
        debug_assert!(has_exception);
    }

    if ok { Ok(out) } else { Err(JsError::Thrown) }
}

#[track_caller]
pub fn to_js(this: &String, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; `this` is a live &String, global_object borrowed for call duration.
    crate::from_js_host_call(global_object, || unsafe {
        BunString__toJS(global_object.as_ptr(), this)
    })
}

pub fn to_jsdomurl(this: &mut String, global_object: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into JSC; `this` is a live &mut String, global_object borrowed for call duration.
    unsafe { BunString__toJSDOMURL(global_object.as_ptr(), this) }
}

/// calls toJS on all elements of `array`.
#[track_caller]
pub fn to_js_array(global_object: &JSGlobalObject, array: &[String]) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; `array` ptr/len from a live slice, global_object borrowed for call duration.
    crate::from_js_host_call(global_object, || unsafe {
        BunString__createArray(global_object.as_ptr(), array.as_ptr(), array.len())
    })
}

#[track_caller]
pub fn to_js_by_parse_json(self_: &mut String, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; `self_` is a live &mut String, global_object borrowed for call duration.
    crate::from_js_host_call(global_object, || unsafe {
        BunString__toJSON(global_object.as_ptr(), self_)
    })
}

#[track_caller]
pub fn create_utf8_for_js(
    global_object: &JSGlobalObject,
    utf8_slice: &[u8],
) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; ptr/len from a live &[u8], global_object borrowed for call duration.
    crate::from_js_host_call(global_object, || unsafe {
        BunString__createUTF8ForJS(global_object.as_ptr(), utf8_slice.as_ptr(), utf8_slice.len())
    })
}

#[track_caller]
pub fn create_format_for_js(
    global_object: &JSGlobalObject,
    args: fmt::Arguments<'_>,
) -> JsResult<JSValue> {
    // PORT NOTE: Zig took `comptime fmt: [:0]const u8, args: anytype`; callers now
    // pass `format_args!("...", ...)` directly.
    let mut builder: Vec<u8> = Vec::new();
    builder.write_fmt(args).expect("unreachable"); // Vec<u8> write cannot fail
    // SAFETY: FFI call into JSC; ptr/len from a live Vec<u8>, global_object borrowed for call duration.
    crate::from_js_host_call(global_object, || unsafe {
        BunString__createUTF8ForJS(global_object.as_ptr(), builder.as_ptr(), builder.len())
    })
}

#[track_caller]
pub fn parse_date(this: &mut String, global_object: &JSGlobalObject) -> JsResult<f64> {
    // SAFETY: FFI call into JSC; `this` is a live &mut String, global_object borrowed for call duration.
    crate::from_js_host_call_generic(global_object, || unsafe {
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
        return Ok(JSValue::js_number_from_int32(0));
    }

    let js_str = argument.to_js_string(global_object)?;
    // SAFETY: `to_js_string` returns a non-null `JSString*` on success (a thrown
    // exception would have been propagated by `?`); valid for the call duration.
    let view = unsafe { &*js_str }.view(global_object);

    if view.is_empty() {
        return Ok(JSValue::js_number_from_int32(0));
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

    Ok(JSValue::js_number(width as f64))
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
    if (this.underlying.tag() == Tag::Dead || this.underlying.tag() == Tag::Empty)
        && this.utf8.length() > 0
    {
        // We should never enter this state.
        debug_assert!(!this.utf8.is_wtf_allocated());

        // PORT NOTE: Zig checked `utf8.allocator.get()` to see if the slice
        // owns a heap allocation. The Rust `ZigStringSlice` encodes that in
        // its variant; an `Owned` slice's bytes can be handed straight to JSC
        // as an external string (mimalloc-backed, JSC frees on finalize).
        if this.utf8.is_allocated() {
            match strings::to_utf16_alloc(this.utf8.slice(), false, false) {
                Ok(Some(utf16)) => {
                    // Drop the UTF-8 backing (Zig: `this.utf8.deinit(); = .{}`).
                    this.utf8 = ZigStringSlice::default();
                    // Ownership of `utf16` transfers to JSC's external-string
                    // finalizer; do not Drop it here.
                    let utf16 = core::mem::ManuallyDrop::new(utf16);
                    return Ok(zig_string::to_external_u16(
                        utf16.as_ptr(),
                        utf16.len(),
                        global_object,
                    ));
                }
                Ok(None) | Err(_) => {
                    // All-ASCII (or alloc failure — Zig's `catch null`): hand
                    // the existing 8-bit buffer to JSC. Only the `Owned`
                    // variant has a transferable mimalloc block; `WTF` is
                    // ruled out by the assert above and `Static` cannot reach
                    // this arm (`is_allocated()` is false).
                    if let Some((ptr, len)) = this.utf8.take_owned_raw() {
                        let zs = ZigString::init(
                            // SAFETY: `take_owned_raw` yields a live mimalloc
                            // block of `len` bytes; valid until JSC frees it.
                            unsafe { core::slice::from_raw_parts(ptr, len) },
                        );
                        return Ok(zs.to_external_value(global_object));
                    }
                    // Non-owned allocator (no mimalloc block to hand off):
                    // fall through to the copying path below.
                }
            }
        }

        let result = create_utf8_for_js(global_object, this.utf8.slice());
        if transfer {
            this.utf8 = ZigStringSlice::default();
        }
        return result;
    }

    if transfer {
        this.utf8 = ZigStringSlice::default();
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
        return Err(global.throw("expected string argument", format_args!("")));
    }

    let input = input_value.to_slice(global)?;

    let mut buf: Vec<u8> = Vec::new();

    // PORT NOTE: Zig mapped `error.WriteFailed` → `error.OutOfMemory`; Vec<u8>
    // writes cannot fail short of abort-on-OOM, so the error arm is dead.
    strings::escape_reg_exp(input.slice(), &mut buf).expect("Vec<u8> write cannot fail");

    let output = String::clone_utf8(&buf);

    to_js(&output, global)
}

#[bun_jsc::host_fn]
pub fn js_escape_reg_exp_for_package_name_matching(
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    let input_value = call_frame.argument(0);

    if !input_value.is_string() {
        return Err(global.throw("expected string argument", format_args!("")));
    }

    let input = input_value.to_slice(global)?;

    let mut buf: Vec<u8> = Vec::new();

    // PORT NOTE: Zig mapped `error.WriteFailed` → `error.OutOfMemory`; Vec<u8>
    // writes cannot fail short of abort-on-OOM, so the error arm is dead.
    strings::escape_reg_exp_for_package_name_matching(input.slice(), &mut buf)
        .expect("Vec<u8> write cannot fail");

    let output = String::clone_utf8(&buf);

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
            return Err(
                global_this.throw("toUTF16AllocSentinel: expected 1 argument", format_args!("")),
            );
        }
        let Some(array_buffer) = arguments[0].as_array_buffer(global_this) else {
            return Err(
                global_this.throw("toUTF16AllocSentinel: expected a Uint8Array", format_args!("")),
            );
        };
        let bytes = array_buffer.byte_slice();

        let result = match strings::to_utf16_alloc_for_real(bytes, false, true) {
            Ok(r) => r,
            Err(err) => {
                return Err(global_this.throw_error(err.into(), "toUTF16AllocForReal failed"));
            }
        };

        // PORT NOTE: the Rust port of `to_utf16_alloc_for_real(.., sentinel=true)`
        // stores the trailing NUL **inside** the `Vec` (Zig's `[:0]u16` excludes
        // it from `.len`). Slice it off before cloning so the JS string doesn't
        // gain a stray U+0000.
        debug_assert!(matches!(result.last(), Some(&0)));
        let payload = &result[..result.len().saturating_sub(1)];

        let out = String::clone_utf16(payload);
        let js = to_js(&out, global_this);
        out.deref();
        js
    }
}
