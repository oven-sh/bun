use crate::webcore::EncodingLabel;
use crate::webcore::jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_core::AllocError;
use bun_core::strings;
use bun_jsc::HostReturn as _;
use core::cell::{Cell, RefCell};

use bun_core::EncodedSlice;
use jsc::EncodedSliceJsc as _;
use jsc::StringJsc as _;
use jsc::bun_string_jsc;

use strings::{u16_is_lead, u16_is_trail};
const UNICODE_REPLACEMENT_U16: u16 = strings::UNICODE_REPLACEMENT as u16;

#[derive(Default, Clone, Copy)]
pub struct Buffered {
    pub(crate) buf: [u8; 3],
    pub(crate) len: u8,
}

impl Buffered {
    fn slice(&self) -> &[u8] {
        &self.buf[0..self.len as usize]
    }
}

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (`RefCell` for the decoder; its borrow is
// released before anything can call back into JS).
#[bun_jsc::JsClass]
pub struct TextDecoder {
    // used for utf8 decoding
    pub(crate) buffered: Cell<Buffered>,

    // used for utf16 decoding
    pub(crate) lead_byte: Cell<Option<u8>>,
    pub(crate) lead_surrogate: Cell<Option<u16>>,

    // https://encoding.spec.whatwg.org/#textdecoder-bom-seen-flag
    // True once the stream's BOM decision is made: its first scalar was either
    // a suppressed U+FEFF or something else, so no later U+FEFF may be dropped.
    bom_seen: Cell<bool>,
    // https://encoding.spec.whatwg.org/#textdecoder-do-not-flush-flag
    // True when the previous `decode()` was a `{stream: true}` chunk, so the
    // next call continues that stream instead of starting a new one.
    do_not_flush: Cell<bool>,

    // encoding_rs decoder for every other encoding. It owns the streaming
    // state (lead byte, ISO-2022-JP mode, GB18030 first/second/third), so it
    // must live across `{stream: true}` chunks. Created lazily by a stream's
    // first chunk and cleared by `begin_decode` when the next stream starts,
    // however the previous decode exited: a decoder that has flushed must not
    // be fed again (encoding_rs panics).
    codec: RefCell<Option<encoding_rs::Decoder>>,

    // Read-only after construction (set in `constructor` before the JS wrapper
    // exists) — left bare.
    pub(crate) ignore_bom: bool,
    pub(crate) fatal: bool,
    pub(crate) encoding: EncodingLabel,
}

impl Default for TextDecoder {
    fn default() -> Self {
        Self {
            buffered: Cell::new(Buffered::default()),
            lead_byte: Cell::new(None),
            lead_surrogate: Cell::new(None),
            bom_seen: Cell::new(false),
            do_not_flush: Cell::new(false),
            codec: RefCell::new(None),
            ignore_bom: false,
            fatal: false,
            encoding: EncodingLabel::Utf8,
        }
    }
}

// pub const js = jsc.Codegen.JSTextDecoder;
// pub const toJS / fromJS / fromJSDirect — provided by #[bun_jsc::JsClass] codegen.

impl TextDecoder {
    pub(crate) fn new(init: TextDecoder) -> Box<TextDecoder> {
        Box::new(init)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_ignore_bom(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(self.ignore_bom)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_fatal(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(self.fatal)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_encoding(&self, global_this: &JSGlobalObject) -> JSValue {
        self.encoding.to_js(global_this)
    }

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
    pub(crate) fn code_unit_from_bytes_utf16<const BIG_ENDIAN: bool>(
        first: u16,
        second: u16,
    ) -> u16 {
        if BIG_ENDIAN {
            (first << 8) | second
        } else {
            first | (second << 8)
        }
    }

    pub(crate) fn decode_utf16<const BIG_ENDIAN: bool, const FLUSH: bool>(
        &self,
        bytes: &[u8],
    ) -> Result<(Vec<u16>, bool), AllocError> {
        let mut output: Vec<u16> = Vec::with_capacity(bytes.len() / 2);

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
            assert!(i == remain.len());
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

    /// Feeds one chunk to the encoding_rs decoder shared across a stream's
    /// `{stream: true}` chunks. `InvalidByteSequence` is only reported in
    /// fatal mode; otherwise malformed bytes become U+FFFD in the output.
    fn decode_with_encoding_rs<const FLUSH: bool>(
        &self,
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

        let written = if self.fatal {
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

    #[bun_jsc::host_fn(method)]
    pub(crate) fn decode(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();

        // Evaluate options.stream before reading the input bytes. Reading `stream`
        // can invoke a user-defined getter that detaches/transfers the input's
        // ArrayBuffer; capturing the byte pointer before that getter runs leaves
        // `decodeSlice` reading through a stale pointer into memory that may have
        // been freed or reused. Node.js reads options first as well.
        let stream = 'stream: {
            if arguments.len() > 1 && !arguments[1].is_undefined_or_null() {
                // https://webidl.spec.whatwg.org/#es-dictionary step 1
                if !arguments[1].is_object() {
                    return Err(global_this.throw_invalid_argument_type_value(
                        b"options",
                        b"object",
                        arguments[1],
                    ));
                }
                if let Some(stream_value) =
                    arguments[1].fast_get(global_this, jsc::BuiltinName::stream)?
                {
                    break 'stream stream_value.to_boolean();
                }
            }

            false
        };

        // Hoisted out of the labeled block — `ArrayBuffer::slice` borrows from
        // the by-value `ArrayBuffer`, so it must outlive the `'input_slice` block.
        let array_buffer;
        let owned_input;
        let input_slice: &[u8] = 'input_slice: {
            if arguments.is_empty() || arguments[0].is_undefined() {
                break 'input_slice b"";
            }

            if let Some(ab) = arguments[0].as_array_buffer(global_this) {
                array_buffer = ab;
                if array_buffer.shared || array_buffer.resizable {
                    owned_input = Box::<[u8]>::from(array_buffer.slice());
                    break 'input_slice &owned_input;
                }
                break 'input_slice array_buffer.slice();
            }

            return Err(global_this.throw_invalid_arguments(format_args!(
                "TextDecoder.decode expects an ArrayBuffer or TypedArray",
            )));
        };

        // This runs AFTER the input check: a type error must leave the stream
        // state untouched.
        self.begin_decode(stream);

        // Dispatch the runtime `stream` bool to a const-generic flush parameter.
        if !stream {
            self.decode_slice::<true>(global_this, input_slice)
        } else {
            self.decode_slice::<false>(global_this, input_slice)
        }
    }

    /// https://encoding.spec.whatwg.org/#dom-textdecoder-decode steps 1-2: a
    /// decode() after a flushing one starts a new stream, with a new decoder
    /// and its BOM not yet seen.
    fn begin_decode(&self, stream: bool) {
        if !self.do_not_flush.replace(stream) {
            self.bom_seen.set(false);
            *self.codec.borrow_mut() = None;
        }
    }

    fn decode_slice<const FLUSH: bool>(
        &self,
        global_this: &JSGlobalObject,
        buffer_slice: &[u8],
    ) -> JsResult<JSValue> {
        match self.encoding {
            EncodingLabel::LATIN1 => {
                if strings::is_all_ascii(buffer_slice) {
                    return Ok(EncodedSlice::latin1(buffer_slice).to_js(global_this));
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
                unsafe { units.set_len(out.written as usize) };
                bun_string_jsc::owned_utf16_into_js(global_this, units)
            }
            EncodingLabel::Utf8 => {
                // Prepend the partial UTF-8 sequence carried over from the
                // previous `{stream: true}` chunk; the BOM check below must
                // see the JOINED bytes (a BOM may be split across chunks).
                let joined_owned: Box<[u8]>;
                let buffered = self.buffered.get();
                let joined: &[u8] = if buffered.len > 0 {
                    joined_owned = [buffered.slice(), buffer_slice].concat().into_boxed_slice();
                    self.buffered.set(Buffered::default());
                    &joined_owned
                } else {
                    buffer_slice
                };

                // https://encoding.spec.whatwg.org/#concept-td-serialize: suppress
                // at most one LEADING U+FEFF per stream. A strict BOM prefix ("",
                // EF, EF BB) is still ambiguous; `buffered` carries it to the next chunk.
                const UTF8_BOM: &[u8] = b"\xef\xbb\xbf";
                let set_bom_seen: bool;
                let input: &[u8] = if self.ignore_bom || self.bom_seen.get() {
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
                        // `joined_owned` drops at scope exit.
                        if self.fatal {
                            if matches!(err, strings::ToUTF16Error::InvalidByteSequence) {
                                return Err(global_this
                                    .err(
                                        jsc::ErrorCode::ERR_ENCODING_INVALID_ENCODED_DATA,
                                        format_args!(
                                            "The encoded data was not valid for encoding utf-8"
                                        ),
                                    )
                                    .throw());
                            }
                        }

                        debug_assert!(matches!(err, strings::ToUTF16Error::OutOfMemory));
                        return Err(bun_string_jsc::throw_utf16_transcode_failure(
                            global_this,
                            input,
                        ));
                    }
                };

                // "BOM seen" is only written by "serialize I/O queue", which a
                // thrown fatal decode never reaches, so only commit it once the
                // decode succeeded.
                if set_bom_seen {
                    self.bom_seen.set(true);
                }

                if let Some((decoded, leftover, leftover_len)) = maybe_decode_result {
                    // `joined_owned` drops at scope exit.
                    debug_assert!(self.buffered.get().len == 0);
                    if !FLUSH {
                        if leftover_len != 0 {
                            self.buffered.set(Buffered {
                                buf: leftover,
                                len: leftover_len,
                            });
                        }
                    }
                    return bun_string_jsc::owned_utf16_into_js(global_this, decoded);
                }

                // All-ASCII input needed no conversion. `EncodedSlice::latin1(..).to_js`
                // copies, so `input` may borrow the caller's buffer or `joined_owned`.
                // Experiment: using mimalloc directly is slightly slower
                Ok(EncodedSlice::latin1(input).to_js(global_this))
            }

            enc @ (EncodingLabel::Utf16Le | EncodingLabel::Utf16Be) => {
                let big_endian = matches!(enc, EncodingLabel::Utf16Be);

                // When the stream's BOM is whole at the start of this chunk, strip
                // it from the INPUT (avoids the O(n) `Vec::remove(0)` below). A
                // carried lead byte or surrogate means these are not its first bytes.
                let bom: &[u8; 2] = if big_endian { b"\xfe\xff" } else { b"\xff\xfe" };
                let pre_stripped = !self.ignore_bom
                    && !self.bom_seen.get()
                    && self.lead_byte.get().is_none()
                    && self.lead_surrogate.get().is_none()
                    && buffer_slice.starts_with(bom);
                let input = if pre_stripped {
                    &buffer_slice[2..]
                } else {
                    buffer_slice
                };

                let (mut decoded, saw_error) = if big_endian {
                    self.decode_utf16::<true, FLUSH>(input)?
                } else {
                    self.decode_utf16::<false, FLUSH>(input)?
                };

                if saw_error && self.fatal {
                    drop(decoded);
                    return Err(global_this
                        .err(
                            jsc::ErrorCode::ERR_ENCODING_INVALID_ENCODED_DATA,
                            // Node formats the message with the lowercase canonical label.
                            format_args!(
                                "The encoded data was not valid for encoding {}",
                                if big_endian { "utf-16be" } else { "utf-16le" }
                            ),
                        )
                        .throw());
                }

                // https://encoding.spec.whatwg.org/#concept-td-serialize: only the
                // stream's FIRST code unit is dropped as a BOM. `bom_seen` is only
                // committed here, after the fatal early return, which never reaches it.
                if pre_stripped {
                    self.bom_seen.set(true);
                } else if !self.ignore_bom && !self.bom_seen.get() && !decoded.is_empty() {
                    // The BOM was split across chunks (half of it in `lead_byte`),
                    // so it is only recognizable as the first decoded code unit.
                    self.bom_seen.set(true);
                    if decoded[0] == 0xFEFF {
                        decoded.remove(0);
                    }
                }

                bun_string_jsc::owned_utf16_into_js(global_this, decoded)
            }

            // Every other encoding goes through encoding_rs.
            _ => {
                // The decoder carries streaming state (lead bytes, escape mode),
                // so reuse the one from the previous `{stream: true}` chunk.
                let mut slot = self.codec.borrow_mut();
                let decoder = slot.get_or_insert_with(|| {
                    // Only utf-8/utf-16 have a BOM and those are handled above.
                    self.encoding
                        .encoding_rs()
                        .new_decoder_without_bom_handling()
                });
                let result = self.decode_with_encoding_rs::<FLUSH>(decoder, buffer_slice);

                // A fatal error discards the decoder along with whatever it had
                // pending (a lead byte, the ISO-2022-JP mode), so a later
                // `{stream: true}` chunk starts over instead of continuing from
                // the bad byte. A flushing decode leaves it to `begin_decode`.
                if matches!(result, Err(strings::ToUTF16Error::InvalidByteSequence)) {
                    *slot = None;
                }
                // Released before anything below can allocate or throw.
                drop(slot);

                let decoded = match result {
                    Ok(decoded) => decoded,
                    Err(strings::ToUTF16Error::InvalidByteSequence) => {
                        return Err(global_this
                            .err(
                                jsc::ErrorCode::ERR_ENCODING_INVALID_ENCODED_DATA,
                                format_args!(
                                    "The encoded data was not valid for encoding {}",
                                    bstr::BStr::new(EncodingLabel::get_label(self.encoding))
                                ),
                            )
                            .throw());
                    }
                    Err(strings::ToUTF16Error::OutOfMemory) => {
                        return Err(global_this.throw_memory_allocation_failed());
                    }
                };

                bun_string_jsc::owned_utf16_into_js(global_this, decoded)
            }
        }
    }

    // `#[JsClass]` emits `TextDecoderClass__construct` calling this; do not
    // wrap with `#[bun_jsc::host_fn]` (its Free-kind shim emits a bare
    // `constructor(...)` call that doesn't resolve inside an `impl` block).
    pub(crate) fn constructor(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<*mut TextDecoder> {
        let [encoding_value, options_value] = callframe.arguments_as_array::<2>();

        let mut decoder = TextDecoder::default();

        if encoding_value.is_string() {
            let str = encoding_value.to_utf8(global_this)?;

            match EncodingLabel::which(str.slice()) {
                // https://encoding.spec.whatwg.org/#dom-textdecoder: "If
                // encoding is failure or replacement, then throw a RangeError."
                Some(label) if label != EncodingLabel::Replacement => decoder.encoding = label,
                _ => {
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
            }
        } else if encoding_value.is_undefined() {
            // default to utf-8
            decoder.encoding = EncodingLabel::Utf8;
        } else {
            // WebIDL DOMString coercion: any other label value is stringified
            // and then looked up, so `1` or `{}` reports the same
            // ERR_ENCODING_NOT_SUPPORTED an unknown string label does.
            let converted = bun_core::String::from_js(encoding_value, global_this)?;
            let str = converted.to_utf8();

            // Same rule as the string branch above: "If encoding is failure or
            // replacement, then throw a RangeError."
            if let Some(label) = EncodingLabel::which(str.slice())
                && label != EncodingLabel::Replacement
            {
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
        }

        if !options_value.is_undefined_or_null() {
            // https://webidl.spec.whatwg.org/#es-dictionary step 1
            if !options_value.is_object() {
                return Err(global_this.throw_invalid_argument_type_value(
                    b"options",
                    b"object",
                    options_value,
                ));
            }

            if let Some(fatal) = options_value.get(global_this, b"fatal")? {
                decoder.fatal = fatal.to_boolean();
            }

            if let Some(ignore_bom) = options_value.get(global_this, b"ignoreBOM")? {
                decoder.ignore_bom = ignore_bom.to_boolean();
            }
        }

        Ok(bun_core::heap::into_raw(TextDecoder::new(decoder)))
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
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn TextDecoder__createForStream(
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
    bun_core::heap::into_raw(TextDecoder::new(TextDecoder {
        fatal,
        ignore_bom,
        encoding,
        ..TextDecoder::default()
    }))
}

/// `TextDecoderStream.prototype.encoding`.
#[unsafe(no_mangle)]
pub extern "C" fn TextDecoder__encodingToJS(
    global: &JSGlobalObject,
    encoding: EncodingLabel,
) -> JSValue {
    encoding.to_js(global)
}

#[unsafe(no_mangle)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn TextDecoder__destroyForStream(this: *mut TextDecoder) {
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
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn TextDecoder__decodeForStream(
    this: *mut TextDecoder,
    global: &JSGlobalObject,
    input: *const u8,
    input_len: usize,
    stream: bool,
) -> JSValue {
    // SAFETY: `this` is the live decoder owned by the calling JS cell; driven
    // only from the JS thread, so `&*this` has no mutable alias.
    let this = unsafe { &*this };
    let slice = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: the caller passes a BufferSource's bytes; `slice` does not
        // escape this call.
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    this.begin_decode(stream);
    let result = if stream {
        this.decode_slice::<false>(global, slice)
    } else {
        this.decode_slice::<true>(global, slice)
    };
    result.or_pending_exception()
}
