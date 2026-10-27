//! `zstdmt_compress.c`: a frame made of sections that are compressed in parallel.
//!
//! The input is cut in the same sections as the C code cuts it in, each of which starts from the end of the previous
//! one as a prefix, so the frames are the same. What differs is how memory is shared. The C code has one round buffer
//! for the input, which workers read while it is being filled, one output buffer for each job, which is flushed while
//! it is being written, and a state that jobs lock in turn. Here a job owns its input, sends its output in pieces, and
//! hands that state over to the next job.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::thread::JoinHandle;

use super::cctx::{
    CDict, DictContentType, FrameCompressor, Input, Span, reset_struct_table, reset_table,
    write_last_empty_block,
};
use super::internal::{
    BufId, Buffers, DictTableLoadMethod, LdmParams, LdmState, ParamSwitch, RawSeq, RawSeqStore,
    Strategy, Window,
};
use super::ldm;
use super::params::{
    CCtxParams, CParamMode, ZSTDMT_JOBLOG_MAX, ZSTDMT_JOBSIZE_MAX, ZSTDMT_JOBSIZE_MIN,
    ZSTDMT_NBWORKERS_MAX, compress_bound, cycle_log, get_c_params_from_cctx_params,
};
use super::stream::EndDirective;
use crate::common::xxhash::Xxh64;
use crate::common::{ZSTD_BLOCKSIZE_MAX, ZSTD_CONTENTSIZE_UNKNOWN};
use crate::error::{ErrorCode, Result};
use crate::util::SliceExt;
use crate::{InBuffer, OutBuffer};

/// `SerialState`: what has to see the input in order.
struct SerialState {
    ldm_params: LdmParams,
    checksum_flag: bool,
    ldm_state: LdmState,
    xxh_state: Xxh64,
    /// The input, where the C code has it in its round buffer: long distance matches reach further back than the
    /// prefix of a job.
    round_buff: Vec<u8>,
}

impl SerialState {
    fn new() -> Self {
        Self {
            ldm_params: NO_LDM_PARAMS,
            checksum_flag: false,
            ldm_state: LdmState::new(),
            xxh_state: Xxh64::new(),
            round_buff: Vec::new(),
        }
    }

    /// `ZSTDMT_serialState_reset`
    fn reset(&mut self, params: &CCtxParams, round_buff_capacity: usize) -> Result<()> {
        let mut ldm_params = params.ldm_params;
        if ldm_params.enable_ldm == ParamSwitch::Enable {
            ldm::adjust_parameters(&mut ldm_params, &params.c_params);
        } else {
            ldm_params = NO_LDM_PARAMS;
        }
        self.checksum_flag = params.f_params.checksum_flag;
        self.xxh_state = Xxh64::new();
        if ldm_params.enable_ldm == ParamSwitch::Enable {
            let bucket_log = ldm_params.hash_log - ldm_params.bucket_size_log;
            self.ldm_state.window = Window::new();
            reset_struct_table(
                &mut self.ldm_state.hash_table,
                1 << ldm_params.hash_log,
                true,
            )?;
            reset_table(&mut self.ldm_state.bucket_offsets, 1 << bucket_log, true)?;
            self.ldm_state.loaded_dict_end = 0;
            reset_table(&mut self.round_buff, round_buff_capacity, false)?;
        } else {
            self.ldm_state = LdmState::new();
            self.round_buff = Vec::new();
        }
        self.ldm_params = ldm_params;
        Ok(())
    }

    /// `ZSTDMT_serialState_genSequences`: `src` is the input of the next job, and `round_pos` where it goes in the
    /// round buffer.
    fn gen_sequences(
        &mut self,
        seq_store: &mut RawSeqStore,
        src: &[u8],
        round_pos: usize,
    ) -> Result<()> {
        if self.ldm_params.enable_ldm == ParamSwitch::Enable {
            self.round_buff.write_at(round_pos, src)?;
            (self.ldm_state.window).update(
                BufId::InBuff.start() + round_pos,
                BufId::InBuff,
                src.len(),
                false,
            );
            ldm::generate_sequences(
                &mut self.ldm_state,
                seq_store,
                &self.ldm_params,
                &Buffers {
                    in_buff: &self.round_buff,
                    user: &[],
                    dict: &[],
                },
                round_pos,
                round_pos + src.len(),
            )?;
        }
        if self.checksum_flag && !src.is_empty() {
            self.xxh_state.update(src);
        }
        Ok(())
    }
}

const NO_LDM_PARAMS: LdmParams = LdmParams {
    enable_ldm: ParamSwitch::Auto,
    hash_log: 0,
    bucket_size_log: 0,
    min_match_length: 0,
    hash_rate_log: 0,
    window_log: 0,
};

/// What a job tells about itself.
enum Progress {
    /// Some more output, and how much of the input is consumed by now.
    Output { data: Vec<u8>, consumed: usize },
    /// The job stops here.
    Failed(ErrorCode),
}

/// `ZSTDMT_jobDescription`, as far as the worker is concerned.
struct Job {
    /// The prefix, then the input.
    data: Vec<u8>,
    prefix_size: usize,
    round_pos: usize,
    first_job: bool,
    last_job: bool,
    params: CCtxParams,
    cdict: Option<Arc<CDict>>,
    full_frame_size: u64,
    /// How many long distance matches to make room for.
    max_nb_seq: usize,
    /// From the previous job.
    serial_in: Receiver<Box<SerialState>>,
    /// To the next one.
    serial_out: Sender<Box<SerialState>>,
    progress: Sender<Progress>,
}

/// What a worker keeps from one job to the next.
struct WorkerState {
    cctx: FrameCompressor,
    seq: Vec<RawSeq>,
    dst: Vec<u8>,
}

const CHUNK_SIZE: usize = 4 * ZSTD_BLOCKSIZE_MAX;

/// `ZSTDMT_compressionJob`
fn compression_job(state: &mut WorkerState, job: &Job, cancelled: &AtomicBool) -> Result<()> {
    let mut job_params = job.params;
    let src_size = job.data.len() - job.prefix_size;
    let src = job.data.sub(job.prefix_size..)?;

    // Whatever happens, the next job waits for this.
    let mut raw_seq_store = RawSeqStore {
        seq: core::mem::take(&mut state.seq),
        pos: 0,
        pos_in_sequence: 0,
        size: 0,
        capacity: job.max_nb_seq,
    };
    let mut serial = job.serial_in.recv().map_err(|_| ErrorCode::Generic)?;
    let generated = if cancelled.load(Ordering::Relaxed) {
        Err(ErrorCode::Generic)
    } else {
        reset_struct_table(&mut raw_seq_store.seq, job.max_nb_seq, false)
            .and_then(|()| serial.gen_sequences(&mut raw_seq_store, src, job.round_pos))
    };
    // The receiver is gone if the frame is given up.
    let _ = job.serial_out.send(serial);
    generated?;

    reset_table(&mut state.dst, compress_bound(CHUNK_SIZE) + 1024, false)?;

    // Only the first job writes the frame header, and the checksum is not that of one job.
    if !job.first_job {
        job_params.f_params.checksum_flag = false;
    }
    job_params.ldm_params.enable_ldm = ParamSwitch::Disable;
    job_params.nb_workers = 0;

    let cdict = job.cdict.as_deref();
    let input = Input {
        bufs: Buffers {
            in_buff: &[],
            user: &job.data,
            dict: cdict.map_or(&[], CDict::dict_content),
        },
        cdict,
    };
    let cctx = &mut state.cctx;
    if cdict.is_some() {
        cctx.begin(
            &input,
            None,
            DictContentType::Auto,
            DictTableLoadMethod::Fast,
            &job_params,
            job.full_frame_size,
            false,
        )?;
    } else {
        let pledged_src_size = if job.first_job {
            job.full_frame_size
        } else {
            src_size as u64
        };
        job_params.force_window = !job.first_job;
        cctx.begin(
            &input,
            Some(Span {
                buf: BufId::User,
                start: 0,
                end: job.prefix_size,
            }),
            DictContentType::RawContent,
            DictTableLoadMethod::Fast,
            &job_params,
            pledged_src_size,
            false,
        )?;
    }

    raw_seq_store.seq.truncate(raw_seq_store.size);
    cctx.reference_external_sequences(raw_seq_store.seq);

    if !job.first_job {
        // This frame header is not for the output.
        let nothing = Span {
            buf: BufId::User,
            start: job.prefix_size,
            end: job.prefix_size,
        };
        cctx.compress_continue(&mut state.dst, &input, nothing)?;
        cctx.invalidate_rep_codes();
    }

    let nb_chunks = src_size.div_ceil(CHUNK_SIZE);
    let mut ip = job.prefix_size;
    let send = |dst: &[u8], consumed: usize| -> Result<()> {
        let mut data = Vec::new();
        data.try_reserve_exact(dst.len())
            .map_err(|_| ErrorCode::MemoryAllocation)?;
        data.extend_from_slice(dst);
        let _ = job.progress.send(Progress::Output { data, consumed });
        Ok(())
    };
    for chunk_nb in 1..nb_chunks {
        if cancelled.load(Ordering::Relaxed) {
            return Err(ErrorCode::Generic);
        }
        let chunk = Span {
            buf: BufId::User,
            start: ip,
            end: ip + CHUNK_SIZE,
        };
        let c_size = cctx.compress_continue(&mut state.dst, &input, chunk)?;
        ip += CHUNK_SIZE;
        send(state.dst.sub(..c_size)?, CHUNK_SIZE * chunk_nb)?;
    }
    let mut last_c_block_size = 0;
    if nb_chunks > 0 || job.last_job {
        let chunk = Span {
            buf: BufId::User,
            start: ip,
            end: job.data.len(),
        };
        last_c_block_size = if job.last_job {
            cctx.compress_end(&mut state.dst, &input, chunk)?
        } else {
            cctx.compress_continue(&mut state.dst, &input, chunk)?
        };
    }
    send(state.dst.sub(..last_c_block_size)?, src_size)
}

fn worker_main(jobs: &Receiver<Job>, cancelled: &AtomicBool) {
    let mut state = WorkerState {
        cctx: FrameCompressor::new(),
        seq: Vec::new(),
        dst: Vec::new(),
    };
    while let Ok(job) = jobs.recv() {
        if let Err(code) = compression_job(&mut state, &job, cancelled) {
            let _ = job.progress.send(Progress::Failed(code));
        }
        state.seq = state.cctx.take_external_sequences();
    }
}

struct Worker {
    jobs: Sender<Job>,
    thread: JoinHandle<()>,
}

/// `ZSTDMT_jobDescription`, as far as flushing is concerned.
struct PendingJob {
    /// `None` for a job that needs no worker.
    progress: Option<Receiver<Progress>>,
    /// Output that is received and not flushed. The first piece is flushed up to `flushed`.
    output: VecDeque<Vec<u8>>,
    flushed: usize,
    /// How many bytes there are in `output` beyond `flushed`.
    to_flush: usize,
    /// How many bytes were received in all.
    c_size: usize,
    consumed: usize,
    src_size: usize,
    frame_checksum_needed: bool,
    error: Option<ErrorCode>,
}

impl PendingJob {
    fn take(&mut self, progress: Progress) {
        match progress {
            Progress::Output { data, consumed } => {
                self.c_size += data.len();
                self.to_flush += data.len();
                self.consumed = consumed;
                if !data.is_empty() {
                    self.output.push_back(data);
                }
            }
            Progress::Failed(code) => {
                self.error = Some(code);
                self.consumed = self.src_size;
                self.progress = None;
            }
        }
    }

    /// `consumed == src.size` is how the C code tells, which does not do for a job that has no input.
    fn is_complete(&self) -> bool {
        self.progress.is_none()
    }

    /// Takes what the worker has sent. If `wait` is set and there is nothing to flush, waits for some.
    fn poll(&mut self, wait: bool) {
        while let Some(receiver) = &self.progress {
            let received = if wait && self.to_flush == 0 {
                receiver.recv().ok()
            } else {
                match receiver.try_recv() {
                    Ok(progress) => Some(progress),
                    Err(std::sync::mpsc::TryRecvError::Empty) => return,
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => None,
                }
            };
            match received {
                Some(progress) => {
                    let last = matches!(&progress, Progress::Output { consumed, .. } if *consumed == self.src_size);
                    self.take(progress);
                    if last {
                        self.progress = None;
                    }
                }
                // The worker is gone.
                None => self.take(Progress::Failed(ErrorCode::Generic)),
            }
        }
    }
}

/// `ZSTDMT_CCtx`
pub(crate) struct MtCtx {
    workers: Vec<Worker>,
    cancelled: Arc<AtomicBool>,
    /// The jobs from `doneJobID` to `nextJobID`.
    jobs: VecDeque<PendingJob>,
    params: CCtxParams,
    target_section_size: usize,
    target_prefix_size: usize,
    /// `inBuff`: the prefix of the next job, then as much of its input as there is.
    in_buff: Vec<u8>,
    in_buff_prefix_size: usize,
    /// `inBuff.buffer.start != NULL`: there is room for the input of the next job.
    in_buff_ready: bool,
    round_buff_capacity: usize,
    round_buff_pos: usize,
    /// Where the last job that was created leaves the state.
    serial: Option<Receiver<Box<SerialState>>>,
    next_job_id: u32,
    frame_ended: bool,
    all_jobs_completed: bool,
    frame_content_size: u64,
    cdict: Option<Arc<CDict>>,
}

/// `ZSTDMT_computeTargetJobLog`
fn compute_target_job_log(params: &CCtxParams) -> u32 {
    let job_log = if params.ldm_params.enable_ldm == ParamSwitch::Enable {
        // Long distance matching makes up for the matches that cutting loses, so sections can be smaller.
        21.max(cycle_log(params.c_params.chain_log, params.c_params.strat()) + 3)
    } else {
        20.max(params.c_params.window_log + 2)
    };
    job_log.min(ZSTDMT_JOBLOG_MAX)
}

/// `ZSTDMT_overlapLog`
fn overlap_log(ovlog: i32, strat: Strategy) -> i32 {
    if ovlog != 0 {
        return ovlog;
    }
    match strat {
        Strategy::BtUltra2 => 9,
        Strategy::BtUltra | Strategy::BtOpt => 8,
        Strategy::BtLazy2 | Strategy::Lazy2 => 7,
        Strategy::Lazy | Strategy::Greedy | Strategy::DFast | Strategy::Fast => 6,
    }
}

/// `ZSTDMT_computeOverlapSize`
fn compute_overlap_size(params: &CCtxParams) -> usize {
    let overlap_r_log = 9 - overlap_log(params.overlap_log, params.c_params.strat());
    let mut ov_log = if overlap_r_log >= 8 {
        0
    } else {
        params.c_params.window_log as i32 - overlap_r_log
    };
    if params.ldm_params.enable_ldm == ParamSwitch::Enable {
        ov_log = (params.c_params.window_log).min(compute_target_job_log(params) - 2) as i32
            - overlap_r_log;
    }
    if ov_log == 0 { 0 } else { 1 << ov_log }
}

impl MtCtx {
    /// `ZSTDMT_createCCtx_advanced`
    pub(crate) fn new(nb_workers: u32) -> Result<Self> {
        let mut mtctx = Self {
            workers: Vec::new(),
            cancelled: Arc::new(AtomicBool::new(false)),
            jobs: VecDeque::new(),
            params: CCtxParams::new(0),
            target_section_size: 0,
            target_prefix_size: 0,
            in_buff: Vec::new(),
            in_buff_prefix_size: 0,
            in_buff_ready: false,
            round_buff_capacity: 0,
            round_buff_pos: 0,
            serial: None,
            next_job_id: 0,
            frame_ended: false,
            all_jobs_completed: true,
            frame_content_size: 0,
            cdict: None,
        };
        mtctx.resize(nb_workers.clamp(1, ZSTDMT_NBWORKERS_MAX as u32) as usize)?;
        Ok(mtctx)
    }

    /// `ZSTDMT_resize`: no job is under way.
    fn resize(&mut self, nb_workers: usize) -> Result<()> {
        for worker in self.workers.drain(nb_workers.min(self.workers.len())..) {
            drop(worker.jobs);
            let _ = worker.thread.join();
        }
        while self.workers.len() < nb_workers {
            let (jobs, receiver) = channel();
            let cancelled = Arc::clone(&self.cancelled);
            let thread = std::thread::Builder::new()
                .name("zstd".into())
                .stack_size(2 << 20)
                .spawn(move || worker_main(&receiver, &cancelled))
                .map_err(|_| ErrorCode::MemoryAllocation)?;
            self.workers.push(Worker { jobs, thread });
        }
        self.params.nb_workers = nb_workers as i32;
        Ok(())
    }

    /// `ZSTDMT_waitForAllJobsCompleted` and `ZSTDMT_releaseAllJobResources`, for a frame that is given up.
    fn abandon_jobs(&mut self) {
        self.cancelled.store(true, Ordering::Relaxed);
        for job in &mut self.jobs {
            while !job.is_complete() {
                job.to_flush = 0;
                job.output.clear();
                job.poll(true);
            }
        }
        self.cancelled.store(false, Ordering::Relaxed);
        self.jobs.clear();
        self.in_buff = Vec::new();
        self.in_buff_prefix_size = 0;
        self.in_buff_ready = false;
        self.all_jobs_completed = true;
    }

    /// The state, once all the jobs that were created have had it.
    fn take_serial(&mut self) -> Box<SerialState> {
        (self.serial.take())
            .and_then(|serial| serial.recv().ok())
            .unwrap_or_else(|| Box::new(SerialState::new()))
    }

    /// `ZSTDMT_updateCParams_whileCompressing`: for the jobs to come.
    pub(crate) fn update_c_params_while_compressing(&mut self, cctx_params: &CCtxParams) {
        // The window is in the frame header.
        let saved_wlog = self.params.c_params.window_log;
        self.params.compression_level = cctx_params.compression_level;
        let mut c_params = get_c_params_from_cctx_params(
            cctx_params,
            ZSTD_CONTENTSIZE_UNKNOWN,
            0,
            CParamMode::NoAttachDict,
        );
        c_params.window_log = saved_wlog;
        self.params.c_params = c_params;
    }

    /// `ZSTDMT_initCStream_internal`
    pub(crate) fn init_c_stream_internal(
        &mut self,
        cdict: Option<Arc<CDict>>,
        mut params: CCtxParams,
        pledged_src_size: u64,
    ) -> Result<()> {
        if !self.all_jobs_completed {
            self.abandon_jobs();
        }
        if params.nb_workers != self.params.nb_workers {
            self.resize(params.nb_workers as usize)?;
        }

        if params.job_size != 0 && params.job_size < ZSTDMT_JOBSIZE_MIN as usize {
            params.job_size = ZSTDMT_JOBSIZE_MIN as usize;
        }
        params.job_size = params.job_size.min(ZSTDMT_JOBSIZE_MAX as usize);

        self.params = params;
        self.frame_content_size = pledged_src_size;
        self.target_prefix_size = compute_overlap_size(&params);
        self.target_section_size = params.job_size;
        if self.target_section_size == 0 {
            self.target_section_size = 1 << compute_target_job_log(&params);
        }
        self.target_section_size = self.target_section_size.max(self.target_prefix_size);
        {
            let window_size = if params.ldm_params.enable_ldm == ParamSwitch::Enable {
                1usize << params.c_params.window_log
            } else {
                0
            };
            let nb_slack_buffers = 2 + usize::from(self.target_prefix_size > 0);
            let slack_size = self.target_section_size * nb_slack_buffers;
            let nb_workers = params.nb_workers.max(1) as usize;
            let sections_size = self.target_section_size * nb_workers;
            let capacity = window_size.max(sections_size) + slack_size;
            self.round_buff_capacity = self.round_buff_capacity.max(capacity);
        }
        self.round_buff_pos = 0;
        self.in_buff = Vec::new();
        self.in_buff_prefix_size = 0;
        self.in_buff_ready = false;
        self.next_job_id = 0;
        self.frame_ended = false;
        self.all_jobs_completed = false;
        self.cdict = cdict;

        let mut serial = self.take_serial();
        serial.reset(&params, self.round_buff_capacity)?;
        let (sender, receiver) = channel();
        let _ = sender.send(serial);
        self.serial = Some(receiver);
        Ok(())
    }

    /// The most jobs at a time, which bounds memory as the size of the round buffer does in the C code.
    fn max_jobs(&self) -> usize {
        self.workers.len() + 2
    }

    /// `ZSTDMT_createCompressionJob`: of the input there is in `in_buff`.
    fn create_compression_job(&mut self, end_op: EndDirective) -> Result<()> {
        let end_frame = end_op == EndDirective::End;
        if self.jobs.len() >= self.max_jobs() {
            // Later.
            return Ok(());
        }

        let data = core::mem::take(&mut self.in_buff);
        let prefix_size = self.in_buff_prefix_size;
        let src_size = data.len() - prefix_size;
        let round_pos = self.round_buff_pos;
        let first_job = self.next_job_id == 0;
        let params = self.params;
        let frame_checksum_needed = params.f_params.checksum_flag && end_frame && !first_job;

        self.round_buff_pos += src_size;
        self.in_buff_ready = false;
        self.in_buff_prefix_size = 0;
        if !end_frame {
            let new_prefix_size = src_size.min(self.target_prefix_size);
            self.in_buff
                .try_reserve_exact(new_prefix_size + self.target_section_size)
                .map_err(|_| ErrorCode::MemoryAllocation)?;
            self.in_buff
                .extend_from_slice(data.sub(data.len() - new_prefix_size..)?);
            self.in_buff_prefix_size = new_prefix_size;
        } else {
            self.frame_ended = true;
            if first_job {
                // The only job writes the checksum itself.
                self.params.f_params.checksum_flag = false;
            }
        }

        let mut pending = PendingJob {
            progress: None,
            output: VecDeque::new(),
            flushed: 0,
            to_flush: 0,
            c_size: 0,
            consumed: 0,
            src_size,
            frame_checksum_needed,
            error: None,
        };

        if src_size == 0 && !first_job {
            // `ZSTDMT_writeLastEmptyBlock`: all there is left to do is to end the frame.
            let mut block = [0u8; 3];
            let size = write_last_empty_block(&mut block)?;
            pending.take(Progress::Output {
                data: block.sub(..size)?.to_vec(),
                consumed: 0,
            });
            self.jobs.push_back(pending);
            self.next_job_id += 1;
            return Ok(());
        }

        let (progress, progress_receiver) = channel();
        let (serial_out, serial_next) = channel();
        let serial_in = self.serial.replace(serial_next).ok_or(ErrorCode::Generic)?;
        pending.progress = Some(progress_receiver);
        let mut ldm_params = params.ldm_params;
        if ldm_params.enable_ldm == ParamSwitch::Enable {
            ldm::adjust_parameters(&mut ldm_params, &params.c_params);
        }
        let job = Job {
            data,
            prefix_size,
            round_pos,
            first_job,
            last_job: end_frame,
            params,
            cdict: if first_job { self.cdict.clone() } else { None },
            full_frame_size: self.frame_content_size,
            max_nb_seq: ldm::get_max_nb_seq(ldm_params, self.target_section_size),
            serial_in,
            serial_out,
            progress,
        };
        let worker = (self.workers)
            .get(self.next_job_id as usize % self.workers.len().max(1))
            .ok_or(ErrorCode::Generic)?;
        worker.jobs.send(job).map_err(|_| ErrorCode::Generic)?;
        self.jobs.push_back(pending);
        self.next_job_id += 1;
        Ok(())
    }

    /// `ZSTDMT_flushProduced`: returns the least number of bytes that are left to flush.
    fn flush_produced(
        &mut self,
        output: &mut OutBuffer<'_>,
        block_to_flush: bool,
        end: EndDirective,
    ) -> Result<usize> {
        if let Some(job) = self.jobs.front_mut() {
            job.poll(block_to_flush);
            if let Some(code) = job.error {
                self.abandon_jobs();
                return Err(code);
            }
        }
        if self
            .jobs
            .front()
            .is_some_and(|job| job.is_complete() && job.frame_checksum_needed)
        {
            let serial = self.take_serial();
            let checksum = serial.xxh_state.digest() as u32;
            let (sender, receiver) = channel();
            let _ = sender.send(serial);
            self.serial = Some(receiver);
            if let Some(job) = self.jobs.front_mut() {
                job.frame_checksum_needed = false;
                let consumed = job.consumed;
                job.take(Progress::Output {
                    data: checksum.to_le_bytes().to_vec(),
                    consumed,
                });
            }
        }
        if let Some(job) = self.jobs.front_mut() {
            while let Some(piece) = job.output.front() {
                let room = output.dst.sub_mut(output.pos..)?;
                let rest = piece.sub(job.flushed..)?;
                let n = rest.len().min(room.len());
                room.write_at(0, rest.sub(..n)?)?;
                output.pos += n;
                job.to_flush -= n;
                if n < rest.len() {
                    job.flushed += n;
                    break;
                }
                job.flushed = 0;
                job.output.pop_front();
            }
            let (to_flush, complete) = (job.to_flush, job.is_complete());
            if complete && to_flush == 0 {
                self.jobs.pop_front();
            }
            if to_flush > 0 {
                return Ok(to_flush);
            }
            if !complete {
                return Ok(1);
            }
        }
        if !self.jobs.is_empty() {
            return Ok(1);
        }
        if self.in_buff.len() > self.in_buff_prefix_size {
            return Ok(1);
        }
        self.all_jobs_completed = self.frame_ended;
        if end == EndDirective::End {
            return Ok(usize::from(!self.frame_ended));
        }
        Ok(0)
    }

    /// `ZSTDMT_tryGetInputRange`: whether the next job can start taking input.
    fn try_get_input_range(&mut self) -> Result<bool> {
        if self.jobs.len() >= self.max_jobs() {
            return Ok(false);
        }
        let space_left = self.round_buff_capacity - self.round_buff_pos;
        if space_left < self.target_section_size {
            // The C code moves the prefix to the start of the round buffer.
            self.round_buff_pos = self.in_buff_prefix_size;
        }
        self.in_buff
            .try_reserve_exact(self.target_section_size)
            .map_err(|_| ErrorCode::MemoryAllocation)?;
        self.in_buff_ready = true;
        Ok(true)
    }

    /// `ZSTDMT_compressStream_generic`
    pub(crate) fn compress_stream_generic(
        &mut self,
        output: &mut OutBuffer<'_>,
        input: &mut InBuffer<'_>,
        mut end_op: EndDirective,
    ) -> Result<usize> {
        let mut forward_input_progress = false;

        if self.frame_ended && end_op == EndDirective::Continue {
            // The frame is complete and still to be flushed.
            return Err(ErrorCode::StageWrong);
        }

        if input.src.len() > input.pos && (self.in_buff_ready || self.try_get_input_range()?) {
            let filled = self.in_buff.len() - self.in_buff_prefix_size;
            let to_load = (input.src.len() - input.pos).min(self.target_section_size - filled);
            self.in_buff
                .extend_from_slice(input.src.span(input.pos, to_load)?);
            input.pos += to_load;
            forward_input_progress = to_load > 0;
        }

        if input.pos < input.src.len() && end_op == EndDirective::End {
            // Not before all the input is consumed.
            end_op = EndDirective::Flush;
        }

        let filled = self.in_buff.len() - self.in_buff_prefix_size;
        if filled >= self.target_section_size
            || (end_op != EndDirective::Continue && filled > 0)
            || (end_op == EndDirective::End && !self.frame_ended)
        {
            self.create_compression_job(end_op)?;
        }

        // Waits for a job to output something if this call did nothing else.
        let remaining_to_flush = self.flush_produced(output, !forward_input_progress, end_op)?;
        if input.pos < input.src.len() {
            return Ok(remaining_to_flush.max(1));
        }
        Ok(remaining_to_flush)
    }
}

impl Drop for MtCtx {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Relaxed);
        for worker in self.workers.drain(..) {
            drop(worker.jobs);
            let _ = worker.thread.join();
        }
    }
}
