use bun_core::paths::strings;
use core::ffi::c_int;

use crate::jsc::{self, CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_core::zig_string::Slice as ZigStringSlice;
use bun_core::{self, fmt as bun_fmt};
use bun_core::{WStr, ZStr, ZigString};
use crate::{SliceWithUnderlyingStringJsc as _, StringJsc as _, ZigStringJsc as _};
use bun_core::paths::{MAX_PATH_BYTES, OSPathBuffer, OSPathSliceZ, PathBuffer, WPathBuffer};
use bun_sys::{self, Fd, Mode, O};

use crate::node::util::validators;
use crate::webcore::{Blob, Request, Response};

pub use bun_core::SliceWithUnderlyingString;

pub use jsc::MarkedArrayBuffer as Buffer;

// `jsc.ArgumentsSlice` — cursor over CallFrame args.
pub use crate::vm::ArgumentsSlice;

// LAYERING: `Fd::{from_js,from_js_validated,to_js}` are provided by the
// canonical `crate::sys_jsc::FdJsc` extension trait (full range/type
// validation). Re-exported so existing
// `crate::node::types::FdJsc` import paths keep resolving.
pub use crate::sys_jsc::FdJsc;

/// `bun_runtime`-tier required-argument helper layered on `FdJsc`. Collapses
/// the `next_eat → from_js_validated → ok_or_else(throw_invalid_fd_error)`
/// boilerplate repeated 12× across `node_fs.rs::args::*::from_js`.
pub(crate) trait FdArgExt: FdJsc {
    #[inline]
    fn from_js_required(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
        let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
        Self::from_js_validated(fd_value, ctx)?.ok_or_else(|| {
            if fd_value.is_number() {
                return ctx
                    .err(
                        jsc::ErrorCode::OUT_OF_RANGE,
                        format_args!(
                            "The value of \"fd\" is out of range. It must be an integer. Received {}",
                            bun_fmt::double(fd_value.as_number())
                        ),
                    )
                    .throw();
            }
            ctx.throw_invalid_argument_type_value(b"fd", b"number", fd_value)
        })
    }
}
impl FdArgExt for Fd {}

// LAYERING: `bun_sys::SystemError → JSValue` bridge (reshapes the T1 data
// struct into the `#[repr(C)]` FFI layout and forwards to C++). Re-exported so
// `system_error.to_error_instance(ctx)` resolves via the canonical impl.
pub use crate::sys_jsc::SystemErrorJsc;

pub use bun_sys::PlatformIoVec;

// ──────────────────────────────────────────────────────────────────────────

pub enum BlobOrStringOrBuffer {
    Blob(Box<Blob>),
    StringOrBuffer(StringOrBuffer),
}

impl Drop for BlobOrStringOrBuffer {
    fn drop(&mut self) {
        match self {
            Self::Blob(blob) => {
                let _ = blob.store.with_mut(|s| s.take());
            }
            Self::StringOrBuffer(_) => {
                // StringOrBuffer's own Drop handles cleanup.
            }
        }
    }
}

impl BlobOrStringOrBuffer {
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::Blob(blob) => blob.shared_view(),
            Self::StringOrBuffer(str) => str.slice(),
        }
    }

    pub fn protect(&self) {
        match self {
            Self::StringOrBuffer(sob) => sob.protect(),
            _ => {}
        }
    }

    pub fn byte_length(&self) -> usize {
        self.slice().len()
    }

    pub fn from_js_maybe_file_maybe_async(
        global: &JSGlobalObject,
        value: JSValue,
        allow_file: bool,
        is_async: bool,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        // Check StringOrBuffer first because it's more common and cheaper.
        let str = match StringOrBuffer::from_js_maybe_async(global, value, is_async, true)? {
            Some(s) => s,
            None => {
                // `as_class_ref` is the safe shared-borrow downcast (centralised
                // deref proof in `JSValue`); the JS wrapper roots the payload
                // while `value` is on the stack. All `Blob` accessors below
                // take `&self`.
                let Some(blob) = value.as_class_ref::<Blob>() else {
                    return Ok(None);
                };
                if allow_file && blob.needs_to_read_file() {
                    return Err(global
                        .throw_invalid_arguments(format_args!("File blob cannot be used here")));
                }

                if is_async {
                    // For async/cross-thread usage, copy the blob data to an owned slice
                    // rather than referencing the store which isn't thread-safe
                    let blob_data = blob.shared_view();
                    let owned_data: Vec<u8> = blob_data.to_vec();
                    return Ok(Some(Self::StringOrBuffer(StringOrBuffer::EncodedSlice(
                        ZigStringSlice::init_owned(owned_data),
                    ))));
                }

                // `Blob::dupe()` clones the StoreRef (bumps refcount) and bit-copies fields.
                return Ok(Some(Self::Blob(Box::new(blob.dupe()))));
            }
        };

        Ok(Some(Self::StringOrBuffer(str)))
    }

    pub fn from_js_maybe_file(
        global: &JSGlobalObject,
        value: JSValue,
        allow_file: bool,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        Self::from_js_maybe_file_maybe_async(global, value, allow_file, false)
    }

    pub fn from_js(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        Self::from_js_maybe_file(global, value, true)
    }

    pub fn from_js_async(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        Self::from_js_maybe_file_maybe_async(global, value, true, true)
    }

    pub fn from_js_with_encoding_value(
        global: &JSGlobalObject,
        value: JSValue,
        encoding_value: JSValue,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        Self::from_js_with_encoding_value_allow_request_response(
            global,
            value,
            encoding_value,
            false,
        )
    }

    pub fn from_js_with_encoding_value_allow_request_response(
        global: &JSGlobalObject,
        value: JSValue,
        encoding_value: JSValue,
        allow_request_response: bool,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        match value.js_type() {
            jsc::JSType::DOMWrapper => {
                // `as_class_ref` is the safe shared-borrow downcast (centralised
                // deref proof in `JSValue`); the JS wrapper roots the payload
                // while `value` is on the stack.
                if let Some(blob) = value.as_class_ref::<Blob>() {
                    return Ok(Some(Self::Blob(Box::new(blob.dupe()))));
                }
                if allow_request_response {
                    if let Some(request) = value.as_class_ref::<Request>() {
                        let body_value = request.get_body_value();
                        body_value.to_blob_if_possible();

                        if let Some(mut any_blob) = body_value.try_use_as_any_blob() {
                            let blob = any_blob.to_blob(global);
                            any_blob.detach();
                            return Ok(Some(Self::Blob(Box::new(blob))));
                        }

                        return Err(global.throw_invalid_arguments(format_args!(
                            "Only buffered Request/Response bodies are supported for now.",
                        )));
                    }

                    if let Some(response) = value.as_class_ref::<Response>() {
                        let body_value = response.get_body_value();
                        body_value.to_blob_if_possible();

                        if let Some(mut any_blob) = body_value.try_use_as_any_blob() {
                            let blob = any_blob.to_blob(global);
                            any_blob.detach();
                            return Ok(Some(Self::Blob(Box::new(blob))));
                        }

                        return Err(global.throw_invalid_arguments(format_args!(
                            "Only buffered Request/Response bodies are supported for now.",
                        )));
                    }
                }
            }
            _ => {}
        }

        let allow_string_object = true;
        match StringOrBuffer::from_js_with_encoding_value_allow_string_object(
            global,
            value,
            encoding_value,
            allow_string_object,
        )? {
            Some(s) => Ok(Some(Self::StringOrBuffer(s))),
            None => Ok(None),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub enum StringOrBuffer {
    String(SliceWithUnderlyingString),
    ThreadsafeString(SliceWithUnderlyingString),
    EncodedSlice(ZigStringSlice),
    Buffer(Buffer),
}

impl Default for StringOrBuffer {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl StringOrBuffer {
    pub const EMPTY: StringOrBuffer = StringOrBuffer::EncodedSlice(ZigStringSlice::EMPTY);

    pub fn slice(&self) -> &[u8] {
        match self {
            Self::String(str) => str.slice(),
            Self::ThreadsafeString(str) => str.slice(),
            Self::EncodedSlice(str) => str.slice(),
            Self::Buffer(str) => str.slice(),
        }
    }
}

impl Drop for StringOrBuffer {
    fn drop(&mut self) {
        match self {
            Self::ThreadsafeString(str) | Self::String(str) => {
                // `SliceWithUnderlyingString` has no `Drop` of its own; release
                // the WTF refcount in place. `str.utf8: ZigStringSlice` is then
                // dropped by the enum's field drop glue — no need to
                // `mem::take()` and write a ~56B default back.
                str.underlying.deref();
            }
            Self::EncodedSlice(_encoded) => {
                // ZigStringSlice has Drop; cleanup is implicit.
            }
            Self::Buffer(_) => {}
        }
    }
}

impl bun_jsc::Unprotect for BlobOrStringOrBuffer {
    /// JS-side half of cleanup — owned
    /// payloads are released by `Drop` (which runs next when held in a
    /// [`bun_jsc::ThreadSafe`]).
    #[inline]
    fn unprotect(&mut self) {
        if let Self::StringOrBuffer(sob) = self {
            sob.unprotect();
        }
    }
}

impl bun_jsc::Unprotect for StringOrBuffer {
    /// JS-side half of cleanup — undo the
    /// `protect()` taken by [`StringOrBuffer::to_thread_safe`] /
    /// `from_js_maybe_async(.., is_async=true)`. Owned slices are released by
    /// `Drop`.
    #[inline]
    fn unprotect(&mut self) {
        if let Self::Buffer(buffer) = self {
            if buffer.pinned {
                buffer.pinned = false;
                buffer.buffer.unpin();
            }
            buffer.buffer.value.unprotect();
        }
    }
}

impl StringOrBuffer {
    pub fn to_thread_safe(&mut self) {
        match self {
            Self::String(s) => {
                s.to_thread_safe();
                let str = core::mem::take(s);
                *self = Self::ThreadsafeString(str);
            }
            Self::ThreadsafeString(_) => {}
            Self::EncodedSlice(_) => {}
            Self::Buffer(buffer) => {
                buffer.buffer.value.protect();
            }
        }
    }

    /// Consuming `to_thread_safe()` — see [`PathLike::into_thread_safe`].
    #[inline]
    pub fn into_thread_safe(mut self) -> bun_jsc::ThreadSafe<Self> {
        self.to_thread_safe();
        bun_jsc::ThreadSafe::adopt(self)
    }

    pub fn from_js_to_owned_slice(
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Vec<u8>> {
        if let Some(array_buffer) = value.as_array_buffer(global_object) {
            let bytes = array_buffer.byte_slice();
            global_object
                .vm()
                .report_extra_memory(array_buffer.len as usize);
            return Ok(bytes.to_vec());
        }

        let str = bun_core::String::from_js(value, global_object)?;
        scopeguard::defer! { str.deref(); }

        let result = str.to_owned_slice();
        global_object.vm().report_extra_memory(result.len());
        Ok(result)
    }

    pub fn to_js(&mut self, ctx: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Self::ThreadsafeString(str) | Self::String(str) => str.transfer_to_js(ctx),
            Self::EncodedSlice(encoded_slice) => {
                let result = jsc::bun_string_jsc::create_utf8_for_js(ctx, encoded_slice.slice());
                *encoded_slice = ZigStringSlice::default();
                result
            }
            Self::Buffer(buffer) => {
                if buffer.buffer.value != JSValue::ZERO {
                    return Ok(buffer.buffer.value);
                }
                Ok(buffer.to_node_buffer(ctx))
            }
        }
    }

    /// Mirrors `to_thread_safe` but only
    /// protects the JS-side buffer value (no string conversion).
    #[inline]
    pub fn protect(&self) {
        if let Self::Buffer(buffer) = self {
            buffer.buffer.value.protect();
        }
    }

    /// Returns the buffer payload if this is `Self::Buffer`.
    #[inline]
    pub fn buffer(&self) -> Option<&Buffer> {
        if let Self::Buffer(b) = self {
            Some(b)
        } else {
            None
        }
    }

    /// Out-param core of [`from_js_maybe_async`]. Writes the decoded payload
    /// directly into `*out` and returns
    /// `Ok(true)` on success, `Ok(false)` if `value` is not a string/buffer
    /// type. `*out` is left untouched on `Ok(false)` / `Err`.
    ///
    /// Hot callers (e.g. `NodeHTTPResponse::write_or_end`) should use this
    /// directly — returning `JsResult<Option<StringOrBuffer>>` by value lowers
    /// to ~128B of `vmovups` stack-to-stack copies per call which the
    /// `Option<>`-returning wrappers below cannot always NRVO away.
    #[inline]
    pub fn from_js_maybe_async_into(
        out: &mut StringOrBuffer,
        global: &JSGlobalObject,
        value: JSValue,
        is_async: bool,
        allow_string_object: bool,
    ) -> JsResult<bool> {
        use jsc::JSType;
        match value.js_type() {
            str_type @ (JSType::String | JSType::StringObject | JSType::DerivedStringObject) => {
                if !allow_string_object && str_type != JSType::String {
                    return Ok(false);
                }
                let mut str = bun_core::String::from_js(value, global)?;
                if is_async {
                    let mut possible_clone = str;
                    let mut sliced = possible_clone.to_thread_safe_slice();
                    sliced.report_extra_memory(global.vm());
                    // Release the ref `from_js` took. On the WTF paths above
                    // `to_thread_safe_slice` left `str` intact (and took its
                    // own refs as needed); on the non-WTF fall-through it
                    // moved the value into `sliced.underlying`, so this is a
                    // no-op. Previously a `scopeguard` did this at scope exit.
                    str.deref();

                    if sliced.underlying.is_empty() {
                        // partial-move out of `SliceWithUnderlyingString` —
                        // take `utf8` and leave the rest defaulted (no Drop on the type).
                        *out = Self::EncodedSlice(core::mem::take(&mut sliced.utf8));
                        return Ok(true);
                    }

                    *out = Self::ThreadsafeString(sliced);
                } else {
                    // `to_slice()` moves the ref into `.underlying` and leaves
                    // `str` EMPTY, so no trailing `deref()` is needed here —
                    // the old scopeguard's closure was always a no-op on this arm.
                    *out = Self::String(str.to_slice());
                }
                Ok(true)
            }

            JSType::ArrayBuffer
            | JSType::Int8Array
            | JSType::Uint8Array
            | JSType::Uint8ClampedArray
            | JSType::Int16Array
            | JSType::Uint16Array
            | JSType::Int32Array
            | JSType::Uint32Array
            | JSType::Float32Array
            | JSType::Float16Array
            | JSType::Float64Array
            | JSType::BigInt64Array
            | JSType::BigUint64Array
            | JSType::DataView => {
                let buffer = if is_async {
                    Buffer::from_js_pinned(global, value)
                        .unwrap_or_else(|| Buffer::from_array_buffer(global, value))
                } else {
                    Buffer::from_array_buffer(global, value)
                };

                if is_async {
                    buffer.buffer.value.protect();
                }

                *out = Self::Buffer(buffer);
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    #[inline]
    pub fn from_js_maybe_async(
        global: &JSGlobalObject,
        value: JSValue,
        is_async: bool,
        allow_string_object: bool,
    ) -> JsResult<Option<StringOrBuffer>> {
        let mut out = Self::EMPTY;
        if Self::from_js_maybe_async_into(&mut out, global, value, is_async, allow_string_object)? {
            Ok(Some(out))
        } else {
            Ok(None)
        }
    }

    #[inline]
    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<StringOrBuffer>> {
        Self::from_js_maybe_async(global, value, false, true)
    }

    #[inline]
    pub fn from_js_with_encoding(
        global: &JSGlobalObject,
        value: JSValue,
        encoding: Encoding,
    ) -> JsResult<Option<StringOrBuffer>> {
        Self::from_js_with_encoding_maybe_async(global, value, encoding, false, true)
    }

    /// Out-param convenience wrapper — see [`from_js_with_encoding_maybe_async_into`].
    #[inline]
    pub fn from_js_with_encoding_into(
        out: &mut StringOrBuffer,
        global: &JSGlobalObject,
        value: JSValue,
        encoding: Encoding,
    ) -> JsResult<bool> {
        Self::from_js_with_encoding_maybe_async_into(out, global, value, encoding, false, true)
    }

    /// Out-param core of [`from_js_with_encoding_maybe_async`]. Writes into
    /// `*out` and returns `Ok(true)` on success, `Ok(false)` for not-a-
    /// string-or-buffer. See [`from_js_maybe_async_into`] for rationale.
    #[inline]
    pub fn from_js_with_encoding_maybe_async_into(
        out: &mut StringOrBuffer,
        global: &JSGlobalObject,
        value: JSValue,
        encoding: Encoding,
        is_async: bool,
        allow_string_object: bool,
    ) -> JsResult<bool> {
        if value.is_cell() && value.js_type().is_array_buffer_like() {
            let buffer = if is_async {
                Buffer::from_js_pinned(global, value)
                    .unwrap_or_else(|| Buffer::from_array_buffer(global, value))
            } else {
                Buffer::from_array_buffer(global, value)
            };
            if is_async {
                buffer.buffer.value.protect();
            }
            *out = Self::Buffer(buffer);
            return Ok(true);
        }

        if encoding == Encoding::Utf8 {
            return Self::from_js_maybe_async_into(
                out,
                global,
                value,
                is_async,
                allow_string_object,
            );
        }

        if value.is_string() {
            let str = bun_core::OwnedString::new(bun_core::String::from_js(value, global)?);
            if str.is_empty() {
                return Self::from_js_maybe_async_into(
                    out,
                    global,
                    value,
                    is_async,
                    allow_string_object,
                );
            }

            use crate::webcore::encoding::BunStringEncode as _;
            let encoded = str.get().encode(encoding);
            global.vm().report_extra_memory(encoded.len());

            *out = Self::EncodedSlice(ZigStringSlice::init_owned(encoded));
            return Ok(true);
        }

        Ok(false)
    }

    #[inline]
    pub fn from_js_with_encoding_maybe_async(
        global: &JSGlobalObject,
        value: JSValue,
        encoding: Encoding,
        is_async: bool,
        allow_string_object: bool,
    ) -> JsResult<Option<StringOrBuffer>> {
        let mut out = Self::EMPTY;
        if Self::from_js_with_encoding_maybe_async_into(
            &mut out,
            global,
            value,
            encoding,
            is_async,
            allow_string_object,
        )? {
            Ok(Some(out))
        } else {
            Ok(None)
        }
    }

    pub fn from_js_with_encoding_value(
        global: &JSGlobalObject,
        value: JSValue,
        encoding_value: JSValue,
    ) -> JsResult<Option<StringOrBuffer>> {
        let encoding: Encoding = 'brk: {
            if !encoding_value.is_cell() {
                break 'brk Encoding::Utf8;
            }
            break 'brk Encoding::from_js(encoding_value, global)?.unwrap_or(Encoding::Utf8);
        };

        Self::from_js_with_encoding(global, value, encoding)
    }

    pub fn from_js_with_encoding_value_allow_string_object(
        global: &JSGlobalObject,
        value: JSValue,
        encoding_value: JSValue,
        allow_string_object: bool,
    ) -> JsResult<Option<StringOrBuffer>> {
        let encoding: Encoding = 'brk: {
            if !encoding_value.is_cell() {
                break 'brk Encoding::Utf8;
            }
            break 'brk Encoding::from_js(encoding_value, global)?.unwrap_or(Encoding::Utf8);
        };
        let is_async = false;
        Self::from_js_with_encoding_maybe_async(
            global,
            value,
            encoding,
            is_async,
            allow_string_object,
        )
    }
}

// String encoding — see `crate::webcore::encoding::BunStringEncode`.

// ──────────────────────────────────────────────────────────────────────────

/// https://github.com/nodejs/node/blob/master/lib/buffer.js#L587
/// See `webcore::encoding` for encoding and decoding functions.
/// must match src/jsc/bindings/BufferEncodingType.h
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum Encoding {
    Utf8,
    Ucs2,
    Utf16le,
    Latin1,
    Ascii,
    Base64,
    Base64url,
    Hex,

    /// Refer to the buffer's encoding
    Buffer,
}

bun_core::comptime_string_map! {
    /// Buffer encoding names → [`Encoding`]. Looked up case-insensitively
    /// ([`Encoding::from`]), so keys must stay lowercase.
    static ENCODING_MAP: Encoding = {
        b"hex" => Encoding::Hex,
        b"utf8" => Encoding::Utf8,
        b"ucs2" => Encoding::Utf16le,
        b"utf-8" => Encoding::Utf8,
        b"ucs-2" => Encoding::Utf16le,
        b"ascii" => Encoding::Ascii,
        b"base64" => Encoding::Base64,
        b"binary" => Encoding::Latin1,
        b"latin1" => Encoding::Latin1,
        b"buffer" => Encoding::Buffer,
        b"utf16le" => Encoding::Utf16le,
        b"utf16-le" => Encoding::Utf16le,
        b"base64url" => Encoding::Base64url,
    };
}

impl From<Encoding> for bun_core::NodeEncoding {
    fn from(e: Encoding) -> Self {
        // Both enums are `#[repr(u8)]` with identical discriminant order
        // (Utf8, Ucs2, Utf16le, Latin1, Ascii, Base64, Base64url, Hex, Buffer).
        match e {
            Encoding::Utf8 => Self::Utf8,
            Encoding::Ucs2 => Self::Ucs2,
            Encoding::Utf16le => Self::Utf16le,
            Encoding::Latin1 => Self::Latin1,
            Encoding::Ascii => Self::Ascii,
            Encoding::Base64 => Self::Base64,
            Encoding::Base64url => Self::Base64url,
            Encoding::Hex => Self::Hex,
            Encoding::Buffer => Self::Buffer,
        }
    }
}

impl From<bun_core::NodeEncoding> for Encoding {
    fn from(e: bun_core::NodeEncoding) -> Self {
        // Reverse of the impl above — both enums are `#[repr(u8)]` with identical
        // discriminant order; required so `webcore::encoding::{to_string,to_bun_string}`'s
        // `impl Into<Encoding>` bound accepts `bun_core::NodeEncoding` directly.
        match e {
            bun_core::NodeEncoding::Utf8 => Self::Utf8,
            bun_core::NodeEncoding::Ucs2 => Self::Ucs2,
            bun_core::NodeEncoding::Utf16le => Self::Utf16le,
            bun_core::NodeEncoding::Latin1 => Self::Latin1,
            bun_core::NodeEncoding::Ascii => Self::Ascii,
            bun_core::NodeEncoding::Base64 => Self::Base64,
            bun_core::NodeEncoding::Base64url => Self::Base64url,
            bun_core::NodeEncoding::Hex => Self::Hex,
            bun_core::NodeEncoding::Buffer => Self::Buffer,
        }
    }
}

impl Encoding {
    pub fn is_binary_to_text(self) -> bool {
        matches!(self, Self::Hex | Self::Base64 | Self::Base64url)
    }

    /// Caller must verify the value is a string
    pub fn from(slice: &[u8]) -> Option<Encoding> {
        ENCODING_MAP.get_ascii_case_insensitive(slice).copied()
    }

    /// Case-insensitive lookup against a `bun.String` without allocating
    /// (`bun.String.inMapCaseInsensitive`): UTF-16 code units are narrowed
    /// into a stack buffer (any non-ASCII unit ⇒ miss — no encoding name
    /// contains one) before the map lookup.
    pub fn from_bun_string(s: &bun_core::String) -> Option<Encoding> {
        s.in_map_case_insensitive(&ENCODING_MAP)
    }
}

impl Encoding {
    pub fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Encoding>> {
        // `from_bun_string` narrows into a stack buffer — no `to_utf8()`
        // allocation needed for a short ASCII key.
        let str = bun_core::OwnedString::new(bun_core::String::from_js(value, global)?);
        Ok(Self::from_bun_string(&str))
    }

    pub fn assert(
        value: JSValue,
        global_object: &JSGlobalObject,
        default: Encoding,
    ) -> JsResult<Encoding> {
        if value.is_falsey() {
            return Ok(default);
        }

        if !value.is_string() {
            return Err(Self::throw_encoding_error(global_object, value));
        }

        match Self::from_js_with_default_on_empty(value, global_object, default)? {
            Some(e) => Ok(e),
            None => Err(Self::throw_encoding_error(global_object, value)),
        }
    }

    pub fn from_js_with_default_on_empty(
        value: JSValue,
        global_object: &JSGlobalObject,
        default: Encoding,
    ) -> JsResult<Option<Encoding>> {
        let str = bun_core::OwnedString::new(bun_core::String::from_js(value, global_object)?);
        if str.is_empty() {
            return Ok(Some(default));
        }
        Ok(Self::from(str.to_utf8().slice()))
    }

    pub fn throw_encoding_error(global_object: &JSGlobalObject, value: JSValue) -> jsc::JsError {
        global_object
            .err(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!(
                    "encoding '{}' is an invalid encoding",
                    value.fmt_string(global_object)
                ),
            )
            .throw()
    }

    /// Thin assertion wrapper over `encode_with_max_size`; currently has no
    /// callers (CryptoHasher.rs uses `encode_with_max_size` directly).
    #[inline]
    pub fn encode_with_size(
        self,
        global_object: &JSGlobalObject,
        size: usize,
        input: &[u8],
    ) -> JsResult<JSValue> {
        debug_assert_eq!(input.len(), size);
        self.encode_with_max_size(global_object, size, input)
    }

    /// `max_size` is a runtime arg (see `encode_with_size`); callers pass
    /// `EVP_MAX_MD_SIZE` etc.
    pub fn encode_with_max_size(
        self,
        global_object: &JSGlobalObject,
        max_size: usize,
        input: &[u8],
    ) -> JsResult<JSValue> {
        debug_assert!(
            input.len() <= max_size,
            "input length ({}) should not exceed max_size ({})",
            input.len(),
            max_size,
        );
        // Stable Rust forbids const-generic arithmetic in array lengths, so
        // we heap-allocate.
        match self {
            Self::Base64 => {
                let encoded_len = bun_core::base64::encode_len(input);
                let (mut encoded, bytes) =
                    bun_core::String::create_uninitialized_latin1(encoded_len);
                if encoded.is_dead() {
                    return encoded.transfer_to_js(global_object);
                }
                let n = bun_core::base64::encode(bytes, input);
                debug_assert_eq!(n, encoded_len);
                encoded.transfer_to_js(global_object)
            }
            Self::Base64url => {
                let buf = bun_core::base64::simdutf_encode_url_safe_alloc(input);
                Ok(jsc::zig_string::ZigString::init(&buf).to_js(global_object))
            }
            Self::Hex => {
                // The byte-by-byte `write!` formatting machinery is pathologically
                // slow in debug builds, so encode via LUT directly into the
                // destination JS string buffer.
                let (mut encoded, bytes) =
                    bun_core::String::create_uninitialized_latin1(input.len() * 2);
                if encoded.is_dead() {
                    // WTF OOM — match webcore::encoding pattern; transfer the
                    // Dead string (becomes JS empty) rather than indexing a
                    // zero-length `bytes`.
                    return encoded.transfer_to_js(global_object);
                }
                bun_core::fmt::bytes_to_hex_lower(input, bytes);
                encoded.transfer_to_js(global_object)
            }
            Self::Buffer => jsc::ArrayBuffer::create_buffer(global_object, input),
            enc => crate::webcore::encoding::to_string(input, global_object, enc),
        }
    }

    pub fn to_js(self, global_object: &JSGlobalObject) -> JSValue {
        // `Encoding` is `#[repr(u8)]` matching BufferEncodingType.h.
        WebCore_BufferEncodingType_toJS(global_object, self)
    }
}

// and isn't already *_sys, leave them in place".
unsafe extern "C" {
    safe fn WebCore_BufferEncodingType_toJS(
        global_object: &JSGlobalObject,
        encoding: Encoding,
    ) -> JSValue;
}

// ──────────────────────────────────────────────────────────────────────────

/// This is used on the windows implementation of realpath, which is in javascript

pub fn js_assert_encoding_valid(
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    let value = call_frame.argument(0);
    let _ = Encoding::assert(value, global, Encoding::Utf8)?;
    Ok(JSValue::UNDEFINED)
}

// ──────────────────────────────────────────────────────────────────────────

pub enum PathOrBuffer {
    Path(bun_core::RawSlice<u8>),
    Buffer(Buffer),
}

impl PathOrBuffer {
    #[inline]
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::Path(p) => p.slice(),
            Self::Buffer(_) => unreachable!("Zig accessed .path unconditionally"),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

// LAYERING: single nominal `PathLike`/`PathOrFileDescriptor` live in
// `bun_jsc::node_path` so `bun_jsc::webcore_types::store::File::pathlike`
// and the `Store`/`Blob` constructors here share one type. This module
// re-exports them and layers the JS-argument-parsing helpers via the
// `PathLikeExt` / `PathOrFdExt` extension traits.
pub use crate::node_path::{PathLike, PathOrFileDescriptor};

/// Returned by [`PathLikeExt::slice_w`] / [`PathLikeExt::os_path`] /
/// [`PathLikeExt::os_path_kernel32`] when the path's UTF-16 form would not
/// fit a `WPathBuffer` (`strings::fits_in_wide_path_buffer`). NT caps paths
/// at `PATH_MAX_WIDE` units, so such a path cannot exist on disk — callers
/// map this to `false`/`ENAMETOOLONG` as appropriate instead of letting the
/// conversion overflow (oven-sh/bun#27775).
#[derive(Debug, Clone, Copy)]
pub struct NameTooLong;

/// `bun_runtime`-tier behaviour layered on `bun_jsc::node_path::PathLike`.
///
/// `to_thread_safe` / `into_thread_safe` / `slice` / `estimated_size` are
/// inherent on the lower-tier type (see `bun_jsc::node_path`); this trait
/// adds only the path-buffer slicers and JS-argument parsing that depend on
/// `bun_runtime` types (`Valid`, `ArgumentsSlice` cursor flow).
pub trait PathLikeExt {
    fn slice_z_with_force_copy<'a, const FORCE: bool>(
        &'a self,
        buf: &'a mut PathBuffer,
    ) -> &'a ZStr
    where
        Self: Sized;
    fn slice_z<'a>(&'a self, buf: &'a mut PathBuffer) -> &'a ZStr
    where
        Self: Sized;
    fn slice_w<'a>(&'a self, buf: &'a mut WPathBuffer) -> Result<&'a WStr, NameTooLong>
    where
        Self: Sized;
    fn os_path<'a>(&'a self, buf: &'a mut OSPathBuffer) -> Result<&'a OSPathSliceZ, NameTooLong>
    where
        Self: Sized;
    fn os_path_kernel32<'a>(
        &'a self,
        buf: &'a mut PathBuffer,
    ) -> Result<&'a OSPathSliceZ, NameTooLong>
    where
        Self: Sized;
    fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Option<PathLike>>
    where
        Self: Sized;

    /// `from_js` + Node's `ERR_INVALID_ARG_VALUE` "<name> must be a string
    /// or TypedArray" throw on `None`. Collapses the open-coded
    /// `?.ok_or_else(|| ctx.throw_invalid_arguments(...))?` repeated 22× in
    /// `node_fs.rs::args::*::from_js`.
    #[inline]
    fn from_js_required(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
        name: &str,
    ) -> JsResult<PathLike>
    where
        Self: Sized,
    {
        Self::from_js(ctx, arguments)?.ok_or_else(|| {
            ctx.throw_invalid_arguments(format_args!("{name} must be a string or TypedArray"))
        })
    }

    fn from_js_with_allocator(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Option<PathLike>>
    where
        Self: Sized;
    fn from_bun_string(
        global: &JSGlobalObject,
        str: &mut bun_core::String,
        will_be_async: bool,
    ) -> JsResult<PathLike>
    where
        Self: Sized;
}

/// `bun_runtime`-tier behaviour layered on `bun_jsc::node_path::PathOrFileDescriptor`.
pub(crate) trait PathOrFdExt {
    fn from_js(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Option<PathOrFileDescriptor>>
    where
        Self: Sized;
}

impl PathLikeExt for PathLike {
    // Const-generics can't change return mutability, so this always returns
    // `&ZStr`. A future force=true caller that needs `&mut ZStr` will need a
    // separate method.
    fn slice_z_with_force_copy<'a, const FORCE: bool>(
        &'a self,
        buf: &'a mut PathBuffer,
    ) -> &'a ZStr {
        let sliced = self.slice();

        #[cfg(windows)]
        {
            // Only take the fast path for paths that can exist on NT at
            // all (≤ ~32757 UTF-16 units). That bounds the `\\?\`-prefixed
            // copy below in bytes too (≤ 3×32757 + 5 < MAX_PATH_BYTES);
            // the cwd-join branch of `resolve_cwd_with_external_buf_z`
            // prepends the cwd's filesystem root — arbitrarily long for UNC
            // cwds — and bounds-checks internally, surfacing NameTooLong.
            // Anything over-long falls through to the plain copy at the
            // bottom, which fits without the prefix (or takes the too-long
            // fallback) and fails at the syscall.
            if bun_core::paths::is_absolute(sliced) && strings::fits_in_wide_path_buffer(sliced) {
                if sliced.len() > 2
                    && bun_core::paths::is_drive_letter(sliced[0])
                    && sliced[1] == b':'
                    && bun_core::paths::is_sep_any(sliced[2])
                {
                    // Add the long path syntax. This affects most of node:fs
                    // Normalize the path directly into buf without an intermediate
                    // buffer. The input (sliced) already has a drive letter, so
                    // resolveCWDWithExternalBufZ would just memcpy it, making the
                    // temporary allocation unnecessary.
                    buf[0..4].copy_from_slice(&bun_sys::windows::LONG_PATH_PREFIX_U8);
                    let n = bun_core::paths::resolve_path::normalize_buf::<bun_core::paths::platform::Windows>(
                        sliced,
                        &mut buf[4..],
                    )
                    .len();
                    buf[4 + n] = 0;
                    // SAFETY: buf[4+n] == 0 written above.
                    return ZStr::from_buf(&buf[..], 4 + n);
                }
                // reshaped for borrowck — capture the length so
                // the `Ok` borrow ends at the match, then re-derive.
                let resolved_len = match bun_core::paths::resolve_path::PosixToWinNormalizer::resolve_cwd_with_external_buf_z(buf, sliced) {
                    Ok(res) => Some(res.len()),
                    // The cwd root + path don't fit `buf` (UNC cwds can push
                    // a near-MAX_PATH_BYTES path over); fall through to the
                    // plain copy / too-long handling below.
                    Err(bun_core::paths::Error::Sys(bun_core::errno::SystemErrno::ENAMETOOLONG)) => None,
                    Err(e) => panic!("Error while resolving path: {e:?}"),
                };
                if let Some(len) = resolved_len {
                    // SAFETY: `resolve_cwd_with_external_buf_z` wrote the NUL
                    // at `buf[len]`.
                    return ZStr::from_buf(&buf[..], len);
                }
            }
        }

        if sliced.is_empty() {
            if !FORCE {
                return ZStr::EMPTY;
            }

            buf[0] = 0;
            // SAFETY: buf[0] == 0 written above.
            return ZStr::from_buf(&buf[..], 0);
        }

        if !FORCE {
            if sliced[sliced.len() - 1] == 0 {
                // SAFETY: last byte is NUL.
                return ZStr::from_slice_with_nul(sliced);
            }
        }

        if sliced.len() >= buf.len() {
            bun_core::debug_warn!(
                "path too long: {} bytes exceeds PathBuffer capacity of {}\n",
                sliced.len(),
                buf.len()
            );
            if !FORCE {
                return ZStr::EMPTY;
            }

            buf[0] = 0;
            // SAFETY: buf[0] == 0 written above.
            return ZStr::from_buf(&buf[..], 0);
        }

        buf[..sliced.len()].copy_from_slice(sliced);
        buf[sliced.len()] = 0;
        // SAFETY: buf[sliced.len()] == 0 written above.
        ZStr::from_buf(&buf[..], sliced.len())
    }

    #[inline]
    fn slice_z<'a>(&'a self, buf: &'a mut PathBuffer) -> &'a ZStr {
        self.slice_z_with_force_copy::<false>(buf)
    }

    #[inline]
    fn slice_w<'a>(&'a self, buf: &'a mut WPathBuffer) -> Result<&'a WStr, NameTooLong> {
        let sliced = self.slice();
        if !strings::fits_in_wide_path_buffer(sliced) {
            return Err(NameTooLong);
        }
        Ok(strings::paths::to_w_path(buf, sliced))
    }

    #[inline]
    fn os_path<'a>(&'a self, buf: &'a mut OSPathBuffer) -> Result<&'a OSPathSliceZ, NameTooLong> {
        #[cfg(windows)]
        {
            return self.slice_w(buf);
        }
        #[cfg(not(windows))]
        {
            Ok(self.slice_z_with_force_copy::<false>(buf))
        }
    }

    #[inline]
    fn os_path_kernel32<'a>(
        &'a self,
        buf: &'a mut PathBuffer,
    ) -> Result<&'a OSPathSliceZ, NameTooLong> {
        #[cfg(windows)]
        {
            let s = self.slice();
            let mut b = bun_core::paths::path_buffer_pool::get();
            // RAII guard puts back on Drop.

            // Device paths (\\.\, \\?\) and NT object paths (\??\) should not be normalized
            // because the "." in \\.\pipe\name would be incorrectly stripped as a "current directory" component.
            if s.len() >= 4
                && bun_core::paths::is_sep_any(s[0])
                && bun_core::paths::is_sep_any(s[1])
                && (s[2] == b'.' || s[2] == b'?')
                && bun_core::paths::is_sep_any(s[3])
            {
                if !strings::fits_in_wide_path_buffer(s) {
                    return Err(NameTooLong);
                }
                // SAFETY: reinterpreting PathBuffer ([u8; N]) as [u16] — 2-byte
                // alignment is runtime-asserted inside `bytes_as_slice_mut`;
                // see PathBuffer doc comment for
                // why the buffer is always sufficiently aligned in practice.
                let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(&mut buf[..]) };
                return Ok(strings::to_kernel32_path(buf_u16, s));
            }
            if !s.is_empty() && bun_core::paths::is_sep_any(s[0]) {
                // Bail before the cwd resolution + normalization below write
                // into fixed u8 buffers: UNC-shaped inputs pass through the
                // resolver untouched and can reach `normalize_buf` at full
                // MAX_PATH_BYTES length, whose root handling writes one past
                // the input length.
                if !strings::fits_in_wide_path_buffer(s) {
                    return Err(NameTooLong);
                }
                // `buf` is the scratch for cwd-resolution; `b` is the pooled
                // scratch for normalisation; final wide path lands back in `buf`.
                let resolve = match bun_core::paths::resolve_path::PosixToWinNormalizer::resolve_cwd_with_external_buf(
                    buf, s,
                ) {
                    Ok(r) => r,
                    // The cwd root + path don't fit the resolution buffer
                    // (UNC cwds can push a near-MAX_PATH_BYTES path over) —
                    // such a path can't exist on NT.
                    Err(bun_core::paths::Error::Sys(bun_core::errno::SystemErrno::ENAMETOOLONG)) => return Err(NameTooLong),
                    Err(e) => panic!("Error while resolving path: {e:?}"),
                };
                let normal = bun_core::paths::resolve_path::normalize_buf::<bun_core::paths::platform::Windows>(
                    resolve,
                    &mut b[..],
                );
                if !strings::fits_in_wide_path_buffer(normal) {
                    return Err(NameTooLong);
                }
                // `resolve`'s borrow of `buf` ended at the line above (NLL).
                // SAFETY: same alignment note as above.
                let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(&mut buf[..]) };
                return Ok(strings::to_kernel32_path(buf_u16, normal));
            }
            // Handle "." specially since normalizeStringBuf strips it to an empty string
            if s.len() == 1 && s[0] == b'.' {
                // SAFETY: see alignment note above (PathBuffer reinterpreted as [u16]).
                let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(&mut buf[..]) };
                return Ok(strings::to_kernel32_path(buf_u16, b"."));
            }
            let normal = bun_core::paths::resolve_path::normalize_string_buf::<
                true,
                bun_core::paths::platform::Windows,
                false,
            >(s, &mut b[..]);
            if !strings::fits_in_wide_path_buffer(normal) {
                return Err(NameTooLong);
            }
            // SAFETY: see alignment note above (PathBuffer reinterpreted as [u16]).
            let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(&mut buf[..]) };
            return Ok(strings::to_kernel32_path(buf_u16, normal));
        }

        #[cfg(not(windows))]
        {
            Ok(self.slice_z_with_force_copy::<false>(buf))
        }
    }

    fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Option<PathLike>> {
        Self::from_js_with_allocator(ctx, arguments)
    }

    fn from_js_with_allocator(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Option<PathLike>> {
        let Some(arg) = arguments.next() else {
            return Ok(None);
        };
        use jsc::JSType;
        match arg.js_type() {
            JSType::Uint8Array | JSType::DataView => {
                let mut buffer = Buffer::from_js_pinned(ctx, arg)
                    .unwrap_or_else(|| Buffer::from_typed_array(ctx, arg));
                if let Err(err) = Valid::path_buffer(&buffer, ctx)
                    .and_then(|_| Valid::path_null_bytes(buffer.slice(), ctx))
                {
                    if buffer.pinned {
                        buffer.pinned = false;
                        buffer.buffer.unpin();
                    }
                    return Err(err);
                }

                arguments.protect_eat();
                Ok(Some(Self::Buffer(buffer)))
            }

            JSType::ArrayBuffer => {
                let mut buffer = Buffer::from_js_pinned(ctx, arg)
                    .unwrap_or_else(|| Buffer::from_array_buffer(ctx, arg));
                if let Err(err) = Valid::path_buffer(&buffer, ctx)
                    .and_then(|_| Valid::path_null_bytes(buffer.slice(), ctx))
                {
                    if buffer.pinned {
                        buffer.pinned = false;
                        buffer.buffer.unpin();
                    }
                    return Err(err);
                }

                arguments.protect_eat();
                Ok(Some(Self::Buffer(buffer)))
            }

            JSType::String | JSType::StringObject | JSType::DerivedStringObject => {
                let mut str = bun_core::OwnedString::new(arg.to_bun_string(ctx)?);

                arguments.eat();

                Ok(Some(Self::from_bun_string(
                    ctx,
                    &mut str,
                    arguments.will_be_async,
                )?))
            }
            _ => {
                if let Some(domurl) = jsc::DOMURL::cast(arg, ctx) {
                    use jsc::dom_url::ToFileSystemPathError;
                    let mut str = bun_core::OwnedString::new(match domurl.file_system_path() {
                        Ok(s) => s,
                        Err(ToFileSystemPathError::NotFileUrl) => {
                            return Err(ctx
                                .err(
                                    jsc::ErrorCode::INVALID_URL_SCHEME,
                                    format_args!("URL must be a non-empty \"file:\" path"),
                                )
                                .throw());
                        }
                        Err(ToFileSystemPathError::InvalidPath) => {
                            return Err(ctx
                                .err(
                                    jsc::ErrorCode::INVALID_FILE_URL_PATH,
                                    format_args!("URL must be a non-empty \"file:\" path"),
                                )
                                .throw());
                        }
                        Err(ToFileSystemPathError::InvalidHost) => {
                            return Err(ctx
                                .err(
                                    jsc::ErrorCode::INVALID_FILE_URL_HOST,
                                    format_args!("URL must be a non-empty \"file:\" path"),
                                )
                                .throw());
                        }
                    });
                    if str.is_empty() {
                        return Err(ctx
                            .err(
                                jsc::ErrorCode::INVALID_ARG_VALUE,
                                format_args!("URL must be a non-empty \"file:\" path"),
                            )
                            .throw());
                    }
                    arguments.eat();

                    return Ok(Some(Self::from_bun_string(
                        ctx,
                        &mut str,
                        arguments.will_be_async,
                    )?));
                }

                Ok(None)
            }
        }
    }

    fn from_bun_string(
        global: &JSGlobalObject,
        str: &mut bun_core::String,
        will_be_async: bool,
    ) -> JsResult<PathLike> {
        if will_be_async {
            let sliced = str.to_thread_safe_slice();
            let sliced = scopeguard::guard(sliced, |s| s.deinit());

            // Validate the UTF-8 byte length after conversion, since the path
            // will be stored in a fixed-size PathBuffer.
            Valid::path_string_length(sliced.slice().len(), global)?;
            Valid::path_null_bytes(sliced.slice(), global)?;

            let mut sliced = scopeguard::ScopeGuard::into_inner(sliced);
            sliced.report_extra_memory(global.vm());

            if sliced.underlying.is_empty() {
                return Ok(Self::EncodedSlice(core::mem::take(&mut sliced.utf8)));
            }
            Ok(Self::ThreadsafeString(sliced))
        } else {
            let sliced = str.to_slice();
            let sliced = scopeguard::guard(sliced, |s| s.deinit());

            // Validate the UTF-8 byte length after conversion, since the path
            // will be stored in a fixed-size PathBuffer.
            Valid::path_string_length(sliced.slice().len(), global)?;
            Valid::path_null_bytes(sliced.slice(), global)?;

            let mut sliced = scopeguard::ScopeGuard::into_inner(sliced);

            // Costs nothing to keep both around.
            if sliced.is_wtf_allocated() {
                return Ok(Self::SliceWithUnderlyingString(sliced));
            }

            sliced.report_extra_memory(global.vm());

            // It is expensive to keep both around. `utf8` here is an Owned
            // transcoded copy (UTF-16 or non-ASCII Latin-1 input), so the
            // returned EncodedSlice is independent of `underlying` — release
            // the WTFStringImpl ref `to_slice` moved into it.
            let utf8 = core::mem::take(&mut sliced.utf8);
            sliced.deinit();
            Ok(Self::EncodedSlice(utf8))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct Valid;

impl Valid {
    pub fn path_slice(zig_str: &ZigStringSlice, ctx: &JSGlobalObject) -> JsResult<()> {
        match zig_str.slice().len() {
            // Exclusive: `PathBuffer` is `[u8; MAX_PATH_BYTES]` and
            // `slice_z_with_force_copy` needs `len + NUL ≤ MAX_PATH_BYTES`.
            0..MAX_PATH_BYTES => Ok(()),
            _ => {
                let mut system_error =
                    bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open)
                        .with_path(zig_str.slice())
                        .to_system_error();
                system_error.syscall = bun_core::String::DEAD;
                Err(ctx.throw_value(system_error.to_error_instance(ctx)))
            }
        }
    }

    pub fn path_string_length(len: usize, ctx: &JSGlobalObject) -> JsResult<()> {
        match len {
            // Exclusive: `PathBuffer` is `[u8; MAX_PATH_BYTES]` and
            // `slice_z_with_force_copy` needs `len + NUL ≤ MAX_PATH_BYTES`.
            0..MAX_PATH_BYTES => Ok(()),
            _ => {
                let mut system_error =
                    bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open)
                        .to_system_error();
                system_error.syscall = bun_core::String::DEAD;
                Err(ctx.throw_value(system_error.to_error_instance(ctx)))
            }
        }
    }

    pub fn path_string(zig_str: &ZigString, ctx: &JSGlobalObject) -> JsResult<()> {
        Self::path_string_length(zig_str.len, ctx)
    }

    pub fn path_buffer(buffer: &Buffer, ctx: &JSGlobalObject) -> JsResult<()> {
        let slice = buffer.slice();
        match slice.len() {
            0 => {
                Err(ctx
                    .throw_invalid_arguments(format_args!("Invalid path buffer: can't be empty")))
            }
            // Exclusive: `PathBuffer` is `[u8; MAX_PATH_BYTES]` and
            // `slice_z_with_force_copy` needs `len + NUL ≤ MAX_PATH_BYTES`.
            1..MAX_PATH_BYTES => Ok(()),
            _ => {
                let mut system_error =
                    bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open)
                        .to_system_error();
                system_error.syscall = bun_core::String::DEAD;
                Err(ctx.throw_value(system_error.to_error_instance(ctx)))
            }
        }
    }

    pub fn path_null_bytes(slice: &[u8], global: &JSGlobalObject) -> JsResult<()> {
        if strings::index_of_char(slice, 0).is_some() {
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received {}",
                        bun_fmt::quote(slice)
                    ),
                )
                .throw());
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct VectorArrayBuffer {
    // bare JSValue field — only sound while this lives on the stack.
    // Stored in a stack-local during writev; never heap-allocated.
    pub value: JSValue,
    pub buffers: Vec<PlatformIoVec>,
    /// The collected elements, in order. Rooted (and their backing stores
    /// pinned) for the lifetime of an async operation; see [`Self::release`].
    pub views: Vec<JSValue>,
    pinned: bool,
}

impl VectorArrayBuffer {
    pub fn to_js(&self, _: &JSGlobalObject) -> JSValue {
        self.value
    }

    /// Release the per-element roots and pins taken by `from_js(.., pin: true)`.
    /// Must run on the JS thread, exactly once, after the I/O completes.
    pub fn release(&mut self) {
        if !self.pinned {
            return;
        }
        self.pinned = false;
        for view in self.views.drain(..) {
            view.unpin_array_buffer();
            view.unprotect();
        }
    }
}

unsafe extern "C" {
    fn Bun__JSArray__collectBufferSpans(
        global_object: &JSGlobalObject,
        value: JSValue,
        pin_buffers: bool,
        ctx: *mut std::ffi::c_void,
        append: unsafe extern "C" fn(
            ctx: *mut std::ffi::c_void,
            element: JSValue,
            data: *mut u8,
            byte_len: usize,
        ),
    ) -> i32;
}

unsafe extern "C" fn append_buffer_span(
    ctx: *mut std::ffi::c_void,
    element: JSValue,
    data: *mut u8,
    byte_len: usize,
) {
    // SAFETY: `ctx` is the `&mut VectorArrayBuffer` passed to
    // `Bun__JSArray__collectBufferSpans` by `from_js` below, alive for the
    // duration of the call.
    let out = unsafe { &mut *ctx.cast::<VectorArrayBuffer>() };
    let slice: &mut [u8] = if data.is_null() || byte_len == 0 {
        &mut []
    } else {
        // SAFETY: `data..data + byte_len` is the byte range of `element`'s
        // backing store, valid and unaliased for the duration of the callback.
        unsafe { std::slice::from_raw_parts_mut(data, byte_len) }
    };
    out.buffers.push(bun_sys::platform_iovec_create(slice));
    out.views.push(element);
}

impl VectorArrayBuffer {
    /// Collect an array of ArrayBufferViews into iovecs. Every element is read
    /// before any raw pointer is taken, so user code run by an indexed read (a
    /// getter, a proxy trap) cannot free a backing store that has already been
    /// captured.
    ///
    /// `pin` is required when the spans outlive this call (async I/O): each
    /// element is rooted and its backing store is pinned against detach until
    /// [`Self::release`] runs.
    pub fn from_js(
        global_object: &JSGlobalObject,
        val: JSValue,
        pin: bool,
    ) -> JsResult<VectorArrayBuffer> {
        let mut out = VectorArrayBuffer {
            value: val,
            buffers: Vec::new(),
            views: Vec::new(),
            pinned: false,
        };
        bun_jsc::validation_scope!(scope, global_object);
        // SAFETY: `out` outlives the call; the callback only dereferences the
        // ctx pointer it is handed.
        let status = unsafe {
            Bun__JSArray__collectBufferSpans(
                global_object,
                val,
                pin,
                (&raw mut out).cast(),
                append_buffer_span,
            )
        };
        scope.assert_exception_presence_matches(status == -1);
        if pin {
            // The C++ side already pinned each backing store; root the views
            // themselves so a getter-returned element that is not reachable
            // from `value` survives until completion. Set `pinned` even on
            // failure so `release()` balances the elements collected before
            // the error.
            out.pinned = true;
            for view in &out.views {
                view.protect();
            }
        }
        match status {
            0 => Ok(out),
            -1 => {
                out.release();
                Err(jsc::JsError::Thrown)
            }
            2 => {
                out.release();
                Err(global_object.throw_out_of_memory())
            }
            _ => {
                out.release();
                Err(global_object
                    .throw_invalid_arguments(format_args!("Expected ArrayBufferView[]")))
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub fn mode_from_js(ctx: &JSGlobalObject, value: JSValue) -> JsResult<Option<Mode>> {
    let mode_int: u32 = if value.is_number() {
        validators::validate_uint32(ctx, value, format_args!("mode"), false)?
    } else {
        if value.is_undefined_or_null() {
            return Ok(None);
        }

        // Node gates on `typeof value === 'string'`, so a `new String(...)`
        // wrapper falls through to the number-only validator.
        if !value.is_string_literal() {
            return Err(ctx.throw_invalid_argument_type_value(b"mode", b"number", value));
        }

        // An easier method of constructing the mode is to use a sequence of
        // three octal digits (e.g. 765). The left-most digit (7 in the example),
        // specifies the permissions for the file owner. The middle digit (6 in
        // the example), specifies permissions for the group. The right-most
        // digit (5 in the example), specifies the permissions for others.

        let mut zig_str = ZigString::EMPTY;
        value.to_zig_string(&mut zig_str, ctx)?;
        // `to_slice()` handles both storage forms: the 8-bit-only `slice()`
        // would misread a UTF-16 buffer, and JSC can store pure-ASCII content
        // 16-bit, so bitness cannot be used to pre-filter.
        let utf8 = zig_str.to_slice();
        let slice = utf8.slice();

        // Node validates mode strings against /^[0-7]+$/ before parsing.
        if slice.is_empty() || !slice.iter().all(|b| (b'0'..=b'7').contains(b)) {
            let actual = JSGlobalObject::inspect_for_error_message(ctx, value)?;
            return Err(ctx
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The argument 'mode' must be a 32-bit unsigned integer or an octal string. Received {}",
                        actual
                    ),
                )
                .throw());
        }

        // Node range-checks the parsed octal string with the same validateUint32
        // as numeric modes (> u32::MAX is ERR_OUT_OF_RANGE). `slice` is already
        // [0-7]+, so the only parse error is Overflow; u64::MAX stays out of range.
        let parsed = strings::parse_int::<u64>(slice, 8).unwrap_or(u64::MAX);
        validators::validate_uint32(
            ctx,
            JSValue::js_number_from_uint64(parsed),
            format_args!("mode"),
            false,
        )?
    };

    Ok(Some(mode_int as Mode))
}

// ──────────────────────────────────────────────────────────────────────────

// LAYERING: `Clone for PathOrFileDescriptor` and the `SerializeTag` enum now
// live alongside the type in `bun_jsc::node_path` (orphan rules forbid the
// foreign-type impl here). Re-export the tag so downstream
// `crate::node::types::PathOrFileDescriptorSerializeTag` paths keep resolving.
pub use crate::node_path::PathOrFileDescriptorSerializeTag;

// The path-owning variants have
// `Drop`, so an explicit `dupe()` is provided for
// callers (Blob, Store::File) that need a fresh copy. Ref-counting variants are
// bumped where the underlying type supports it; otherwise we bitwise-copy
// and leave proper ref-counting to a later pass.

impl PathOrFdExt for PathOrFileDescriptor {
    fn from_js(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Option<PathOrFileDescriptor>> {
        let Some(first) = arguments.next() else {
            return Ok(None);
        };

        if let Some(fd) = Fd::from_js_validated(first, ctx)? {
            arguments.eat();
            return Ok(Some(Self::Fd(fd)));
        }

        match PathLike::from_js_with_allocator(ctx, arguments)? {
            Some(path) => Ok(Some(Self::Path(path))),
            None => Ok(None),
        }
    }
}

// Drop: unref()s the path string if it is a PathLike (via PathLike's Drop).
// Does nothing for file descriptors, **does not** close file descriptors.
// (No explicit `impl Drop` needed — field drop of PathLike handles it.)

// ──────────────────────────────────────────────────────────────────────────

/// Non-exhaustive set of flag values; newtype over c_int.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct FileSystemFlags(pub c_int);

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FileSystemFlagsKind {
    Access,
    CopyFile,
}

impl FileSystemFlags {
    // `pub type TagType = c_int;` would be an inherent associated
    // type (unstable). Dropped — callers use `c_int` directly.

    /// Open file for appending. The file is created if it does not exist.
    pub const A: Self = Self(O::APPEND | O::WRONLY | O::CREAT);
    /// Open file for reading. An exception occurs if the file does not exist.
    pub const R: Self = Self(O::RDONLY);
    /// Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
    pub const W: Self = Self(O::TRUNC | O::CREAT | O::WRONLY);

    #[inline]
    pub fn as_int(self) -> c_int {
        self.0
    }
}

impl FileSystemFlags {
    pub fn from_js(ctx: &JSGlobalObject, val: JSValue) -> JsResult<Option<FileSystemFlags>> {
        if val.is_number() {
            // Match Node's stringToFlags, which runs validateInt32 on a numeric
            // `flags`: accept any integer-valued number in the int32 range,
            // regardless of whether JSC boxed it as an int32 or a double. Go's
            // `syscall/js` bridge reads arguments out of wasm memory with
            // getFloat64, so valid flags like 578 (O_RDWR|O_CREAT|O_TRUNC)
            // arrive double-boxed and must not be rejected.
            let number = validators::validate_int32(ctx, val, "flags", None, None)?;
            let flags = number.max(0);
            // On Windows, numeric flags from fs.constants (e.g. O_CREAT=0x100)
            // use the platform's native MSVC/libuv values which differ from the
            // internal bun.O representation. Convert them here so downstream
            // code that operates on bun.O flags works correctly.
            #[cfg(windows)]
            {
                return Ok(Some(FileSystemFlags(bun_core::libuv_sys::O::to_bun_o(flags))));
            }
            #[cfg(not(windows))]
            {
                return Ok(Some(FileSystemFlags(flags)));
            }
        }

        if val.is_undefined_or_null() {
            return Ok(None);
        }

        // Node switches on the value with strict equality, so only primitive
        // strings can match; `new String("w")` and every other object throw.
        if val.is_string_literal() {
            let str = val.get_zig_string(ctx)?;
            // The longest valid flag string is 3 bytes ("as+" etc).
            if str.len >= 1 && str.len <= 3 {
                let key_slice = str.to_slice();
                if let Some(flags) = FILE_SYSTEM_FLAGS_MAP.get(key_slice.slice()).copied() {
                    return Ok(Some(FileSystemFlags(flags)));
                }
            }
        }

        let actual = JSGlobalObject::inspect_for_error_message(ctx, val)?;
        Err(ctx
            .err(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!("The argument 'flags' is invalid. Received {}", actual),
            )
            .throw())
    }

    /// Equivalent of GetValidFileMode, which is used to implement fs.access and copyFile
    pub fn from_js_number_only(
        global: &JSGlobalObject,
        value: JSValue,
        kind: FileSystemFlagsKind,
    ) -> JsResult<FileSystemFlags> {
        // Allow only int32 or null/undefined values.
        if !value.is_number() {
            if value.is_undefined_or_null() {
                return Ok(FileSystemFlags(match kind {
                    FileSystemFlagsKind::Access => 0,   // F_OK
                    FileSystemFlagsKind::CopyFile => 0, // constexpr int kDefaultCopyMode = 0;
                }));
            }
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("mode must be int32 or null/undefined"),
                )
                .throw());
        }
        const MIN: i32 = 0;
        const MAX: i32 = 7;
        if value.is_int32() {
            let int: i32 = value.as_int32();
            if int < MIN || int > MAX {
                return Err(global
                    .err(
                        jsc::ErrorCode::OUT_OF_RANGE,
                        format_args!("mode is out of range: >= 0 and <= 7"),
                    )
                    .throw());
            }
            Ok(FileSystemFlags(int))
        } else {
            let float = value.as_number();
            if float.is_nan() || float.is_infinite() || float < MIN as f64 || float > MAX as f64 {
                return Err(global
                    .err(
                        jsc::ErrorCode::OUT_OF_RANGE,
                        format_args!("mode is out of range: >= 0 and <= 7"),
                    )
                    .throw());
            }
            Ok(FileSystemFlags(float as i32))
        }
    }
}

bun_core::comptime_string_map! {
    /// Node's `stringToFlags` table. Case-sensitive: uppercase spellings
    /// ("W", "A+", ...) are rejected by Node with ERR_INVALID_ARG_VALUE.
    static FILE_SYSTEM_FLAGS_MAP: c_int = {
        b"r" => O::RDONLY,
        b"w" => O::TRUNC | O::CREAT | O::WRONLY,
        b"a" => O::APPEND | O::CREAT | O::WRONLY,
        b"r+" => O::RDWR,
        b"w+" => O::TRUNC | O::CREAT | O::RDWR,
        b"a+" => O::APPEND | O::CREAT | O::RDWR,
        b"rs" => O::RDONLY | O::SYNC,
        b"sr" => O::RDONLY | O::SYNC,
        b"wx" => O::TRUNC | O::CREAT | O::WRONLY | O::EXCL,
        b"xw" => O::TRUNC | O::CREAT | O::WRONLY | O::EXCL,
        b"ax" => O::APPEND | O::CREAT | O::WRONLY | O::EXCL,
        b"xa" => O::APPEND | O::CREAT | O::WRONLY | O::EXCL,
        b"as" => O::APPEND | O::CREAT | O::WRONLY | O::SYNC,
        b"sa" => O::APPEND | O::CREAT | O::WRONLY | O::SYNC,
        b"rs+" => O::RDWR | O::SYNC,
        b"sr+" => O::RDWR | O::SYNC,
        b"wx+" => O::TRUNC | O::CREAT | O::RDWR | O::EXCL,
        b"xw+" => O::TRUNC | O::CREAT | O::RDWR | O::EXCL,
        b"ax+" => O::APPEND | O::CREAT | O::RDWR | O::EXCL,
        b"xa+" => O::APPEND | O::CREAT | O::RDWR | O::EXCL,
        b"as+" => O::APPEND | O::CREAT | O::RDWR | O::SYNC,
        b"sa+" => O::APPEND | O::CREAT | O::RDWR | O::SYNC,
    };
}

// ──────────────────────────────────────────────────────────────────────────

/// A class representing a directory stream.
///
/// Created by {@link opendir}, {@link opendirSync}, or `fsPromises.opendir()`.
///
/// ```js
/// import { opendir } from 'fs/promises';
///
/// try {
///   const dir = await opendir('./');
///   for await (const dirent of dir)
///     console.log(dirent.name);
/// } catch (err) {
///   console.error(err);
/// }
/// ```
///
/// When using the async iterator, the `fs.Dir` object will be automatically
/// closed after the iterator exits.
/// @since v12.12.0
pub struct Dirent {
    pub name: bun_core::String,
    pub path: bun_core::String,
    // not publicly exposed
    pub kind: DirentKind,
}

pub type DirentKind = bun_sys::FileKind;

// and isn't already *_sys, leave them in place".
// `&JSGlobalObject` / `&mut bun_core::String` are ABI-identical to non-null
// pointers; `Option<&mut *mut JSString>` uses the niche-optimization layout
// (`*mut *mut JSString`), so the validity proof lives in the type signature.
unsafe extern "C" {
    safe fn Bun__JSDirentObjectConstructor(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Dirent__toJS(
        global: &JSGlobalObject,
        kind: i32,
        name: &mut bun_core::String,
        path: &mut bun_core::String,
        cached_previous_path_jsvalue: Option<&mut *mut jsc::JSString>,
    ) -> JSValue;
}

impl Dirent {
    pub fn get_constructor(global: &JSGlobalObject) -> JSValue {
        Bun__JSDirentObjectConstructor(global)
    }

    pub fn to_js(
        &mut self,
        global_object: &JSGlobalObject,
        cached_previous_path_jsvalue: Option<&mut *mut jsc::JSString>,
    ) -> JsResult<JSValue> {
        use bun_core::libuv_sys::{
            UV_DIRENT_BLOCK, UV_DIRENT_CHAR, UV_DIRENT_DIR, UV_DIRENT_FIFO, UV_DIRENT_FILE,
            UV_DIRENT_LINK, UV_DIRENT_SOCKET, UV_DIRENT_UNKNOWN,
        };
        let kind_int: i32 = match self.kind {
            DirentKind::File => UV_DIRENT_FILE,
            DirentKind::BlockDevice => UV_DIRENT_BLOCK,
            DirentKind::CharacterDevice => UV_DIRENT_CHAR,
            DirentKind::Directory => UV_DIRENT_DIR,
            // event_port is deliberate there.
            DirentKind::EventPort | DirentKind::NamedPipe => UV_DIRENT_FIFO,
            DirentKind::UnixDomainSocket => UV_DIRENT_SOCKET,
            DirentKind::SymLink => UV_DIRENT_LINK,
            DirentKind::Whiteout | DirentKind::Door | DirentKind::Unknown => UV_DIRENT_UNKNOWN,
        };
        bun_jsc::from_js_host_call(global_object, || {
            Bun__Dirent__toJS(
                global_object,
                kind_int,
                &mut self.name,
                &mut self.path,
                cached_previous_path_jsvalue,
            )
        })
    }

    pub fn to_js_newly_created(
        &mut self,
        global_object: &JSGlobalObject,
        previous_jsstring: Option<&mut *mut jsc::JSString>,
    ) -> JsResult<JSValue> {
        // Shouldn't techcnically be necessary.
        let result = self.to_js(global_object, previous_jsstring);
        self.deref();
        result
    }

    pub fn deref(&self) {
        self.name.deref();
        self.path.deref();
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub enum PathOrBlob {
    Path(PathOrFileDescriptor),
    Blob(Box<Blob>),
}

impl PathOrBlob {
    pub fn from_js_no_copy(
        ctx: &JSGlobalObject,
        args: &mut ArgumentsSlice,
    ) -> JsResult<PathOrBlob> {
        if let Some(path) = PathOrFileDescriptor::from_js(ctx, args)? {
            return Ok(PathOrBlob::Path(path));
        }

        let Some(arg) = args.next_eat() else {
            return Err(ctx.throw_invalid_argument_type_value(
                b"destination",
                b"path, file descriptor, or Blob",
                JSValue::UNDEFINED,
            ));
        };
        if let Some(blob) = arg.as_class_ref::<Blob>() {
            return Ok(PathOrBlob::Blob(Box::new(blob.borrowed_view())));
        }
        Err(ctx.throw_invalid_argument_type_value(
            b"destination",
            b"path, file descriptor, or Blob",
            arg,
        ))
    }
}
