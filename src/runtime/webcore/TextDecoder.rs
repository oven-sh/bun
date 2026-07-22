use crate::webcore::EncodingLabel;
use crate::webcore::jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsResult,
};
use bun_core::AllocError;
use bun_core::{OwnedString, strings};
use core::cell::Cell;
use core::ptr::NonNull;

use jsc::StringJsc as _;
use jsc::ZigStringJsc as _;
use jsc::text_codec::TextCodec;
use jsc::zig_string::ZigString;

use strings::{u16_is_lead, u16_is_trail};
const UNICODE_REPLACEMENT_U16: u16 = strings::UNICODE_REPLACEMENT as u16;

#[derive(Default, Clone, Copy)]
pub struct Buffered {
    pub buf: [u8; 3],
    pub len: u8,
}

impl Buffered {
    pub(crate) fn slice(&self) -> &[u8] {
        &self.buf[0..self.len as usize]
    }
}

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (all written fields are `Copy`).
#[bun_jsc::JsClass]
pub struct TextDecoder {
    // used for utf8 decoding
    pub buffered: Cell<Buffered>,

    // used for utf16 decoding
    pub lead_byte: Cell<Option<u8>>,
    pub lead_surrogate: Cell<Option<u16>>,

    // https://encoding.spec.whatwg.org/#textdecoder-bom-seen-flag
    // True once the stream's BOM decision is made: its first scalar was either
    // a suppressed U+FEFF or something else, so no later U+FEFF may be dropped.
    bom_seen: Cell<bool>,
    // https://encoding.spec.whatwg.org/#textdecoder-do-not-flush-flag
    // True when the previous `decode()` was a `{stream: true}` chunk, so the
    // next call continues that stream instead of starting a new one.
    do_not_flush: Cell<bool>,

    // WebKit `PAL::TextCodec` for every other encoding. The codec owns the
    // streaming state (lead byte, ISO-2022-JP mode, GB18030 first/second/third),
    // so it must live across `{stream: true}` chunks. Created lazily on first
    // decode, dropped when a flushing decode ends the stream and in `Drop`.
    codec: Cell<Option<NonNull<TextCodec>>>,

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
            bom_seen: Cell::new(false),
            do_not_flush: Cell::new(false),
            codec: Cell::new(None),
            ignore_bom: false,
            fatal: false,
            encoding: EncodingLabel::Utf8,
        }
    }
}

impl Drop for TextDecoder {
    fn drop(&mut self) {
        if let Some(codec) = self.codec.get_mut().take() {
            // SAFETY: `codec` was returned by `TextCodec::create` and has not
            // been freed (the field is cleared whenever we destroy it).
            unsafe { TextCodec::destroy(codec.as_ptr()) }
        }
    }
}

// pub const js = jsc.Codegen.JSTextDecoder;
// pub const toJS / fromJS / fromJSDirect — provided by #[bun_jsc::JsClass] codegen.

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

        // https://encoding.spec.whatwg.org/#dom-textdecoder-decode steps 1-2:
        // a decode() after a flushing one starts a new stream. This runs AFTER
        // the input check: a type error must leave the stream state untouched.
        if !self.do_not_flush.replace(stream) {
            self.bom_seen.set(false);
        }

        // Dispatch the runtime `stream` bool to a const-generic flush parameter.
        if !stream {
            self.decode_slice::<true>(global_this, input_slice)
        } else {
            self.decode_slice::<false>(global_this, input_slice)
        }
    }

    /// DOMJIT fast path for `decode(typedArray)` called with no options object.
    /// A no-options decode is flushing per WHATWG Encoding, matching the slow
    /// path in `decode()` when `stream` is absent.
    pub fn decode_without_type_checks(
        &self,
        global_this: &JSGlobalObject,
        uint8array: &mut JSUint8Array,
    ) -> JsResult<JSValue> {
        // Same stream bookkeeping as `decode()`, with `stream` always false.
        if !self.do_not_flush.replace(false) {
            self.bom_seen.set(false);
        }
        let owned_input;
        let input_slice: &[u8] =
            match JSValue::from_cell::<JSUint8Array>(uint8array).as_array_buffer(global_this) {
                Some(array_buffer) if array_buffer.shared || array_buffer.resizable => {
                    owned_input = Box::<[u8]>::from(array_buffer.slice());
                    &owned_input
                }
                _ => uint8array.slice(),
            };
        self.decode_slice::<true>(global_this, input_slice)
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
                // The boxed slice is a tight allocation (no excess capacity).
                // SAFETY: `bytes` was allocated by the global allocator; `into_raw`
                // transfers ownership of the buffer to JSC's external-string finalizer.
                Ok(unsafe {
                    jsc::zig_string::to_external_u16(
                        bun_core::heap::into_raw(bytes).cast::<u16>(),
                        out.written as usize,
                        global_this,
                    )
                })
            }
            EncodingLabel::Utf8 => {
                // Prepend the partial UTF-8 sequence carried over from the
                // previous `{stream: true}` chunk; the BOM check below must
                // see the JOINED bytes (a BOM may be split across chunks).
                let joined_owned: Box<[u8]>;
                let buffered = self.buffered.get();
                let joined: &[u8] = if buffered.len > 0 {
                    let buffered_len = buffered.len as usize;
                    let mut storage =
                        vec![0u8; buffered_len + buffer_slice.len()].into_boxed_slice();
                    storage[0..buffered_len].copy_from_slice(buffered.slice());
                    storage[buffered_len..].copy_from_slice(buffer_slice);
                    self.buffered.set(Buffered::default());
                    joined_owned = storage;
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
                        return Err(global_this.throw_out_of_memory());
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
                    let len = decoded.len();
                    // `to_external_u16` returns `jsEmptyString` and never
                    // calls `free_global_string` for `len == 0`, so a
                    // zero-length decode (e.g. a buffered partial sequence
                    // with `stream: true`, or all-replaced bytes when
                    // `fatal: false`) would strand the `Vec`'s reserved
                    // backing store. Drop it here and return the canonical
                    // empty string instead.
                    if len == 0 {
                        drop(decoded);
                        return Ok(ZigString::EMPTY.to_js(global_this));
                    }
                    // PERF: Vec::leak may retain excess capacity — profile if it shows up on a hot path.
                    let ptr = decoded.leak().as_mut_ptr();
                    // SAFETY: `ptr` was leaked from a global-allocator `Vec<u16>`;
                    // ownership transfers to JSC's external-string finalizer.
                    return Ok(unsafe { jsc::zig_string::to_external_u16(ptr, len, global_this) });
                }

                // All-ASCII input needed no conversion. `ZigString::init(..).to_js`
                // copies, so `input` may borrow the caller's buffer or `joined_owned`.
                // Experiment: using mimalloc directly is slightly slower
                Ok(ZigString::init(input).to_js(global_this))
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

                if decoded.is_empty() {
                    drop(decoded);
                    return Ok(ZigString::EMPTY.to_js(global_this));
                }

                // Transfer ownership of the backing allocation to JSC; freed via
                // free_global_string -> mi_free when the string is collected.
                let len = decoded.len();
                // PERF: Vec::leak may retain excess capacity — profile if it shows up on a hot path.
                let ptr = decoded.leak().as_mut_ptr();
                // SAFETY: `ptr` was leaked from a global-allocator `Vec<u16>`;
                // ownership transfers to JSC's external-string finalizer.
                Ok(unsafe { jsc::zig_string::to_external_u16(ptr, len, global_this) })
            }

            // Handle all other encodings using WebKit's TextCodec
            _ => {
                let encoding_name = EncodingLabel::get_label(self.encoding);

                // The codec carries streaming state (lead bytes, escape mode),
                // so reuse the one from the previous `{stream: true}` chunk.
                // Create it lazily on first use — matches WebKit's
                // `if (!m_codec) m_codec = newTextCodec(...)`.
                let codec_ptr = match self.codec.get() {
                    Some(ptr) => ptr,
                    None => {
                        let Some(ptr) = TextCodec::create(encoding_name) else {
                            // Fallback to empty string if codec creation fails
                            return Ok(ZigString::init(b"").to_js(global_this));
                        };
                        if !self.ignore_bom {
                            // `TextCodec` is an opaque ZST FFI handle (S008);
                            // `ptr` is live — safe via `opaque_deref_mut`.
                            bun_opaque::opaque_deref_mut(ptr.as_ptr()).strip_bom();
                        }
                        self.codec.set(Some(ptr));
                        ptr
                    }
                };
                // `TextCodec` is an opaque ZST FFI handle (S008); `codec_ptr`
                // is live for this call — safe via `opaque_deref_mut`. The
                // C++ `decode()` does not call back into JS, so no re-entrancy.
                let codec = bun_opaque::opaque_deref_mut(codec_ptr.as_ptr());

                // Decode the data
                let result = codec.decode(buffer_slice, FLUSH, self.fatal);
                // `bun_core::String` is `#[derive(Copy)]` with NO `Drop` impl, and
                // `DecodeResult` has none either — wrap the +1 ref in `OwnedString`
                // so it derefs on scope exit.
                let result_str = OwnedString::new(result.result);

                // A flushing decode ends the stream. Per WHATWG Encoding the
                // next `decode()` starts with a fresh decoder, so drop this
                // codec now — otherwise mode state that the C++ codec does not
                // reset on flush (e.g. `m_iso2022JPDecoderState`) would leak
                // into the next stream.
                if FLUSH {
                    self.codec.set(None);
                    // SAFETY: `codec_ptr` came from `TextCodec::create` above
                    // (or on an earlier chunk) and is freed exactly once here.
                    unsafe { TextCodec::destroy(codec_ptr.as_ptr()) };
                }

                // Check for errors if fatal mode is enabled
                if result.saw_error && self.fatal {
                    // `result_str` drops here, releasing the WTFStringImpl ref.
                    return Err(global_this
                        .err(
                            jsc::ErrorCode::ERR_ENCODING_INVALID_ENCODED_DATA,
                            format_args!(
                                "The encoded data was not valid for encoding {}",
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
            // `bun_core::String` is `#[derive(Copy)]` with NO `Drop` impl, so the +1
            // ref `from_js` returns has to be wrapped to deref on scope exit.
            let converted =
                OwnedString::new(bun_core::String::from_js(encoding_value, global_this)?);
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
