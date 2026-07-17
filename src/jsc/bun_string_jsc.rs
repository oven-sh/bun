//! JSC bridges for `bun.String` and `SliceWithUnderlyingString`. Keeps
//! `src/string/` free of `JSValue`/`JSGlobalObject`/`CallFrame` types — the
//! original methods are aliased to the free fns here.

use bun_core::{SliceWithUnderlyingString, String, Tag, ZigStringSlice, strings};

use crate::zig_string::{self, ZigString};
use crate::{CallFrame, JSGlobalObject, JSValue, JsError, JsResult, ZigStringJsc as _};

// ── extern decls ────────────────────────────────────────────────────────────
// `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle and `&String`/
// `&mut String` are ABI-identical to non-null `*const String`/`*mut String`,
// so shims that take only those are declared `safe fn`. The (ptr,len) pair
// shims stay `unsafe fn`.
//
// `[[ZIG_EXPORT(...)]]`-annotated symbols (`BunString__toJS`, `BunString__fromJS`,
// `BunString__transferToJS`, `BunString__toJSON`, `BunString__createUTF8ForJS`,
// `Bun__parseDate`) are NOT redeclared here — route through `crate::cpp::*`,
// which owns the canonical extern decl + per-mode exception scope.
unsafe extern "C" {
    safe fn BunString__toJSDOMURL(global_object: &JSGlobalObject, in_: &mut String) -> JSValue;
    fn BunString__createArray(
        global_object: &JSGlobalObject,
        ptr: *const String,
        len: usize,
    ) -> JSValue;
    safe fn JSC__createError(global: &JSGlobalObject, str_: &String) -> JSValue;
    safe fn JSC__createTypeError(global: &JSGlobalObject, str_: &String) -> JSValue;
    safe fn JSC__createRangeError(global: &JSGlobalObject, str_: &String) -> JSValue;
}

// ── bun.String methods ──────────────────────────────────────────────────────
#[track_caller]
pub fn transfer_to_js(this: &mut String, global_this: &JSGlobalObject) -> JsResult<JSValue> {
    // SAFETY: `this` is a live `&mut String`; the cppbind wrapper opens its own
    // validation scope and converts `.zero` to `Err(JsError::Thrown)`.
    unsafe { crate::cpp::BunString__transferToJS(this, global_this) }
}

pub fn to_error_instance(this: &String, global_object: &JSGlobalObject) -> JSValue {
    let result = JSC__createError(global_object, this);
    this.deref();
    result
}

pub(crate) fn to_type_error_instance(this: &String, global_object: &JSGlobalObject) -> JSValue {
    let result = JSC__createTypeError(global_object, this);
    this.deref();
    result
}

pub(crate) fn to_range_error_instance(this: &String, global_object: &JSGlobalObject) -> JSValue {
    let result = JSC__createRangeError(global_object, this);
    this.deref();
    result
}

#[inline]
#[track_caller]
pub fn from_js(value: JSValue, global_object: &JSGlobalObject) -> JsResult<String> {
    crate::validation_scope!(scope, global_object);
    let mut out: String = String::DEAD;
    // SAFETY: `global_object` is a valid handle; `out` is a live stack out-param.
    let ok = unsafe {
        crate::cpp::raw::BunString__fromJS(
            core::ptr::from_ref(global_object).cast_mut(),
            value,
            &raw mut out,
        )
    };

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
    // SAFETY: `this` borrows a live `String` for the call duration.
    unsafe { crate::cpp::BunString__toJS(global_object, this) }
}

/// `BunString__toJSDOMURL` opens a `DECLARE_THROW_SCOPE` and throws (returning
/// encoded `0`) when the string is not a valid URL, so wrap it in a validation
/// scope exactly like `to_js`/`transfer_to_js` above. Without this, under
/// `BUN_JSC_validateExceptionChecks=1` the C++ ThrowScope's destructor
/// `simulateThrow()` leaves `m_needExceptionCheck` set and the caller's
/// `to_js_host_call` scope dtor asserts "unchecked exception".
///
/// Routing the FFI through `from_js_host_call` observes the exception at the
/// call site and surfaces it as `Err(JsError::Thrown)`.
#[track_caller]
pub fn to_jsdomurl(this: &mut String, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    crate::from_js_host_call(global_object, || BunString__toJSDOMURL(global_object, this))
}

/// calls toJS on all elements of `array`.
#[track_caller]
pub fn to_js_array(global_object: &JSGlobalObject, array: &[String]) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; `array` ptr/len from a live slice, global_object borrowed for call duration.
    crate::from_js_host_call(global_object, || unsafe {
        BunString__createArray(global_object, array.as_ptr(), array.len())
    })
}

#[track_caller]
pub fn to_js_by_parse_json(
    self_: &mut String,
    global_object: &JSGlobalObject,
) -> JsResult<JSValue> {
    // SAFETY: `self_` is a live `&mut String`.
    unsafe { crate::cpp::BunString__toJSON(global_object, self_) }
}

#[track_caller]
pub fn create_utf8_for_js(global_object: &JSGlobalObject, utf8_slice: &[u8]) -> JsResult<JSValue> {
    // SAFETY: FFI call into JSC; ptr/len from a live &[u8], global_object borrowed for call duration.
    unsafe {
        crate::cpp::BunString__createUTF8ForJS(
            global_object,
            utf8_slice.as_ptr().cast(),
            utf8_slice.len(),
        )
    }
}

#[track_caller]
pub fn parse_date(this: &mut String, global_object: &JSGlobalObject) -> JsResult<f64> {
    // SAFETY: `this` is a live `&mut String`; cppbind wrapper opens its own scope.
    unsafe { crate::cpp::Bun__parseDate(global_object, this) }
}

// ── SliceWithUnderlyingString methods ───────────────────────────────────────
pub(crate) fn slice_with_underlying_string_to_js(
    this: &mut SliceWithUnderlyingString,
    global_object: &JSGlobalObject,
) -> JsResult<JSValue> {
    slice_with_underlying_string_to_js_with_options(this, global_object, false)
}

pub(crate) fn slice_with_underlying_string_transfer_to_js(
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

        // `ZigStringSlice` encodes ownership in the variant:
        // `Owned`/`WTF` ⇒ allocated, `Static` ⇒ borrowed.
        if this.utf8.is_allocated() {
            if let Some(utf16) = strings::to_utf16_alloc(this.utf8.slice(), false, false)
                .map_err(|_| global_object.throw_out_of_memory())?
            {
                // Drop the now-unused utf8 allocation.
                this.utf8 = ZigStringSlice::default();
                // Ownership of `utf16` is transferred to JSC as an
                // external string; do not drop it here.
                let mut utf16 = core::mem::ManuallyDrop::new(utf16);
                utf16.shrink_to_fit();
                // SAFETY: `utf16` was allocated by the global allocator and is
                // wrapped in `ManuallyDrop`; ownership transfers to JSC here.
                return Ok(unsafe {
                    zig_string::to_external_u16(utf16.as_ptr(), utf16.len(), global_object)
                });
            } else if let Some((ptr, len)) = this.utf8.take_owned_raw() {
                // Ownership of the utf8 bytes is transferred to JSC via
                // `to_external_value`; `take_owned_raw` already cleared `utf8`
                // and leaked the buffer (mimalloc-freed by JSC).
                let zig = ZigString::from_bytes(
                    // SAFETY: `take_owned_raw` returned a leaked, contiguous
                    // mimalloc-owned buffer of `len` bytes.
                    unsafe { bun_core::ffi::slice(ptr, len) },
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

    // Vec<u8> writes can only fail on OOM.
    if bun_core::escape_reg_exp::escape_reg_exp(input.slice(), &mut buf).is_err() {
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

    // Vec<u8> writes can only fail on OOM.
    if bun_core::escape_reg_exp::escape_reg_exp_for_package_name_matching(input.slice(), &mut buf)
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
    /// otherwise only reachable from Windows-only `bun build --compile`
    /// metadata code.
    #[bun_jsc::host_fn]
    pub fn to_utf16_alloc_sentinel(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return Err(
                global_this.throw(format_args!("toUTF16AllocSentinel: expected 1 argument"))
            );
        }
        let Some(array_buffer) = arguments[0].as_array_buffer(global_this) else {
            return Err(
                global_this.throw(format_args!("toUTF16AllocSentinel: expected a Uint8Array"))
            );
        };
        let bytes = array_buffer.byte_slice();

        let result = match strings::to_utf16_alloc_for_real(bytes, false, true) {
            Ok(r) => r,
            Err(err) => {
                return Err(global_this.throw(format_args!("{err:?} toUTF16AllocForReal failed")));
            }
        };

        // `to_utf16_alloc_for_real(.., sentinel=true)` includes the trailing
        // NUL **in** `result.len()`, so slice it off before handing to JSC.
        debug_assert_eq!(result.last().copied(), Some(0));

        let out = String::clone_utf16(&result[..result.len() - 1]);
        let js = to_js(&out, global_this);
        out.deref();
        js
    }
}
