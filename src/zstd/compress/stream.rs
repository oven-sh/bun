//! The public side of `zstd_compress.c`: `ZSTD_CCtx`, its parameters, `ZSTD_compressStream2` and `ZSTD_compress`.

use std::sync::Arc;

use super::cctx::{CDict, FrameCompressor, Input, Output, Span};
use super::internal::{BufId, Buffers, CompressedBlockState};
use super::mt::MtCtx;
use super::params::{
    CCtxParams, CParamMode, ZSTD_CLEVEL_DEFAULT, ZSTDMT_JOBSIZE_MIN, compress_bound,
    get_c_params_from_cctx_params, get_params_internal, resolve_block_splitter_mode,
    resolve_enable_ldm, resolve_row_match_finder_mode,
};
use crate::error::{Error, Result};
use crate::util::{SliceExt, append, try_copy};
use crate::{InBuffer, OutBuffer};

/// `ZSTD_EndDirective`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EndDirective {
    /// Collect more input: the encoder decides when to output.
    Continue = 0,
    /// Output all that was consumed, so that a decoder can get it.
    Flush = 1,
    /// Flush, and close the frame.
    End = 2,
}

/// `ZSTD_cStreamStage`
#[derive(Clone, Copy, PartialEq, Eq)]
enum StreamStage {
    Init,
    Load,
    Flush,
}

/// `ZSTD_CCtx`
pub struct CCtx {
    frame: FrameCompressor,
    requested_params: CCtxParams,
    /// As long as it was ever filled, with room for `in_buff_size`.
    in_buff: Vec<u8>,
    in_buff_size: usize,
    in_to_compress: usize,
    in_buff_pos: usize,
    in_buff_target: usize,
    /// Empty until it is needed, with room for `out_buff_size`.
    out_buff: Vec<u8>,
    out_buff_size: usize,
    out_buff_content_size: usize,
    out_buff_flushed_size: usize,
    stream_stage: StreamStage,
    frame_ended: bool,
    /// `localDict.dict`
    local_dict: Option<Arc<Vec<u8>>>,
    /// `localDict.cdict`, which is made when the first frame starts.
    cdict: Option<Arc<CDict>>,
    mtctx: Option<Box<MtCtx>>,
}

impl Default for CCtx {
    fn default() -> Self {
        Self::new()
    }
}

/// `ZSTD_limitCopy`
fn limit_copy(dst: &mut [u8], src: &[u8]) -> Result<usize> {
    let length = dst.len().min(src.len());
    dst.write_at(0, src.sub(..length)?)?;
    Ok(length)
}

/// Gives `buffer` room for `new_size` bytes instead of `size`, none of which is touched.
fn resize_buffer(buffer: &mut Vec<u8>, size: &mut usize, new_size: usize) -> Result<()> {
    if *size != new_size {
        // First, so that both are not allocated at once.
        *buffer = Vec::new();
        *size = 0;
        buffer
            .try_reserve_exact(new_size)
            .map_err(|_| Error::MemoryAllocation)?;
        *size = new_size;
    }
    Ok(())
}

/// Writes `src` at `pos`, which is at most the length of `buffer`, over what is there and beyond, for which it has the
/// capacity.
fn write_or_append(buffer: &mut Vec<u8>, pos: usize, src: &[u8]) -> Result<()> {
    let over = buffer.sub_mut(pos..)?;
    let (first, rest) = src.split_at_checked(over.len()).unwrap_or((src, &[]));
    over.write_at(0, first)?;
    append(buffer, rest)
}

impl CCtx {
    /// How much memory a new one takes.
    pub const SIZE: usize = size_of::<Self>() + 2 * size_of::<CompressedBlockState>();

    /// `ZSTD_createCCtx`
    pub fn new() -> Self {
        Self {
            frame: FrameCompressor::new(),
            requested_params: CCtxParams::new(ZSTD_CLEVEL_DEFAULT),
            in_buff: Vec::new(),
            in_buff_size: 0,
            in_to_compress: 0,
            in_buff_pos: 0,
            in_buff_target: 0,
            out_buff: Vec::new(),
            out_buff_size: 0,
            out_buff_content_size: 0,
            out_buff_flushed_size: 0,
            stream_stage: StreamStage::Init,
            frame_ended: false,
            local_dict: None,
            cdict: None,
            mtctx: None,
        }
    }

    /// `ZSTD_CCtx_setParameter`: `param` is one of [`super::params::c_param`].
    pub fn set_parameter(&mut self, param: i32, value: i32) -> Result<usize> {
        if self.stream_stage != StreamStage::Init {
            return Err(Error::StageWrong);
        }
        self.requested_params.set_parameter(param, value)
    }

    /// `ZSTD_CCtx_setPledgedSrcSize`
    pub fn set_pledged_src_size(&mut self, pledged_src_size: u64) -> Result<()> {
        if self.stream_stage != StreamStage::Init {
            return Err(Error::StageWrong);
        }
        self.frame.pledged_src_size_plus_one = pledged_src_size.wrapping_add(1);
        Ok(())
    }

    /// `ZSTD_CCtx_loadDictionary`: every frame from now on starts with `dict`, of which a copy is kept. If it is empty,
    /// with no dictionary.
    pub fn load_dictionary(&mut self, dict: &[u8]) -> Result<()> {
        if self.stream_stage != StreamStage::Init {
            return Err(Error::StageWrong);
        }
        self.local_dict = None;
        self.cdict = None;
        if !dict.is_empty() {
            self.local_dict = Some(Arc::new(try_copy(dict)?));
        }
        Ok(())
    }

    /// `ZSTD_CCtx_reset` with `ZSTD_reset_session_only`
    fn reset_session(&mut self) {
        self.stream_stage = StreamStage::Init;
        self.frame.pledged_src_size_plus_one = 0;
    }

    /// `ZSTD_initLocalDict`
    fn init_local_dict(&mut self) -> Result<()> {
        let Some(dict) = &self.local_dict else {
            return Ok(());
        };
        if self.cdict.is_some() {
            return Ok(());
        }
        // Whatever is wrong with the dictionary, the C code only knows that it got no `ZSTD_CDict`.
        let cdict = CDict::new(Arc::clone(dict), &self.requested_params)
            .map_err(|_| Error::MemoryAllocation)?;
        self.cdict = Some(Arc::new(cdict));
        Ok(())
    }

    /// `ZSTD_CCtx_init_compressStream2`
    fn init_compress_stream2(&mut self, end_op: EndDirective, in_size: usize) -> Result<()> {
        let mut params = self.requested_params;
        self.init_local_dict()?;
        if end_op == EndDirective::End {
            // All the input is there.
            self.frame.pledged_src_size_plus_one = in_size as u64 + 1;
        }
        let pledged_src_size = self.frame.pledged_src_size_plus_one.wrapping_sub(1);
        let cdict = self.cdict.as_deref();

        {
            let dict_size = cdict.map_or(0, |cdict| cdict.dict_content().len());
            // `ZSTD_getCParamMode`
            let mode = match cdict {
                Some(cdict) if cdict.should_attach(&params, pledged_src_size) => {
                    CParamMode::AttachDict
                }
                _ => CParamMode::NoAttachDict,
            };
            params.c_params =
                get_c_params_from_cctx_params(&params, pledged_src_size, dict_size, mode);
        }

        params.post_block_splitter =
            resolve_block_splitter_mode(params.post_block_splitter, &params.c_params);
        params.ldm_params.enable_ldm =
            resolve_enable_ldm(params.ldm_params.enable_ldm, &params.c_params);
        params.use_row_match_finder =
            resolve_row_match_finder_mode(params.use_row_match_finder, &params.c_params);

        if pledged_src_size <= ZSTDMT_JOBSIZE_MIN as u64 {
            // Not worth several threads.
            params.nb_workers = 0;
        }
        if params.nb_workers > 0 {
            if self.mtctx.is_none() {
                self.mtctx = Some(Box::new(MtCtx::new(params.nb_workers as u32)?));
            }
            let mtctx = self.mtctx.as_mut().ok_or(Error::MemoryAllocation)?;
            mtctx.init_c_stream_internal(self.cdict.clone(), params, pledged_src_size)?;
            self.frame.dict_id = cdict.map_or(0, CDict::dict_id);
            self.frame.dict_content_size = cdict.map_or(0, |cdict| cdict.dict_content().len());
            self.frame.consumed_src_size = 0;
            self.frame.produced_c_size = 0;
            self.stream_stage = StreamStage::Load;
            self.frame.applied_params = params;
        } else {
            let input = Input {
                bufs: Buffers {
                    in_buff: &[],
                    user: &[],
                    dict: cdict.map_or(&[], CDict::dict_content),
                },
                cdict,
            };
            let sizes = self
                .frame
                .begin(&input, None, &params, pledged_src_size, true)?;
            // They are part of the workspace in the C code.
            resize_buffer(
                &mut self.in_buff,
                &mut self.in_buff_size,
                sizes.buff_in_size,
            )
            .and_then(|()| {
                resize_buffer(
                    &mut self.out_buff,
                    &mut self.out_buff_size,
                    sizes.buff_out_size,
                )
            })
            .inspect_err(|_| self.frame.forget())?;
            self.in_to_compress = 0;
            self.in_buff_pos = 0;
            // One more byte, to tell an input of exactly one block from a longer one.
            self.in_buff_target = self.frame.block_size_max
                + usize::from(self.frame.block_size_max as u64 == pledged_src_size);
            self.out_buff_content_size = 0;
            self.out_buff_flushed_size = 0;
            self.stream_stage = StreamStage::Load;
            self.frame_ended = false;
        }
        Ok(())
    }

    /// `ZSTD_nextInputSizeHint`
    fn next_input_size_hint(&self) -> usize {
        match self.in_buff_target - self.in_buff_pos {
            0 => self.frame.block_size_max,
            hint_in_size => hint_in_size,
        }
    }

    /// `ZSTD_compressStream_generic`
    fn compress_stream_generic(
        &mut self,
        output: &mut OutBuffer<'_>,
        input: &mut InBuffer<'_>,
        flush_mode: EndDirective,
    ) -> Result<usize> {
        let iend = input.src.len();
        let mut ip = input.pos;
        let mut op = output.pos;
        let cdict = self.cdict.clone();
        let cdict = cdict.as_deref();
        let dict = cdict.map_or(&[][..], CDict::dict_content);

        loop {
            match self.stream_stage {
                StreamStage::Init => return Err(Error::InitMissing),

                StreamStage::Load => {
                    if flush_mode == EndDirective::End
                        && output.dst.len() - op >= compress_bound(iend - ip)
                        && self.in_buff_pos == 0
                    {
                        // There is room for the worst case: no need for the buffers.
                        let c_size = self.frame.compress_end(
                            output.dst.sub_mut(op..)?,
                            &Input {
                                bufs: Buffers {
                                    in_buff: &self.in_buff,
                                    user: input.src,
                                    dict,
                                },
                                cdict,
                            },
                            Span {
                                buf: BufId::User,
                                start: ip,
                                end: iend,
                            },
                        )?;
                        ip = iend;
                        op += c_size;
                        self.frame_ended = true;
                        self.reset_session();
                        break;
                    }
                    {
                        let loaded = (self.in_buff_target - self.in_buff_pos).min(iend - ip);
                        write_or_append(
                            &mut self.in_buff,
                            self.in_buff_pos,
                            input.src.span(ip, loaded)?,
                        )?;
                        self.in_buff_pos += loaded;
                        ip += loaded;
                        if flush_mode == EndDirective::Continue
                            && self.in_buff_pos < self.in_buff_target
                        {
                            // Not enough for a block yet.
                            break;
                        }
                        if flush_mode == EndDirective::Flush
                            && self.in_buff_pos == self.in_to_compress
                        {
                            // Nothing to flush.
                            break;
                        }
                    }
                    let i_size = self.in_buff_pos - self.in_to_compress;
                    let direct = output.dst.len() - op >= compress_bound(i_size);
                    let c_dst = if direct {
                        output.dst.sub_mut(op..)?
                    } else {
                        self.out_buff.resize(self.out_buff_size, 0);
                        self.out_buff.as_mut_slice()
                    };
                    let last_block = flush_mode == EndDirective::End && ip == iend;
                    let frame_input = Input {
                        bufs: Buffers {
                            in_buff: &self.in_buff,
                            user: &[],
                            dict,
                        },
                        cdict,
                    };
                    let src = Span {
                        buf: BufId::InBuff,
                        start: self.in_to_compress,
                        end: self.in_buff_pos,
                    };
                    let c_size = if last_block {
                        self.frame.compress_end(c_dst, &frame_input, src)?
                    } else {
                        self.frame.compress_continue(c_dst, &frame_input, src)?
                    };
                    self.frame_ended = last_block;
                    // The next block goes after this one, or at the start if there is no room left.
                    self.in_buff_target = self.in_buff_pos + self.frame.block_size_max;
                    if self.in_buff_target > self.in_buff_size {
                        self.in_buff_pos = 0;
                        self.in_buff_target = self.frame.block_size_max;
                    }
                    self.in_to_compress = self.in_buff_pos;
                    if direct {
                        op += c_size;
                        if self.frame_ended {
                            self.reset_session();
                            break;
                        }
                        continue;
                    }
                    self.out_buff_content_size = c_size;
                    self.out_buff_flushed_size = 0;
                    self.stream_stage = StreamStage::Flush;
                }

                StreamStage::Flush => {
                    let to_flush = self.out_buff_content_size - self.out_buff_flushed_size;
                    let flushed = limit_copy(
                        output.dst.sub_mut(op..)?,
                        self.out_buff.span(self.out_buff_flushed_size, to_flush)?,
                    )?;
                    op += flushed;
                    self.out_buff_flushed_size += flushed;
                    if to_flush != flushed {
                        // The output is full.
                        break;
                    }
                    self.out_buff_content_size = 0;
                    self.out_buff_flushed_size = 0;
                    if self.frame_ended {
                        self.reset_session();
                        break;
                    }
                    self.stream_stage = StreamStage::Load;
                }
            }
        }

        input.pos = ip;
        output.pos = op;
        if self.frame_ended {
            return Ok(0);
        }
        Ok(self.next_input_size_hint())
    }

    /// `ZSTD_compressStream2`: returns the least number of bytes that are left to flush, which for
    /// [`EndDirective::End`] is 0 once the frame is complete.
    pub fn compress_stream2(
        &mut self,
        output: &mut OutBuffer<'_>,
        input: &mut InBuffer<'_>,
        end_op: EndDirective,
    ) -> Result<usize> {
        if output.pos > output.dst.len() {
            return Err(Error::DstSizeTooSmall);
        }
        if input.pos > input.src.len() {
            return Err(Error::SrcSizeWrong);
        }

        if self.stream_stage == StreamStage::Init {
            self.init_compress_stream2(end_op, input.src.len() - input.pos)?;
        }

        if self.frame.applied_params.nb_workers > 0 {
            let mtctx = self.mtctx.as_mut().ok_or(Error::Generic)?;
            loop {
                let ipos = input.pos;
                let opos = output.pos;
                let mut flush_min = mtctx.compress_stream_generic(output, input, end_op);
                self.frame.consumed_src_size += (input.pos - ipos) as u64;
                self.frame.produced_c_size += (output.pos - opos) as u64;
                // Not in 1.5.7, where only a frame of one job is checked, and any other is one that cannot be decoded.
                let pledged = self.frame.pledged_src_size_plus_one;
                let consumed = self.frame.consumed_src_size + 1;
                let is_complete = end_op == EndDirective::End && flush_min == Ok(0);
                if pledged != 0 && (consumed > pledged || (is_complete && consumed != pledged)) {
                    flush_min = flush_min.and(Err(Error::SrcSizeWrong));
                }
                if flush_min.is_err() || (end_op == EndDirective::End && flush_min == Ok(0)) {
                    // `reset_session`, but `mtctx` is borrowed.
                    self.stream_stage = StreamStage::Init;
                    self.frame.pledged_src_size_plus_one = 0;
                }
                let flush_min = flush_min?;

                if end_op == EndDirective::Continue {
                    // Some progress is enough. Otherwise, wait for a job to make some.
                    if input.pos != ipos
                        || output.pos != opos
                        || input.pos == input.src.len()
                        || output.pos == output.dst.len()
                    {
                        return Ok(flush_min);
                    }
                } else if flush_min == 0 || output.pos == output.dst.len() {
                    // Flushing goes on for as long as there is room.
                    return Ok(flush_min);
                }
            }
        }
        self.compress_stream_generic(output, input, end_op)?;
        Ok(self.out_buff_content_size - self.out_buff_flushed_size)
    }
}

/// `ZSTD_compress`: returns the size of the frame.
pub fn compress(dst: &mut [u8], src: &[u8], compression_level: i32) -> Result<usize> {
    compress_to(&mut Output::Slice(dst), src, compression_level)
}

/// [`compress`] to either kind of output.
pub(crate) fn compress_to(
    dst: &mut Output<'_>,
    src: &[u8],
    compression_level: i32,
) -> Result<usize> {
    let mut frame = FrameCompressor::new();
    let params = get_params_internal(
        compression_level,
        src.len() as u64,
        0,
        CParamMode::NoAttachDict,
    );
    let cctx_params = CCtxParams::from_params(
        &params,
        if compression_level == 0 {
            ZSTD_CLEVEL_DEFAULT
        } else {
            compression_level
        },
    );
    let input = Input {
        bufs: Buffers {
            in_buff: &[],
            user: src,
            dict: &[],
        },
        cdict: None,
    };
    frame.begin(&input, None, &cctx_params, src.len() as u64, false)?;
    frame.compress_end_to(
        dst,
        &input,
        Span {
            buf: BufId::User,
            start: 0,
            end: src.len(),
        },
    )
}
