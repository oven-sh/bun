use bun_jsc::{CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsResult, ZigString};
use bun_jsc::webcore::EncodingLabel;
use bun_jsc::text_codec::TextCodec;
use bun_str::strings;
use bun_alloc::AllocError;

#[derive(Default)]
pub struct Buffered {
    pub buf: [u8; 3],
    pub len: u8, // Zig: u2
}

impl Buffered {
    pub fn slice(&self) -> &[u8] {
        &self.buf[0..self.len as usize]
    }
}

#[bun_jsc::JsClass]
pub struct TextDecoder {
    // used for utf8 decoding
    pub buffered: Buffered,

    // used for utf16 decoding
    pub lead_byte: Option<u8>,
    pub lead_surrogate: Option<u16>,

    pub ignore_bom: bool,
    pub fatal: bool,
    pub encoding: EncodingLabel,
}

impl Default for TextDecoder {
    fn default() -> Self {
        Self {
            buffered: Buffered::default(),
            lead_byte: None,
            lead_surrogate: None,
            ignore_bom: false,
            fatal: false,
            encoding: EncodingLabel::Utf8,
        }
    }
}

// pub const js = jsc.Codegen.JSTextDecoder;
// pub const toJS / fromJS / fromJSDirect — provided by #[bun_jsc::JsClass] codegen.

impl TextDecoder {
    pub fn new(init: TextDecoder) -> Box<TextDecoder> {
        Box::new(init)
    }

    pub fn finalize(this: *mut TextDecoder) {
        // SAFETY: `this` was produced by Box::into_raw in the codegen'd constructor
        // path; finalize runs on the mutator thread during lazy sweep.
        unsafe { drop(Box::from_raw(this)) };
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_ignore_bom(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(this.ignore_bom)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_fatal(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(this.fatal)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_encoding(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::init(EncodingLabel::get_label(this.encoding)).to_js(global_this)
    }

    // const Vector16 = std.meta.Vector(16, u16);
    // const max_16_ascii: Vector16 = @splat(@as(u16, 127));
    // TODO(port): SIMD vector constants — unused in this file's hot paths in current Zig; revisit in Phase B.

    fn process_code_unit_utf16(
        &mut self,
        output: &mut Vec<u16>,
        saw_error: &mut bool,
        code_unit: u16,
    ) -> Result<(), AllocError> {
        if let Some(lead_surrogate) = self.lead_surrogate {
            self.lead_surrogate = None;

            if strings::u16_is_trail(code_unit) {
                // TODO: why is this here?
                // const code_point = strings.u16GetSupplementary(lead_surrogate, code_unit);
                output.extend_from_slice(&[lead_surrogate, code_unit]);
                return Ok(());
            }
            output.push(strings::UNICODE_REPLACEMENT);
            *saw_error = true;
        }

        if strings::u16_is_lead(code_unit) {
            self.lead_surrogate = Some(code_unit);
            return Ok(());
        }

        if strings::u16_is_trail(code_unit) {
            output.push(strings::UNICODE_REPLACEMENT);
            *saw_error = true;
            return Ok(());
        }

        output.push(code_unit);
        Ok(())
    }

    pub fn code_unit_from_bytes_utf16<const BIG_ENDIAN: bool>(first: u16, second: u16) -> u16 {
        if BIG_ENDIAN {
            (first << 8) | second
        } else {
            first | (second << 8)
        }
    }

    pub fn decode_utf16<const BIG_ENDIAN: bool, const FLUSH: bool>(
        &mut self,
        bytes: &[u8],
    ) -> Result<(Vec<u16>, bool), AllocError> {
        let mut output: Vec<u16> = Vec::new();
        output.reserve(bytes.len() / 2);

        let mut remain = bytes;
        let mut saw_error = false;

        if let Some(lead_byte) = self.lead_byte {
            if !remain.is_empty() {
                self.lead_byte = None;

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
            self.lead_byte = Some(remain[i]);
        } else {
            // TODO(port): bun.assertWithLocation — using debug_assert! without source-location capture
            debug_assert!(i == remain.len());
        }

        if FLUSH {
            if self.lead_byte.is_some() || self.lead_surrogate.is_some() {
                self.lead_byte = None;
                self.lead_surrogate = None;
                output.push(strings::UNICODE_REPLACEMENT);
                saw_error = true;
                return Ok((output, saw_error));
            }
        }

        Ok((output, saw_error))
    }

    #[bun_jsc::host_fn(method)]
    pub fn decode(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2).slice();

        // Evaluate options.stream before reading the input bytes. Reading `stream`
        // can invoke a user-defined getter that detaches/transfers the input's
        // ArrayBuffer; capturing the byte pointer before that getter runs leaves
        // `decodeSlice` reading through a stale pointer into memory that may have
        // been freed or reused. Node.js reads options first as well.
        let stream = 'stream: {
            if arguments.len() > 1 && arguments[1].is_object() {
                if let Some(stream_value) = arguments[1].fast_get(global_this, bun_jsc::BuiltinName::Stream)? {
                    break 'stream stream_value.to_boolean();
                }
            }

            false
        };

        let input_slice: &[u8] = 'input_slice: {
            if arguments.is_empty() || arguments[0].is_undefined() {
                break 'input_slice b"";
            }

            if let Some(array_buffer) = arguments[0].as_array_buffer(global_this) {
                break 'input_slice array_buffer.slice();
            }

            return global_this.throw_invalid_arguments(
                "TextDecoder.decode expects an ArrayBuffer or TypedArray",
                format_args!(""),
            );
        };

        // switch (!stream) { inline else => |flush| ... } — runtime bool → comptime dispatch
        if !stream {
            this.decode_slice::<true>(global_this, input_slice)
        } else {
            this.decode_slice::<false>(global_this, input_slice)
        }
    }

    pub fn decode_without_type_checks(
        this: &mut Self,
        global_this: &JSGlobalObject,
        uint8array: &JSUint8Array,
    ) -> JsResult<JSValue> {
        this.decode_slice::<false>(global_this, uint8array.slice())
    }

    fn decode_slice<const FLUSH: bool>(
        &mut self,
        global_this: &JSGlobalObject,
        buffer_slice: &[u8],
    ) -> JsResult<JSValue> {
        match self.encoding {
            EncodingLabel::Latin1 => {
                if strings::is_all_ascii(buffer_slice) {
                    return Ok(ZigString::init(buffer_slice).to_js(global_this));
                }

                // It's unintuitive that we encode Latin1 as UTF16 even though the engine natively supports Latin1 strings...
                // However, this is also what WebKit seems to do.
                //
                // => The reason we need to encode it is because TextDecoder "latin1" is actually CP1252, while WebKit latin1 is 8-bit utf-16
                let out_length = strings::element_length_cp1252_into_utf16(buffer_slice);
                // TODO(port): allocate uninit u16 buffer for external JSC string ownership
                let mut bytes = vec![0u16; out_length].into_boxed_slice();

                let out = strings::copy_cp1252_into_utf16(&mut bytes, buffer_slice);
                Ok(ZigString::to_external_u16(
                    Box::into_raw(bytes) as *mut u16,
                    out.written,
                    global_this,
                ))
            }
            EncodingLabel::Utf8 => {
                // PORT NOTE: reshaped for borrowck — Zig used a labeled tuple-destructuring block.
                let maybe_without_bom = if !self.ignore_bom
                    && buffer_slice.starts_with(b"\xef\xbb\xbf")
                {
                    &buffer_slice[3..]
                } else {
                    buffer_slice
                };

                let (input, deinit): (&[u8], bool);
                let joined_owned: Box<[u8]>;
                if self.buffered.len > 0 {
                    let buffered_len = self.buffered.len as usize;
                    let mut joined = vec![0u8; maybe_without_bom.len() + buffered_len].into_boxed_slice();
                    joined[0..buffered_len].copy_from_slice(self.buffered.slice());
                    joined[buffered_len..][0..maybe_without_bom.len()].copy_from_slice(maybe_without_bom);
                    self.buffered.len = 0;
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
                    strings::to_utf16_alloc_maybe_buffered::<true>(input, FLUSH)
                } else {
                    strings::to_utf16_alloc_maybe_buffered::<false>(input, FLUSH)
                };

                let maybe_decode_result = match maybe_decode_result {
                    Ok(v) => v,
                    Err(err) => {
                        // `joined_owned` drops at scope exit (matches `if (deinit) free(input)`).
                        if self.fatal {
                            if err == bun_core::err!("InvalidByteSequence") {
                                return global_this
                                    .err(bun_jsc::ErrorCode::ENCODING_INVALID_ENCODED_DATA, format_args!("Invalid byte sequence"))
                                    .throw();
                            }
                        }

                        debug_assert!(err == bun_core::err!("OutOfMemory"));
                        return global_this.throw_out_of_memory();
                    }
                };

                if let Some(decode_result) = maybe_decode_result {
                    // `joined_owned` drops at scope exit (matches `if (deinit) free(input)`).
                    let (decoded, leftover, leftover_len) = decode_result;
                    debug_assert!(self.buffered.len == 0);
                    if !FLUSH {
                        if leftover_len != 0 {
                            self.buffered.buf = leftover;
                            self.buffered.len = leftover_len;
                        }
                    }
                    let len = decoded.len();
                    return Ok(ZigString::to_external_u16(
                        Box::into_raw(decoded) as *mut u16,
                        len,
                        global_this,
                    ));
                }

                debug_assert!(input.is_empty() || !deinit);

                // Experiment: using mimalloc directly is slightly slower
                Ok(ZigString::init(input).to_js(global_this))
            }

            enc @ (EncodingLabel::Utf16Le | EncodingLabel::Utf16Be) => {
                // inline .@"UTF-16LE", .@"UTF-16BE" => |utf16_encoding| { ... }
                let big_endian = matches!(enc, EncodingLabel::Utf16Be);
                let bom: &[u8] = if !big_endian { b"\xff\xfe" } else { b"\xfe\xff" };
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
                    return global_this
                        .err(
                            bun_jsc::ErrorCode::ENCODING_INVALID_ENCODED_DATA,
                            format_args!(
                                "The encoded data was not valid {} data",
                                <&'static str>::from(enc)
                            ),
                        )
                        .throw();
                }

                if decoded.is_empty() {
                    drop(decoded);
                    return Ok(ZigString::EMPTY.to_js(global_this));
                }

                // Transfer ownership of the backing allocation to JSC; freed via
                // free_global_string -> mi_free when the string is collected.
                let len = decoded.len();
                let ptr = decoded.leak().as_mut_ptr();
                // PERF(port): Vec::leak may retain excess capacity vs Zig's items.ptr — profile in Phase B
                Ok(ZigString::to_external_u16(ptr, len, global_this))
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
                // `codec` drops at scope exit (matches `defer codec.deinit()`).

                // Handle BOM stripping if needed
                if !self.ignore_bom {
                    codec.strip_bom();
                }

                // Decode the data
                let result = codec.decode(buffer_slice, FLUSH, self.fatal);
                // `result.result` derefs on drop (matches `defer result.result.deref()`).

                // Check for errors if fatal mode is enabled
                if result.saw_error && self.fatal {
                    return global_this
                        .err(
                            bun_jsc::ErrorCode::ENCODING_INVALID_ENCODED_DATA,
                            format_args!(
                                "The encoded data was not valid {} data",
                                bstr::BStr::new(encoding_name)
                            ),
                        )
                        .throw();
                }

                // Return the decoded string
                Ok(result.result.to_js(global_this))
            }
        }
    }

    #[bun_jsc::host_fn]
    pub fn constructor(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<TextDecoder>> {
        let [encoding_value, options_value] = callframe.arguments_as_array::<2>();

        let mut decoder = TextDecoder::default();

        if encoding_value.is_string() {
            let str = encoding_value.to_slice(global_this)?;
            // `str` drops at scope exit (matches `defer str.deinit()`).

            if let Some(label) = EncodingLabel::which(str.slice()) {
                decoder.encoding = label;
            } else {
                return global_this
                    .err(
                        bun_jsc::ErrorCode::ENCODING_NOT_SUPPORTED,
                        format_args!(
                            "Unsupported encoding label \"{}\"",
                            bstr::BStr::new(str.slice())
                        ),
                    )
                    .throw();
            }
        } else if encoding_value.is_undefined() {
            // default to utf-8
            decoder.encoding = EncodingLabel::Utf8;
        } else {
            return global_this.throw_invalid_arguments(
                "TextDecoder(encoding) label is invalid",
                format_args!(""),
            );
        }

        if !options_value.is_undefined() {
            if !options_value.is_object() {
                return global_this.throw_invalid_arguments(
                    "TextDecoder(options) is invalid",
                    format_args!(""),
                );
            }

            if let Some(fatal) = options_value.get(global_this, "fatal")? {
                decoder.fatal = fatal.to_boolean();
            }

            if let Some(ignore_bom) = options_value.get(global_this, "ignoreBOM")? {
                if ignore_bom.is_boolean() {
                    decoder.ignore_bom = ignore_bom.as_boolean();
                } else {
                    return global_this.throw_invalid_arguments(
                        "TextDecoder(options) ignoreBOM is invalid. Expected boolean value",
                        format_args!(""),
                    );
                }
            }
        }

        Ok(TextDecoder::new(decoder))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/TextDecoder.zig (376 lines)
//   confidence: medium
//   todos:      3
//   notes:      ZigString::to_external_u16 ownership-transfer + to_utf16_alloc_maybe_buffered error type need Phase B verification; UTF-8 joined-buffer path reshaped for borrowck.
// ──────────────────────────────────────────────────────────────────────────
