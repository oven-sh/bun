pub(crate) use _impl::NativeZstd;

mod _impl {
    use core::cell::Cell;
    use core::ffi::{c_int, c_uint};

    use bun_core::vec::BorrowedCursor;
    use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
    use bun_jsc::{self as jsc, JsResult};
    use bun_zstd::{OwnedCCtx, OwnedDCtx, c};

    use crate::node::node_zlib_binding::{
        CompressionContext, CompressionStreamImpl as _, Error, Stream,
    };
    use crate::node::util::validators;
    // #[repr(u8)] enum shared by all native-zlib stream types.
    use bun_zlib::NodeMode;

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

        /// Per-mode external-allocation footprint, fixed at construction.
        fn external_size_for(mode: NodeMode) -> usize {
            match mode {
                NodeMode::ZSTD_COMPRESS => 5272,    // estimate of ZSTD_sizeof_CCtx
                NodeMode::ZSTD_DECOMPRESS => 95968, // estimate of ZSTD_sizeof_DCtx
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
        ) -> JsResult<bool> {
            let global = cx.global();
            let this_value = this_value.to_js();
            self.throw_unless_idle(global)?;

            let init_params_array_value = init_params_array.to_js();
            let pledged_src_size_value = pledged_src_size.to_js();
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

            let mut pledged_src_size: u64 = u64::MAX;
            if pledged_src_size_value.is_number() {
                pledged_src_size = u64::from(validators::validate_uint32(
                    global,
                    pledged_src_size_value,
                    format_args!("pledgedSrcSize"),
                    false,
                )?);
            }

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
            if let Err(err) = result {
                self.emit_error(global, this_value, &err);
                return Ok(false);
            }

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
                    self.close();
                    return Err(global
                        .err(
                            jsc::ErrorCode::ZLIB_INITIALIZATION_FAILED,
                            format_args!("Setting parameter failed"),
                        )
                        .throw());
                }
            }

            Ok(true)
        }

        pub(crate) fn params(&self) {
            // intentionally left empty
        }
    }

    enum State {
        Compress(OwnedCCtx),
        Decompress(OwnedDCtx),
    }

    pub(crate) struct Context {
        mode: NodeMode,
        state: Option<State>,
        flush: c_int,
        avail_in: usize,
        avail_out: usize,
        pledged_src_size: u64,
        error: Option<bun_zstd::ErrorCode>,
    }

    impl Context {
        const DICTIONARY_LOAD_FAILED: Error = Error::init(
            c"Failed to load zstd dictionary",
            -1,
            c"ERR_ZLIB_DICTIONARY_LOAD_FAILED",
        );
        const CREATE_FAILED: Error = Error::init(
            c"Could not initialize zstd instance",
            -1,
            c"ERR_ZLIB_INITIALIZATION_FAILED",
        );

        fn new(mode: NodeMode) -> Self {
            Self {
                mode,
                state: None,
                flush: c::ZSTD_e_continue as c_int,
                avail_in: 0,
                avail_out: 0,
                pledged_src_size: u64::MAX,
                error: None,
            }
        }

        fn init(&mut self, pledged_src_size: u64, dictionary: &[u8]) -> Result<(), Error> {
            // Mirrors node's `state_.reset(ZSTD_createCCtx())`: free the previous
            // context first. `init` is JS-reachable twice on one handle.
            self.state = None;
            self.state = Some(match self.mode {
                NodeMode::ZSTD_COMPRESS => {
                    self.pledged_src_size = pledged_src_size;
                    let mut state = OwnedCCtx::new().ok_or(Self::CREATE_FAILED)?;
                    // Node loads the dictionary before setting the pledged size.
                    if !dictionary.is_empty() && state.load_dictionary(dictionary).is_err() {
                        return Err(Self::DICTIONARY_LOAD_FAILED);
                    }
                    if state.set_pledged_src_size(pledged_src_size).is_err() {
                        return Err(Error::init(
                            c"Could not set pledged src size",
                            -1,
                            c"ERR_ZLIB_INITIALIZATION_FAILED",
                        ));
                    }
                    State::Compress(state)
                }
                NodeMode::ZSTD_DECOMPRESS => {
                    let mut state = OwnedDCtx::new().ok_or(Self::CREATE_FAILED)?;
                    if !dictionary.is_empty() && state.load_dictionary(dictionary).is_err() {
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
                Some(State::Compress(cctx)) => cctx.set_parameter(key, value as c_int),
                Some(State::Decompress(dctx)) => dctx.set_parameter(key, value as c_int),
                None => unreachable!(),
            }
            .is_ok()
        }

        const ZSTD_MAGICNUMBER: [u8; 4] = 0xFD2FB528u32.to_le_bytes();
        const ZSTD_MAGIC_SKIPPABLE: [u8; 4] = 0x184D2A50u32.to_le_bytes();

        /// True when the unconsumed input begins a zstd/skippable frame magic (or a prefix of one).
        fn next_input_is_frame(input: &[u8]) -> bool {
            let n = input.len().min(4);
            if n == 0 {
                return false;
            }
            input[..n] == Self::ZSTD_MAGICNUMBER[..n]
                || (input[0] & 0xF0 == Self::ZSTD_MAGIC_SKIPPABLE[0]
                    && input[1..n] == Self::ZSTD_MAGIC_SKIPPABLE[1..n])
        }
    }

    impl CompressionContext for Context {
        fn reset(&mut self) -> Result<(), Error> {
            // Matches node's `ZstdContext::ResetStream()`, which calls `Init()`
            // with its default (empty) dictionary — a reset drops the dictionary.
            // `init` frees the previous context itself.
            self.init(self.pledged_src_size, &[])
        }

        fn flush_value_is_valid(flush: u32) -> bool {
            flush <= 2
        }

        fn set_flush(&mut self, flush: c_int) {
            self.flush = flush;
        }

        fn do_work(&mut self, mut input: &[u8], mut out: BorrowedCursor<'_, u8>) {
            match &mut self.state {
                // Driven before `init()`.
                None => self.error = None,
                Some(State::Compress(cctx)) => {
                    let (consumed, result) = cctx.step(input, out.reborrow(), self.flush as c_uint);
                    input = &input[consumed..];
                    self.error = result.err();
                }
                Some(State::Decompress(dctx)) => loop {
                    let (consumed, result) = dctx.step(input, out.reborrow());
                    input = &input[consumed..];
                    // 0 is frame-complete; mirrors the GUNZIP loop in NativeZlib.
                    if result != Ok(0) || out.capacity() == 0 || !Self::next_input_is_frame(input) {
                        self.error = result.err();
                        break;
                    }
                },
            }
            self.avail_in = input.len();
            self.avail_out = out.capacity();
        }

        fn write_result(&self) -> Result<[u32; 2], Error> {
            match self.error {
                None => Ok(
                    [self.avail_out, self.avail_in].map(|n| u32::try_from(n).expect("int cast"))
                ),
                Some(err) => Err(Error {
                    err: err.0 as c_int,
                    msg: err.message(),
                    code: match err.0 {
                        c::ZSTD_error_no_error => c"ZSTD_error_no_error",
                        c::ZSTD_error_GENERIC => c"ZSTD_error_GENERIC",
                        c::ZSTD_error_prefix_unknown => c"ZSTD_error_prefix_unknown",
                        c::ZSTD_error_version_unsupported => c"ZSTD_error_version_unsupported",
                        c::ZSTD_error_frameParameter_unsupported => {
                            c"ZSTD_error_frameParameter_unsupported"
                        }
                        c::ZSTD_error_frameParameter_windowTooLarge => {
                            c"ZSTD_error_frameParameter_windowTooLarge"
                        }
                        c::ZSTD_error_corruption_detected => c"ZSTD_error_corruption_detected",
                        c::ZSTD_error_checksum_wrong => c"ZSTD_error_checksum_wrong",
                        c::ZSTD_error_literals_headerWrong => c"ZSTD_error_literals_headerWrong",
                        c::ZSTD_error_dictionary_corrupted => c"ZSTD_error_dictionary_corrupted",
                        c::ZSTD_error_dictionary_wrong => c"ZSTD_error_dictionary_wrong",
                        c::ZSTD_error_dictionaryCreation_failed => {
                            c"ZSTD_error_dictionaryCreation_failed"
                        }
                        c::ZSTD_error_parameter_unsupported => c"ZSTD_error_parameter_unsupported",
                        c::ZSTD_error_parameter_combination_unsupported => {
                            c"ZSTD_error_parameter_combination_unsupported"
                        }
                        c::ZSTD_error_parameter_outOfBound => c"ZSTD_error_parameter_outOfBound",
                        c::ZSTD_error_tableLog_tooLarge => c"ZSTD_error_tableLog_tooLarge",
                        c::ZSTD_error_maxSymbolValue_tooLarge => {
                            c"ZSTD_error_maxSymbolValue_tooLarge"
                        }
                        c::ZSTD_error_maxSymbolValue_tooSmall => {
                            c"ZSTD_error_maxSymbolValue_tooSmall"
                        }
                        c::ZSTD_error_stabilityCondition_notRespected => {
                            c"ZSTD_error_stabilityCondition_notRespected"
                        }
                        c::ZSTD_error_stage_wrong => c"ZSTD_error_stage_wrong",
                        c::ZSTD_error_init_missing => c"ZSTD_error_init_missing",
                        c::ZSTD_error_memory_allocation => c"ZSTD_error_memory_allocation",
                        c::ZSTD_error_workSpace_tooSmall => c"ZSTD_error_workSpace_tooSmall",
                        c::ZSTD_error_dstSize_tooSmall => c"ZSTD_error_dstSize_tooSmall",
                        c::ZSTD_error_srcSize_wrong => c"ZSTD_error_srcSize_wrong",
                        c::ZSTD_error_dstBuffer_null => c"ZSTD_error_dstBuffer_null",
                        c::ZSTD_error_noForwardProgress_destFull => {
                            c"ZSTD_error_noForwardProgress_destFull"
                        }
                        c::ZSTD_error_noForwardProgress_inputEmpty => {
                            c"ZSTD_error_noForwardProgress_inputEmpty"
                        }
                        _ => c"ZSTD_error_GENERIC",
                    },
                }),
            }
        }
    }

    crate::__impl_compression_stream!(NativeZstd, Context, js_NativeZstd);
} // mod _impl
