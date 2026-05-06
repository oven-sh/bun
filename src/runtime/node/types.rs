use core::ffi::c_int;
use core::fmt;

// TODO(b2-blocked): bun_jsc — using crate-local opaque shim until `bun_jsc` is a dep.
use crate::jsc::{self, CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_paths::{self as path_handler, PathBuffer, WPathBuffer, OSPathBuffer, OSPathSliceZ, MAX_PATH_BYTES};
use bun_str::{self, strings, ZStr, WStr, ZigString};
use bun_str::zig_string::Slice as ZigStringSlice;
use bun_sys::{self, Fd, Mode, O};
use bun_core::{self, fmt as bun_fmt};
use bun_wyhash::hash;

use crate::webcore::{Blob, Request, Response};
use crate::node::util::validators;

// ─── b2-blocked stubs ─────────────────────────────────────────────────────
// `SliceWithUnderlyingString` lives in `bun_str::lib_draft_b1.rs`, not yet
// re-exported from the active `bun_str`. Stubbed with the field/method
// surface this file touches so the enum variants type-check; method bodies
// that USE it stay ``-gated below.
// TODO(b2-blocked): swap to `pub use bun_str::SliceWithUnderlyingString;`.
#[derive(Default)]
pub struct SliceWithUnderlyingString {
    pub utf8: ZigStringSlice,
    pub underlying: bun_str::String,
}
impl SliceWithUnderlyingString {
    pub fn slice(&self) -> &[u8] { self.utf8.slice() }
    pub fn deinit(&self) {}
    pub fn to_thread_safe(&mut self) {}

    /// `string_jsc.sliceWithUnderlyingStringTransferToJS` — hand this slice to
    /// JS, consuming both the utf8 buffer and the underlying `bun.String` ref.
    pub fn transfer_to_js(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        use bun_str::Tag;
        if matches!(self.underlying.tag(), Tag::Dead | Tag::Empty) && !self.utf8.slice().is_empty() {
            // Zig: `if (this.utf8.allocator.get()) |_|` — heap-owned bytes can
            // be donated to JSC without a copy.
            if matches!(self.utf8, ZigStringSlice::Owned(_)) {
                debug_assert!(
                    !matches!(self.utf8, ZigStringSlice::WTF { .. }),
                    "WTF-backed slice should never reach the owned-transfer path",
                );
                let ZigStringSlice::Owned(bytes) =
                    core::mem::replace(&mut self.utf8, ZigStringSlice::default())
                else {
                    unreachable!()
                };
                if let Ok(Some(utf16)) = strings::to_utf16_alloc(&bytes, false, false) {
                    drop(bytes);
                    let utf16 = core::mem::ManuallyDrop::new(utf16);
                    return Ok(jsc::zig_string::to_external_u16(
                        utf16.as_ptr(),
                        utf16.len(),
                        global_object,
                    ));
                }
                // All-ASCII (or UTF-16 conversion declined): hand the Latin-1
                // bytes to JSC; ownership transfers via the external-string
                // finalizer (mimalloc-backed Vec).
                let bytes = core::mem::ManuallyDrop::new(bytes);
                // SAFETY: `bytes` is leaked into JSC; ptr/len remain valid for
                // the lifetime of the external string.
                let slice = unsafe { core::slice::from_raw_parts(bytes.as_ptr(), bytes.len()) };
                return Ok(jsc::zig_string::ZigString::init(slice).to_external_value(global_object));
            }

            // Borrowed/WTF-backed: copy into a fresh JS string, then release.
            let result = jsc::bun_string_jsc::create_utf8_for_js(global_object, self.utf8.slice());
            self.utf8 = ZigStringSlice::default();
            return result;
        }

        self.utf8 = ZigStringSlice::default();
        jsc::bun_string_jsc::transfer_to_js(&mut self.underlying, global_object)
    }
}

// `bun.jsc.MarkedArrayBuffer` (the `Buffer` payload). Opaque until `bun_jsc`
// is a dep; only `.slice()` is reachable from un-gated code.
// TODO(b2-blocked): swap to `pub use bun_jsc::MarkedArrayBuffer as Buffer;`.
#[derive(Default)]
pub struct Buffer {
    pub buffer: jsc::ArrayBuffer,
}
impl Buffer {
    #[inline] pub fn slice(&self) -> &[u8] { &[] }

    /// `MarkedArrayBuffer.toNodeBuffer` — wrap the backing bytes in a Node
    /// `Buffer` (Uint8Array subclass). Ownership of the byte storage transfers
    /// to JSC via the buffer deallocator.
    pub fn to_node_buffer(&self, ctx: &JSGlobalObject) -> JSValue {
        let mut buf = self.buffer;
        JSValue::create_buffer(ctx, buf.byte_slice_mut())
    }
}

// `jsc.ArgumentsSlice` — cursor over CallFrame args. Mirrors the Zig API
// (`next` peeks without consuming, `eat` advances, `next_eat` does both).
// TODO(b2-blocked): swap to `pub use bun_jsc::call_frame::ArgumentsSlice;`.
pub struct ArgumentsSlice {
    pub remaining: &'static [JSValue],
    pub will_be_async: bool,
    pub vm: *mut jsc::VirtualMachineRef,
}
impl Default for ArgumentsSlice {
    fn default() -> Self {
        Self { remaining: &[], will_be_async: false, vm: core::ptr::null_mut() }
    }
}
impl ArgumentsSlice {
    /// Peek the current argument without consuming it.
    #[inline]
    pub fn next(&self) -> Option<JSValue> {
        self.remaining.first().copied()
    }
    /// Consume the current argument (no-op if empty).
    #[inline]
    pub fn eat(&mut self) {
        if !self.remaining.is_empty() {
            self.remaining = &self.remaining[1..];
        }
    }
    /// Peek + consume in one step.
    #[inline]
    pub fn next_eat(&mut self) -> Option<JSValue> {
        let v = self.next();
        if v.is_some() { self.eat(); }
        v
    }
    /// Protect-then-consume — used by callers that need to keep the JS value
    /// alive across an async boundary.
    #[inline]
    pub fn protect_eat_next(&mut self) -> Option<JSValue> {
        let v = self.next()?;
        v.protect();
        self.eat();
        Some(v)
    }
    #[inline]
    pub fn init(vm: *mut jsc::VirtualMachineRef, args: &'static [JSValue]) -> Self {
        Self { remaining: args, will_be_async: false, vm }
    }
}

// `Fd::from_js_validated` lives in `bun_sys_jsc::FdJsc`, which is not a
// dependency of this crate. Provide a thin extension trait so call sites
// (`Fd::from_js_validated(value, ctx)`) keep their shape.
// TODO(b2-blocked): swap to `use bun_sys_jsc::FdJsc;` once it is a dep.
pub trait FdJsc: Sized {
    fn from_js(value: JSValue) -> Option<Self>;
    fn from_js_validated(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Self>>;
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
}
impl FdJsc for Fd {
    #[inline]
    fn from_js(value: JSValue) -> Option<Fd> {
        if !value.is_any_int() { return None; }
        let fd64 = value.to_int64();
        if fd64 < 0 || fd64 > i64::from(i32::MAX) { return None; }
        Some(Fd::from_uv(fd64 as i32))
    }
    fn from_js_validated(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Fd>> {
        let _ = global;
        // TODO(b2-blocked): full range/type validation lives in bun_sys_jsc.
        Ok(Self::from_js(value))
    }
    #[inline]
    fn to_js(self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_int32(self.uv())
    }
}

// `bun_sys::PlatformIoVec` not yet exported (B-2 stub crate).
// TODO(b2-blocked): swap to `pub use bun_sys::PlatformIoVec;`.
#[cfg(unix)]
pub type PlatformIoVec = libc::iovec;
#[cfg(not(unix))]
#[repr(C)]
pub struct PlatformIoVec { pub buf: *mut u8, pub len: u32 }

// ──────────────────────────────────────────────────────────────────────────

pub enum BlobOrStringOrBuffer {
    Blob(Blob),
    StringOrBuffer(StringOrBuffer),
}

// Gated: calls Blob::store()/deref_count() (webcore method surface not yet real).

impl Drop for BlobOrStringOrBuffer {
    fn drop(&mut self) {
        match self {
            Self::Blob(blob) => {
                // `.blob` is a raw bitwise copy of a live JS Blob — it does NOT own
                // content_type/name. Only release the store reference.
                if let Some(store) = blob.store() {
                    store.deref_count();
                }
            }
            Self::StringOrBuffer(_) => {
                // StringOrBuffer's own Drop handles cleanup.
            }
        }
    }
}

// Gated: every method body calls JSC/webcore methods (`.shared_view()`,
// `.js_type()`, `.throw_invalid_arguments()`, `Blob::store()`).
// TODO(b2-blocked): un-gate once bun_jsc + webcore method surface lands.

impl BlobOrStringOrBuffer {
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::Blob(blob) => blob.shared_view(),
            Self::StringOrBuffer(str) => str.slice(),
        }
    }

    pub fn protect(&self) {
        match self {
            Self::StringOrBuffer(sob) => {
                // TODO(port): `StringOrBuffer::protect` is not defined in this file in Zig either;
                // verify it exists / port from sibling file.
                sob.protect();
            }
            _ => {}
        }
    }

    pub fn deinit_and_unprotect(mut self) {
        // Alternate cleanup path (unprotects JS-side buffers); consumes `self`
        // and skips Drop to avoid double-release.
        match &mut self {
            Self::StringOrBuffer(sob) => {
                // TODO(port): StringOrBuffer::deinit_and_unprotect now consumes; reshape once borrowck allows move-out-of-enum here.
                core::mem::take(sob).deinit_and_unprotect();
            }
            Self::Blob(blob) => {
                // `.blob` is populated via a raw bitwise copy of a live JS Blob
                // (see from_js_maybe_file_maybe_async / from_js_with_encoding_value_allow_request_response),
                // so it does not own `content_type` or `name`. Only release the
                // store reference, matching Drop above.
                if let Some(store) = blob.store() {
                    store.deref_count();
                }
            }
        }
        core::mem::forget(self);
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
                let Some(blob) = value.as_::<Blob>() else {
                    return Ok(None);
                };
                if allow_file && blob.needs_to_read_file() {
                    return global.throw_invalid_arguments("File blob cannot be used here", format_args!(""));
                }

                if is_async {
                    // For async/cross-thread usage, copy the blob data to an owned slice
                    // rather than referencing the store which isn't thread-safe
                    let blob_data = blob.shared_view();
                    let owned_data: Box<[u8]> = Box::from(blob_data);
                    return Ok(Some(Self::StringOrBuffer(StringOrBuffer::EncodedSlice(
                        ZigStringSlice::from_owned(owned_data),
                    ))));
                }

                if let Some(store) = blob.store() {
                    store.ref_count();
                }
                return Ok(Some(Self::Blob(blob.clone_raw())));
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

    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<BlobOrStringOrBuffer>> {
        Self::from_js_maybe_file(global, value, true)
    }

    pub fn from_js_async(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<BlobOrStringOrBuffer>> {
        Self::from_js_maybe_file_maybe_async(global, value, true, true)
    }

    pub fn from_js_with_encoding_value(
        global: &JSGlobalObject,
        value: JSValue,
        encoding_value: JSValue,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        Self::from_js_with_encoding_value_allow_request_response(global, value, encoding_value, false)
    }

    pub fn from_js_with_encoding_value_allow_request_response(
        global: &JSGlobalObject,
        value: JSValue,
        encoding_value: JSValue,
        allow_request_response: bool,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        match value.js_type() {
            jsc::JSType::DOMWrapper => {
                if let Some(blob) = value.as_::<Blob>() {
                    if let Some(store) = blob.store() {
                        store.ref_count();
                    }
                    return Ok(Some(Self::Blob(blob.clone_raw())));
                }
                if allow_request_response {
                    if let Some(request) = value.as_::<Request>() {
                        let body_value = request.get_body_value();
                        body_value.to_blob_if_possible();

                        if let Some(any_blob_) = body_value.try_use_as_any_blob() {
                            let mut any_blob = any_blob_;
                            let result = Self::Blob(any_blob.to_blob(global));
                            any_blob.detach();
                            return Ok(Some(result));
                        }

                        return global.throw_invalid_arguments(
                            "Only buffered Request/Response bodies are supported for now.",
                            format_args!(""),
                        );
                    }

                    if let Some(response) = value.as_::<Response>() {
                        let body_value = response.get_body_value();
                        body_value.to_blob_if_possible();

                        if let Some(any_blob_) = body_value.try_use_as_any_blob() {
                            let mut any_blob = any_blob_;
                            let result = Self::Blob(any_blob.to_blob(global));
                            any_blob.detach();
                            return Ok(Some(result));
                        }

                        return global.throw_invalid_arguments(
                            "Only buffered Request/Response bodies are supported for now.",
                            format_args!(""),
                        );
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

// Gated: SliceWithUnderlyingString/ZigStringSlice deinit() are stubbed.
// TODO(b2-blocked): un-gate once bun_str::SliceWithUnderlyingString is real.

impl Drop for StringOrBuffer {
    fn drop(&mut self) {
        match self {
            Self::ThreadsafeString(str) | Self::String(str) => {
                // TODO(port): if SliceWithUnderlyingString gains Drop, this becomes implicit.
                str.deinit();
            }
            Self::EncodedSlice(encoded) => {
                // TODO(port): if ZigStringSlice gains Drop, this becomes implicit.
                encoded.deinit();
            }
            Self::Buffer(_) => {}
        }
    }
}

// Gated: every body calls JSC methods (`.protect()`, `.as_array_buffer()`,
// `.js_type()`, `bun_str::String::from_js`, `.vm()`).
// TODO(b2-blocked): un-gate once bun_jsc method surface lands.

impl StringOrBuffer {
    pub fn to_thread_safe(&mut self) {
        match self {
            Self::String(s) => {
                s.to_thread_safe();
                // PORT NOTE: reshaped for borrowck — Zig moves the payload between variants.
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

    pub fn from_js_to_owned_slice(
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Vec<u8>> {
        if let Some(array_buffer) = value.as_array_buffer(global_object) {
            let bytes = array_buffer.byte_slice();
            global_object.vm().deprecated_report_extra_memory(array_buffer.len as usize);
            return Ok(bytes.to_vec());
        }

        let str = bun_str::String::from_js(value, global_object)?;
        // `str.deref()` happens on Drop.

        let result = str.to_owned_slice()?;
        global_object.vm().deprecated_report_extra_memory(result.len());
        Ok(result)
    }

    pub fn to_js(&mut self, ctx: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Self::ThreadsafeString(str) | Self::String(str) => str.transfer_to_js(ctx),
            Self::EncodedSlice(encoded_slice) => {
                let result =
                    jsc::bun_string_jsc::create_utf8_for_js(ctx, encoded_slice.slice());
                // Zig: `defer { this.encoded_slice.deinit(); this.encoded_slice = .{}; }`
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

    /// Explicit cleanup hook (Zig parity). Ownership is on `Drop`.
    #[inline]
    pub fn deinit(&self) {}

    /// Returns the buffer payload if this is `Self::Buffer`.
    #[inline]
    pub fn buffer(&self) -> Option<&Buffer> {
        if let Self::Buffer(b) = self { Some(b) } else { None }
    }

    pub fn deinit_and_unprotect(self) {
        // Alternate cleanup path (unprotects JS-side buffers); consumes `self`
        // and skips Drop to avoid double-release.
        match &self {
            Self::ThreadsafeString(str) | Self::String(str) => {
                // TODO(port): if SliceWithUnderlyingString gains Drop, this becomes implicit.
                str.deinit();
            }
            Self::Buffer(buffer) => {
                buffer.buffer.value.unprotect();
            }
            Self::EncodedSlice(encoded) => {
                encoded.deinit();
            }
        }
        core::mem::forget(self);
    }

    pub fn from_js_maybe_async(
        global: &JSGlobalObject,
        value: JSValue,
        is_async: bool,
        allow_string_object: bool,
    ) -> JsResult<Option<StringOrBuffer>> {
        use jsc::JSType;
        match value.js_type() {
            str_type @ (JSType::String | JSType::StringObject | JSType::DerivedStringObject) => {
                if !allow_string_object && str_type != JSType::String {
                    return Ok(None);
                }
                let str = bun_str::String::from_js(value, global)?;
                // str.deref() on Drop
                if is_async {
                    let mut possible_clone = str;
                    let mut sliced = possible_clone.to_thread_safe_slice()?;
                    sliced.report_extra_memory(global.vm());

                    if sliced.underlying.is_empty() {
                        return Ok(Some(Self::EncodedSlice(sliced.utf8)));
                    }

                    return Ok(Some(Self::ThreadsafeString(sliced)));
                } else {
                    return Ok(Some(Self::String(str.to_slice())));
                }
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
                let buffer = Buffer::from_array_buffer(global, value);

                if is_async {
                    buffer.buffer.value.protect();
                }

                Ok(Some(Self::Buffer(buffer)))
            }
            _ => Ok(None),
        }
    }

    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<StringOrBuffer>> {
        Self::from_js_maybe_async(global, value, false, true)
    }

    pub fn from_js_with_encoding(
        global: &JSGlobalObject,
        value: JSValue,
        encoding: Encoding,
    ) -> JsResult<Option<StringOrBuffer>> {
        Self::from_js_with_encoding_maybe_async(global, value, encoding, false, true)
    }

    pub fn from_js_with_encoding_maybe_async(
        global: &JSGlobalObject,
        value: JSValue,
        encoding: Encoding,
        is_async: bool,
        allow_string_object: bool,
    ) -> JsResult<Option<StringOrBuffer>> {
        if value.is_cell() && value.js_type().is_array_buffer_like() {
            let buffer = Buffer::from_array_buffer(global, value);
            if is_async {
                buffer.buffer.value.protect();
            }
            return Ok(Some(Self::Buffer(buffer)));
        }

        if encoding == Encoding::Utf8 {
            return Self::from_js_maybe_async(global, value, is_async, allow_string_object);
        }

        if value.is_string() {
            let str = bun_str::String::from_js(value, global)?;
            // str.deref() on Drop
            if str.is_empty() {
                return Self::from_js_maybe_async(global, value, is_async, allow_string_object);
            }

            let out = str.encode(encoding);
            global.vm().deprecated_report_extra_memory(out.len());

            return Ok(Some(Self::EncodedSlice(ZigStringSlice::from_owned(out))));
        }

        Ok(None)
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
        Self::from_js_with_encoding_maybe_async(global, value, encoding, is_async, allow_string_object)
    }
}

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

// TODO(port): phf custom hasher — Zig used `fromJSCaseInsensitive` / `inMapCaseInsensitive`
// against this map. phf is case-sensitive; either lowercase the input first or
// use a custom case-insensitive phf hasher in Phase B.
pub static ENCODING_MAP: phf::Map<&'static [u8], Encoding> = phf::phf_map! {
    b"utf-8" => Encoding::Utf8,
    b"utf8" => Encoding::Utf8,
    b"ucs-2" => Encoding::Utf16le,
    b"ucs2" => Encoding::Utf16le,
    b"utf16-le" => Encoding::Utf16le,
    b"utf16le" => Encoding::Utf16le,
    b"binary" => Encoding::Latin1,
    b"latin1" => Encoding::Latin1,
    b"ascii" => Encoding::Ascii,
    b"base64" => Encoding::Base64,
    b"hex" => Encoding::Hex,
    b"buffer" => Encoding::Buffer,
    b"base64url" => Encoding::Base64url,
};

impl Encoding {
    pub fn is_binary_to_text(self) -> bool {
        matches!(self, Self::Hex | Self::Base64 | Self::Base64url)
    }

    /// Caller must verify the value is a string
    pub fn from(slice: &[u8]) -> Option<Encoding> {
        // TODO(port): case-insensitive lookup — phf is case-sensitive.
        ENCODING_MAP.get(slice).copied()
    }
}

// Gated: every body calls JSC methods (`.is_falsey()`, `.is_string()`,
// `bun_str::String::from_js`, `ZigString::to_js`, `ArrayBuffer::create_buffer`).
// TODO(b2-blocked): un-gate once bun_jsc method surface lands.

impl Encoding {
    pub fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Encoding>> {
        // TODO(port): ComptimeStringMap::fromJSCaseInsensitive — needs case-insensitive lookup
        let str = bun_str::String::from_js(value, global)?;
        // str.deref() on Drop
        Ok(str.in_map_case_insensitive(&ENCODING_MAP))
    }

    pub fn assert(value: JSValue, global_object: &JSGlobalObject, default: Encoding) -> JsResult<Encoding> {
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
        let str = bun_str::String::from_js(value, global_object)?;
        // str.deref() on Drop
        if str.is_empty() {
            return Ok(Some(default));
        }
        Ok(str.in_map_case_insensitive(&ENCODING_MAP))
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

    pub fn encode_with_size<const SIZE: usize>(
        self,
        global_object: &JSGlobalObject,
        input: &[u8; SIZE],
    ) -> JsResult<JSValue> {
        // PERF(port): Zig used comptime-sized stack buffers; stable Rust forbids
        // const-generic arithmetic in array lengths, so we heap-allocate. Revisit
        // once `generic_const_exprs` stabilizes or callers pass concrete sizes.
        match self {
            Self::Base64 => {
                let mut buf = vec![0u8; bun_core::base64::standard_encoder_calc_size(SIZE)];
                let len = bun_core::base64::encode(&mut buf, input);
                Ok(ZigString::init(&buf[..len]).to_js(global_object))
            }
            Self::Base64url => {
                let mut buf = vec![0u8; bun_base64::simdutf_encode_len_url_safe(SIZE)];
                let encoded = bun_base64::simdutf_encode_url_safe(&mut buf, input);
                Ok(ZigString::init(&buf[..encoded]).to_js(global_object))
            }
            Self::Hex => {
                let mut buf = vec![0u8; SIZE * 4];
                use std::io::Write;
                let mut cursor: &mut [u8] = &mut buf[..];
                // TODO(port): Zig "{x}" on a byte slice prints lowercase hex per byte.
                for b in input {
                    write!(cursor, "{:02x}", b).expect("unreachable");
                }
                let written = SIZE * 4 - cursor.len();
                let out = &buf[..written];
                Ok(ZigString::init(out).to_js(global_object))
            }
            Self::Buffer => jsc::ArrayBuffer::create_buffer(global_object, input),
            // PERF(port): was comptime monomorphization (`inline else`) — profile in Phase B
            enc => crate::webcore::encoding::to_string(input, global_object, enc),
        }
    }

    pub fn encode_with_max_size<const MAX_SIZE: usize>(
        self,
        global_object: &JSGlobalObject,
        input: &[u8],
    ) -> JsResult<JSValue> {
        debug_assert!(
            input.len() <= MAX_SIZE,
            "input length ({}) should not exceed max_size ({})",
            input.len(),
            MAX_SIZE,
        );
        // PERF(port): Zig used comptime-sized stack buffers; stable Rust forbids
        // const-generic arithmetic in array lengths, so we heap-allocate.
        match self {
            Self::Base64 => {
                let mut base64_buf =
                    vec![0u8; bun_core::base64::standard_encoder_calc_size(MAX_SIZE * 4)];
                let encoded_len = bun_core::base64::encode(&mut base64_buf, input);
                let (mut encoded, bytes) = bun_str::String::create_uninitialized_latin1(encoded_len);
                // SAFETY: `bytes` is a freshly-allocated Latin-1 buffer of `encoded_len` bytes.
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        base64_buf.as_ptr(),
                        bytes.as_mut_ptr(),
                        encoded_len,
                    );
                }
                encoded.transfer_to_js(global_object)
            }
            Self::Base64url => {
                let mut buf = vec![0u8; bun_base64::simdutf_encode_len_url_safe(MAX_SIZE * 4)];
                let encoded = bun_base64::simdutf_encode_url_safe(&mut buf, input);
                Ok(ZigString::init(&buf[..encoded]).to_js(global_object))
            }
            Self::Hex => {
                let mut buf = vec![0u8; MAX_SIZE * 4];
                use std::io::Write;
                let mut cursor: &mut [u8] = &mut buf[..];
                for b in input {
                    write!(cursor, "{:02x}", b).expect("unreachable");
                }
                let written = MAX_SIZE * 4 - cursor.len();
                let out = &buf[..written];
                Ok(ZigString::init(out).to_js(global_object))
            }
            Self::Buffer => jsc::ArrayBuffer::create_buffer(global_object, input),
            // PERF(port): was comptime monomorphization (`inline else`) — profile in Phase B
            enc => crate::webcore::encoding::to_string(input, global_object, enc),
        }
    }

    pub fn to_js(self, global_object: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call into WebCore; `Encoding` is `#[repr(u8)]` matching BufferEncodingType.h.
        unsafe { WebCore_BufferEncodingType_toJS(global_object, self) }
    }
}

// TODO(port): move to runtime_sys
 // TODO(b2-blocked): JSGlobalObject/JSValue are opaque shims; FFI ABI not yet stable.
unsafe extern "C" {
    fn WebCore_BufferEncodingType_toJS(global_object: *const JSGlobalObject, encoding: Encoding) -> JSValue;
}

// ──────────────────────────────────────────────────────────────────────────

/// This is used on the windows implementation of realpath, which is in javascript
// TODO(b2-blocked): #[bun_jsc::host_fn] attribute macro not yet available.

pub fn js_assert_encoding_valid(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
    let value = call_frame.argument(0);
    let _ = Encoding::assert(value, global, Encoding::Utf8)?;
    Ok(JSValue::UNDEFINED)
}

// ──────────────────────────────────────────────────────────────────────────

#[allow(dead_code)]
pub enum PathOrBuffer {
    Path(bun_str::PathString),
    Buffer(Buffer),
}

impl PathOrBuffer {
    #[inline]
    pub fn slice(&self) -> &[u8] {
        // PORT NOTE: Zig only ever returns `self.path.slice()` here regardless of variant —
        // preserved verbatim (likely a latent bug or this type is unused).
        match self {
            Self::Path(p) => p.slice(),
            Self::Buffer(_) => unreachable!("Zig accessed .path unconditionally"),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct CallbackTask<Result> {
    // TODO(b2-blocked): bun_jsc::c::JSObjectRef — opaque pointer until bun_jsc lands.
    pub callback: *mut core::ffi::c_void,
    pub option: CallbackTaskOption<Result>,
    pub success: bool,
}

// PORT NOTE: Zig uses an untagged `union` discriminated by `success: bool`.
// Represented here as a Rust enum; callers must keep `success` in sync or
// drop the `success` field entirely in Phase B.
pub enum CallbackTaskOption<Result> {
    Err(bun_sys::SystemError),
    Result(Result),
}

impl<Result> Default for CallbackTask<Result>
where
    CallbackTaskOption<Result>: Default,
{
    fn default() -> Self {
        // Zig only sets `success = false` and leaves the rest `undefined`;
        // Rust requires every field initialized, so zero the callback handle
        // and lean on the `CallbackTaskOption<Result>: Default` bound.
        Self {
            callback: core::ptr::null_mut(),
            option: Default::default(),
            success: false,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub enum PathLike {
    String(bun_str::PathString),
    Buffer(Buffer),
    SliceWithUnderlyingString(SliceWithUnderlyingString),
    ThreadsafeString(SliceWithUnderlyingString),
    EncodedSlice(ZigStringSlice),
}

// Gated: SliceWithUnderlyingString/ZigStringSlice deinit() are stubbed.
// TODO(b2-blocked): un-gate once bun_str::SliceWithUnderlyingString is real.

impl Drop for PathLike {
    fn drop(&mut self) {
        match self {
            Self::String(_) | Self::Buffer(_) => {}
            // TODO(port): if SliceWithUnderlyingString / ZigStringSlice gain Drop, these become implicit.
            Self::SliceWithUnderlyingString(str) => str.deinit(),
            Self::ThreadsafeString(str) => str.deinit(),
            Self::EncodedSlice(str) => str.deinit(),
        }
    }
}

impl PathLike {
    #[inline]
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::String(str) => str.slice(),
            Self::Buffer(str) => str.slice(),
            Self::SliceWithUnderlyingString(str) => str.slice(),
            Self::ThreadsafeString(str) => str.slice(),
            Self::EncodedSlice(str) => str.slice(),
        }
    }

    pub fn estimated_size(&self) -> usize {
        match self {
            Self::String(s) => s.estimated_size(),
            Self::Buffer(b) => b.slice().len(),
            Self::ThreadsafeString(_) | Self::SliceWithUnderlyingString(_) => 0,
            Self::EncodedSlice(s) => s.slice().len(),
        }
    }
}

impl Default for PathLike {
    #[inline]
    fn default() -> Self {
        Self::EncodedSlice(ZigStringSlice::EMPTY)
    }
}

impl PathLike {
    /// Explicit cleanup hook (Zig parity). Ownership is on `Drop`; this is a
    /// no-op so call sites that spell `path.deinit()` keep compiling.
    #[inline]
    pub fn deinit(&self) {}

    pub fn to_thread_safe(&mut self) {
        match self {
            Self::SliceWithUnderlyingString(s) => {
                s.to_thread_safe();
                // PORT NOTE: reshaped for borrowck
                let slice_with_underlying_string = core::mem::take(s);
                *self = Self::ThreadsafeString(slice_with_underlying_string);
            }
            Self::Buffer(b) => {
                b.buffer.value.protect();
            }
            _ => {}
        }
    }

    pub fn deinit_and_unprotect(&self) {
        // Alternate cleanup path (unprotects JS-side buffers).
        // PORT NOTE: Zig consumes `self`; Rust call sites pass `&self` /
        // `&mut self` interchangeably, so take by reference and rely on Drop
        // for the owned-side release.
        match self {
            Self::EncodedSlice(val) => val.deinit(),
            Self::ThreadsafeString(val) => val.deinit(),
            Self::SliceWithUnderlyingString(val) => val.deinit(),
            Self::Buffer(val) => {
                val.buffer.value.unprotect();
            }
            _ => {}
        }
    }

    // TODO(port): Zig return type is `if (force) [:0]u8 else [:0]const u8`.
    // Rust const-generics can't change return mutability; we always return `&ZStr`.
    // The single force=true caller (if any) needs `&mut ZStr` — handle in Phase B.
    pub fn slice_z_with_force_copy<'a, const FORCE: bool>(&'a self, buf: &'a mut PathBuffer) -> &'a ZStr {
        let sliced = self.slice();

        #[cfg(windows)]
        {
            if bun_paths::is_absolute(sliced) {
                if sliced.len() > 2
                    && bun_paths::is_drive_letter(sliced[0])
                    && sliced[1] == b':'
                    && bun_paths::is_sep_any(sliced[2])
                {
                    // Add the long path syntax. This affects most of node:fs
                    // Normalize the path directly into buf without an intermediate
                    // buffer. The input (sliced) already has a drive letter, so
                    // resolveCWDWithExternalBufZ would just memcpy it, making the
                    // temporary allocation unnecessary.
                    buf[0..4].copy_from_slice(&bun_sys::windows::LONG_PATH_PREFIX_U8);
                    let n = bun_paths::normalize_buf(sliced, &mut buf[4..], bun_paths::Style::Windows).len();
                    buf[4 + n] = 0;
                    // SAFETY: buf[4+n] == 0 written above.
                    return unsafe { ZStr::from_raw(buf.as_ptr(), 4 + n) };
                }
                return path_handler::posix_to_win_normalizer::resolve_cwd_with_external_buf_z(buf, sliced)
                    .unwrap_or_else(|_| panic!("Error while resolving path."));
            }
        }

        if sliced.is_empty() {
            if !FORCE {
                return ZStr::EMPTY;
            }

            buf[0] = 0;
            // SAFETY: buf[0] == 0 written above.
            return unsafe { ZStr::from_raw(buf.as_ptr(), 0) };
        }

        if !FORCE {
            if sliced[sliced.len() - 1] == 0 {
                // SAFETY: last byte is NUL.
                return unsafe { ZStr::from_raw(sliced.as_ptr(), sliced.len() - 1) };
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
            return unsafe { ZStr::from_raw(buf.as_ptr(), 0) };
        }

        buf[..sliced.len()].copy_from_slice(sliced);
        buf[sliced.len()] = 0;
        // SAFETY: buf[sliced.len()] == 0 written above.
        unsafe { ZStr::from_raw(buf.as_ptr(), sliced.len()) }
    }

    #[inline]
    pub fn slice_z<'a>(&'a self, buf: &'a mut PathBuffer) -> &'a ZStr {
        self.slice_z_with_force_copy::<false>(buf)
    }

    #[inline]
    pub fn slice_w<'a>(&'a self, buf: &'a mut WPathBuffer) -> &'a WStr {
        strings::paths::to_w_path(buf, self.slice())
    }

    #[inline]
    pub fn os_path<'a>(&'a self, buf: &'a mut OSPathBuffer) -> &'a OSPathSliceZ {
        #[cfg(windows)]
        {
            return self.slice_w(buf);
        }
        #[cfg(not(windows))]
        {
            self.slice_z_with_force_copy::<false>(buf)
        }
    }

    #[inline]
    pub fn os_path_kernel32<'a>(&'a self, buf: &'a mut PathBuffer) -> &'a OSPathSliceZ {
        #[cfg(windows)]
        {
            let s = self.slice();
            let b = bun_paths::path_buffer_pool().get();
            // RAII guard puts back on Drop.

            // Device paths (\\.\, \\?\) and NT object paths (\??\) should not be normalized
            // because the "." in \\.\pipe\name would be incorrectly stripped as a "current directory" component.
            if s.len() >= 4
                && bun_paths::is_sep_any(s[0])
                && bun_paths::is_sep_any(s[1])
                && (s[2] == b'.' || s[2] == b'?')
                && bun_paths::is_sep_any(s[3])
            {
                // SAFETY: reinterpreting PathBuffer ([u8; N]) as [u16] — alignment asserted by @alignCast in Zig.
                let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(buf) };
                return strings::to_kernel32_path(buf_u16, s);
            }
            if !s.is_empty() && bun_paths::is_sep_any(s[0]) {
                let resolve = path_handler::posix_to_win_normalizer::resolve_cwd_with_external_buf(buf, s)
                    .unwrap_or_else(|_| panic!("Error while resolving path."));
                let normal = path_handler::normalize_buf(resolve, &mut *b, bun_paths::Style::Windows);
                // SAFETY: same alignment note as above.
                let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(buf) };
                return strings::to_kernel32_path(buf_u16, normal);
            }
            // Handle "." specially since normalizeStringBuf strips it to an empty string
            if s.len() == 1 && s[0] == b'.' {
                // SAFETY: see alignment note above (PathBuffer reinterpreted as [u16]).
                let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(buf) };
                return strings::to_kernel32_path(buf_u16, b".");
            }
            let normal = path_handler::normalize_string_buf(s, &mut *b, true, bun_paths::Style::Windows, false);
            // SAFETY: see alignment note above (PathBuffer reinterpreted as [u16]).
            let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(buf) };
            return strings::to_kernel32_path(buf_u16, normal);
        }

        #[cfg(not(windows))]
        {
            self.slice_z_with_force_copy::<false>(buf)
        }
    }

    pub fn from_js(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Option<PathLike>> {
        Self::from_js_with_allocator(ctx, arguments)
    }

    pub fn from_js_with_allocator(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Option<PathLike>> {
        let Some(arg) = arguments.next() else {
            return Ok(None);
        };
        use jsc::JSType;
        match arg.js_type() {
            JSType::Uint8Array | JSType::DataView => {
                let buffer = Buffer::from_typed_array(ctx, arg);
                Valid::path_buffer(&buffer, ctx)?;
                Valid::path_null_bytes(buffer.slice(), ctx)?;

                arguments.protect_eat();
                Ok(Some(Self::Buffer(buffer)))
            }

            JSType::ArrayBuffer => {
                let buffer = Buffer::from_array_buffer(ctx, arg);
                Valid::path_buffer(&buffer, ctx)?;
                Valid::path_null_bytes(buffer.slice(), ctx)?;

                arguments.protect_eat();
                Ok(Some(Self::Buffer(buffer)))
            }

            JSType::String | JSType::StringObject | JSType::DerivedStringObject => {
                let str = arg.to_bun_string(ctx)?;
                // str.deref() on Drop

                arguments.eat();

                Ok(Some(Self::from_bun_string(ctx, &str, arguments.will_be_async)?))
            }
            _ => {
                if let Some(domurl) = arg.as_::<jsc::DOMURL>() {
                    let str: bun_str::String = match domurl.file_system_path() {
                        Ok(s) => s,
                        Err(e) if e == bun_core::err!("NotFileUrl") => {
                            return ctx
                                .err(jsc::ErrorCode::INVALID_URL_SCHEME)
                                .fmt(format_args!("URL must be a non-empty \"file:\" path"))
                                .throw();
                        }
                        Err(e) if e == bun_core::err!("InvalidPath") => {
                            return ctx
                                .err(jsc::ErrorCode::INVALID_FILE_URL_PATH)
                                .fmt(format_args!("URL must be a non-empty \"file:\" path"))
                                .throw();
                        }
                        Err(e) if e == bun_core::err!("InvalidHost") => {
                            return ctx
                                .err(jsc::ErrorCode::INVALID_FILE_URL_HOST)
                                .fmt(format_args!("URL must be a non-empty \"file:\" path"))
                                .throw();
                        }
                        Err(_) => unreachable!(),
                    };
                    // str.deref() on Drop
                    if str.is_empty() {
                        return ctx
                            .err(jsc::ErrorCode::INVALID_ARG_VALUE)
                            .fmt(format_args!("URL must be a non-empty \"file:\" path"))
                            .throw();
                    }
                    arguments.eat();

                    return Ok(Some(Self::from_bun_string(ctx, &str, arguments.will_be_async)?));
                }

                Ok(None)
            }
        }
    }

    pub fn from_bun_string(
        global: &JSGlobalObject,
        str: &bun_str::String,
        will_be_async: bool,
    ) -> JsResult<PathLike> {
        // TODO(port): narrow error set
        if will_be_async {
            let mut sliced = str.to_thread_safe_slice()?;
            // errdefer sliced.deinit() — Drop handles this.

            // Validate the UTF-8 byte length after conversion, since the path
            // will be stored in a fixed-size PathBuffer.
            Valid::path_string_length(sliced.slice().len(), global)?;
            Valid::path_null_bytes(sliced.slice(), global)?;

            sliced.report_extra_memory(global.vm());

            if sliced.underlying.is_empty() {
                // TODO(port): partial move out of SliceWithUnderlyingString — use into_utf8() accessor in Phase B.
                let utf8 = core::mem::take(&mut sliced.utf8);
                core::mem::forget(sliced);
                return Ok(Self::EncodedSlice(utf8));
            }
            Ok(Self::ThreadsafeString(sliced))
        } else {
            let mut sliced = str.to_slice();
            // errdefer sliced.deinit() — Drop handles this.

            // Validate the UTF-8 byte length after conversion, since the path
            // will be stored in a fixed-size PathBuffer.
            Valid::path_string_length(sliced.slice().len(), global)?;
            Valid::path_null_bytes(sliced.slice(), global)?;

            // Costs nothing to keep both around.
            if sliced.is_wtf_allocated() {
                return Ok(Self::SliceWithUnderlyingString(sliced));
            }

            sliced.report_extra_memory(global.vm());

            // It is expensive to keep both around.
            // TODO(port): partial move out of SliceWithUnderlyingString — use into_utf8() accessor in Phase B.
            let utf8 = core::mem::take(&mut sliced.utf8);
            core::mem::forget(sliced);
            Ok(Self::EncodedSlice(utf8))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct Valid;

// Gated: every body calls `ctx.throw_value()` / `ctx.err()` (bun_jsc methods).
// TODO(b2-blocked): un-gate once bun_jsc method surface lands.

impl Valid {
    pub fn path_slice(zig_str: &ZigStringSlice, ctx: &JSGlobalObject) -> JsResult<()> {
        match zig_str.len() {
            0..=MAX_PATH_BYTES => Ok(()),
            _ => {
                let mut system_error = bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open)
                    .with_path(zig_str.slice())
                    .to_system_error();
                system_error.syscall = bun_str::String::DEAD;
                ctx.throw_value(system_error.to_error_instance(ctx))
            }
        }
    }

    pub fn path_string_length(len: usize, ctx: &JSGlobalObject) -> JsResult<()> {
        match len {
            0..=MAX_PATH_BYTES => Ok(()),
            _ => {
                let mut system_error =
                    bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open).to_system_error();
                system_error.syscall = bun_str::String::DEAD;
                ctx.throw_value(system_error.to_error_instance(ctx))
            }
        }
    }

    pub fn path_string(zig_str: &ZigString, ctx: &JSGlobalObject) -> JsResult<()> {
        Self::path_string_length(zig_str.len(), ctx)
    }

    pub fn path_buffer(buffer: &Buffer, ctx: &JSGlobalObject) -> JsResult<()> {
        let slice = buffer.slice();
        match slice.len() {
            0 => ctx.throw_invalid_arguments("Invalid path buffer: can't be empty", format_args!("")),
            1..=MAX_PATH_BYTES => Ok(()),
            _ => {
                let mut system_error =
                    bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open).to_system_error();
                system_error.syscall = bun_str::String::DEAD;
                ctx.throw_value(system_error.to_error_instance(ctx))
            }
        }
    }

    pub fn path_null_bytes(slice: &[u8], global: &JSGlobalObject) -> JsResult<()> {
        if strings::index_of_char(slice, 0).is_some() {
            return global
                .err(jsc::ErrorCode::INVALID_ARG_VALUE)
                .fmt(format_args!(
                    "The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received {}",
                    bun_fmt::quote(slice)
                ))
                .throw();
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct VectorArrayBuffer {
    // PORT NOTE: bare JSValue field — only sound while this lives on the stack.
    // Stored in a stack-local during writev; never heap-allocated.
    pub value: JSValue,
    pub buffers: Vec<PlatformIoVec>,
}

impl VectorArrayBuffer {
    pub fn to_js(&self, _: &JSGlobalObject) -> JSValue {
        self.value
    }
}

// Gated: body calls JSC methods (`.js_type()`, `.get_length()`, `.get_index()`).
// TODO(b2-blocked): un-gate once bun_jsc method surface lands.

impl VectorArrayBuffer {
    pub fn from_js(global_object: &JSGlobalObject, val: JSValue) -> JsResult<VectorArrayBuffer> {
        if !val.js_type().is_array_like() {
            return global_object.throw_invalid_arguments("Expected ArrayBufferView[]", format_args!(""));
        }

        let mut bufferlist: Vec<PlatformIoVec> = Vec::new();
        let mut i: usize = 0;
        let len = val.get_length(global_object)?;
        bufferlist.reserve_exact(len);

        while i < len {
            let element = val.get_index(global_object, i as u32)?;

            if !element.is_cell() {
                return global_object.throw_invalid_arguments("Expected ArrayBufferView[]", format_args!(""));
            }

            let Some(array_buffer) = element.as_array_buffer(global_object) else {
                return global_object.throw_invalid_arguments("Expected ArrayBufferView[]", format_args!(""));
            };

            let buf = array_buffer.byte_slice();
            bufferlist.push(bun_sys::platform_iovec_create(buf));
            i += 1;
        }

        Ok(VectorArrayBuffer {
            value: val,
            buffers: bufferlist,
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────

// Gated: body calls JSC methods (`.is_number()`, `.to_zig_string()`, validators).
// TODO(b2-blocked): un-gate once bun_jsc method surface lands.

pub fn mode_from_js(ctx: &JSGlobalObject, value: JSValue) -> JsResult<Option<Mode>> {
    let mode_int: u32 = if value.is_number() {
        validators::validate_uint32(ctx, value, format_args!("mode"), false)?
    } else {
        if value.is_undefined_or_null() {
            return Ok(None);
        }

        if !value.is_string() {
            return ctx.throw_invalid_argument_type_value("mode", "number", value);
        }

        // An easier method of constructing the mode is to use a sequence of
        // three octal digits (e.g. 765). The left-most digit (7 in the example),
        // specifies the permissions for the file owner. The middle digit (6 in
        // the example), specifies permissions for the group. The right-most
        // digit (5 in the example), specifies the permissions for others.

        let mut zig_str = ZigString::EMPTY;
        value.to_zig_string(&mut zig_str, ctx)?;
        let mut slice = zig_str.slice();
        if slice.starts_with(b"0o") {
            slice = &slice[2..];
        }

        // TODO(port): std.fmt.parseInt over &[u8] — need byte-slice radix parser in bun_core
        match strings::parse_int::<Mode>(slice, 8) {
            Ok(v) => v as u32,
            Err(_) => {
                let mut formatter = jsc::console_object::Formatter::new(ctx);
                // formatter.deinit() on Drop
                return ctx.throw_value(
                    ctx.err(jsc::ErrorCode::INVALID_ARG_VALUE)
                        .fmt(format_args!(
                            "The argument 'mode' must be a 32-bit unsigned integer or an octal string. Received {}",
                            value.to_fmt(&mut formatter)
                        ))
                        .to_js(),
                );
            }
        }
    };

    Ok(Some((mode_int & 0o777) as Mode))
}

// ──────────────────────────────────────────────────────────────────────────

pub enum PathOrFileDescriptor {
    Fd(Fd),
    Path(PathLike),
}

impl Default for PathOrFileDescriptor {
    fn default() -> Self { Self::Fd(Fd::INVALID) }
}

#[repr(u8)]
pub enum PathOrFileDescriptorSerializeTag {
    Fd,
    Path,
}

// Drop: unref()s the path string if it is a PathLike (via PathLike's Drop).
// Does nothing for file descriptors, **does not** close file descriptors.
// (No explicit `impl Drop` needed — field drop of PathLike handles it.)

impl PathOrFileDescriptor {
    pub fn estimated_size(&self) -> usize {
        match self {
            Self::Path(path) => path.estimated_size(),
            Self::Fd(_) => 0,
        }
    }

    pub fn hash(&self) -> u64 {
        match self {
            Self::Path(path) => hash(path.slice()),
            Self::Fd(fd) => {
                // SAFETY: Fd is POD; reinterpret as bytes for hashing.
                let bytes = unsafe {
                    core::slice::from_raw_parts(
                        (fd as *const Fd) as *const u8,
                        core::mem::size_of::<Fd>(),
                    )
                };
                hash(bytes)
            }
        }
    }
}

// Gated: bodies call JSC methods (`arguments.next()`, `Fd::from_js_validated`,
// `path.to_thread_safe()` reaches `.protect()`).
// TODO(b2-blocked): un-gate once bun_jsc method surface lands.

impl PathOrFileDescriptor {
    pub fn to_thread_safe(&mut self) {
        if let Self::Path(path) = self {
            path.to_thread_safe();
        }
    }

    /// Zig: `deinit()` — only the `.path` arm owns memory; fds are not closed.
    pub fn deinit(&self) {
        if let Self::Path(path) = self { path.deinit(); }
    }

    pub fn deinit_and_unprotect(&self) {
        match self {
            Self::Path(path) => path.deinit_and_unprotect(),
            Self::Fd(_) => {}
        }
    }

    pub fn from_js(
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

impl fmt::Display for PathOrFileDescriptor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Path(p) => write!(f, "{}", bstr::BStr::new(p.slice())),
            Self::Fd(fd) => write!(f, "{:?}", fd),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

/// Non-exhaustive enum in Zig (`enum(c_int) { ... _ }`) → newtype over c_int.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct FileSystemFlags(pub c_int);

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FileSystemFlagsKind {
    Access,
    CopyFile,
}

impl FileSystemFlags {
    // PORT NOTE: `pub type TagType = c_int;` would be an inherent associated
    // type (unstable). Dropped — callers use `c_int` directly.

    // Named variants from the Zig enum:
    /// Open file for appending. The file is created if it does not exist.
    pub const A: Self = Self(O::APPEND | O::WRONLY | O::CREAT);
    /// Open file for reading. An exception occurs if the file does not exist.
    pub const R: Self = Self(O::RDONLY);
    /// Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
    pub const W: Self = Self(O::WRONLY | O::CREAT);

    #[inline]
    pub fn as_int(self) -> c_int {
        self.0
    }
}

// Gated: bodies call JSC methods (`.is_number()`, `.coerce_i32()`, `ctx.err()`).
// TODO(b2-blocked): un-gate once bun_jsc method surface lands.

impl FileSystemFlags {
    pub fn from_js(ctx: &JSGlobalObject, val: JSValue) -> JsResult<Option<FileSystemFlags>> {
        if val.is_number() {
            if !val.is_int32() {
                return ctx.throw_value(
                    ctx.err(jsc::ErrorCode::OUT_OF_RANGE)
                        .fmt(format_args!(
                            "The value of \"flags\" is out of range. It must be an integer. Received {}",
                            val.as_number()
                        ))
                        .to_js(),
                );
            }
            let number = val.coerce_i32(ctx)?;
            let flags = number.max(0);
            // On Windows, numeric flags from fs.constants (e.g. O_CREAT=0x100)
            // use the platform's native MSVC/libuv values which differ from the
            // internal bun.O representation. Convert them here so downstream
            // code that operates on bun.O flags works correctly.
            #[cfg(windows)]
            {
                return Ok(Some(FileSystemFlags(libuv::O::to_bun_o(flags))));
            }
            #[cfg(not(windows))]
            {
                return Ok(Some(FileSystemFlags(flags)));
            }
        }

        let js_type = val.js_type();
        if js_type.is_string_like() {
            let str = val.get_zig_string(ctx)?;
            if str.is_empty() {
                return ctx.throw_invalid_arguments(
                    "Expected flags to be a non-empty string. Learn more at https://nodejs.org/api/fs.html#fs_file_system_flags",
                    format_args!(""),
                );
            }
            // it's definitely wrong when the string is super long
            else if str.len() > 12 {
                return ctx.throw_invalid_arguments(
                    "Invalid flag '{any}'. Learn more at https://nodejs.org/api/fs.html#fs_file_system_flags",
                    format_args!("{}", str),
                );
            }

            let flags: Option<i32> = 'brk: {
                // PERF(port): was comptime bool dispatch (`inline else`) — profile in Phase B
                if str.is_16bit() {
                    let chars = str.utf16_slice_aligned();
                    if (chars[0] as u8).is_ascii_digit() {
                        // node allows "0o644" as a string :(
                        let slice = str.to_slice();
                        // slice.deinit() on Drop
                        break 'brk strings::parse_int::<Mode>(slice.slice(), 10)
                            .ok()
                            .map(|v| i32::try_from(v).unwrap());
                    }
                } else {
                    let chars = str.slice();
                    if chars[0].is_ascii_digit() {
                        break 'brk strings::parse_int::<Mode>(chars, 10)
                            .ok()
                            .map(|v| i32::try_from(v).unwrap());
                    }
                }

                // TODO(port): ComptimeStringMap::getWithEql with ZigString::eqlComptime — needs custom comparator over phf
                break 'brk FILE_SYSTEM_FLAGS_MAP
                    .get_with_eql(&str, ZigString::eql_comptime)
                    .copied();
            };

            let Some(flags) = flags else {
                return ctx.throw_invalid_arguments(
                    "Invalid flag '{any}'. Learn more at https://nodejs.org/api/fs.html#fs_file_system_flags",
                    format_args!("{}", str),
                );
            };

            return Ok(Some(FileSystemFlags(flags)));
        }

        Ok(None)
    }

    /// Equivalent of GetValidFileMode, which is used to implement fs.access and copyFile
    pub fn from_js_number_only<const KIND: FileSystemFlagsKind>(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<FileSystemFlags> {
        // Allow only int32 or null/undefined values.
        if !value.is_number() {
            if value.is_undefined_or_null() {
                return Ok(FileSystemFlags(match KIND {
                    FileSystemFlagsKind::Access => 0,   // F_OK
                    FileSystemFlagsKind::CopyFile => 0, // constexpr int kDefaultCopyMode = 0;
                }));
            }
            return global
                .err(jsc::ErrorCode::INVALID_ARG_TYPE)
                .fmt(format_args!("mode must be int32 or null/undefined"))
                .throw();
        }
        const MIN: i32 = 0;
        const MAX: i32 = 7;
        if value.is_int32() {
            let int: i32 = value.as_int32();
            if int < MIN || int > MAX {
                return global
                    .err(jsc::ErrorCode::OUT_OF_RANGE)
                    // Zig: comptime std.fmt.comptimePrint — MIN/MAX are literal consts; emit as &'static str.
                    .fmt(format_args!("mode is out of range: >= 0 and <= 7"))
                    .throw();
            }
            Ok(FileSystemFlags(int))
        } else {
            let float = value.as_number();
            if float.is_nan() || float.is_infinite() || float < MIN as f64 || float > MAX as f64 {
                return global
                    .err(jsc::ErrorCode::OUT_OF_RANGE)
                    // Zig: comptime std.fmt.comptimePrint — MIN/MAX are literal consts; emit as &'static str.
                    .fmt(format_args!("mode is out of range: >= 0 and <= 7"))
                    .throw();
            }
            Ok(FileSystemFlags(float as i32))
        }
    }
}

// TODO(port): phf custom hasher — Zig used `getWithEql(str, ZigString.eqlComptime)`.
// Gated: `O::SYNC` not yet defined in `bun_sys::O` (B-2 stub crate).
// TODO(b2-blocked): un-gate once bun_sys::O::SYNC is exported.

static FILE_SYSTEM_FLAGS_MAP: phf::Map<&'static [u8], i32> = phf::phf_map! {
    b"r" => O::RDONLY,
    b"rs" => O::RDONLY | O::SYNC,
    b"sr" => O::RDONLY | O::SYNC,
    b"r+" => O::RDWR,
    b"rs+" => O::RDWR | O::SYNC,
    b"sr+" => O::RDWR | O::SYNC,

    b"R" => O::RDONLY,
    b"RS" => O::RDONLY | O::SYNC,
    b"SR" => O::RDONLY | O::SYNC,
    b"R+" => O::RDWR,
    b"RS+" => O::RDWR | O::SYNC,
    b"SR+" => O::RDWR | O::SYNC,

    b"w" => O::TRUNC | O::CREAT | O::WRONLY,
    b"wx" => O::TRUNC | O::CREAT | O::WRONLY | O::EXCL,
    b"xw" => O::TRUNC | O::CREAT | O::WRONLY | O::EXCL,

    b"W" => O::TRUNC | O::CREAT | O::WRONLY,
    b"WX" => O::TRUNC | O::CREAT | O::WRONLY | O::EXCL,
    b"XW" => O::TRUNC | O::CREAT | O::WRONLY | O::EXCL,

    b"w+" => O::TRUNC | O::CREAT | O::RDWR,
    b"wx+" => O::TRUNC | O::CREAT | O::RDWR | O::EXCL,
    b"xw+" => O::TRUNC | O::CREAT | O::RDWR | O::EXCL,

    b"W+" => O::TRUNC | O::CREAT | O::RDWR,
    b"WX+" => O::TRUNC | O::CREAT | O::RDWR | O::EXCL,
    b"XW+" => O::TRUNC | O::CREAT | O::RDWR | O::EXCL,

    b"a" => O::APPEND | O::CREAT | O::WRONLY,
    b"ax" => O::APPEND | O::CREAT | O::WRONLY | O::EXCL,
    b"xa" => O::APPEND | O::CREAT | O::WRONLY | O::EXCL,
    b"as" => O::APPEND | O::CREAT | O::WRONLY | O::SYNC,
    b"sa" => O::APPEND | O::CREAT | O::WRONLY | O::SYNC,

    b"A" => O::APPEND | O::CREAT | O::WRONLY,
    b"AX" => O::APPEND | O::CREAT | O::WRONLY | O::EXCL,
    b"XA" => O::APPEND | O::CREAT | O::WRONLY | O::EXCL,
    b"AS" => O::APPEND | O::CREAT | O::WRONLY | O::SYNC,
    b"SA" => O::APPEND | O::CREAT | O::WRONLY | O::SYNC,

    b"a+" => O::APPEND | O::CREAT | O::RDWR,
    b"ax+" => O::APPEND | O::CREAT | O::RDWR | O::EXCL,
    b"xa+" => O::APPEND | O::CREAT | O::RDWR | O::EXCL,
    b"as+" => O::APPEND | O::CREAT | O::RDWR | O::SYNC,
    b"sa+" => O::APPEND | O::CREAT | O::RDWR | O::SYNC,

    b"A+" => O::APPEND | O::CREAT | O::RDWR,
    b"AX+" => O::APPEND | O::CREAT | O::RDWR | O::EXCL,
    b"XA+" => O::APPEND | O::CREAT | O::RDWR | O::EXCL,
    b"AS+" => O::APPEND | O::CREAT | O::RDWR | O::SYNC,
    b"SA+" => O::APPEND | O::CREAT | O::RDWR | O::SYNC,
};

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
    pub name: bun_str::String,
    pub path: bun_str::String,
    // not publicly exposed
    pub kind: DirentKind,
}

// TODO(port): Zig used `std.fs.File.Kind`. std::fs is banned; map to bun_sys::FileKind.
pub type DirentKind = bun_sys::FileKind;

// TODO(port): move to runtime_sys
 // TODO(b2-blocked): jsc::JSString opaque; FFI ABI not yet stable.
unsafe extern "C" {
    fn Bun__JSDirentObjectConstructor(global: *const JSGlobalObject) -> JSValue;
    fn Bun__Dirent__toJS(
        global: *const JSGlobalObject,
        kind: i32,
        name: *mut bun_str::String,
        path: *mut bun_str::String,
        cached_previous_path_jsvalue: *mut Option<*mut jsc::JSString>,
    ) -> JSValue;
}

// Gated: bodies call JSC FFI / `bun_jsc::from_js_host_call`.
// TODO(b2-blocked): un-gate once bun_jsc + libuv UV_DIRENT_* land.

impl Dirent {
    pub fn get_constructor(global: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call.
        unsafe { Bun__JSDirentObjectConstructor(global) }
    }

    pub fn to_js(
        &mut self,
        global_object: &JSGlobalObject,
        cached_previous_path_jsvalue: Option<&mut Option<*mut jsc::JSString>>,
    ) -> JsResult<JSValue> {
        // libuv UV_DIRENT_* — `bun_libuv_sys` is not a dep of this crate, so the
        // ABI constants (uv.h `uv_dirent_type_t`) are inlined verbatim.
        const UV_DIRENT_UNKNOWN: i32 = 0;
        const UV_DIRENT_FILE: i32 = 1;
        const UV_DIRENT_DIR: i32 = 2;
        const UV_DIRENT_LINK: i32 = 3;
        const UV_DIRENT_FIFO: i32 = 4;
        const UV_DIRENT_SOCKET: i32 = 5;
        const UV_DIRENT_CHAR: i32 = 6;
        const UV_DIRENT_BLOCK: i32 = 7;
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
        let cached_ptr = match cached_previous_path_jsvalue {
            Some(p) => p as *mut Option<*mut jsc::JSString>,
            None => core::ptr::null_mut(),
        };
        // SAFETY: FFI call wrapped via from_js_host_call.
        bun_jsc::from_js_host_call(global_object, || unsafe {
            Bun__Dirent__toJS(
                global_object,
                kind_int,
                &mut self.name,
                &mut self.path,
                cached_ptr,
            )
        })
    }

    pub fn to_js_newly_created(
        &mut self,
        global_object: &JSGlobalObject,
        previous_jsstring: Option<&mut Option<*mut jsc::JSString>>,
    ) -> JsResult<JSValue> {
        // Shouldn't techcnically be necessary.
        let result = self.to_js(global_object, previous_jsstring);
        self.deref();
        result
    }

    pub fn deref(&self) {
        self.name.deref_count();
        self.path.deref_count();
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub enum PathOrBlob {
    Path(PathOrFileDescriptor),
    Blob(Blob),
}

// Gated: body calls JSC methods (`args.next_eat()`, `arg.as_::<Blob>()`).
// TODO(b2-blocked): un-gate once bun_jsc method surface lands.

impl PathOrBlob {
    pub fn from_js_no_copy(ctx: &JSGlobalObject, args: &mut ArgumentsSlice) -> JsResult<PathOrBlob> {
        if let Some(path) = PathOrFileDescriptor::from_js(ctx, args)? {
            return Ok(PathOrBlob::Path(path));
        }

        let Some(arg) = args.next_eat() else {
            return ctx.throw_invalid_argument_type_value(
                "destination",
                "path, file descriptor, or Blob",
                JSValue::UNDEFINED,
            );
        };
        if let Some(blob) = arg.as_::<Blob>() {
            return Ok(PathOrBlob::Blob(blob.clone_raw()));
        }
        ctx.throw_invalid_argument_type_value("destination", "path, file descriptor, or Blob", arg)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/types.zig (1251 lines)
//   confidence: medium
//   todos:      21
//   notes:      deinit → impl Drop, deinit_and_unprotect consumes self + mem::forget; phf maps need case-insensitive/custom-eql lookup; sliceZWithForceCopy return-type mutability collapsed; Dirent.Kind remapped from std.fs to bun_sys::FileKind
// ──────────────────────────────────────────────────────────────────────────
