use bun_jsc::{CallFrame, JSGlobalObject, JSString, JSUint8Array, JSValue, JsResult};
use bun_str::strings;

bun_output::declare_scope!(TextEncoderStreamEncoder, visible);

#[derive(Default)]
#[bun_jsc::JsClass]
pub struct TextEncoderStreamEncoder {
    pending_lead_surrogate: Option<u16>,
}

impl TextEncoderStreamEncoder {
    pub fn finalize(this: *mut Self) {
        // SAFETY: `this` was allocated via Box::into_raw in `constructor`; codegen calls
        // finalize exactly once on the mutator thread during lazy sweep.
        drop(unsafe { Box::from_raw(this) });
    }

    #[bun_jsc::host_fn]
    pub fn constructor(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<Box<TextEncoderStreamEncoder>> {
        Ok(Box::new(TextEncoderStreamEncoder::default()))
    }

    #[bun_jsc::host_fn(method)]
    pub fn encode(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = frame.arguments_old(1);
        if arguments.is_empty() {
            return global.throw_not_enough_arguments(
                "TextEncoderStreamEncoder.encode",
                1,
                arguments.len(),
            );
        }

        let str = arguments[0].get_zig_string(global)?;

        if str.is_16bit() {
            return Ok(this.encode_utf16(global, str.utf16_slice_aligned()));
        }

        Ok(this.encode_latin1(global, str.slice()))
    }

    pub fn encode_without_type_checks(
        this: &mut Self,
        global: &JSGlobalObject,
        input: &JSString,
    ) -> JSValue {
        let str = input.get_zig_string(global);

        if str.is_16bit() {
            return this.encode_utf16(global, str.utf16_slice_aligned());
        }

        this.encode_latin1(global, str.slice())
    }

    fn encode_latin1(&mut self, global: &JSGlobalObject, input: &[u8]) -> JSValue {
        bun_output::scoped_log!(
            TextEncoderStreamEncoder,
            "encodeLatin1: \"{}\"",
            bstr::BStr::new(input)
        );

        if input.is_empty() {
            return JSUint8Array::create_empty(global);
        }

        let prepend_replacement_len: usize = 'prepend_replacement: {
            if self.pending_lead_surrogate.is_some() {
                self.pending_lead_surrogate = None;
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
            // returns the number written; set_len below stays within capacity.
            let result = unsafe {
                let spare = buffer.spare_capacity_mut();
                let spare_slice =
                    core::slice::from_raw_parts_mut(spare.as_mut_ptr().cast::<u8>(), spare.len());
                strings::copy_latin1_into_utf8(spare_slice, remain)
            };

            // SAFETY: result.written bytes were just initialized in spare capacity.
            unsafe { buffer.set_len(buffer.len() + result.written) };
            remain = &remain[result.read..];

            if result.written == 0 && result.read == 0 {
                // TODO(port): Zig threw a JS OOM exception on alloc failure; Rust Vec aborts on OOM.
                buffer.reserve(2);
            } else if buffer.len() == buffer.capacity() && !remain.is_empty() {
                // TODO(port): Zig threw a JS OOM exception on alloc failure; Rust Vec aborts on OOM.
                let target = buffer.len() + remain.len() + 1;
                buffer.reserve(target.saturating_sub(buffer.len()));
            }
        }

        if cfg!(debug_assertions) {
            // wrap in comptime if so simdutf isn't called in a release build here.
            debug_assert!(
                buffer.len()
                    == (bun_simdutf::length::utf8_from_latin1(input) + prepend_replacement_len)
            );
        }

        JSUint8Array::from_bytes(global, buffer)
    }

    fn encode_utf16(&mut self, global: &JSGlobalObject, input: &[u16]) -> JSValue {
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
            if let Some(lead) = self.pending_lead_surrogate {
                self.pending_lead_surrogate = None;
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

        let length = bun_simdutf::length::utf8_from_utf16_le(remain);

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

        // SAFETY: simdutf writes initialized bytes into the spare capacity and returns the count.
        let result = unsafe {
            let spare = buf.spare_capacity_mut();
            let spare_slice =
                core::slice::from_raw_parts_mut(spare.as_mut_ptr().cast::<u8>(), spare.len());
            bun_simdutf::convert::utf16_to_utf8_with_errors_le(remain, spare_slice)
        };

        match result.status {
            bun_simdutf::Status::Success => {
                // SAFETY: result.count bytes were just initialized in spare capacity.
                unsafe { buf.set_len(buf.len() + result.count) };
                JSUint8Array::from_bytes(global, buf)
            }
            _ => {
                // Slow path: there was invalid UTF-16, so we need to convert it without simdutf.
                // TODO(port): Zig threw a JS OOM exception on alloc failure; Rust Vec aborts on OOM.
                let lead_surrogate = strings::to_utf8_list_with_type_bun(&mut buf, remain, true);

                if let Some(pending_lead) = lead_surrogate {
                    self.pending_lead_surrogate = Some(pending_lead);
                    if buf.is_empty() {
                        return JSUint8Array::create_empty(global);
                    }
                }

                JSUint8Array::from_bytes(global, buf)
            }
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn flush(
        this: &mut Self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(Self::flush_body(this, global))
    }

    pub fn flush_without_type_checks(this: &mut Self, global: &JSGlobalObject) -> JSValue {
        Self::flush_body(this, global)
    }

    fn flush_body(this: &mut Self, global: &JSGlobalObject) -> JSValue {
        if this.pending_lead_surrogate.is_none() {
            JSUint8Array::create_empty(global)
        } else {
            JSUint8Array::from_bytes_copy(global, &[0xef, 0xbf, 0xbd])
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/TextEncoderStreamEncoder.zig (211 lines)
//   confidence: medium
//   todos:      5
//   notes:      OOM throws became aborts; simdutf module paths guessed; spare_capacity_mut + set_len for unusedCapacitySlice writes
// ──────────────────────────────────────────────────────────────────────────
