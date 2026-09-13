use core::cell::Cell;

use bun_alloc::AllocError;
use bun_core::strings;
use bun_jsc::{JSGlobalObject, JSUint8Array, JSValue, JsResult};
use bun_ptr::RawSlice;
use bun_simdutf_sys::simdutf;

use crate::webcore::SinkHandle;
use crate::webcore::streams;

bun_output::declare_scope!(TextEncoderStreamEncoder, visible);

/// Held by `JSTextEncoderStream` as a raw `void*` and driven via the
/// `extern "C"` fns below; no JS wrapper class. `scratch` is moved out via
/// `.take()` before any call that could re-enter.
#[derive(Default)]
pub struct TextEncoderStreamEncoder {
    pending_lead_surrogate: Cell<Option<u16>>,
    /// Reusable output buffer for the native-sink path so a
    /// `ByteStream → TextEncoderStream → JSSink` chain allocates nothing per
    /// chunk. Borrowed only after user-JS coercion has run.
    scratch: core::cell::RefCell<Vec<u8>>,
}

impl TextEncoderStreamEncoder {
    fn encode_latin1(&self, global: &JSGlobalObject, input: &[u8]) -> JsResult<JSValue> {
        if input.is_empty() {
            return JSUint8Array::create_empty(global);
        }
        let mut buffer = Vec::new();
        if self.encode_latin1_into(input, &mut buffer).is_err() {
            return Err(global.throw_out_of_memory());
        }
        JSUint8Array::from_bytes(global, buffer.into())
    }

    fn encode_latin1_into(&self, input: &[u8], buffer: &mut Vec<u8>) -> Result<(), AllocError> {
        bun_output::scoped_log!(
            TextEncoderStreamEncoder,
            "encodeLatin1: \"{}\"",
            bstr::BStr::new(input)
        );
        if input.is_empty() {
            return Ok(());
        }

        let prepend_replacement_len: usize = if self.pending_lead_surrogate.take().is_some() {
            // no latin1 surrogate pairs
            3
        } else {
            0
        };
        // In a previous benchmark, counting the length took about as much time as allocating the buffer.
        //
        // Benchmark    Time %    CPU (ns)    Iterations    Ratio
        // 288.00 ms   13.5%    288.00 ms           simdutf::arm64::implementation::convert_latin1_to_utf8(char const*, unsigned long, char*) const
        // 278.00 ms   13.0%    278.00 ms           simdutf::arm64::implementation::utf8_length_from_latin1(char const*, unsigned long) const
        //
        //
        buffer
            .try_reserve(input.len() + prepend_replacement_len)
            .map_err(|_| AllocError)?;
        if prepend_replacement_len > 0 {
            buffer.extend_from_slice(&[0xef, 0xbf, 0xbd]);
        }

        let mut remain = input;
        while !remain.is_empty() {
            let Some(i) = strings::first_non_ascii(remain) else {
                buffer.try_reserve(remain.len()).map_err(|_| AllocError)?;
                buffer.extend_from_slice(remain);
                break;
            };
            let i = i as usize;
            buffer.try_reserve(i + 2).map_err(|_| AllocError)?;
            buffer.extend_from_slice(&remain[..i]);
            remain = &remain[i..];
            // The run of non-ASCII bytes that follows: two UTF-8 bytes each.
            let run = remain.iter().take_while(|&&c| c >= 0x80).count();
            buffer.try_reserve(run * 2).map_err(|_| AllocError)?;
            for &c in &remain[..run] {
                buffer.extend_from_slice(&strings::latin1_to_codepoint_bytes_assume_not_ascii(c));
            }
            remain = &remain[run..];
        }
        debug_assert!(
            buffer.len() == (simdutf::length::utf8::from::latin1(input) + prepend_replacement_len)
        );
        Ok(())
    }

    fn encode_utf16(&self, global: &JSGlobalObject, input: &[u16]) -> JsResult<JSValue> {
        if input.is_empty() {
            return JSUint8Array::create_empty(global);
        }
        let mut buf = Vec::new();
        if self.encode_utf16_into(input, &mut buf).is_err() {
            return Err(global.throw_out_of_memory());
        }
        if buf.is_empty() {
            return JSUint8Array::create_empty(global);
        }
        JSUint8Array::from_bytes(global, buf.into())
    }

    fn encode_utf16_into(&self, input: &[u16], buf: &mut Vec<u8>) -> Result<(), AllocError> {
        bun_output::scoped_log!(
            TextEncoderStreamEncoder,
            "encodeUTF16: \"{}\"",
            bun_core::fmt::utf16(input)
        );
        if input.is_empty() {
            return Ok(());
        }

        #[derive(Clone, Copy)]
        struct Prepend {
            bytes: [u8; 4],
            len: u8,
        }

        impl Prepend {
            const REPLACEMENT: Prepend = Prepend {
                bytes: [0xef, 0xbf, 0xbd, 0],
                len: 3,
            };

            fn from_sequence(seq: [u8; 4], length: u8) -> Prepend {
                Prepend {
                    bytes: seq,
                    len: length,
                }
            }
        }

        let mut remain = input;

        let prepend: Option<Prepend> = 'prepend: {
            if let Some(lead) = self.pending_lead_surrogate.take() {
                let maybe_trail = remain[0];
                if strings::u16_is_trail(maybe_trail) {
                    let converted = strings::utf16_codepoint_with_fffd(&[lead, maybe_trail]);
                    // shouldn't fail because `u16_is_trail` is true and `pending_lead_surrogate` is always
                    // a valid lead.
                    debug_assert!(!converted.fail);

                    let sequence = strings::wtf8_sequence(converted.code_point);

                    remain = &remain[1..];
                    if remain.is_empty() {
                        let width = converted.utf8_width() as usize;
                        buf.try_reserve(width).map_err(|_| AllocError)?;
                        buf.extend_from_slice(&sequence[0..width]);
                        return Ok(());
                    }

                    break 'prepend Some(Prepend::from_sequence(sequence, converted.utf8_width()));
                }

                break 'prepend Some(Prepend::REPLACEMENT);
            }
            break 'prepend None;
        };

        if let Some(pre) = &prepend {
            buf.try_reserve(pre.len as usize).map_err(|_| AllocError)?;
            buf.extend_from_slice(&pre.bytes[0..pre.len as usize]);
        }

        // Reserves the UTF-8 length of `remain`; appends nothing unless the
        // whole of it was valid UTF-16.
        let result = simdutf::convert::utf16::to::utf8::with_errors::le_append(remain, buf)
            .ok_or(AllocError)?;

        if result.status != simdutf::Status::SUCCESS {
            // Slow path: there was invalid UTF-16, so we need to convert it without simdutf.
            let lead_surrogate = strings::to_utf8_list_with_type_bun::<true>(buf, remain)?;
            if let Some(pending_lead) = lead_surrogate {
                self.pending_lead_surrogate.set(Some(pending_lead));
            }
        }
        Ok(())
    }

    fn flush_body(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if self.pending_lead_surrogate.get().is_none() {
            JSUint8Array::create_empty(global)
        } else {
            JSUint8Array::from_bytes_copy(global, &[0xef, 0xbf, 0xbd])
        }
    }
}

// ─── extern "C" surface (JSTextEncoderStream.cpp) ─────────────────────────
// The TextEncoderStream cell owns its encoder directly as a `void*` (no JS
// wrapper cell, no prototype lookup) and drives it through these.

// HOST_EXPORT(TextEncoderStreamEncoder__createForStream, c)
pub fn create_for_stream()
-> Option<Box<crate::webcore::text_encoder_stream_encoder::TextEncoderStreamEncoder>> {
    Some(Box::default())
}

/// The C++ cell cleared its pointer before calling; dropping the box frees the encoder.
// HOST_EXPORT(TextEncoderStreamEncoder__destroyForStream, c)
pub fn destroy_for_stream(
    this: Option<Box<crate::webcore::text_encoder_stream_encoder::TextEncoderStreamEncoder>>,
) {
    drop(this);
}

/// The TextEncoderStream transform step: WebIDL `USVString` conversion of
/// `chunk` (user JS — may throw), then encode. Returns a fresh `Uint8Array`
/// on success, or `JSValue::zero` with the exception pending on `global`.
// HOST_EXPORT(TextEncoderStreamEncoder__encodeForStream, c)
pub fn encode_for_stream(
    this: &crate::webcore::text_encoder_stream_encoder::TextEncoderStreamEncoder,
    global: &JSGlobalObject,
    chunk: JSValue,
) -> JSValue {
    let Ok(str) = chunk.to_js_string_view(global) else {
        return JSValue::ZERO;
    };
    let encoded = if str.is_utf16() {
        this.encode_utf16(global, str.utf16())
    } else {
        this.encode_latin1(global, str.latin1())
    };
    bun_jsc::to_js_host_fn_result(global, encoded)
}

// HOST_EXPORT(TextEncoderStreamEncoder__flushForStream, c)
pub fn flush_for_stream(
    this: &crate::webcore::text_encoder_stream_encoder::TextEncoderStreamEncoder,
    global: &JSGlobalObject,
) -> JSValue {
    bun_jsc::to_js_host_fn_result(global, this.flush_body(global))
}

/// Cap on the reusable scratch buffer so a single huge chunk doesn't pin
/// that much memory for the life of the encoder.
const SCRATCH_CAP: usize = 64 * 1024;

/// Native-sink transform step: encodes `chunk` into the encoder's reusable
/// scratch buffer and writes it straight to the sink, so a
/// `ByteStream → TextEncoderStream → JSSink` chain allocates no
/// `JSUint8Array` per chunk. Returns the sink's `write_bytes` result (see
/// nativeSinkWriteIsBackpressure for the backpressure-signal shapes),
/// `undefined` for an empty output, or `JSValue::zero` with the exception
/// pending on `global`.
// HOST_EXPORT(TextEncoderStreamEncoder__encodeIntoSink, c)
pub fn encode_into_sink(
    this: &crate::webcore::text_encoder_stream_encoder::TextEncoderStreamEncoder,
    global: &JSGlobalObject,
    chunk: JSValue,
    sink: SinkHandle,
) -> JSValue {
    let Ok(str) = chunk.to_js_string_view(global) else {
        return JSValue::ZERO;
    };
    // Move the Vec out of the RefCell for the duration of the sink write so a
    // (theoretical) re-entrant encode-into-sink call cannot BorrowMut-panic.
    let mut buf = this.scratch.take();
    buf.clear();
    let encoded = if str.is_utf16() {
        this.encode_utf16_into(str.utf16(), &mut buf)
    } else {
        this.encode_latin1_into(str.latin1(), &mut buf)
    };
    if encoded.is_err() {
        return global.throw_out_of_memory_value();
    }
    if buf.is_empty() || sink.is_none() {
        this.scratch.replace(buf);
        return JSValue::UNDEFINED;
    }
    let wrote = sink
        .write(&streams::Result::Temporary(RawSlice::new(&buf)))
        .to_js(global);
    if buf.capacity() <= SCRATCH_CAP {
        this.scratch.replace(buf);
    }
    wrote
}

/// Native-sink flush step; see `TextEncoderStreamEncoder__encodeIntoSink` for the return contract.
// HOST_EXPORT(TextEncoderStreamEncoder__flushIntoSink, c)
pub fn flush_into_sink(
    this: &crate::webcore::text_encoder_stream_encoder::TextEncoderStreamEncoder,
    global: &JSGlobalObject,
    sink: SinkHandle,
) -> JSValue {
    if this.pending_lead_surrogate.get().is_none() {
        return JSValue::UNDEFINED;
    }
    const REPLACEMENT: [u8; 3] = [0xef, 0xbf, 0xbd];
    if sink.is_none() {
        return JSValue::UNDEFINED;
    }
    sink.write(&streams::Result::Temporary(RawSlice::new(&REPLACEMENT)))
        .to_js(global)
}
