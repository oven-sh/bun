use core::ffi::{CStr, c_int};

use bun_core::vec::BorrowedCursor;
use bun_zlib as c;

use crate::node::node_zlib_binding::{CompressionContext, Error};

mod _impl {
    use super::*;
    use core::cell::Cell;

    use bun_jsc::JsResult;
    use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};

    use crate::node::node_zlib_binding::{CompressionStreamImpl as _, Stream};
    use crate::node::util::validators;

    pub(crate) struct NativeZlib {
        stream: Cell<Option<Box<Stream<Context>>>>,
        pending_close: Cell<bool>,
        closed: Cell<bool>,
    }

    // `CompressionStreamImpl` (node_zlib_binding.rs) has write, writeSync, reset, close and onerror.

    impl NativeZlib {
        pub(crate) fn constructor(mode: u8) -> Self {
            Self {
                stream: Cell::new(Some(Stream::new(Context::new(c::NodeMode::from_int(mode))))),
                pending_close: Cell::new(false),
                closed: Cell::new(false),
            }
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
            // the call to `Context::init` below (E0716 otherwise).
            let dictionary_buf;
            let dictionary = if dictionary.is_undefined() {
                &[]
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
                dictionary_buf.byte_slice()
            };

            js::write_result_set_cached(this_value, global, write_result_value);
            js::write_callback_set_cached(
                this_value,
                global,
                write_callback.with_async_context_if_needed(global),
            );

            let result = self.borrow_idle_stream(global)?.context.init(
                level,
                window_bits,
                mem_level,
                strategy,
                dictionary,
            );
            if result.is_err() {
                self.close();
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
            let result = self
                .borrow_idle_stream(global)?
                .context
                .set_params(level, strategy);
            if let Err(err) = result {
                self.emit_error(global, this_value.to_js(), &err);
            }
            Ok(())
        }
    }

    crate::__impl_compression_stream!(NativeZlib, super::Context, js_NativeZlib);
} // mod _impl

pub(crate) use _impl::NativeZlib;

// ─── non-JSC body (real): zlib stream Context ─────────────────────────────

enum State {
    Deflate(c::DeflateEncoder),
    Inflate(c::InflateDecoder),
}

pub(crate) struct Context {
    mode: c::NodeMode,
    /// `None` until `init()`: what would call zlib fails with `StreamError`.
    state: Option<State>,
    err: c::ReturnCode,
    flush: c::FlushValue,
    dictionary: Vec<u8>,
    gzip_id_bytes_read: u8,
    avail_in: usize,
    avail_out: usize,
}

impl Context {
    const GZIP_HEADER_ID1: u8 = 0x1f;
    const GZIP_HEADER_ID2: u8 = 0x8b;

    fn new(mode: c::NodeMode) -> Self {
        Self {
            mode,
            state: None,
            err: c::ReturnCode::Ok,
            flush: c::FlushValue::NoFlush,
            dictionary: Vec::new(),
            gzip_id_bytes_read: 0,
            avail_in: 0,
            avail_out: 0,
        }
    }

    fn init(
        &mut self,
        level: c_int,
        window_bits: c_int,
        mem_level: c_int,
        strategy: c_int,
        dictionary: &[u8],
    ) -> Result<(), c::ZlibError> {
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

        self.dictionary = dictionary.to_vec();

        // `init` is JS-reachable twice on one handle: free the previous state first.
        self.state = None;
        self.state = Some(match self.mode {
            DEFLATE | GZIP | DEFLATERAW => State::Deflate(c::DeflateEncoder::new(
                level,
                window_bits_actual,
                mem_level,
                strategy,
            )?),
            _ => State::Inflate(c::InflateDecoder::new(window_bits_actual)?),
        });

        let _ = self.set_dictionary();
        Ok(())
    }

    fn set_dictionary(&mut self) -> Result<(), Error> {
        use c::NodeMode::*;
        if self.dictionary.is_empty() {
            return Ok(());
        }
        self.err = match (self.mode, &mut self.state) {
            (DEFLATE | DEFLATERAW, Some(State::Deflate(encoder))) => {
                encoder.set_dictionary(&self.dictionary)
            }
            (INFLATERAW, Some(State::Inflate(decoder))) => decoder.set_dictionary(&self.dictionary),
            _ => c::ReturnCode::Ok,
        };
        if self.err != c::ReturnCode::Ok {
            return Err(self.error_for_message(c"Failed to set dictionary"));
        }
        Ok(())
    }

    fn set_params(&mut self, level: c_int, strategy: c_int) -> Result<(), Error> {
        use c::NodeMode::*;
        self.err = match (self.mode, &mut self.state) {
            (DEFLATE | DEFLATERAW, Some(State::Deflate(encoder))) => {
                encoder.set_params(level, strategy)
            }
            (DEFLATE | DEFLATERAW, _) => c::ReturnCode::StreamError,
            _ => c::ReturnCode::Ok,
        };
        if self.err != c::ReturnCode::Ok && self.err != c::ReturnCode::BufError {
            return Err(self.error_for_message(c"Failed to set parameters"));
        }
        Ok(())
    }

    fn error_for_message(&self, default: &'static CStr) -> Error {
        let message = match &self.state {
            Some(State::Deflate(encoder)) => encoder.error_message(),
            Some(State::Inflate(decoder)) => decoder.error_message(),
            None => None,
        };
        Error {
            msg: message.unwrap_or(default),
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
            },
        }
    }

    /// Resolves `UNZIP` to `GUNZIP` or `INFLATE` once the first bytes tell which it is.
    fn detect_gzip_header(&mut self, input: &[u8]) {
        let mut header = input.iter().copied();
        if self.gzip_id_bytes_read == 0 {
            match header.next() {
                Some(Self::GZIP_HEADER_ID1) => self.gzip_id_bytes_read = 1,
                Some(_) => {
                    self.mode = c::NodeMode::INFLATE;
                    return;
                }
                None => return,
            }
        }
        match header.next() {
            Some(Self::GZIP_HEADER_ID2) => self.mode = c::NodeMode::GUNZIP,
            Some(_) => self.mode = c::NodeMode::INFLATE,
            None => {}
        }
    }
}

impl CompressionContext for Context {
    fn reset(&mut self) -> Result<(), Error> {
        self.err = match (self.mode, &mut self.state) {
            (c::NodeMode::UNZIP, _) => c::ReturnCode::Ok,
            (_, Some(State::Deflate(encoder))) => encoder.reset(),
            (_, Some(State::Inflate(decoder))) => decoder.reset(),
            (_, None) => c::ReturnCode::StreamError,
        };
        if self.err != c::ReturnCode::Ok {
            return Err(self.error_for_message(c"Failed to reset stream"));
        }
        self.set_dictionary()
    }

    fn flush_value_is_valid(flush: u32) -> bool {
        flush <= 6
    }

    fn set_flush(&mut self, flush: c_int) {
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

    fn do_work(&mut self, mut input: &[u8], mut out: BorrowedCursor<'_, u8>) {
        if self.mode == c::NodeMode::UNZIP {
            self.detect_gzip_header(input);
        }

        match &mut self.state {
            None => self.err = c::ReturnCode::StreamError,
            Some(State::Deflate(encoder)) => {
                let consumed;
                (consumed, self.err) = encoder.step_into(input, out.reborrow(), self.flush);
                input = &input[consumed..];
            }
            Some(State::Inflate(decoder)) => {
                let mut step = |decoder: &mut c::InflateDecoder, input: &mut &[u8]| {
                    let (consumed, err) = decoder.step_into(input, out.reborrow(), self.flush);
                    *input = &input[consumed..];
                    err
                };
                self.err = step(decoder, &mut input);

                if self.mode != c::NodeMode::INFLATERAW
                    && self.err == c::ReturnCode::NeedDict
                    && !self.dictionary.is_empty()
                {
                    self.err = match decoder.set_dictionary(&self.dictionary) {
                        c::ReturnCode::Ok => step(decoder, &mut input),
                        c::ReturnCode::DataError => c::ReturnCode::NeedDict,
                        err => err,
                    };
                }
                while self.mode == c::NodeMode::GUNZIP
                    && self.err == c::ReturnCode::StreamEnd
                    && input.first().is_some_and(|&byte| byte != 0)
                {
                    // Another member of the archive, or trailing garbage. Trailing zero bytes are padding.
                    let _ = decoder.reset();
                    self.err = step(decoder, &mut input);
                }
            }
        }

        self.avail_in = input.len();
        self.avail_out = out.capacity();
    }

    fn write_result(&self) -> Result<[u32; 2], Error> {
        match self.err {
            c::ReturnCode::Ok | c::ReturnCode::BufError => {
                if self.avail_out != 0 && self.flush == c::FlushValue::Finish {
                    return Err(self.error_for_message(c"unexpected end of file"));
                }
            }
            c::ReturnCode::StreamEnd => {}
            c::ReturnCode::NeedDict => {
                if self.dictionary.is_empty() {
                    return Err(self.error_for_message(c"Missing dictionary"));
                } else {
                    return Err(self.error_for_message(c"Bad dictionary"));
                }
            }
            _ => {
                return Err(self.error_for_message(c"Zlib error"));
            }
        }
        Ok([self.avail_out, self.avail_in].map(|n| u32::try_from(n).expect("int cast")))
    }
}
