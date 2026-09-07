//! JSC bridges for `bun_core::String` and `Utf8WithString`: the
//! `StringJsc`/`Utf8WithStringJsc` extension traits and the free functions
//! for bytes → JS string. Keeps `bun_core::string` free of
//! `JSValue`/`JSGlobalObject`/`CallFrame` types.

use bun_core::{EncodedSlice, String, Tag, Utf8WithString, strings};

use crate::{CallFrame, EncodedSliceJsc as _, JSGlobalObject, JSValue, JsError, JsResult};

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
    safe fn BunString__toJSDOMURL(global_object: &JSGlobalObject, in_: &String) -> JSValue;
    safe fn BunString__toErrorInstance(
        str: &String,
        global_object: &JSGlobalObject,
        kind: ErrorKind,
    ) -> JSValue;
    fn BunString__createArray(
        global_object: &JSGlobalObject,
        ptr: *const String,
        len: usize,
    ) -> JSValue;
}

/// Mirrors `BunErrorKind` in headers-handwritten.h.
#[repr(u8)]
#[derive(Clone, Copy)]
pub enum ErrorKind {
    Error = 0,
    TypeError = 1,
    SyntaxError = 2,
    RangeError = 3,
}

/// `new <kind>(string)`: a WTF-backed message is shared, a static one
/// atomized, a borrowed `EncodedSlice` copied.
pub(crate) fn error_instance(string: &String, global: &JSGlobalObject, kind: ErrorKind) -> JSValue {
    BunString__toErrorInstance(string, global, kind)
}

/// JSC conversions for `bun_core::String`.
pub trait StringJsc {
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_core::String>;
    /// Borrow: JSC takes its own ref (or copies borrowed bytes).
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
    /// Consume: the +1 moves into the `JSString` (no ref/deref pair).
    /// Borrowed (`EncodedSlice`) contents are copied.
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn to_js_by_parse_json(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
    /// `new Error(self)`: a WTF-backed message is shared, a static one
    /// atomized, a borrowed `EncodedSlice` copied.
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_type_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_syntax_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_range_error_instance(&self, global: &JSGlobalObject) -> JSValue;
}
impl StringJsc for String {
    #[track_caller]
    fn from_js(value: JSValue, global_object: &JSGlobalObject) -> JsResult<String> {
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
    fn to_js(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: `self` borrows a live `String` for the call duration.
        unsafe { crate::cpp::BunString__toJS(global_object, self) }
    }
    #[track_caller]
    fn into_js(mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: C++ moves the ref out of `self` (leaving it Dead) and the cppbind
        // wrapper opens its own validation scope.
        unsafe { crate::cpp::BunString__transferToJS(&raw mut self, global_this) }
    }
    #[track_caller]
    fn to_js_by_parse_json(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: `self` is a live `&String`.
        unsafe { crate::cpp::BunString__toJSON(global_object, self) }
    }
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        error_instance(self, global, ErrorKind::Error)
    }
    fn to_type_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        error_instance(self, global, ErrorKind::TypeError)
    }
    fn to_syntax_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        error_instance(self, global, ErrorKind::SyntaxError)
    }
    fn to_range_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        error_instance(self, global, ErrorKind::RangeError)
    }
}

/// JSC conversions for `bun_core::Utf8WithString`.
pub trait Utf8WithStringJsc {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue>;
}
impl Utf8WithStringJsc for Utf8WithString {
    fn into_js(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let (utf8, string) = self.into_parts();
        if string.is_empty() {
            if let Some(utf8) = utf8.filter(|v| !v.is_empty()) {
                return owned_utf8_into_js(global_object, utf8);
            }
        }
        string.into_js(global_object)
    }
}

/// `BunString__toJSDOMURL` opens a `DECLARE_THROW_SCOPE` and throws (returning
/// encoded `0`) when the string is not a valid URL, so wrap it in a validation
/// scope exactly like `to_js`/`into_js` above. Without this, under
/// `BUN_JSC_validateExceptionChecks=1` the C++ ThrowScope's destructor
/// `simulateThrow()` leaves `m_needExceptionCheck` set and the caller's
/// `to_js_host_call` scope dtor asserts "unchecked exception".
///
/// Routing the FFI through `from_js_host_call` observes the exception at the
/// call site and surfaces it as `Err(JsError::Thrown)`.
#[track_caller]
pub fn to_jsdomurl(this: &String, global_object: &JSGlobalObject) -> JsResult<JSValue> {
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

/// UTF-8 `Vec<u8>` → JS string; the allocation (or its UTF-16 transcode) is
/// adopted by JSC. Throws `STRING_TOO_LONG` when over [`String::max_length`]
/// and `MEMORY_ALLOCATION_FAILED` when the transcode could not allocate.
pub fn owned_utf8_into_js(global_object: &JSGlobalObject, utf8: Vec<u8>) -> JsResult<JSValue> {
    if utf8.is_empty() {
        return Ok(JSValue::js_empty_string(global_object));
    }
    match strings::to_utf16_alloc(&utf8, false, false) {
        Ok(None) => owned_latin1_into_js(global_object, utf8),
        Ok(Some(utf16)) => owned_utf16_into_js(global_object, utf16),
        Err(_) => Err(throw_utf16_transcode_failure(global_object, &utf8)),
    }
}

/// The error for a `to_utf16_alloc` of `utf8` that could not allocate its
/// output: `STRING_TOO_LONG` when the result could not have fit in a string
/// anyway, `MEMORY_ALLOCATION_FAILED` otherwise.
#[cold]
pub fn throw_utf16_transcode_failure(global_object: &JSGlobalObject, utf8: &[u8]) -> JsError {
    if String::utf16_transcode_too_long(utf8) {
        global_object.throw_string_too_long()
    } else {
        global_object.throw_memory_allocation_failed()
    }
}

/// Latin-1 (or known-ASCII) `Vec<u8>` → JS string; the allocation is adopted
/// by JSC. Throws `STRING_TOO_LONG` when over [`String::max_length`].
pub fn owned_latin1_into_js(global_object: &JSGlobalObject, latin1: Vec<u8>) -> JsResult<JSValue> {
    if latin1.is_empty() {
        return Ok(JSValue::js_empty_string(global_object));
    }
    let latin1 = core::mem::ManuallyDrop::new(latin1);
    EncodedSlice::latin1(&latin1).to_external_value(global_object)
}

/// UTF-16 `Vec<u16>` → JS string; the allocation is adopted by JSC.
/// Throws `STRING_TOO_LONG` when over [`String::max_length`].
pub fn owned_utf16_into_js(global_object: &JSGlobalObject, utf16: Vec<u16>) -> JsResult<JSValue> {
    if utf16.is_empty() {
        return Ok(JSValue::js_empty_string(global_object));
    }
    let utf16 = core::mem::ManuallyDrop::new(utf16);
    EncodedSlice::utf16(&utf16).to_external_value(global_object)
}

#[track_caller]
pub fn parse_date(this: &String, global_object: &JSGlobalObject) -> JsResult<f64> {
    // SAFETY: `this` is a live `&String`; cppbind wrapper opens its own scope.
    unsafe { crate::cpp::Bun__parseDate(global_object, this) }
}

// ── escapeRegExp host fns ───────────────────────────────────────────────────
#[bun_jsc::host_fn]
pub fn js_escape_reg_exp(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let input_value = call_frame.argument(0);

    if !input_value.is_string() {
        return Err(global.throw(format_args!("expected string argument")));
    }

    let input = input_value.to_utf8(global)?;

    let mut buf: Vec<u8> = Vec::new();

    // Vec<u8> writes can only fail on OOM.
    if bun_core::escape_reg_exp::escape_reg_exp(input.slice(), &mut buf).is_err() {
        return Err(JsError::OutOfMemory);
    }

    create_utf8_for_js(global, &buf)
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

    let input = input_value.to_utf8(global)?;

    let mut buf: Vec<u8> = Vec::new();

    // Vec<u8> writes can only fail on OOM.
    if bun_core::escape_reg_exp::escape_reg_exp_for_package_name_matching(input.slice(), &mut buf)
        .is_err()
    {
        return Err(JsError::OutOfMemory);
    }

    create_utf8_for_js(global, &buf)
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

        String::clone_utf16(&result[..result.len() - 1]).into_js(global_this)
    }
}
