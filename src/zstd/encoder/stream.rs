//! Compression of input that comes in pieces, into output that is taken in pieces.

use core::ops::Range;

use bun_removable_features::removable_definition;
use bun_zstd_decoder::array::allocate;
use bun_zstd_decoder::{Error, Output, Result, Status};

use crate::dictionary::Dictionary;
use crate::frame::{FrameWriter, Start};
use crate::parameters::{JOB_LEN_MIN, Plan, Purpose, Request};
use crate::vec::{self, Shared};
use crate::window::Input;
use crate::workers::{Pool, Workers};
use crate::worst_case_len;

/// The values are those of `ZSTD_EndDirective`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum EndDirective {
    Continue = 0,
    /// Makes all input so far decodable.
    Flush = 1,
    /// Ends the frame.
    End = 2,
}

/// The output that there was no room for.
#[derive(Default)]
pub(crate) struct Backlog {
    bytes: Vec<u8>,
    left: Range<usize>,
}

impl Backlog {
    pub(crate) fn of(bytes: Vec<u8>) -> Self {
        let left = 0..bytes.len();
        Self { bytes, left }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.left.is_empty()
    }

    fn fill(
        &mut self,
        room: usize,
        write: impl FnOnce(&mut Output<'_>) -> Result<()>,
    ) -> Result<()> {
        vec::make_room(&mut self.bytes, room)?;
        let mut out = Output::resume_ring(&mut self.bytes, 0, room);
        write(&mut out)?;
        self.left = 0..out.written();
        Ok(())
    }

    pub(crate) fn flush(&mut self, out: &mut Output<'_>) {
        if let Some(left @ [_, ..]) = self.bytes.get(self.left.clone()) {
            self.left.start += out.append(left);
        }
    }
}

/// Where the segment before the current one is.
#[derive(Clone, Copy)]
enum Older {
    InDictionary,
    InBuffer { end: usize },
}

/// Collects input into blocks. At the end of its buffer, it starts over.
struct Buffered {
    writer: FrameWriter,
    buffer: Vec<u8>,
    capacity: usize,
    older: Older,
    /// Of the block that is being filled.
    start: usize,
    filled: usize,
    target: usize,
    backlog: Backlog,
    has_ended: bool,
    /// How many in a row would have done with much less memory.
    small_frames: u32,
}

impl Buffered {
    /// With the memory of the frame before, if there was one.
    fn new(
        plan: Plan,
        input_len: Option<u64>,
        dictionary: Option<&Dictionary>,
        earlier: Option<Box<Self>>,
    ) -> Result<Box<Self>> {
        let mut frame = match earlier {
            Some(frame) => frame,
            None => allocate(|| Self {
                writer: FrameWriter::new(plan),
                buffer: Vec::new(),
                capacity: 0,
                older: Older::InDictionary,
                start: 0,
                filled: 0,
                target: 0,
                backlog: Backlog::default(),
                has_ended: false,
                small_frames: 0,
            })?,
        };
        frame
            .writer
            .start(plan, input_len, Start::Frame(dictionary))?;
        let block_len = frame.writer.block_len_max();
        frame.capacity = frame.writer.window_len() + block_len;
        (frame.older, frame.start, frame.filled) = (Older::InDictionary, 0, 0);
        // If that is all, the end of the frame does not need a block of its own.
        frame.target = block_len + usize::from(input_len == Some(block_len as u64));
        frame.has_ended = false;
        Ok(frame)
    }

    /// Whether the next frame should take over the memory.
    fn is_worth_keeping(&mut self) -> bool {
        const OVERSIZE_FACTOR: usize = 3;
        const SMALL_FRAMES_MAX: u32 = 128;
        let [held, needed] = self.writer.tables_len();
        let is_small = held + self.buffer.capacity() >= OVERSIZE_FACTOR * (needed + self.capacity);
        self.small_frames = if is_small { self.small_frames + 1 } else { 0 };
        self.small_frames < SMALL_FRAMES_MAX
    }

    /// What is left of the older segment, if the buffer is overwritten up to `overwritten`.
    fn older<'a>(
        older: Older,
        buffer: &'a [u8],
        overwritten: usize,
        dictionary: Option<&'a Dictionary>,
    ) -> &'a [u8] {
        match older {
            Older::InDictionary => dictionary.map(Dictionary::content),
            Older::InBuffer { end } => buffer.get(overwritten..end),
        }
        .unwrap_or_default()
    }

    fn fill(&mut self, input: &mut &[u8]) -> Result<()> {
        const SHORT_LEN: usize = 16 << 10;
        let len = input.len().min(self.target - self.filled);
        if self.filled + len > self.buffer.capacity() {
            let capacity = match self.filled + len {
                ..=SHORT_LEN => self.capacity.min(SHORT_LEN),
                _ => self.capacity,
            };
            self.buffer
                .try_reserve_exact(capacity - self.buffer.len())?;
        }
        let taken = input.split_off(..len).unwrap_or_default();
        vec::write_at(&mut self.buffer, self.filled, taken);
        self.filled += len;
        Ok(())
    }

    fn write_block(
        &mut self,
        dictionary: Option<&Dictionary>,
        is_last: bool,
        out: &mut Output<'_>,
    ) -> Result<()> {
        let input = Input {
            segment: self.buffer.get(..self.filled).ok_or(Error::Internal)?,
            len: self.filled - self.start,
            follows_last: self.start != 0,
            older: Self::older(self.older, &self.buffer, self.filled, dictionary),
        };
        let block_len = self.writer.block_len_max();
        if out.room() >= worst_case_len(input.len) {
            self.writer.write(&input, dictionary, is_last, out)?;
        } else {
            self.backlog.fill(worst_case_len(block_len) + 1, |out| {
                self.writer.write(&input, dictionary, is_last, out)
            })?;
        }
        self.has_ended = is_last;

        if self.filled + block_len > self.capacity {
            self.older = Older::InBuffer { end: self.filled };
            self.filled = 0;
        }
        self.start = self.filled;
        self.target = self.filled + block_len;
        Ok(())
    }

    fn step(
        &mut self,
        input: &mut &[u8],
        dictionary: Option<&Dictionary>,
        out: &mut Output<'_>,
        directive: EndDirective,
    ) -> Result<Status> {
        loop {
            self.backlog.flush(out);
            if !self.backlog.is_empty() {
                return Ok(Status::Pending);
            }
            if self.has_ended {
                return Ok(Status::Complete);
            }
            if directive == EndDirective::End
                && self.filled == 0
                && out.room() >= worst_case_len(input.len())
            {
                let older = Self::older(self.older, &self.buffer, 0, dictionary);
                let input = Input::alone(core::mem::take(input), older);
                self.writer.write(&input, dictionary, true, out)?;
                self.has_ended = true;
                return Ok(Status::Complete);
            }

            self.fill(input)?;
            let is_done = match directive {
                EndDirective::Continue => self.filled < self.target,
                EndDirective::Flush => self.filled == self.start,
                EndDirective::End => false,
            };
            if is_done {
                return Ok(Status::Complete);
            }
            let is_last = directive == EndDirective::End && input.is_empty();
            self.write_block(dictionary, is_last, out)?;
        }
    }
}

enum Frame {
    Buffered(Box<Buffered>),
    Parallel(Box<Workers>),
}

/// Writes one frame after the other.
pub struct Encoder {
    request: Request,
    /// Of the next frame.
    pledged_len: Option<u64>,
    dictionary_bytes: Option<Shared<Vec<u8>>>,
    /// From when the first frame starts, as the parameters are known then.
    dictionary: Option<Shared<Dictionary>>,
    frame: Option<Frame>,
    /// The next one takes over its memory.
    finished: Option<Box<Buffered>>,
    /// Waits for the jobs of `frame`, so it has to be dropped after it.
    pool: Pool,
    error: Option<Error>,
}

impl Encoder {
    pub fn new(level: i32) -> Self {
        Self {
            request: Request::new(level),
            pledged_len: None,
            dictionary_bytes: None,
            dictionary: None,
            frame: None,
            finished: None,
            pool: Pool::default(),
            error: None,
        }
    }

    fn ensure_idle(&self) -> Result<()> {
        match (self.error, &self.frame) {
            (Some(error), _) => Err(error),
            (None, Some(_)) => Err(Error::StageWrong),
            (None, None) => Ok(()),
        }
    }

    /// For all frames from the next one on.
    pub fn load_dictionary(&mut self, dictionary: &[u8]) -> Result<()> {
        self.ensure_idle()?;
        (self.dictionary, self.dictionary_bytes) = (None, None);
        if !dictionary.is_empty() {
            self.dictionary_bytes = Some(vec::shared(vec::copied(dictionary)?)?);
        }
        Ok(())
    }

    /// How long the input of the next frame is going to be.
    pub fn set_pledged_len(&mut self, len: Option<u64>) -> Result<()> {
        self.ensure_idle()?;
        self.pledged_len = len;
        Ok(())
    }

    /// `key` is a `ZSTD_cParameter`.
    #[inline(never)]
    pub fn set_parameter(&mut self, key: u32, value: i32) -> Result<()> {
        removable_definition!(ZstdCompressor, Self::set_parameter);
        self.ensure_idle()?;
        self.request.set(key, value)
    }

    /// Forgets the frame in progress and an error, but not the parameters and the dictionary.
    pub fn reset_session(&mut self) {
        (self.frame, self.error, self.pledged_len) = (None, None, None);
    }

    fn start_frame(&mut self, input_len: Option<u64>) -> Result<Frame> {
        if let (Some(bytes), None) = (&self.dictionary_bytes, &self.dictionary) {
            self.dictionary = Some(vec::shared(Dictionary::new(bytes, &self.request)?)?);
        }
        let dictionary = self.dictionary.as_deref();
        let copied = dictionary.filter(|it| !it.is_attached_for(input_len));
        let dictionary_len = copied.map_or(0, Dictionary::len);
        let tuning = self
            .request
            .tuning(input_len, Purpose::Frame { dictionary_len });
        let plan = self.request.plan(tuning);

        if self.request.workers > 0 && input_len.is_none_or(|len| len > JOB_LEN_MIN as u64) {
            let (dictionary, pool) = (self.dictionary.as_ref(), &mut self.pool);
            let workers = Workers::new(plan, &self.request, input_len, dictionary, pool)?;
            return Ok(Frame::Parallel(allocate(|| workers)?));
        }
        Buffered::new(plan, input_len, dictionary, self.finished.take()).map(Frame::Buffered)
    }

    fn try_step(
        &mut self,
        input: &mut &[u8],
        out: &mut Output<'_>,
        directive: EndDirective,
    ) -> Result<Status> {
        let frame = match &mut self.frame {
            Some(frame) => frame,
            None => {
                let pledged_len = self.pledged_len.take();
                let frame = self.start_frame(match directive {
                    EndDirective::End => Some(input.len() as u64),
                    _ => pledged_len,
                })?;
                self.frame.insert(frame)
            }
        };
        let (status, has_ended) = match frame {
            Frame::Buffered(frame) => {
                let status = frame.step(input, self.dictionary.as_deref(), out, directive)?;
                (status, frame.has_ended)
            }
            Frame::Parallel(frame) => (
                frame.step(&mut self.pool, input, out, directive)?,
                directive == EndDirective::End,
            ),
        };
        if has_ended
            && status == Status::Complete
            && let Some(Frame::Buffered(mut frame)) = self.frame.take()
            && frame.is_worth_keeping()
        {
            self.finished = Some(frame);
        }
        Ok(status)
    }

    /// Returns how much of `input` it took. An error stays until [`reset_session`](Self::reset_session).
    #[inline(never)]
    pub fn step(
        &mut self,
        input: &[u8],
        out: &mut Output<'_>,
        directive: EndDirective,
    ) -> (usize, Result<Status>) {
        removable_definition!(ZstdCompressor, Self::step);
        if let Some(error) = self.error {
            return (0, Err(error));
        }
        let (mut left, written_before) = (input, out.written());
        match self.try_step(&mut left, out, directive) {
            Ok(status) => (input.len() - left.len(), Ok(status)),
            Err(error) => {
                out.rewind(written_before);
                (self.error, self.frame) = (Some(error), None);
                (0, Err(error))
            }
        }
    }
}
