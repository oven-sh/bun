use core::cell::Cell;

use bun_collections::VecExt as _;
use bun_core::strings;
use bun_jsc::{CallFrame, JSGlobalObject, JSString, JSUint8Array, JSValue, JsResult};
use bun_simdutf_sys::simdutf;

bun_output::declare_scope!(TextEncoderStreamEncoder, visible);

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; the single
// mutable field is `Cell<Option<u16>>` (Copy). The codegen shim still emits
// `this: &mut TextEncoderStreamEncoder` until Phase 1 lands — `&mut T`
// auto-derefs to `&T` so the impls below compile against either.
#[derive(Default)]
#[bun_jsc::JsClass]
pub struct TextEncoderStreamEncoder {
    pending_lead_surrogate: Cell<Option<u16>>,
}

impl TextEncoderStreamEncoder {
    // PORT NOTE: no `#[bun_jsc::host_fn]` here — that macro's free-fn arm emits
    // a bare `constructor(...)` which cannot resolve inside an `impl`. The
    // `#[bun_jsc::JsClass]` derive already emits the `<Self>::constructor` shim.
    pub fn constructor(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<Box<TextEncoderStreamEncoder>> {
        Ok(Box::new(TextEncoderStreamEncoder::default()))
    }

    #[bun_jsc::host_fn(method)]
    pub fn encode(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = frame.arguments_old::<1>();
        let arguments = arguments.slice();
        if arguments.is_empty() {
            return Err(global.throw_not_enough_arguments(
                "TextEncoderStreamEncoder.encode",
                1,
                arguments.len(),
            ));
        }

        let str = arguments[0].get_zig_string(global)?;

        if str.is_16bit() {
            return Ok(self.encode_utf16(global, str.utf16_slice_aligned()));
        }

        Ok(self.encode_latin1(global, str.slice()))
    }

    pub fn encode_without_type_checks(&self, global: &JSGlobalObject, input: &JSString) -> JSValue {
        let str = input.get_zig_string(global);

        if str.is_16bit() {
            return self.encode_utf16(global, str.utf16_slice_aligned());
        }

        self.encode_latin1(global, str.slice())
    }

    fn encode_latin1(&self, global: &JSGlobalObject, input: &[u8]) -> JSValue {
        bun_output::scoped_log!(
            TextEncoderStreamEncoder,
            "encodeLatin1: \"{}\"",
            bstr::BStr::new(input)
        );

        if input.is_empty() {
            return JSUint8Array::create_empty(global);
        }

        let prepend_replacement_len: usize = 'prepend_replacement: {
            if self.pending_lead_surrogate.take().is_some() {
                // no latin1 surrogate pairs
                break 'prepend_replacement 3;
            }

            break 'prepend_replacement 0;
        };
        // In a previous benchmark, counting the length took about as much time as allocating the buffer.
        //
        // Benchmark    Time %    CPU (ns)    Iterations    Ratio
        // 288.00 ms   13.5%    288.00 ms           simdutf::arm64::implementation::convert_latin1_to_utf8(char const*, unsigned long, char*) const
        // 278.00 ms   13.0%    278.00 ms           simdutf::arm64::implementation::utf8_length_from_latin1(char const*, unsigned long) const
        //
        //
        // TODO(port): Zig threw a JS OOM exception on alloc failure; Rust Vec aborts on OOM.
        let mut buffer: Vec<u8> = Vec::with_capacity(input.len() + prepend_replacement_len);
        if prepend_replacement_len > 0 {
            // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
            buffer.extend_from_slice(&[0xef, 0xbf, 0xbd]);
        }

        let mut remain = input;
        while !remain.is_empty() {
            // SAFETY: copy_latin1_into_utf8 writes initialized bytes into the spare capacity and
            // returns the number written; fill_spare commits exactly that many.
            let result = unsafe {
                bun_core::vec::fill_spare(&mut buffer, 0, |spare| {
                    let r = strings::copy_latin1_into_utf8(spare, remain);
                    (r.written as usize, r)
                })
            };
            remain = &remain[result.read as usize..];

            if result.written == 0 && result.read == 0 {
                // TODO(port): Zig threw a JS OOM exception on alloc failure; Rust Vec aborts on OOM.
                buffer.reserve(2);
            } else if buffer.len() == buffer.capacity() && !remain.is_empty() {
                // TODO(port): Zig threw a JS OOM exception on alloc failure; Rust Vec aborts on OOM.
                buffer.ensure_total_capacity(buffer.len() + remain.len() + 1);
            }
        }

        if cfg!(debug_assertions) {
            // wrap in comptime if so simdutf isn't called in a release build here.
            debug_assert!(
                buffer.len()
                    == (simdutf::length::utf8::from::latin1(input) + prepend_replacement_len)
            );
        }

        JSUint8Array::from_bytes(global, buffer.into())
    }

    fn encode_utf16(&self, global: &JSGlobalObject, input: &[u16]) -> JSValue {
        bun_output::scoped_log!(
            TextEncoderStreamEncoder,
            "encodeUTF16: \"{}\"",
            bun_core::fmt::utf16(input)
        );

        if input.is_empty() {
            return JSUint8Array::create_empty(global);
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
                        return JSUint8Array::from_bytes_copy(
                            global,
                            &sequence[0..converted.utf8_width() as usize],
                        );
                    }

                    break 'prepend Some(Prepend::from_sequence(sequence, converted.utf8_width()));
                }

                break 'prepend Some(Prepend::REPLACEMENT);
            }
            break 'prepend None;
        };

        let length = simdutf::length::utf8::from::utf16::le(remain);

        // TODO(port): Zig threw a JS OOM exception on alloc failure; Rust Vec aborts on OOM.
        let mut buf: Vec<u8> = Vec::with_capacity(
            length
                + match prepend {
                    Some(pre) => pre.len as usize,
                    None => 0,
                },
        );

        if let Some(pre) = &prepend {
            // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
            buf.extend_from_slice(&pre.bytes[0..pre.len as usize]);
        }

        // SAFETY: simdutf writes initialized bytes into the spare capacity and returns the
        // count; on non-SUCCESS we commit 0 and fall through to the slow path.
        let result = unsafe {
            bun_core::vec::fill_spare(&mut buf, 0, |spare| {
                let r = simdutf::convert::utf16::to::utf8::with_errors::le(remain, spare);
                (
                    if r.status == simdutf::Status::SUCCESS {
                        r.count
                    } else {
                        0
                    },
                    r,
                )
            })
        };

        if result.status == simdutf::Status::SUCCESS {
            JSUint8Array::from_bytes(global, buf.into())
        } else {
            // Slow path: there was invalid UTF-16, so we need to convert it without simdutf.
            let lead_surrogate = match strings::to_utf8_list_with_type_bun::<true>(&mut buf, remain)
            {
                Ok(v) => v,
                Err(_) => return global.throw_out_of_memory_value(),
            };

            if let Some(pending_lead) = lead_surrogate {
                self.pending_lead_surrogate.set(Some(pending_lead));
                if buf.is_empty() {
                    return JSUint8Array::create_empty(global);
                }
            }

            JSUint8Array::from_bytes(global, buf.into())
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn flush(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(self.flush_body(global))
    }

    pub fn flush_without_type_checks(&self, global: &JSGlobalObject) -> JSValue {
        self.flush_body(global)
    }

    fn flush_body(&self, global: &JSGlobalObject) -> JSValue {
        if self.pending_lead_surrogate.get().is_none() {
            JSUint8Array::create_empty(global)
        } else {
            JSUint8Array::from_bytes_copy(global, &[0xef, 0xbf, 0xbd])
        }
    }
}

// ported from: src/runtime/webcore/TextEncoderStreamEncoder.zig
