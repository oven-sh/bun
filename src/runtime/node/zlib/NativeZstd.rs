pub(crate) use _impl::NativeZstd;

mod _impl {
    use core::cell::Cell;
    use core::ffi::{c_int, c_uint};

    use bun_core::vec::BorrowedCursor;
    use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
    use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsError, JsResult};
    use bun_zstd::{Decoder, Encoder, EndDirective, Output, Status};

    use crate::node::node_zlib_binding::{
        CompressionContext, CompressionStreamImpl as _, Error, Stream, Z_BUF_ERROR,
    };
    use crate::node::util::validators;
    // #[repr(u8)] enum shared by all native-zlib stream types.
    use crate::node::node_zlib_binding::NodeMode;

    pub(crate) struct NativeZstd {
        stream: Cell<Option<Box<Stream<Context>>>>,
        pending_close: Cell<bool>,
        closed: Cell<bool>,
        /// Fixed at construction: `estimated_size` runs on a GC marking thread, which cannot read `stream`.
        estimated_external_size: usize,
    }

    // `CompressionStreamImpl` (node_zlib_binding.rs) has write, writeSync, reset, close and onerror.

    impl NativeZstd {
        pub(crate) fn constructor(mode: u8) -> Self {
            let mode = NodeMode::from_int(mode);
            Self {
                stream: Cell::new(Some(Stream::new(Context::new(mode)))),
                pending_close: Cell::new(false),
                closed: Cell::new(false),
                estimated_external_size: Self::external_size_for(mode),
            }
        }

        /// `ZSTD_sizeof_CCtx()` and `ZSTD_sizeof_DCtx()` of a new context of libzstd, which the GC is used to.
        fn external_size_for(mode: NodeMode) -> usize {
            match mode {
                NodeMode::ZSTD_COMPRESS => 5272,
                NodeMode::ZSTD_DECOMPRESS => 95968,
                _ => 0,
            }
        }

        /// Called from any thread (concurrent GC marking). Reads only the
        /// immutable `estimated_external_size` field, never `self.stream`.
        pub(crate) fn estimated_size(&self) -> usize {
            self.estimated_external_size
        }

        pub(crate) fn init(
            &self,
            this_value: JsWrapper<'_, Self>,
            cx: &mut JsScope<'_>,
            init_params_array: JsLocal<'_>,
            pledged_src_size: JsLocal<'_>,
            write_state: JsLocal<'_>,
            process_callback: JsLocal<'_>,
            dictionary: JsLocal<'_>,
        ) -> JsResult<()> {
            let global = cx.global();
            let this_value = this_value.to_js();
            self.throw_unless_idle(global)?;

            let init_params_array_value = init_params_array.to_js();
            let write_state_value = write_state.to_js();
            let process_callback_value = process_callback.to_js();

            let Some(mut write_state) = write_state_value.as_array_buffer(global) else {
                return Err(global.throw_invalid_argument_type_value(
                    "writeState",
                    "Uint32Array",
                    write_state_value,
                ));
            };
            if write_state.typed_array_type != jsc::JSType::Uint32Array {
                return Err(global.throw_invalid_argument_type_value(
                    "writeState",
                    "Uint32Array",
                    write_state_value,
                ));
            }
            // `flush_write_result` writes two u32s into this array, so the
            // caller-supplied array must hold at least 2 elements.
            let write_state_slice = write_state.as_u32();
            if write_state_slice.len() < 2 {
                return Err(global
                    .err(
                        jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("writeState must be a Uint32Array with at least 2 elements"),
                    )
                    .throw());
            }
            js::write_result_set_cached(this_value, global, write_state_value);

            let write_js_callback =
                validators::validate_function(global, "processCallback", process_callback_value)?;
            js::write_callback_set_cached(
                this_value,
                global,
                write_js_callback.with_async_context_if_needed(global),
            );

            let pledged_src_size = validate_pledged_src_size(global, pledged_src_size.to_js())?;

            // Bind the ArrayBuffer view to a local so the borrowed byte_slice()
            // outlives the `Context::init` call below (E0716 otherwise).
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
                dictionary_buf.byte_slice()
            };

            let result = self
                .borrow_idle_stream(global)?
                .context
                .init(pledged_src_size, dictionary);
            result.map_err(|message| self.fail_init(global, message))?;

            let Some(mut params_) = init_params_array_value.as_array_buffer(global) else {
                return Err(global.throw_invalid_argument_type_value(
                    "initParamsArray",
                    "Uint32Array",
                    init_params_array_value,
                ));
            };
            if params_.typed_array_type != jsc::JSType::Uint32Array {
                return Err(global.throw_invalid_argument_type_value(
                    "initParamsArray",
                    "Uint32Array",
                    init_params_array_value,
                ));
            }
            let mut stream = self.borrow_idle_stream(global)?;
            for (i, x) in params_.as_u32().iter().map(|x| x.get()).enumerate() {
                if x == u32::MAX {
                    continue;
                }
                if !stream
                    .context
                    .set_params(c_uint::try_from(i).expect("int cast"), x)
                {
                    drop(stream);
                    return Err(self.fail_init(global, "Setting parameter failed"));
                }
            }

            Ok(())
        }

        fn fail_init(&self, global: &JSGlobalObject, message: &str) -> JsError {
            self.close();
            global
                .err(
                    jsc::ErrorCode::ZLIB_INITIALIZATION_FAILED,
                    format_args!("{message}"),
                )
                .throw()
        }

        pub(crate) fn params(&self) {
            // intentionally left empty
        }
    }

    /// https://github.com/nodejs/node/blob/v26.12.1/src/node_zlib.cc#L1007-L1026
    fn validate_pledged_src_size(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<u64>> {
        if value.is_undefined() {
            return Ok(None);
        }
        let throw = |code, must_be| {
            let message = format_args!("pledgedSrcSize must be {must_be}");
            Err(global.err(code, message).throw())
        };
        if !value.is_number() {
            return throw(jsc::ErrorCode::INVALID_ARG_TYPE, "a number");
        }
        let size = value.as_number();
        if !value.is_integer() || size.abs() > jsc::MAX_SAFE_INTEGER as f64 {
            return throw(jsc::ErrorCode::OUT_OF_RANGE, "a safe integer");
        }
        if size < 0.0 {
            return throw(jsc::ErrorCode::OUT_OF_RANGE, "non-negative");
        }
        Ok(Some(size as u64))
    }

    fn codec_error(error: bun_zstd::Error) -> Error {
        Error::init(error.message(), error as c_int, error.name())
    }

    /// https://github.com/nodejs/node/blob/1d3835e7dd524f2813e5b761be6cd2f20597f8c9/src/node_zlib.cc#L1833-L1909
    struct Compressor {
        encoder: Encoder,
        pledged_src_size: Option<u64>,
        /// The encoder goes by the length of the input instead if its first step ends the frame.
        pledged_left: Option<u64>,
        has_broken_pledge: bool,
        has_ended_frame: bool,
        has_emitted_part_of_frame: bool,
    }

    impl Compressor {
        fn pledge(&mut self) -> Result<(), bun_zstd::Error> {
            self.pledged_left = self.pledged_src_size;
            self.encoder.set_pledged_len(self.pledged_src_size)
        }

        fn reset(&mut self) -> Result<(), Error> {
            if self.has_emitted_part_of_frame {
                return Err(Error::init(
                    c"Cannot reset a zstd stream with an incomplete frame; end the frame or discard the output produced so far",
                    bun_zstd::Error::StageWrong as c_int,
                    c"ERR_ZLIB_INCOMPLETE_FRAME",
                ));
            }
            self.encoder.reset_session();
            (self.has_broken_pledge, self.has_ended_frame) = (false, false);
            self.pledge().map_err(codec_error)
        }

        fn step(
            &mut self,
            input: &mut &[u8],
            out: &mut Output<'_>,
            flush: EndDirective,
        ) -> Result<(), Error> {
            // Ending it again would append an empty frame.
            if !(self.has_ended_frame && input.is_empty()) {
                let (consumed, result) = self.encoder.step(input, out, flush);
                *input = &input[consumed..];
                if let Some(left) = &mut self.pledged_left {
                    *left = left.wrapping_sub(consumed as u64);
                }
                self.has_ended_frame = result == Ok(Status::Complete) && flush == EndDirective::End;
                if self.has_ended_frame {
                    self.has_emitted_part_of_frame = false;
                    self.has_broken_pledge |= self.pledged_left.take().is_some_and(|it| it != 0);
                } else {
                    self.has_emitted_part_of_frame |= out.written() != 0;
                }
                result.map_err(codec_error)?;
            }
            if self.has_broken_pledge {
                return Err(codec_error(bun_zstd::Error::SrcSizeWrong));
            }
            Ok(())
        }
    }

    /// https://github.com/nodejs/node/blob/v26.12.1/src/node_zlib.cc#L1940-L2055
    struct Decompressor {
        decoder: Decoder,
        /// `None` until a frame is complete.
        consumed_since_frame_end: Option<usize>,
    }

    impl Decompressor {
        fn reset(&mut self) {
            self.decoder.reset_session();
            self.consumed_since_frame_end = None;
        }

        fn step(
            &mut self,
            input: &mut &[u8],
            out: &mut Output<'_>,
            flush: EndDirective,
        ) -> Result<(), Error> {
            const MAGIC_LEN: usize = 4;
            /// `ZSTD_NO_FORWARD_PROGRESS_MAX`
            const IDLE_STEPS_MAX: u32 = 16;
            let had_input = !input.is_empty();
            loop {
                let (consumed, result) = self.decoder.step(input, out);
                *input = &input[consumed..];
                match (result, &mut self.consumed_since_frame_end) {
                    (Ok(Status::Complete), since) => *since = Some(0),
                    (Ok(Status::Pending), Some(since)) => *since = since.saturating_add(consumed),
                    (Ok(Status::Pending), None) => {}
                    // The decoder repeats the error, so whatever comes later is ignored as well.
                    (Err(bun_zstd::Error::PrefixUnknown), Some(_)) => return Ok(()),
                    (Err(error), _) => return Err(codec_error(error)),
                }
                if result != Ok(Status::Complete) || input.is_empty() || out.room() == 0 {
                    break;
                }
            }
            if self.decoder.idle_steps() >= IDLE_STEPS_MAX && (out.room() == 0 || !had_input) {
                return Err(codec_error(match out.room() {
                    0 => bun_zstd::Error::NoForwardProgressDestFull,
                    _ => bun_zstd::Error::NoForwardProgressInputEmpty,
                }));
            }
            let is_in_frame = (self.consumed_since_frame_end).is_none_or(|it| it >= MAGIC_LEN);
            if flush == EndDirective::End && is_in_frame && input.is_empty() && out.room() != 0 {
                return Err(Error::init(
                    c"unexpected end of file",
                    Z_BUF_ERROR,
                    c"Z_BUF_ERROR",
                ));
            }
            Ok(())
        }
    }

    enum State {
        Compress(Box<Compressor>),
        Decompress(Box<Decompressor>),
    }

    pub(crate) struct Context {
        mode: NodeMode,
        state: Option<State>,
        flush: EndDirective,
        /// Of the last write.
        result: Result<[u32; 2], Error>,
    }

    impl Context {
        const DICTIONARY_LOAD_FAILED: &str = "Failed to load zstd dictionary";

        fn new(mode: NodeMode) -> Self {
            Self {
                mode,
                state: None,
                flush: EndDirective::Continue,
                result: Ok([0; 2]),
            }
        }

        fn init(
            &mut self,
            pledged_src_size: Option<u64>,
            dictionary: &[u8],
        ) -> Result<(), &'static str> {
            // Mirrors node's `state_.reset(ZSTD_createCCtx())`: free the previous
            // context first. `init` is JS-reachable twice on one handle.
            self.state = None;
            self.state = Some(match self.mode {
                NodeMode::ZSTD_COMPRESS => {
                    let mut state = Box::new(Compressor {
                        encoder: Encoder::new(bun_zstd::DEFAULT_LEVEL),
                        pledged_src_size,
                        pledged_left: None,
                        has_broken_pledge: false,
                        has_ended_frame: false,
                        has_emitted_part_of_frame: false,
                    });
                    // Node loads the dictionary before setting the pledged size.
                    if !dictionary.is_empty() && state.encoder.load_dictionary(dictionary).is_err()
                    {
                        return Err(Self::DICTIONARY_LOAD_FAILED);
                    }
                    if state.pledge().is_err() {
                        return Err("Could not set pledged src size");
                    }
                    State::Compress(state)
                }
                NodeMode::ZSTD_DECOMPRESS => {
                    let mut state = Box::new(Decompressor {
                        decoder: Decoder::new(),
                        consumed_since_frame_end: None,
                    });
                    if !dictionary.is_empty() && state.decoder.load_dictionary(dictionary).is_err()
                    {
                        return Err(Self::DICTIONARY_LOAD_FAILED);
                    }
                    State::Decompress(state)
                }
                _ => unreachable!(),
            });
            Ok(())
        }

        fn set_params(&mut self, key: c_uint, value: u32) -> bool {
            match &mut self.state {
                Some(State::Compress(state)) => state.encoder.set_parameter(key, value as c_int),
                Some(State::Decompress(state)) => state.decoder.set_parameter(key, value as c_int),
                None => unreachable!(),
            }
            .is_ok()
        }
    }

    impl CompressionContext for Context {
        fn reset(&mut self) -> Result<(), Error> {
            match &mut self.state {
                None => {}
                Some(State::Compress(state)) => state.reset()?,
                Some(State::Decompress(state)) => state.reset(),
            }
            Ok(())
        }

        fn flush_value_is_valid(flush: u32) -> bool {
            flush <= 2
        }

        fn set_flush(&mut self, flush: c_int) {
            self.flush = match flush {
                0 => EndDirective::Continue,
                1 => EndDirective::Flush,
                _ => EndDirective::End,
            };
        }

        fn do_work(&mut self, mut input: &[u8], mut cursor: BorrowedCursor<'_, u8>) {
            // An `ArrayBuffer`, so there is nothing to initialize.
            let mut out = Output::slice(cursor.ensure_init());
            let result = match &mut self.state {
                // Driven before `init()`.
                None => Ok(()),
                Some(State::Compress(state)) => state.step(&mut input, &mut out, self.flush),
                Some(State::Decompress(state)) => state.step(&mut input, &mut out, self.flush),
            };
            self.result = result
                .map(|()| [out.room(), input.len()].map(|n| u32::try_from(n).expect("int cast")));
        }

        fn write_result(&self) -> Result<[u32; 2], Error> {
            self.result
        }
    }

    crate::__impl_compression_stream!(NativeZstd, Context, js_NativeZstd);
} // mod _impl
