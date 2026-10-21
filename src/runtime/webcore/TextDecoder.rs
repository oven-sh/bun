use crate::generated_bindgen::text_decoder::{TextDecodeOptions, TextDecoderOptions};
use crate::webcore::EncodingLabel;
use crate::webcore::jsc::{self as jsc, JSGlobalObject, JSString, JSValue};
use bun_core::strings;
use bun_jsc::HostReturn as _;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope};

use jsc::StringJsc as _;

use strings::{u16_is_lead, u16_is_trail};
const UNICODE_REPLACEMENT_U16: u16 = strings::UNICODE_REPLACEMENT as u16;

#[derive(Default, Clone, Copy)]
struct Buffered {
    buf: [u8; 3],
    len: u8,
}

impl Buffered {
    fn slice(&self) -> &[u8] {
        &self.buf[0..self.len as usize]
    }
}

#[derive(Default)]
pub(crate) struct TextDecoder {
    // used for utf8 decoding
    buffered: Buffered,

    // used for utf16 decoding
    lead_byte: Option<u8>,
    lead_surrogate: Option<u16>,

    // https://encoding.spec.whatwg.org/#textdecoder-bom-seen-flag
    // True once the stream's BOM decision is made: its first scalar was either
    // a suppressed U+FEFF or something else, so no later U+FEFF may be dropped.
    bom_seen: bool,
    // https://encoding.spec.whatwg.org/#textdecoder-do-not-flush-flag
    // True when the previous `decode()` was a `{stream: true}` chunk, so the
    // next call continues that stream instead of starting a new one.
    do_not_flush: bool,

    // encoding_rs decoder for every other encoding. It owns the streaming
    // state (lead byte, ISO-2022-JP mode, GB18030 first/second/third), so it
    // must live across `{stream: true}` chunks. Created lazily by a stream's
    // first chunk and cleared by `decode_chunk` when the next stream starts,
    // however the previous decode exited: a decoder that has flushed must not
    // be fed again (encoding_rs panics).
    codec: Option<encoding_rs::Decoder>,

    ignore_bom: bool,
    fatal: bool,
    encoding: EncodingLabel,
}

impl TextDecoder {
    #[inline(always)]
    fn process_code_unit_utf16(
        &mut self,
        output: &mut Vec<u16>,
        saw_error: &mut bool,
        code_unit: u16,
    ) {
        if let Some(lead_surrogate) = self.lead_surrogate {
            self.lead_surrogate = None;
            if u16_is_trail(code_unit) {
                // TODO: why is this here?
                // const code_point = strings.u16GetSupplementary(lead_surrogate, code_unit);
                output.extend_from_slice(&[lead_surrogate, code_unit]);
                return;
            }
            output.push(UNICODE_REPLACEMENT_U16);
            *saw_error = true;
        }

        if u16_is_lead(code_unit) {
            self.lead_surrogate = Some(code_unit);
            return;
        }

        if u16_is_trail(code_unit) {
            output.push(UNICODE_REPLACEMENT_U16);
            *saw_error = true;
            return;
        }

        output.push(code_unit);
    }

    #[inline(always)]
    fn code_unit_from_bytes_utf16<const BIG_ENDIAN: bool>(first: u16, second: u16) -> u16 {
        if BIG_ENDIAN {
            (first << 8) | second
        } else {
            first | (second << 8)
        }
    }

    fn decode_utf16<const BIG_ENDIAN: bool, const FLUSH: bool>(
        &mut self,
        bytes: &[u8],
    ) -> (Vec<u16>, bool) {
        let mut output: Vec<u16> = Vec::with_capacity(bytes.len() / 2);

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
                );
                remain = &remain[1..];
            }
        }

        let (pairs, rest) = remain.as_chunks::<2>();
        for &[first, second] in pairs {
            self.process_code_unit_utf16(
                &mut output,
                &mut saw_error,
                Self::code_unit_from_bytes_utf16::<BIG_ENDIAN>(u16::from(first), u16::from(second)),
            );
        }
        if let [lead_byte] = *rest {
            self.lead_byte = Some(lead_byte);
        }

        if FLUSH {
            if self.lead_byte.is_some() || self.lead_surrogate.is_some() {
                self.lead_byte = None;
                self.lead_surrogate = None;
                output.push(UNICODE_REPLACEMENT_U16);
                saw_error = true;
            }
        }

        (output, saw_error)
    }

    /// Feeds one chunk to the encoding_rs decoder shared across a stream's
    /// `{stream: true}` chunks. `InvalidByteSequence` is only reported in
    /// fatal mode; otherwise malformed bytes become U+FFFD in the output.
    fn decode_with_encoding_rs<const FLUSH: bool>(
        fatal: bool,
        decoder: &mut encoding_rs::Decoder,
        bytes: &[u8],
    ) -> Result<Vec<u16>, strings::ToUTF16Error> {
        // Nothing to decode. Also keeps the chunk away from encoding_rs 0.8.35,
        // whose big5, euc-kr and shift_jis decoders forget a pending lead byte
        // when fed an empty non-final chunk.
        if bytes.is_empty() && !FLUSH {
            return Ok(Vec::new());
        }

        // Bounds the output for this chunk in both the replacing and the
        // fatal mode, so neither decode call below can stop on a full buffer.
        let cap = decoder
            .max_utf16_buffer_length(bytes.len())
            .ok_or(strings::ToUTF16Error::OutOfMemory)?;
        let mut decoded = Vec::<u16>::new();
        decoded
            .try_reserve_exact(cap)
            .map_err(|_| strings::ToUTF16Error::OutOfMemory)?;
        // SAFETY: `decoded` has `cap` spare units. encoding_rs only writes to
        // its output slice (Gecko has it fill uninitialized string storage the
        // same way), so the units need no zero-fill; `set_len` below exposes
        // only the prefix it reports as written.
        let dst = unsafe { core::slice::from_raw_parts_mut(decoded.as_mut_ptr(), cap) };

        let written = if fatal {
            let (result, _, written) =
                decoder.decode_to_utf16_without_replacement(bytes, dst, FLUSH);
            if let encoding_rs::DecoderResult::Malformed(..) = result {
                return Err(strings::ToUTF16Error::InvalidByteSequence);
            }
            debug_assert!(matches!(result, encoding_rs::DecoderResult::InputEmpty));
            written
        } else {
            let (result, _, written, _) = decoder.decode_to_utf16(bytes, dst, FLUSH);
            debug_assert!(matches!(result, encoding_rs::CoderResult::InputEmpty));
            written
        };
        debug_assert!(written <= cap);
        // SAFETY: encoding_rs initialized `dst[..written]`, and `written <= cap`.
        unsafe { decoded.set_len(written) };
        // `cap` is about one code unit per input byte; two-byte CJK text fills
        // half of it, and this buffer lives as long as the JS string does.
        decoded.shrink_to_fit();
        Ok(decoded)
    }

    /// Not thrown here: to throw can run a debugger's JavaScript, which can reach the decoder.
    #[cold]
    fn invalid_data<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Error<'a> {
        heap.error_with_code(
            jsc::ErrorCode::ERR_ENCODING_INVALID_ENCODED_DATA,
            format_args!(
                "The encoded data was not valid for encoding {}",
                bstr::BStr::new(self.encoding.get_label())
            ),
        )
    }

    fn decode_chunk<'a>(
        &mut self,
        heap: &JsHeap<'a>,
        chunk: &[u8],
        stream: bool,
    ) -> bindgen::Result<'a, JsLocal<'a, JSString>> {
        // https://encoding.spec.whatwg.org/#dom-textdecoder-decode steps 1-2: what follows a flush is a new stream.
        if !core::mem::replace(&mut self.do_not_flush, stream) {
            self.bom_seen = false;
            self.codec = None;
        }
        if stream {
            self.decode_slice::<false>(heap, chunk)
        } else {
            self.decode_slice::<true>(heap, chunk)
        }
    }

    fn decode_slice<'a, const FLUSH: bool>(
        &mut self,
        heap: &JsHeap<'a>,
        buffer_slice: &[u8],
    ) -> bindgen::Result<'a, JsLocal<'a, JSString>> {
        match self.encoding {
            EncodingLabel::LATIN1 => {
                if strings::is_all_ascii(buffer_slice) {
                    return Ok(heap.create_latin1_string(buffer_slice));
                }

                // It's unintuitive that we encode Latin1 as UTF16 even though the engine natively supports Latin1 strings...
                // However, this is also what WebKit seems to do.
                //
                // => The reason we need to encode it is because TextDecoder "latin1" is actually CP1252, while WebKit latin1 is 8-bit utf-16
                let out_length = strings::element_length_cp1252_into_utf16(buffer_slice);
                let mut units: Vec<u16> = Vec::with_capacity(out_length);
                // SAFETY: `units` has `out_length` spare units; `buf` is only ever written.
                let buf =
                    unsafe { core::slice::from_raw_parts_mut(units.as_mut_ptr(), out_length) };
                let out = strings::copy_cp1252_into_utf16(buf, buffer_slice);
                // SAFETY: the copy above initialized `out.written` (≤ `out_length`) units.
                unsafe { units.set_len(out.written) };
                heap.create_utf16_string_from_vec(units)
            }
            EncodingLabel::Utf8 => {
                // Prepend the partial UTF-8 sequence carried over from the
                // previous `{stream: true}` chunk; the BOM check below must
                // see the JOINED bytes (a BOM may be split across chunks).
                let joined_owned: Box<[u8]>;
                let buffered = self.buffered;
                let joined: &[u8] = if buffered.len > 0 {
                    joined_owned = [buffered.slice(), buffer_slice].concat().into_boxed_slice();
                    self.buffered = Buffered::default();
                    &joined_owned
                } else {
                    buffer_slice
                };

                // https://encoding.spec.whatwg.org/#concept-td-serialize: suppress
                // at most one LEADING U+FEFF per stream. A strict BOM prefix ("",
                // EF, EF BB) is still ambiguous; `buffered` carries it to the next chunk.
                const UTF8_BOM: &[u8] = b"\xef\xbb\xbf";
                let set_bom_seen: bool;
                let input: &[u8] = if self.ignore_bom || self.bom_seen {
                    set_bom_seen = false;
                    joined
                } else if let Some(rest) = joined.strip_prefix(UTF8_BOM) {
                    set_bom_seen = true;
                    rest
                } else if UTF8_BOM.starts_with(joined) {
                    set_bom_seen = false;
                    joined
                } else {
                    set_bom_seen = true;
                    joined
                };

                // Dispatch the runtime `fatal` bool to a const-generic parameter.
                let maybe_decode_result = if self.fatal {
                    strings::to_utf16_alloc_maybe_buffered::<true, FLUSH>(input)
                } else {
                    strings::to_utf16_alloc_maybe_buffered::<false, FLUSH>(input)
                };

                let maybe_decode_result = match maybe_decode_result {
                    Ok(v) => v,
                    Err(err) => {
                        if self.fatal && matches!(err, strings::ToUTF16Error::InvalidByteSequence) {
                            return Err(self.invalid_data(heap));
                        }

                        debug_assert!(matches!(err, strings::ToUTF16Error::OutOfMemory));
                        return Err(if bun_core::String::utf16_transcode_too_long(input) {
                            heap.string_too_long()
                        } else {
                            heap.memory_allocation_failed()
                        });
                    }
                };

                // "BOM seen" is only written by "serialize I/O queue", which a
                // thrown fatal decode never reaches, so only commit it once the
                // decode succeeded.
                if set_bom_seen {
                    self.bom_seen = true;
                }

                if let Some((decoded, leftover, leftover_len)) = maybe_decode_result {
                    debug_assert!(self.buffered.len == 0);
                    if !FLUSH {
                        if leftover_len != 0 {
                            self.buffered = Buffered {
                                buf: leftover,
                                len: leftover_len,
                            };
                        }
                    }
                    return heap.create_utf16_string_from_vec(decoded);
                }

                // All-ASCII input needed no conversion. `create_latin1_string`
                // copies, so `input` may borrow the caller's buffer or `joined_owned`.
                // Experiment: using mimalloc directly is slightly slower
                Ok(heap.create_latin1_string(input))
            }

            enc @ (EncodingLabel::Utf16Le | EncodingLabel::Utf16Be) => {
                let big_endian = matches!(enc, EncodingLabel::Utf16Be);

                // When the stream's BOM is whole at the start of this chunk, strip
                // it from the INPUT (avoids the O(n) `Vec::remove(0)` below). A
                // carried lead byte or surrogate means these are not its first bytes.
                let bom: &[u8; 2] = if big_endian { b"\xfe\xff" } else { b"\xff\xfe" };
                let pre_stripped = !self.ignore_bom
                    && !self.bom_seen
                    && self.lead_byte.is_none()
                    && self.lead_surrogate.is_none()
                    && buffer_slice.starts_with(bom);
                let input = if pre_stripped {
                    &buffer_slice[2..]
                } else {
                    buffer_slice
                };

                let (mut decoded, saw_error) = if big_endian {
                    self.decode_utf16::<true, FLUSH>(input)
                } else {
                    self.decode_utf16::<false, FLUSH>(input)
                };

                if saw_error && self.fatal {
                    return Err(self.invalid_data(heap));
                }

                // https://encoding.spec.whatwg.org/#concept-td-serialize: only the
                // stream's FIRST code unit is dropped as a BOM. `bom_seen` is only
                // committed here, after the fatal early return, which never reaches it.
                if pre_stripped {
                    self.bom_seen = true;
                } else if !self.ignore_bom && !self.bom_seen && !decoded.is_empty() {
                    // The BOM was split across chunks (half of it in `lead_byte`),
                    // so it is only recognizable as the first decoded code unit.
                    self.bom_seen = true;
                    if decoded[0] == 0xFEFF {
                        decoded.remove(0);
                    }
                }

                heap.create_utf16_string_from_vec(decoded)
            }

            // Every other encoding goes through encoding_rs.
            _ => {
                // The decoder carries streaming state (lead bytes, escape mode),
                // so reuse the one from the previous `{stream: true}` chunk.
                let decoder = self.codec.get_or_insert_with(|| {
                    // Only utf-8/utf-16 have a BOM and those are handled above.
                    self.encoding
                        .encoding_rs()
                        .new_decoder_without_bom_handling()
                });
                let decoded =
                    match Self::decode_with_encoding_rs::<FLUSH>(self.fatal, decoder, buffer_slice)
                    {
                        Ok(decoded) => decoded,
                        Err(strings::ToUTF16Error::InvalidByteSequence) => {
                            // Drops what it had pending, so a later `{stream: true}` chunk does not go on from the bad byte.
                            self.codec = None;
                            return Err(self.invalid_data(heap));
                        }
                        Err(strings::ToUTF16Error::OutOfMemory) => {
                            return Err(heap.memory_allocation_failed());
                        }
                    };

                heap.create_utf16_string_from_vec(decoded)
            }
        }
    }
}

impl TextDecoder {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        label: Option<&'a [u8]>,
        options: &TextDecoderOptions,
    ) -> bindgen::Result<'a, Self> {
        let encoding = match label {
            None => EncodingLabel::Utf8,
            // https://encoding.spec.whatwg.org/#dom-textdecoder: failure or replacement is a RangeError.
            Some(label) => match EncodingLabel::which(label) {
                Some(encoding) if encoding != EncodingLabel::Replacement => encoding,
                _ => {
                    return Err(heap.error_with_code(
                        jsc::ErrorCode::ERR_ENCODING_NOT_SUPPORTED,
                        format_args!("Unsupported encoding label \"{}\"", bstr::BStr::new(label)),
                    ));
                }
            },
        };
        Ok(TextDecoder {
            fatal: options.fatal,
            ignore_bom: options.ignore_bom,
            encoding,
            ..TextDecoder::default()
        })
    }

    pub(crate) fn decode<'a>(
        &mut self,
        heap: &JsHeap<'a>,
        input: Option<&'a [u8]>,
        options: &TextDecodeOptions,
    ) -> bindgen::Result<'a, JsLocal<'a, JSString>> {
        self.decode_chunk(heap, input.unwrap_or_default(), options.stream)
    }

    pub(crate) fn get_encoding<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        self.encoding.to_js(heap)
    }

    pub(crate) fn get_fatal(&self) -> bool {
        self.fatal
    }

    pub(crate) fn get_ignore_bom(&self) -> bool {
        self.ignore_bom
    }
}

// ─── extern "C" surface (JSTextDecoderStream.cpp) ─────────────────────────
// The TextDecoderStream cell owns its decoder directly as a `void*` (no JS
// `TextDecoder` wrapper cell, no `decode` prototype lookup, no per-chunk
// `{stream: true}` options object) and drives it through these.

/// Validates `label` (WebIDL DOMString coercion — may run user JS) and
/// returns a fresh decoder configured for the matching encoding. Returns null
/// with an exception pending on `global` on a bad label.
///
/// For the overwhelmingly common `utf-8` + non-fatal case the C++ side uses
/// the inline `StreamingUTF8DecodeState` instead of this decoder, so no
/// `TextDecoder` is allocated: `*out_utf8_fast_path` is set and null is
/// returned with no exception.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn TextDecoder__createForStream(
    global: &JSGlobalObject,
    label: JSValue,
    fatal: bool,
    ignore_bom: bool,
    out_utf8_fast_path: *mut bool,
    out_encoding: *mut EncodingLabel,
) -> *mut TextDecoder {
    // SAFETY: both out-params are stack locals on the caller's frame.
    unsafe { *out_utf8_fast_path = false };
    let encoding = if label.is_undefined() {
        EncodingLabel::Utf8
    } else {
        let converted = match bun_core::String::from_js(label, global) {
            Ok(s) => s,
            Err(_) => return core::ptr::null_mut(),
        };
        let str = converted.to_utf8();
        match EncodingLabel::which(str.slice()) {
            Some(l) if l != EncodingLabel::Replacement => l,
            _ => {
                let _ = global
                    .err(
                        jsc::ErrorCode::ERR_ENCODING_NOT_SUPPORTED,
                        format_args!(
                            "Unsupported encoding label \"{}\"",
                            bstr::BStr::new(str.slice())
                        ),
                    )
                    .throw();
                return core::ptr::null_mut();
            }
        }
    };
    // SAFETY: as above.
    unsafe { out_encoding.write(encoding) };
    if matches!(encoding, EncodingLabel::Utf8) && !fatal {
        // SAFETY: as above.
        unsafe { *out_utf8_fast_path = true };
        return core::ptr::null_mut();
    }
    bun_core::heap::into_raw(Box::new(TextDecoder {
        fatal,
        ignore_bom,
        encoding,
        ..TextDecoder::default()
    }))
}

/// `TextDecoderStream.prototype.encoding`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn TextDecoder__encodingToJS(
    global: &JSGlobalObject,
    encoding: EncodingLabel,
) -> JSValue {
    // SAFETY: a host function of a stream called this with no `JsScope` borrowed.
    unsafe { JsScope::with(global.as_mut_ptr(), |cx| encoding.to_js(&cx.heap).to_js()) }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn TextDecoder__destroyForStream(this: *mut TextDecoder) {
    if !this.is_null() {
        // SAFETY: `this` was returned by `TextDecoder__createForStream` and has not been
        // freed (the C++ cell clears its pointer before calling).
        unsafe { bun_core::heap::destroy(this) };
    }
}

/// The TextDecoderStream transform/flush step. `stream = true` for a mid-
/// stream chunk, `false` for the final flush. `input` may be null iff
/// `input_len == 0`. Returns a JSString on success, or `JSValue::zero` with
/// the exception pending on `global`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn TextDecoder__decodeForStream(
    this: *mut TextDecoder,
    global: &JSGlobalObject,
    input: *const u8,
    input_len: usize,
    stream: bool,
) -> JSValue {
    let slice = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: the caller passes a BufferSource's bytes; `slice` does not
        // escape this call.
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    // SAFETY: the stream's transform or flush algorithm called this with no `JsScope` borrowed, and holds the cell of `this`.
    unsafe {
        JsScope::with(global.as_mut_ptr(), |cx| {
            (*this)
                .decode_chunk(&cx.heap, slice, stream)
                .map(JsLocal::to_js)
                .map_err(|error| error.into_js_error(global))
        })
    }
    .or_pending_exception()
}
