use crate::webcore::EncodingLabel;
use crate::webcore::jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsResult,
};
use bun_core::AllocError;
use bun_core::{OwnedString, strings};
use core::cell::Cell;

use jsc::StringJsc as _;
use jsc::ZigStringJsc as _;
use jsc::text_codec::TextCodec;
use jsc::zig_string::ZigString;

use strings::{u16_is_lead, u16_is_trail};
const UNICODE_REPLACEMENT_U16: u16 = strings::UNICODE_REPLACEMENT as u16;

#[derive(Default, Clone, Copy)]
pub struct Buffered {
    pub buf: [u8; 3],
    pub len: u8, // Zig: u2
}

impl Buffered {
    pub fn slice(&self) -> &[u8] {
        &self.buf[0..self.len as usize]
    }
}

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (all written fields are `Copy`). The codegen
// shim still emits `this: &mut TextDecoder` until Phase 1 `sharedThis` lands —
// `&mut T` auto-derefs to `&T` so the impls below compile against either.
#[bun_jsc::JsClass]
pub struct TextDecoder {
    // used for utf8 decoding
    pub buffered: Cell<Buffered>,

    // used for utf16 decoding
    pub lead_byte: Cell<Option<u8>>,
    pub lead_surrogate: Cell<Option<u16>>,

    // Read-only after construction (set in `constructor` before the JS wrapper
    // exists) — left bare.
    pub ignore_bom: bool,
    pub fatal: bool,
    pub encoding: EncodingLabel,
}

impl Default for TextDecoder {
    fn default() -> Self {
        Self {
            buffered: Cell::new(Buffered::default()),
            lead_byte: Cell::new(None),
            lead_surrogate: Cell::new(None),
            ignore_bom: false,
            fatal: false,
            encoding: EncodingLabel::Utf8,
        }
    }
}

// pub const js = jsc.Codegen.JSTextDecoder;
// pub const toJS / fromJS / fromJSDirect — provided by #[bun_jsc::JsClass] codegen.

/// RAII guard for an FFI-owned `TextCodec` (matches Zig `defer codec.deinit()`).
struct CodecGuard(core::ptr::NonNull<TextCodec>);
impl Drop for CodecGuard {
    fn drop(&mut self) {
        // SAFETY: `self.0` came from `TextCodec::create` and has not been freed.
        unsafe { TextCodec::destroy(self.0.as_ptr()) }
    }
}
impl core::ops::Deref for CodecGuard {
    type Target = TextCodec;
    fn deref(&self) -> &TextCodec {
        // `TextCodec` is an opaque ZST FFI handle (S008); pointer is live for
        // the guard's lifetime — safe `*const → &` via `opaque_deref`.
        bun_opaque::opaque_deref(self.0.as_ptr())
    }
}
impl core::ops::DerefMut for CodecGuard {
    fn deref_mut(&mut self) -> &mut TextCodec {
        // `TextCodec` is an opaque ZST FFI handle (S008); pointer is live for
        // the guard's lifetime, `&mut self` is exclusive — safe via `opaque_deref_mut`.
        bun_opaque::opaque_deref_mut(self.0.as_ptr())
    }
}

impl TextDecoder {
    pub fn new(init: TextDecoder) -> Box<TextDecoder> {
        Box::new(init)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_ignore_bom(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(self.ignore_bom)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_fatal(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(self.fatal)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_encoding(&self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::init(EncodingLabel::get_label(self.encoding)).to_js(global_this)
    }

    // const Vector16 = std.meta.Vector(16, u16);
    // const max_16_ascii: Vector16 = @splat(@as(u16, 127));
    // PORT NOTE: SIMD vector constants are unused in this file's hot paths in current Zig.

    #[inline(always)]
    fn process_code_unit_utf16(
        &self,
        output: &mut Vec<u16>,
        saw_error: &mut bool,
        code_unit: u16,
    ) -> Result<(), AllocError> {
        if let Some(lead_surrogate) = self.lead_surrogate.get() {
            self.lead_surrogate.set(None);

            if u16_is_trail(code_unit) {
                // TODO: why is this here?
                // const code_point = strings.u16GetSupplementary(lead_surrogate, code_unit);
                output.extend_from_slice(&[lead_surrogate, code_unit]);
                return Ok(());
            }
            output.push(UNICODE_REPLACEMENT_U16);
            *saw_error = true;
        }

        if u16_is_lead(code_unit) {
            self.lead_surrogate.set(Some(code_unit));
            return Ok(());
        }

        if u16_is_trail(code_unit) {
            output.push(UNICODE_REPLACEMENT_U16);
            *saw_error = true;
            return Ok(());
        }

        output.push(code_unit);
        Ok(())
    }

    #[inline(always)]
    pub fn code_unit_from_bytes_utf16<const BIG_ENDIAN: bool>(first: u16, second: u16) -> u16 {
        if BIG_ENDIAN {
            (first << 8) | second
        } else {
            first | (second << 8)
        }
    }

    pub fn decode_utf16<const BIG_ENDIAN: bool, const FLUSH: bool>(
        &self,
        bytes: &[u8],
    ) -> Result<(Vec<u16>, bool), AllocError> {
        let mut output: Vec<u16> = Vec::new();
        output.reserve(bytes.len() / 2);

        let mut remain = bytes;
        let mut saw_error = false;

        if let Some(lead_byte) = self.lead_byte.get() {
            if !remain.is_empty() {
                self.lead_byte.set(None);

                self.process_code_unit_utf16(
                    &mut output,
                    &mut saw_error,
                    Self::code_unit_from_bytes_utf16::<BIG_ENDIAN>(
                        u16::from(lead_byte),
                        u16::from(remain[0]),
                    ),
                )?;
                remain = &remain[1..];
            }
        }

        let mut i: usize = 0;

        while i < remain.len().saturating_sub(1) {
            self.process_code_unit_utf16(
                &mut output,
                &mut saw_error,
                Self::code_unit_from_bytes_utf16::<BIG_ENDIAN>(
                    u16::from(remain[i]),
                    u16::from(remain[i + 1]),
                ),
            )?;
            i += 2;
        }

        if !remain.is_empty() && i == remain.len() - 1 {
            self.lead_byte.set(Some(remain[i]));
        } else {
            bun_core::assert_with_location(i == remain.len(), core::panic::Location::caller());
        }

        if FLUSH {
            if self.lead_byte.get().is_some() || self.lead_surrogate.get().is_some() {
                self.lead_byte.set(None);
                self.lead_surrogate.set(None);
                output.push(UNICODE_REPLACEMENT_U16);
                saw_error = true;
                return Ok((output, saw_error));
            }
        }

        Ok((output, saw_error))
    }

    #[bun_jsc::host_fn(method)]
    pub fn decode(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments_buf = callframe.arguments_old::<2>();
        let arguments = arguments_buf.slice();

        // Evaluate options.stream before reading the input bytes. Reading `stream`
        // can invoke a user-defined getter that detaches/transfers the input's
        // ArrayBuffer; capturing the byte pointer before that getter runs leaves
        // `decodeSlice` reading through a stale pointer into memory that may have
        // been freed or reused. Node.js reads options first as well.
        let stream = 'stream: {
            if arguments.len() > 1 && arguments[1].is_object() {
                if let Some(stream_value) =
                    arguments[1].fast_get(global_this, jsc::BuiltinName::stream)?
                {
                    break 'stream stream_value.to_boolean();
                }
            }

            false
        };

        // PORT NOTE: hoisted out of the labeled block — `ArrayBuffer::slice` borrows
        // from the by-value `ArrayBuffer`, so it must outlive the `'input_slice` block.
        let array_buffer;
        let input_slice: &[u8] = 'input_slice: {
            if arguments.is_empty() || arguments[0].is_undefined() {
                break 'input_slice b"";
            }

            if let Some(ab) = arguments[0].as_array_buffer(global_this) {
                array_buffer = ab;
                break 'input_slice array_buffer.slice();
            }

            return Err(global_this.throw_invalid_arguments(format_args!(
                "TextDecoder.decode expects an ArrayBuffer or TypedArray",
            )));
        };

        // switch (!stream) { inline else => |flush| ... } — runtime bool → comptime dispatch
        if !stream {
            self.decode_slice::<true>(global_this, input_slice)
        } else {
            self.decode_slice::<false>(global_this, input_slice)
        }
    }

    pub fn decode_without_type_checks(
        &self,
        global_this: &JSGlobalObject,
        uint8array: &mut JSUint8Array,
    ) -> JsResult<JSValue> {
        self.decode_slice::<false>(global_this, uint8array.slice())
    }

    fn decode_slice<const FLUSH: bool>(
        &self,
        global_this: &JSGlobalObject,
        buffer_slice: &[u8],
    ) -> JsResult<JSValue> {
        match self.encoding {
            EncodingLabel::LATIN1 => {
                if strings::is_all_ascii(buffer_slice) {
                    return Ok(ZigString::init(buffer_slice).to_js(global_this));
                }

                // It's unintuitive that we encode Latin1 as UTF16 even though the engine natively supports Latin1 strings...
                // However, this is also what WebKit seems to do.
                //
                // => The reason we need to encode it is because TextDecoder "latin1" is actually CP1252, while WebKit latin1 is 8-bit utf-16
                let out_length = strings::element_length_cp1252_into_utf16(buffer_slice);
                let mut bytes = vec![0u16; out_length].into_boxed_slice();

                let out = strings::copy_cp1252_into_utf16(&mut bytes, buffer_slice);
                // PERF(port): heap::alloc transfers a tight allocation (no excess capacity).
                Ok(jsc::zig_string::to_external_u16(
                    bun_core::heap::into_raw(bytes).cast::<u16>(),
                    out.written as usize,
                    global_this,
                ))
            }
            EncodingLabel::Utf8 => {
                // PORT NOTE: reshaped for borrowck — Zig used a labeled tuple-destructuring block.
                let maybe_without_bom =
                    if !self.ignore_bom && buffer_slice.starts_with(b"\xef\xbb\xbf") {
                        &buffer_slice[3..]
                    } else {
                        buffer_slice
                    };

                let (input, deinit): (&[u8], bool);
                let joined_owned: Box<[u8]>;
                let buffered = self.buffered.get();
                if buffered.len > 0 {
                    let buffered_len = buffered.len as usize;
                    let mut joined =
                        vec![0u8; maybe_without_bom.len() + buffered_len].into_boxed_slice();
                    joined[0..buffered_len].copy_from_slice(buffered.slice());
                    joined[buffered_len..][0..maybe_without_bom.len()]
                        .copy_from_slice(maybe_without_bom);
                    self.buffered.set(Buffered::default());
                    joined_owned = joined;
                    input = &joined_owned;
                    deinit = true;
                } else {
                    joined_owned = Box::default();
                    let _ = &joined_owned;
                    input = maybe_without_bom;
                    deinit = false;
                }

                // switch (this.fatal) { inline else => |fail_if_invalid| ... }
                let maybe_decode_result = if self.fatal {
                    strings::to_utf16_alloc_maybe_buffered::<true, FLUSH>(input)
                } else {
                    strings::to_utf16_alloc_maybe_buffered::<false, FLUSH>(input)
                };

                let maybe_decode_result = match maybe_decode_result {
                    Ok(v) => v,
                    Err(err) => {
                        // `joined_owned` drops at scope exit (matches `if (deinit) free(input)`).
                        if self.fatal {
                            if matches!(err, strings::ToUTF16Error::InvalidByteSequence) {
                                return Err(global_this
                                    .err(
                                        jsc::ErrorCode::ERR_ENCODING_INVALID_ENCODED_DATA,
                                        format_args!("Invalid byte sequence"),
                                    )
                                    .throw());
                            }
                        }

                        debug_assert!(matches!(err, strings::ToUTF16Error::OutOfMemory));
                        return Err(global_this.throw_out_of_memory());
                    }
                };

                if let Some((decoded, leftover, leftover_len)) = maybe_decode_result {
                    // `joined_owned` drops at scope exit (matches `if (deinit) free(input)`).
                    debug_assert!(self.buffered.get().len == 0);
                    if !FLUSH {
                        if leftover_len != 0 {
                            self.buffered.set(Buffered {
                                buf: leftover,
                                len: leftover_len,
                            });
                        }
                    }
                    let len = decoded.len();
                    // PERF(port): Vec::leak may retain excess capacity vs Zig's items.ptr — profile in Phase B
                    let ptr = decoded.leak().as_mut_ptr();
                    return Ok(jsc::zig_string::to_external_u16(ptr, len, global_this));
                }

                debug_assert!(input.is_empty() || !deinit);

                // Experiment: using mimalloc directly is slightly slower
                Ok(ZigString::init(input).to_js(global_this))
            }

            enc @ (EncodingLabel::Utf16Le | EncodingLabel::Utf16Be) => {
                // inline .@"UTF-16LE", .@"UTF-16BE" => |utf16_encoding| { ... }
                let big_endian = matches!(enc, EncodingLabel::Utf16Be);
                let bom: &[u8] = if !big_endian {
                    b"\xff\xfe"
                } else {
                    b"\xfe\xff"
                };
                let input = if !self.ignore_bom && buffer_slice.starts_with(bom) {
                    &buffer_slice[2..]
                } else {
                    buffer_slice
                };

                let (decoded, saw_error) = if big_endian {
                    self.decode_utf16::<true, FLUSH>(input)?
                } else {
                    self.decode_utf16::<false, FLUSH>(input)?
                };

                if saw_error && self.fatal {
                    drop(decoded);
                    return Err(global_this
                        .err(
                            jsc::ErrorCode::ERR_ENCODING_INVALID_ENCODED_DATA,
                            // Zig: `@tagName(utf16_encoding)` → "UTF-16LE" / "UTF-16BE"
                            // (NOT `get_label()`, which is lowercase "utf-16le"/"utf-16be").
                            format_args!(
                                "The encoded data was not valid {} data",
                                if big_endian { "UTF-16BE" } else { "UTF-16LE" }
                            ),
                        )
                        .throw());
                }

                if decoded.is_empty() {
                    drop(decoded);
                    return Ok(ZigString::EMPTY.to_js(global_this));
                }

                // Transfer ownership of the backing allocation to JSC; freed via
                // free_global_string -> mi_free when the string is collected.
                let len = decoded.len();
                // PERF(port): Vec::leak may retain excess capacity vs Zig's items.ptr — profile in Phase B
                let ptr = decoded.leak().as_mut_ptr();
                Ok(jsc::zig_string::to_external_u16(ptr, len, global_this))
            }

            // Handle all other encodings using WebKit's TextCodec
            _ => {
                let encoding_name = EncodingLabel::get_label(self.encoding);

                // Create codec if we don't have one cached
                // Note: In production, we might want to cache these per-encoding
                let Some(codec) = TextCodec::create(encoding_name) else {
                    // Fallback to empty string if codec creation fails
                    return Ok(ZigString::init(b"").to_js(global_this));
                };
                let mut codec = CodecGuard(codec);
                // `codec` drops at scope exit (matches `defer codec.deinit()`).

                // Handle BOM stripping if needed
                if !self.ignore_bom {
                    codec.strip_bom();
                }

                // Decode the data
                let result = codec.decode(buffer_slice, FLUSH, self.fatal);
                // `bun_core::String` is `#[derive(Copy)]` with NO `Drop` impl, and
                // `DecodeResult` has none either — wrap the +1 ref in `OwnedString`
                // so it derefs on scope exit (matches Zig `defer result.result.deref()`).
                let result_str = OwnedString::new(result.result);

                // Check for errors if fatal mode is enabled
                if result.saw_error && self.fatal {
                    // `result_str` drops here, releasing the WTFStringImpl ref.
                    return Err(global_this
                        .err(
                            jsc::ErrorCode::ERR_ENCODING_INVALID_ENCODED_DATA,
                            format_args!(
                                "The encoded data was not valid {} data",
                                bstr::BStr::new(encoding_name)
                            ),
                        )
                        .throw());
                }

                // `StringJsc::to_js(&self, ...)` borrows; `result_str` drops after,
                // releasing the +1 (JSC holds its own ref via the JSString).
                result_str.to_js(global_this)
            }
        }
    }

    // `#[JsClass]` emits `TextDecoderClass__construct` calling this; do not
    // wrap with `#[bun_jsc::host_fn]` (its Free-kind shim emits a bare
    // `constructor(...)` call that doesn't resolve inside an `impl` block).
    pub fn constructor(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<*mut TextDecoder> {
        let [encoding_value, options_value] = callframe.arguments_as_array::<2>();

        let mut decoder = TextDecoder::default();

        if encoding_value.is_string() {
            let str = encoding_value.to_slice(global_this)?;
            // `str` drops at scope exit (matches `defer str.deinit()`).

            if let Some(label) = EncodingLabel::which(str.slice()) {
                decoder.encoding = label;
            } else {
                return Err(global_this
                    .err(
                        jsc::ErrorCode::ERR_ENCODING_NOT_SUPPORTED,
                        format_args!(
                            "Unsupported encoding label \"{}\"",
                            bstr::BStr::new(str.slice())
                        ),
                    )
                    .throw());
            }
        } else if encoding_value.is_undefined() {
            // default to utf-8
            decoder.encoding = EncodingLabel::Utf8;
        } else {
            return Err(global_this
                .throw_invalid_arguments(format_args!("TextDecoder(encoding) label is invalid",)));
        }

        if !options_value.is_undefined() {
            if !options_value.is_object() {
                return Err(global_this
                    .throw_invalid_arguments(format_args!("TextDecoder(options) is invalid",)));
            }

            if let Some(fatal) = options_value.get(global_this, b"fatal")? {
                decoder.fatal = fatal.to_boolean();
            }

            if let Some(ignore_bom) = options_value.get(global_this, b"ignoreBOM")? {
                if ignore_bom.is_boolean() {
                    decoder.ignore_bom = ignore_bom.as_boolean();
                } else {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "TextDecoder(options) ignoreBOM is invalid. Expected boolean value",
                    )));
                }
            }
        }

        Ok(bun_core::heap::into_raw(TextDecoder::new(decoder)))
    }
}

// ported from: src/runtime/webcore/TextDecoder.zig
