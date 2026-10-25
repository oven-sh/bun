use core::ffi::{c_char, c_int};

use bun_zlib as c; // bun.zlib — C zlib FFI (NodeMode, z_stream, ReturnCode, FlushValue, deflate*, inflate*)

use crate::node::node_zlib_binding::Error;

mod _impl {
    use super::*;
    use core::cell::Cell;

    use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
    use bun_jsc::{JSGlobalObject, JsCell, JsResult, StrongOptional, WorkPoolTask};
    use bun_ptr::RefPtr;

    use crate::node::node_zlib_binding::{CompressionStreamImpl as _, CountedKeepAlive};
    use crate::node::util::validators;

    /// Placeholder for `WorkPoolTask.callback` — overwritten before scheduling
    /// (see `CompressionStreamImpl::write` in node_zlib_binding.rs).
    /// Safe fn: coerces to the `WorkPoolTask.callback` field type at the
    /// struct-init site; the body never dereferences the pointer.
    fn noop_task_callback(_task: *mut WorkPoolTask) {}

    #[derive(bun_ptr::CellRefCounted)]
    pub(crate) struct NativeZlib {
        pub(crate) ref_count: Cell<u32>,
        // The global outlives this payload. `BackRef`
        // centralises the single unsafe deref so the trait impl is safe.
        pub global_this: bun_ptr::BackRef<JSGlobalObject>,
        /// How the pool thread delivers a finished write to the VM.
        pub ticket: Cell<Option<bun_jsc::Ticket>>,
        pub stream: JsCell<Context>,
        pub poll_ref: JsCell<CountedKeepAlive>,
        pub this_value: JsCell<StrongOptional>, // jsc.Strong.Optional
        pub write_in_progress: Cell<bool>,
        /// bit 0: the pending input's ArrayBuffer is pinned; bit 1: the pending output's. A held bufferless view sets neither.
        pub pinned_buffers: Cell<u8>,
        /// Copy of the pending `write()`'s input, if a pin can't keep the input mapped.
        pub input_copy: JsCell<crate::node::node_zlib_binding::InputCopy>,
        pub pending_close: Cell<bool>,
        pub closed: Cell<bool>,
        pub task: JsCell<WorkPoolTask>,
    }

    // `CompressionStreamImpl` (node_zlib_binding.rs) has write, writeSync, reset, close and onerror.

    impl NativeZlib {
        pub(crate) fn constructor(cx: &mut JsScope<'_>, mode: u8) -> *mut Self {
            let stream = Context {
                mode: c::NodeMode::from_int(mode),
                ..Default::default()
            };
            RefPtr::new(Self {
                ref_count: Cell::new(1),
                global_this: bun_ptr::BackRef::new(cx.global()),
                ticket: Cell::new(None),
                stream: JsCell::new(stream),
                poll_ref: JsCell::new(CountedKeepAlive::default()),
                this_value: JsCell::new(StrongOptional::empty()),
                write_in_progress: Cell::new(false),
                pinned_buffers: Cell::new(0),
                input_copy: JsCell::new(Default::default()),
                pending_close: Cell::new(false),
                closed: Cell::new(false),
                task: JsCell::new(WorkPoolTask {
                    node: Default::default(),
                    callback: noop_task_callback,
                }),
            })
            .into_raw()
        }

        //// adding this didnt help much but leaving it here to compare the number with later
        pub(crate) fn estimated_size(&self) -> usize {
            // @sizeOf(@cImport(@cInclude("deflate.h")).internal_state) @ cloudflare/zlib @ 92530568d2c128b4432467b76a3b54d93d6350bd
            const INTERNAL_STATE_SIZE: usize = 3309;
            INTERNAL_STATE_SIZE
        }

        pub(crate) fn init(
            &self,
            this_value: JsWrapper<'_, Self>,
            cx: &mut JsScope<'_>,
            window_bits: i32,
            level: i32,
            mem_level: i32,
            strategy: i32,
            write_state: JsLocal<'_>,
            process_callback: JsLocal<'_>,
            dictionary: JsLocal<'_>,
        ) -> JsResult<()> {
            let global = cx.global();
            let this_value = this_value.to_js();
            // Racing an in-flight async write would alias `&mut Context`
            // across threads; a closed `Context` cannot be re-initialized.
            self.throw_unless_idle(global)?;

            // `flush_write_result` writes two u32s into this array, so the
            // caller-supplied array must hold at least 2 elements.
            let write_result_value = write_state.to_js();
            let Some(mut write_result_buf) = write_result_value.as_array_buffer(global) else {
                return Err(global.throw_invalid_argument_type_value(
                    "writeResult",
                    "Uint32Array",
                    write_result_value,
                ));
            };
            if write_result_buf.typed_array_type != bun_jsc::JSType::Uint32Array {
                return Err(global.throw_invalid_argument_type_value(
                    "writeResult",
                    "Uint32Array",
                    write_result_value,
                ));
            }
            let write_result_slice = write_result_buf.as_u32();
            if write_result_slice.len() < 2 {
                return Err(global
                    .err(
                        bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("writeResult must be a Uint32Array with at least 2 elements"),
                    )
                    .throw());
            }
            let write_callback =
                validators::validate_function(global, "writeCallback", process_callback.to_js())?;
            // Bind the ArrayBuffer view to a local so the borrowed byte_slice() outlives
            // the call to `stream.init` below (E0716 otherwise).
            let dictionary_buf;
            let dictionary = if dictionary.is_undefined() {
                None
            } else {
                let dictionary_value = dictionary.to_js();
                dictionary_buf = match dictionary_value.as_array_buffer(global) {
                    Some(buf) => buf,
                    None => {
                        return Err(global.throw_invalid_argument_type_value(
                            "dictionary",
                            "Buffer, TypedArray, or DataView",
                            dictionary_value,
                        ));
                    }
                };
                // `deflateSetDictionary`/`inflateSetDictionary` take a `uInt`
                // length; reject anything larger before `Context::init` copies it.
                if dictionary_buf.byte_len > u32::MAX as usize {
                    return Err(global.throw_range_error(
                        dictionary_buf.byte_len as i64,
                        bun_jsc::RangeErrorOptions {
                            field_name: b"dictionary.byteLength",
                            max: i64::from(u32::MAX),
                            ..Default::default()
                        },
                    ));
                }
                Some(dictionary_buf.byte_slice())
            };

            js::write_result_set_cached(this_value, global, write_result_value);
            js::write_callback_set_cached(
                this_value,
                global,
                write_callback.with_async_context_if_needed(global),
            );

            self.stream
                .with_mut(|s| s.init(level, window_bits, mem_level, strategy, dictionary));
            // `Context::init` leaves `mode` at `NONE` when `deflateInit2_` /
            // `inflateInit2_` rejects its arguments; mark the wrapper closed so
            // the next operation is rejected instead of re-entering `NONE`.
            if self.stream.with_mut(|s| s.mode == c::NodeMode::NONE) {
                self.closed.set(true);
            }

            Ok(())
        }

        pub(crate) fn params(
            &self,
            this_value: JsWrapper<'_, Self>,
            cx: &mut JsScope<'_>,
            level: i32,
            strategy: i32,
        ) -> JsResult<()> {
            let global = cx.global();
            // `set_params` calls `deflateParams` on the same `z_stream` an
            // in-flight async write's `deflate()` is using.
            self.throw_unless_idle(global)?;

            let err = self.stream.with_mut(|s| s.set_params(level, strategy));
            if err.is_error() {
                // `&self` over `Cell`/`JsCell` fields — `emit_error` →
                // `run_callback` may re-enter `close()`/`reset()` via a fresh
                // `&Self`; interior mutability makes that sound.
                self.emit_error(global, this_value.to_js(), err);
            }
            Ok(())
        }
    }

    // `poll_ref` and `this_value` (Strong) clean up via their own Drop impls.
    impl Drop for NativeZlib {
        fn drop(&mut self) {
            self.stream.with_mut(|s| s.close());
        }
    }

    crate::__impl_compression_stream!(NativeZlib, super::Context, js_NativeZlib);
} // mod _impl

pub(crate) use _impl::NativeZlib;

// ─── non-JSC body (real): zlib stream Context ─────────────────────────────

pub(crate) struct Context {
    pub(crate) mode: c::NodeMode,
    pub(crate) state: c::ZStream,
    pub(crate) err: c::ReturnCode,
    pub flush: c::FlushValue,
    pub dictionary: Vec<u8>,
    pub(crate) gzip_id_bytes_read: u8,
}

impl Default for Context {
    fn default() -> Self {
        Self {
            mode: c::NodeMode::NONE,
            state: c::ZStream::new(),
            err: c::ReturnCode::Ok,
            flush: c::FlushValue::NoFlush,
            dictionary: Vec::new(),
            gzip_id_bytes_read: 0,
        }
    }
}

impl Context {
    const GZIP_HEADER_ID1: u8 = 0x1f;
    const GZIP_HEADER_ID2: u8 = 0x8b;

    #[inline]
    fn dictionary(&self) -> &[u8] {
        &self.dictionary
    }

    pub(crate) fn init(
        &mut self,
        level: c_int,
        window_bits: c_int,
        mem_level: c_int,
        strategy: c_int,
        dictionary: Option<&[u8]>,
    ) {
        use c::NodeMode::*;
        self.flush = c::FlushValue::NoFlush;
        self.err = c::ReturnCode::Ok;

        let window_bits_actual = match self.mode {
            NONE => unreachable!(),
            DEFLATE | INFLATE => window_bits,
            GZIP | GUNZIP => window_bits + 16,
            UNZIP => window_bits + 32,
            DEFLATERAW | INFLATERAW => -window_bits,
            BROTLI_DECODE | BROTLI_ENCODE => unreachable!(),
            ZSTD_COMPRESS | ZSTD_DECOMPRESS => unreachable!(),
        };

        self.dictionary = match dictionary {
            Some(d) => d.to_vec(),
            None => Vec::new(),
        };

        match self.mode {
            NONE => unreachable!(),
            DEFLATE | GZIP | DEFLATERAW => {
                self.err =
                    self.state
                        .deflate_init(level, 8, window_bits_actual, mem_level, strategy);
            }
            INFLATE | GUNZIP | UNZIP | INFLATERAW => {
                self.err = self.state.inflate_init(window_bits_actual);
            }
            BROTLI_DECODE | BROTLI_ENCODE => unreachable!(),
            ZSTD_COMPRESS | ZSTD_DECOMPRESS => unreachable!(),
        }
        if self.err != c::ReturnCode::Ok {
            self.mode = NONE;
            return;
        }

        let _ = self.set_dictionary();
    }

    pub(crate) fn set_dictionary(&mut self) -> Error {
        use c::NodeMode::*;
        // Reshaped for borrowck — capture raw ptr/len before
        // re-borrowing `self.state` mutably.
        let (dict_ptr, dict_len) = {
            let dict = self.dictionary();
            if dict.is_empty() {
                return Error::ok();
            }
            (dict.as_ptr(), u32::try_from(dict.len()).expect("int cast"))
        };
        self.err = c::ReturnCode::Ok;
        match self.mode {
            // SAFETY: FFI — state is an initialized deflate stream; dict_ptr/dict_len borrow the Context-owned dictionary copy.
            DEFLATE | DEFLATERAW => unsafe {
                self.err = c::deflateSetDictionary(self.state.as_ptr(), dict_ptr, dict_len);
            },
            // SAFETY: FFI — state is an initialized inflate stream; dict_ptr/dict_len borrow the Context-owned dictionary copy.
            INFLATERAW => unsafe {
                self.err = c::inflateSetDictionary(self.state.as_ptr(), dict_ptr, dict_len);
            },
            _ => {}
        }
        if self.err != c::ReturnCode::Ok {
            return self.error_for_message(c"Failed to set dictionary");
        }
        Error::ok()
    }

    pub(crate) fn set_params(&mut self, level: c_int, strategy: c_int) -> Error {
        use c::NodeMode::*;
        self.err = c::ReturnCode::Ok;
        match self.mode {
            DEFLATE | DEFLATERAW => {
                self.set_buffers(None, Some(&mut []));
                // SAFETY: FFI — state is an initialized deflate stream; avail_in/avail_out
                // are 0 (next_out non-null) so the internal deflate(Z_BLOCK) returns
                // Z_BUF_ERROR without touching any previously installed caller buffer.
                unsafe {
                    self.err = c::deflateParams(self.state.as_ptr(), level, strategy);
                }
            }
            _ => {}
        }
        if self.err != c::ReturnCode::Ok && self.err != c::ReturnCode::BufError {
            return self.error_for_message(c"Failed to set parameters");
        }
        Error::ok()
    }

    fn error_for_message(&self, default: &'static core::ffi::CStr) -> Error {
        let mut message: *const c_char = default.as_ptr();
        if !self.state.err_msg().is_null() {
            message = self.state.err_msg();
        }
        Error {
            msg: message,
            err: self.err as c_int,
            code: match self.err {
                c::ReturnCode::Ok => c"Z_OK",
                c::ReturnCode::StreamEnd => c"Z_STREAM_END",
                c::ReturnCode::NeedDict => c"Z_NEED_DICT",
                c::ReturnCode::ErrNo => c"Z_ERRNO",
                c::ReturnCode::StreamError => c"Z_STREAM_ERROR",
                c::ReturnCode::DataError => c"Z_DATA_ERROR",
                c::ReturnCode::MemError => c"Z_MEM_ERROR",
                c::ReturnCode::BufError => c"Z_BUF_ERROR",
                c::ReturnCode::VersionError => c"Z_VERSION_ERROR",
            }
            .as_ptr(),
        }
    }

    pub(crate) fn reset(&mut self) -> Error {
        use c::NodeMode::*;
        self.err = c::ReturnCode::Ok;
        match self.mode {
            // SAFETY: FFI — state was initialized as a deflate stream by deflateInit2_.
            DEFLATE | DEFLATERAW | GZIP => unsafe {
                self.err = c::deflateReset(self.state.as_ptr());
            },
            // SAFETY: FFI — state was initialized as an inflate stream by inflateInit2_.
            INFLATE | INFLATERAW | GUNZIP => unsafe {
                self.err = c::inflateReset(self.state.as_ptr());
            },
            _ => {}
        }
        if self.err != c::ReturnCode::Ok {
            return self.error_for_message(c"Failed to reset stream");
        }
        self.set_dictionary()
    }

    pub(crate) fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>) {
        let (next_in, avail_in) = match in_ {
            Some(p) => (p.as_ptr(), u32::try_from(p.len()).expect("int cast")),
            None => (core::ptr::null(), 0),
        };
        self.state.set_input(next_in, avail_in);
        let (next_out, avail_out) = match out {
            Some(p) => (p.as_mut_ptr(), u32::try_from(p.len()).expect("int cast")),
            None => (core::ptr::null_mut(), 0),
        };
        self.state.set_output(next_out, avail_out);
    }

    pub(crate) fn flush_value_is_valid(flush: u32) -> bool {
        flush <= 6
    }

    pub(crate) fn set_flush(&mut self, flush: c_int) {
        // Checked conversion;
        // transmuting an arbitrary c_int into a Rust enum is UB.
        self.flush = match flush {
            0 => c::FlushValue::NoFlush,
            1 => c::FlushValue::PartialFlush,
            2 => c::FlushValue::SyncFlush,
            3 => c::FlushValue::FullFlush,
            4 => c::FlushValue::Finish,
            5 => c::FlushValue::Block,
            6 => c::FlushValue::Trees,
            _ => unreachable!("invalid zlib flush value: {flush}"),
        };
    }

    pub(crate) fn do_work(&mut self) {
        use c::NodeMode::*;
        let mut next_expected_header_byte: Option<*const u8> = None;

        // If the avail_out is left at 0, then it means that it ran out
        // of room.  If there was avail_out left over, then it means
        // that all of the input was consumed.
        match self.mode {
            DEFLATE | GZIP | DEFLATERAW => {
                return self.do_work_deflate();
            }
            UNZIP => {
                if self.state.avail_in() > 0 {
                    next_expected_header_byte = Some(self.state.next_in());
                }
                if self.gzip_id_bytes_read == 0 {
                    let Some(p) = next_expected_header_byte else {
                        return self.do_work_inflate();
                    };
                    // SAFETY: avail_in > 0 was checked above, so next_in points to ≥1 byte.
                    if unsafe { *p } == Self::GZIP_HEADER_ID1 {
                        self.gzip_id_bytes_read = 1;
                        // SAFETY: advancing within the input buffer; only dereferenced
                        // below after confirming avail_in > 1.
                        next_expected_header_byte = Some(unsafe { p.add(1) });
                        if self.state.avail_in() == 1 {
                            // The only available byte was already read.
                            return self.do_work_inflate();
                        }
                    } else {
                        self.mode = INFLATE;
                        return self.do_work_inflate();
                    }
                }
                if self.gzip_id_bytes_read == 1 {
                    let Some(p) = next_expected_header_byte else {
                        return self.do_work_inflate();
                    };
                    // SAFETY: either avail_in > 1 (fallthrough above) or avail_in > 0
                    // on a fresh call with gzip_id_bytes_read == 1.
                    if unsafe { *p } == Self::GZIP_HEADER_ID2 {
                        self.gzip_id_bytes_read = 2;
                        self.mode = GUNZIP;
                    } else {
                        self.mode = INFLATE;
                    }
                    return self.do_work_inflate();
                }
                debug_assert!(false); // invalid number of gzip magic number bytes read
            }
            INFLATE | GUNZIP | INFLATERAW => {
                return self.do_work_inflate();
            }
            NONE => {}
            BROTLI_ENCODE | BROTLI_DECODE => {}
            ZSTD_COMPRESS | ZSTD_DECOMPRESS => {}
        }
    }

    fn do_work_deflate(&mut self) {
        // SAFETY: FFI — state is an initialized deflate stream.
        self.err = unsafe { c::deflate(self.state.as_ptr(), self.flush) };
    }

    fn do_work_inflate(&mut self) {
        // SAFETY: FFI — state is an initialized inflate stream.
        self.err = unsafe { c::inflate(self.state.as_ptr(), self.flush) };

        if self.mode != c::NodeMode::INFLATERAW
            && self.err == c::ReturnCode::NeedDict
            && !self.dictionary().is_empty()
        {
            // Reshaped for borrowck — capture raw ptr/len before
            // re-borrowing `self.state` mutably.
            let (dict_ptr, dict_len) = {
                let dict = self.dictionary();
                (dict.as_ptr(), u32::try_from(dict.len()).expect("int cast"))
            };
            // SAFETY: FFI — state is an initialized inflate stream; dict is the Context-owned copy.
            self.err = unsafe { c::inflateSetDictionary(self.state.as_ptr(), dict_ptr, dict_len) };

            if self.err == c::ReturnCode::Ok {
                // SAFETY: FFI — state is an initialized inflate stream.
                self.err = unsafe { c::inflate(self.state.as_ptr(), self.flush) };
            } else if self.err == c::ReturnCode::DataError {
                self.err = c::ReturnCode::NeedDict;
            }
        }
        while self.state.avail_in() > 0
            && self.mode == c::NodeMode::GUNZIP
            && self.err == c::ReturnCode::StreamEnd
            // SAFETY: avail_in > 0 ⇒ next_in points to ≥1 readable byte.
            && unsafe { *self.state.next_in() } != 0
        {
            // Bytes remain in input buffer. Perhaps this is another compressed member in the same archive, or just trailing garbage.
            // Trailing zero bytes are okay, though, since they are frequently used for padding.
            let _ = self.reset();
            // SAFETY: FFI — state was just re-initialized by reset().
            self.err = unsafe { c::inflate(self.state.as_ptr(), self.flush) };
        }
    }

    pub(crate) fn update_write_result(&self, avail_in: &mut u32, avail_out: &mut u32) {
        *avail_in = self.state.avail_in();
        *avail_out = self.state.avail_out();
    }

    pub(crate) fn get_error_info(&self) -> Error {
        match self.err {
            c::ReturnCode::Ok | c::ReturnCode::BufError => {
                if self.state.avail_out() != 0 && self.flush == c::FlushValue::Finish {
                    return self.error_for_message(c"unexpected end of file");
                }
            }
            c::ReturnCode::StreamEnd => {}
            c::ReturnCode::NeedDict => {
                if self.dictionary().is_empty() {
                    return self.error_for_message(c"Missing dictionary");
                } else {
                    return self.error_for_message(c"Bad dictionary");
                }
            }
            _ => {
                return self.error_for_message(c"Zlib error");
            }
        }
        Error::ok()
    }

    pub(crate) fn close(&mut self) {
        use c::NodeMode::*;
        let mut status = c::ReturnCode::Ok;
        match self.mode {
            // SAFETY: FFI — state was initialized as a deflate stream by deflateInit2_.
            DEFLATE | DEFLATERAW | GZIP => unsafe {
                status = c::deflateEnd(self.state.as_ptr());
            },
            // SAFETY: FFI — state was initialized as an inflate stream by inflateInit2_.
            INFLATE | INFLATERAW | GUNZIP | UNZIP => unsafe {
                status = c::inflateEnd(self.state.as_ptr());
            },
            NONE => {}
            BROTLI_ENCODE | BROTLI_DECODE => {}
            ZSTD_COMPRESS | ZSTD_DECOMPRESS => {}
        }
        // Ok: normal. DataError: pending output discarded by inflateEnd.
        // StreamError: a handle whose init() threw before deflateInit2_/
        // inflateInit2_ ran, so the zeroed z_stream has nothing to free.
        debug_assert!(
            status == c::ReturnCode::Ok
                || status == c::ReturnCode::DataError
                || status == c::ReturnCode::StreamError
        );
        self.mode = NONE;
    }
}
