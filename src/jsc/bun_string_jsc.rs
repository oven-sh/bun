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
    let this = this as *mut String;
    // SAFETY: FFI call into JSC; `this` is a live *mut String, global_this borrowed for call duration.
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
    let mut scope_storage = core::mem::MaybeUninit::uninit();
    let scope = ExceptionValidationScope::init(&mut scope_storage, global_object);
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

    // Zig: `defer scope.deinit()`. `ExceptionValidationScope` has no `Drop` impl
    // (placement-constructed C++ TopExceptionScope), so destroy explicitly.
    // SAFETY: `scope` was initialized via `init` above and is destroyed exactly once.
    unsafe { ExceptionValidationScope::destroy(scope) };

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
    let self_ = self_ as *mut String;
    // SAFETY: FFI call into JSC; `self_` is a live *mut String, global_object borrowed for call duration.
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
    builder.write_fmt(args).expect("Vec<u8> write cannot fail");
    let (ptr, len) = (builder.as_ptr(), builder.len());
    // SAFETY: FFI call into JSC; ptr/len from a live Vec<u8>, global_object borrowed for call duration.
    crate::from_js_host_call(global_object, || unsafe {
        BunString__createUTF8ForJS(global_object.as_ptr(), ptr, len)
    })
}

#[track_caller]
pub fn parse_date(this: &mut String, global_object: &JSGlobalObject) -> JsResult<f64> {
    let this = this as *mut String;
    // SAFETY: FFI call into JSC; `this` is a live *mut String, global_object borrowed for call duration.
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
    // SAFETY: `to_js_string` returned a non-null `*mut JSString`; valid for the
    // remainder of this host call (rooted on the JS stack via `argument`).
    let view = unsafe { (*js_str).view(global_object) };

    if view.is_empty() {
        return Ok(JSValue::js_number_from_int32(0));
    }

    let str_ = String::init(view);

    // Parse options: { countAnsiEscapeCodes?: bool, ambiguousIsNarrow?: bool }
    let mut count_ansi: bool = false;
    let mut ambiguous_is_narrow: bool = true;

    if opts_val.is_object() {
        if let Some(v) = opts_val.get_truthy(global_object, "countAnsiEscapeCodes")? {
            count_ansi = v.to_boolean();
        }
        if let Some(v) = opts_val.get_truthy(global_object, "ambiguousIsNarrow")? {
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
        #[cfg(debug_assertions)]
        if this.utf8.is_allocated() {
            // We should never enter this state.
            debug_assert!(!this.utf8.is_wtf_allocated());
        }

        // PORT NOTE: Zig checked `utf8.allocator.get()` for "owns an
        // allocator". The Rust `ZigStringSlice` enum encodes ownership in the
        // variant: `Owned`/`WTF` ⇒ allocated, `Static` ⇒ borrowed.
        if this.utf8.is_allocated() {
            if let Some(utf16) =
                strings::to_utf16_alloc(this.utf8.slice(), false, false).unwrap_or(None)
            {
                // Drop the now-unused utf8 allocation (Zig: `this.utf8.deinit()`).
                this.utf8 = ZigStringSlice::default();
                // PORT NOTE: ownership of `utf16` is transferred to JSC as an
                // external string; do not drop it here.
                let mut utf16 = core::mem::ManuallyDrop::new(utf16);
                utf16.shrink_to_fit();
                return Ok(zig_string::to_external_u16(utf16.as_ptr(), utf16.len(), global_object));
            } else if let Some((ptr, len)) = this.utf8.take_owned_raw() {
                // PORT NOTE: ownership of utf8 bytes transferred to JSC via
                // `to_external_value`; `take_owned_raw` already cleared `utf8`
                // and leaked the buffer (mimalloc-freed by JSC).
                let zig = ZigString::from_bytes(
                    // SAFETY: `take_owned_raw` returned a leaked, contiguous
                    // mimalloc-owned buffer of `len` bytes.
                    unsafe { core::slice::from_raw_parts(ptr, len) },
                );
                return Ok(zig.to_external_value(global_object));
            } else {
                // WTF-backed (asserted impossible above) or already cleared:
                // fall through to the copying path.
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
        return Err(global.throw(format_args!("expected string argument")));
    }

    let input = input_value.to_slice(global)?;

    let mut buf: Vec<u8> = Vec::new();

    // Zig mapped `error.WriteFailed` → `error.OutOfMemory`; Vec<u8> writes can
    // only fail on OOM.
    if bun_string::escape_reg_exp::escape_reg_exp(input.slice(), &mut buf).is_err() {
        return Err(JsError::OutOfMemory);
    }

    let output = String::clone_utf8(&buf);
    let js = to_js(&output, global);
    output.deref();
    js
}

#[bun_jsc::host_fn]
pub fn js_escape_reg_exp_for_package_name_matching(
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    let input_value = call_frame.argument(0);

    if !input_value.is_string() {
        return Err(global.throw(format_args!("expected string argument")));
    }

    let input = input_value.to_slice(global)?;

    let mut buf: Vec<u8> = Vec::new();

    // Zig mapped `error.WriteFailed` → `error.OutOfMemory`; Vec<u8> writes can
    // only fail on OOM.
    if bun_string::escape_reg_exp::escape_reg_exp_for_package_name_matching(input.slice(), &mut buf)
        .is_err()
    {
        return Err(JsError::OutOfMemory);
    }

    let output = String::clone_utf8(&buf);
    let js = to_js(&output, global);
    output.deref();
    js
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
            return Err(global_this.throw(format_args!(
                "toUTF16AllocSentinel: expected 1 argument"
            )));
        }
        let Some(array_buffer) = arguments[0].as_array_buffer(global_this) else {
            return Err(global_this.throw(format_args!(
                "toUTF16AllocSentinel: expected a Uint8Array"
            )));
        };
        let bytes = array_buffer.byte_slice();

        let result = match strings::to_utf16_alloc_for_real(bytes, false, true) {
            Ok(r) => r,
            Err(err) => {
                return Err(
                    global_this.throw(format_args!("{err:?} toUTF16AllocForReal failed"))
                );
            }
        };

        // PORT NOTE: Rust's `to_utf16_alloc_for_real(.., sentinel=true)` includes
        // the trailing NUL **in** `result.len()` (Zig's `[:0]u16` kept it past-the-end),
        // so slice it off before handing to JSC.
        debug_assert_eq!(result.last().copied(), Some(0));

        let out = String::clone_utf16(&result[..result.len() - 1]);
        let js = to_js(&out, global_this);
        out.deref();
        js
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/bun_string_jsc.zig (265 lines)
//   confidence: high
//   notes:      ZigString.Slice allocator-vtable replaced by enum variants
//               (`is_allocated`/`is_wtf_allocated`/`take_owned_raw`);
//               markBinding(@src()) dropped; utf8 ownership transferred to JSC
//               via `take_owned_raw` + `to_external_value`.
// ──────────────────────────────────────────────────────────────────────────
