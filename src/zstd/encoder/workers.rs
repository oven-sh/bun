//! Cuts the input into sections, which threads compress. Each job owns what it works on.

use std::collections::VecDeque;
use std::thread::JoinHandle;

use bun_zstd_decoder::array::allocate;
use bun_zstd_decoder::format::{BLOCK_LEN_MAX, CHECKSUM_LEN, FRAME_HEADER_LEN_MAX};
use bun_zstd_decoder::{Error, Output, Result, Status, XxHash64};

use crate::channel::{self, Receiver, Sender};
use crate::dictionary::Dictionary;
use crate::frame::{self, FrameWriter, Interest, Start};
use crate::matches::long_distance::{Candidates, Finder};
use crate::parameters::{LongDistance, LongMatches, Plan, Request, Strategy};
use crate::stream::{Backlog, EndDirective};
use crate::vec::{self, Shared};
use crate::window::Input;
use crate::worst_case_len;

/// After how much input a job reports output.
const CHUNK_LEN: usize = 4 * BLOCK_LEN_MAX;
const STACK_LEN: usize = 1 << 20;

/// Sees all sections, and so finds matches between them.
struct LongMatcher {
    parameters: LongDistance,
    finder: Finder,
    /// Starts over at its end.
    buffer: Vec<u8>,
    filled: usize,
    older_end: usize,
    section_len: usize,
}

impl LongMatcher {
    fn find(
        &mut self,
        section: &[u8],
        candidates: &mut Candidates,
        interest: &Interest,
    ) -> Result<()> {
        if self.filled + section.len() > self.buffer.capacity() {
            self.older_end = core::mem::take(&mut self.filled);
        }
        let start = self.filled;
        vec::write_at(&mut self.buffer, start, section);
        self.filled += section.len();

        let older = self.buffer.get(self.filled..self.older_end);
        let input = Input {
            segment: self.buffer.get(..self.filled).ok_or(Error::Internal)?,
            len: section.len(),
            follows_last: start != 0,
            older: older.unwrap_or_default(),
        };
        candidates.clear_for(self.section_len, &self.parameters)?;
        self.finder.admit(&input);
        let is_lost = || interest.ensure().is_err();
        self.finder
            .find(&input, start, section.len(), candidates, is_lost);
        interest.ensure()
    }
}

/// Goes from one job to the next.
struct Relay {
    hash: Option<XxHash64>,
    long_matcher: Option<LongMatcher>,
}

enum Report {
    Output(Vec<u8>),
    /// With the buffer that the input was in.
    Done(Vec<u8>),
    Failed(Error),
}

struct Job {
    plan: Plan,
    /// The end of the section before, and this one.
    input: Vec<u8>,
    start: usize,
    /// For the first one: the length of all input, and the dictionary.
    frame: Option<(Option<u64>, Option<Shared<Dictionary>>)>,
    is_last: bool,
    relay: Receiver<Box<Relay>>,
    next_relay: Option<Sender<Box<Relay>>>,
    reports: Sender<Report>,
    interest: Interest,
}

#[derive(Default)]
struct Worker {
    writer: Option<FrameWriter>,
    long_matches: Candidates,
    out: Vec<u8>,
}

impl Worker {
    fn compress(&mut self, job: &mut Job) -> Result<()> {
        job.interest.ensure()?;
        let (earlier, section) = job
            .input
            .split_at_checked(job.start)
            .ok_or(Error::Internal)?;
        let mut relay = job.relay.wait()?;
        self.long_matches.clear();
        if let Some(matcher) = &mut relay.long_matcher {
            matcher.find(section, &mut self.long_matches, &job.interest)?;
        }
        if let Some(hash) = &mut relay.hash {
            hash.update(section);
        }
        job.next_relay
            .take()
            .ok_or(Error::Internal)?
            .send_last(relay);
        job.interest.ensure()?;

        let (len, dictionary, start) = match &job.frame {
            Some((len, dictionary)) => {
                let dictionary = dictionary.as_deref();
                (*len, dictionary, Start::Frame(dictionary))
            }
            None => (Some(section.len() as u64), None, Start::Part(earlier)),
        };
        let writer = self
            .writer
            .get_or_insert_with(|| FrameWriter::new(job.plan));
        writer.interest = job.interest.clone();
        writer.start(job.plan, len, start)?;
        core::mem::swap(&mut writer.long_matches, &mut self.long_matches);
        let [for_chunk, for_block] =
            [CHUNK_LEN, BLOCK_LEN_MAX].map(|len| worst_case_len(len.min(section.len())));
        let room = FRAME_HEADER_LEN_MAX + for_chunk + 2 * for_block + CHECKSUM_LEN;
        vec::make_room(&mut self.out, room)?;

        let mut start = job.start;
        loop {
            let end = job.input.len().min(start + CHUNK_LEN);
            let input = Input {
                segment: job.input.get(..end).ok_or(Error::Internal)?,
                len: end - start,
                follows_last: start != 0,
                older: dictionary.map(Dictionary::content).unwrap_or_default(),
            };
            let mut out = Output::resume_ring(&mut self.out, 0, room);
            let is_last = job.is_last && end == job.input.len();
            writer.write(&input, dictionary, is_last, &mut out)?;
            let written = out.written();
            drop(out);
            let output = vec::copied(self.out.get(..written).unwrap_or_default())?;
            job.reports.send(Report::Output(output))?;
            if end == job.input.len() {
                return Ok(());
            }
            start = end;
        }
    }

    fn run(mut self, jobs: &Receiver<Job>) {
        while let Ok(mut job) = jobs.wait() {
            let report = match self.compress(&mut job) {
                Ok(()) => Report::Done(job.input),
                Err(error) => Report::Failed(error),
            };
            job.reports.send_last(report);
        }
    }
}

/// The lengths of a section, and of what a job indexes of the one before.
fn section_and_overlap_len(plan: &Plan, request: &Request) -> (usize, usize) {
    let tuning = &plan.tuning;
    // For long distances the window is too large to go by.
    let section_log = match plan.long_matches {
        LongMatches::None => (tuning.window_log + 2).max(20),
        _ => (tuning.cycle_log() + 3).max(21),
    };
    let section_log = section_log.min(30);
    let overlap_log = match (request.overlap_log, tuning.strategy) {
        (0, Strategy::Ultra2) => 9,
        (0, Strategy::Optimal | Strategy::Ultra) => 8,
        (0, Strategy::Lazy2 | Strategy::TreeLazy2) => 7,
        (0, _) => 6,
        (log, _) => log,
    };
    let overlap_len = match plan.long_matches {
        LongMatches::None if overlap_log > 1 => 1 << (tuning.window_log - (9 - overlap_log)),
        LongMatches::None => 0,
        _ => 1 << (tuning.window_log.min(section_log - 2) - (9 - overlap_log)),
    };
    let section_len = match request.job_len {
        0 => 1 << section_log,
        len => len,
    };
    (section_len.max(overlap_len), overlap_len)
}

#[derive(Default)]
pub(crate) struct Pool {
    jobs: Option<(Sender<Job>, Receiver<Job>)>,
    threads: Vec<JoinHandle<()>>,
}

impl Pool {
    /// Starts another thread if there are fewer. One is enough to go on.
    fn prepare(&mut self, useful_threads: usize) -> Result<&Sender<Job>> {
        let (sender, receiver) = match &mut self.jobs {
            Some(jobs) => jobs,
            none => none.insert(channel::new()?),
        };
        if self.threads.len() < useful_threads {
            self.threads.try_reserve(1)?;
            let jobs = receiver.share();
            let spawned = std::thread::Builder::new()
                .name("Zstd Worker".into())
                .stack_size(STACK_LEN)
                .spawn(move || Worker::default().run(&jobs));
            self.threads.extend(spawned);
        }
        if self.threads.is_empty() {
            return Err(Error::MemoryAllocation);
        }
        Ok(sender)
    }
}

impl Drop for Pool {
    fn drop(&mut self) {
        self.jobs = None;
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

/// A frame whose sections go to a [`Pool`].
pub(crate) struct Workers {
    plan: Plan,
    /// Until the first job takes it.
    frame: Option<(Option<u64>, Option<Shared<Dictionary>>)>,
    input_left: Option<u64>,
    section_len: usize,
    overlap_len: usize,
    /// For the next job.
    input: Vec<u8>,
    start: usize,
    relay: Receiver<Box<Relay>>,
    spare_inputs: Vec<Vec<u8>>,
    threads_max: usize,
    interest: Interest,
    /// Of the jobs whose output is still to come, in order.
    reports: VecDeque<Receiver<Report>>,
    backlog: Backlog,
    /// The section filled up before the frame was told to end.
    is_followed: bool,
    has_posted_last: bool,
    /// What follows the output of the jobs.
    needs_last_block: bool,
    needs_checksum: bool,
}

impl Workers {
    pub(crate) fn new(
        mut plan: Plan,
        request: &Request,
        input_len: Option<u64>,
        dictionary: Option<&Shared<Dictionary>>,
        pool: &mut Pool,
    ) -> Result<Self> {
        pool.prepare(1)?;
        let (section_len, overlap_len) = section_and_overlap_len(&plan, request);
        let window_log = plan.tuning.window_log;
        let long_matcher = match plan.long_matches {
            LongMatches::Own(parameters) => {
                plan.long_matches = LongMatches::Given;
                let parameters = parameters.completed(&plan.tuning);
                Some(LongMatcher {
                    parameters,
                    finder: Finder::new(parameters, window_log)?,
                    buffer: vec::with_room((1 << window_log) + 2 * section_len)?,
                    filled: 0,
                    older_end: 0,
                    section_len,
                })
            }
            _ => None,
        };
        let (sender, relay) = channel::new()?;
        sender.send_last(allocate(|| Relay {
            hash: plan.header.has_checksum.then(XxHash64::new),
            long_matcher,
        })?);

        let jobs_max = request.workers + 2;
        let mut reports = VecDeque::new();
        reports.try_reserve_exact(jobs_max)?;
        Ok(Self {
            plan,
            frame: Some((input_len, dictionary.map(Shared::clone))),
            input_left: input_len,
            section_len,
            overlap_len,
            input: vec::with_room(overlap_len + section_len)?,
            start: 0,
            relay,
            spare_inputs: vec::with_room(jobs_max)?,
            threads_max: request.workers,
            interest: Interest::new()?,
            reports,
            backlog: Backlog::default(),
            is_followed: false,
            has_posted_last: false,
            needs_last_block: false,
            needs_checksum: false,
        })
    }

    fn filled(&self) -> usize {
        self.input.len() - self.start
    }

    fn fill(&mut self, input: &mut &[u8]) -> Result<()> {
        let len = input.len().min(self.section_len - self.filled());
        if let Some(left) = &mut self.input_left {
            *left = left.checked_sub(len as u64).ok_or(Error::SrcSizeWrong)?;
        }
        self.input
            .extend_from_slice(input.split_off(..len).unwrap_or_default());
        Ok(())
    }

    fn post(&mut self, pool: &mut Pool, is_last: bool) -> Result<()> {
        if is_last && self.input_left.is_some_and(|left| left != 0) {
            return Err(Error::SrcSizeWrong);
        }
        let frame = self.frame.take();
        let mut plan = self.plan;
        (self.has_posted_last, self.is_followed) = (is_last, false);
        if frame.is_none() {
            self.needs_checksum = is_last && plan.header.has_checksum;
            plan.header.has_checksum = false;
            if self.filled() == 0 {
                self.needs_last_block = true;
                return Ok(());
            }
        }

        let mut next_input = Vec::new();
        if !is_last {
            next_input = self.spare_inputs.pop().unwrap_or_default();
            vec::clear_for(&mut next_input, self.overlap_len + self.section_len)?;
            let overlap = self.input.len() - self.overlap_len.min(self.filled());
            next_input.extend_from_slice(self.input.get(overlap..).unwrap_or_default());
        }
        let (relay_sender, next_relay) = channel::new()?;
        let (reports, receiver) = channel::new()?;
        let job = Job {
            plan,
            start: core::mem::replace(&mut self.start, next_input.len()),
            input: core::mem::replace(&mut self.input, next_input),
            frame,
            is_last,
            relay: core::mem::replace(&mut self.relay, next_relay),
            next_relay: Some(relay_sender),
            reports,
            interest: self.interest.clone(),
        };
        pool.prepare(1)?.send(job)?;
        self.reports.push_back(receiver);
        if !is_last {
            // It gets ready while the section fills up.
            pool.prepare(self.threads_max.min(self.reports.len() + 1))?;
        }
        Ok(())
    }

    /// Fills the backlog, which is empty. Returns false if there is nothing to expect or, unless it `waits`, not yet.
    fn receive(&mut self, waits: bool) -> Result<bool> {
        let Some(oldest) = self.reports.front() else {
            return self.finish();
        };
        let Some(report) = oldest.receive(waits)? else {
            return Ok(false);
        };
        match report {
            Report::Output(bytes) => self.backlog = Backlog::of(bytes),
            Report::Done(input) => {
                self.reports.pop_front();
                _ = self.spare_inputs.push_within_capacity(input);
            }
            Report::Failed(error) => return Err(error),
        }
        Ok(true)
    }

    fn finish(&mut self) -> Result<bool> {
        if core::mem::take(&mut self.needs_last_block) {
            self.backlog = Backlog::of(vec::copied(&frame::last_empty_block())?);
        } else if core::mem::take(&mut self.needs_checksum) {
            let relay = self.relay.wait()?;
            let hash = relay.hash.as_ref().ok_or(Error::Internal)?;
            self.backlog = Backlog::of(vec::copied(&frame::checksum(hash))?);
        }
        Ok(!self.backlog.is_empty())
    }

    pub(crate) fn step(
        &mut self,
        pool: &mut Pool,
        input: &mut &[u8],
        out: &mut Output<'_>,
        directive: EndDirective,
    ) -> Result<Status> {
        if self.has_posted_last && (directive == EndDirective::Continue || !input.is_empty()) {
            return Err(Error::StageWrong);
        }
        loop {
            self.fill(input)?;
            let is_full = self.filled() == self.section_len;
            self.is_followed |= is_full && directive != EndDirective::End;
            let is_last = directive == EndDirective::End && input.is_empty() && !self.is_followed;
            let is_due = is_full
                || (directive != EndDirective::Continue && self.filled() != 0)
                || (is_last && !self.has_posted_last);
            if is_due && self.reports.len() < self.threads_max + 2 {
                self.post(pool, is_last)?;
                continue;
            }

            self.backlog.flush(out);
            if !self.backlog.is_empty() {
                return Ok(Status::Pending);
            }
            if !self.receive(is_due || directive != EndDirective::Continue)? {
                let is_complete = self.reports.is_empty() && self.filled() == 0;
                return Ok(if is_complete {
                    Status::Complete
                } else {
                    Status::Pending
                });
            }
        }
    }
}

impl Drop for Workers {
    fn drop(&mut self) {
        self.interest.lose();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parameters::Purpose;

    /// The hash is of what `ZSTDMT_initCStream_internal()` arrives at.
    #[test]
    fn sections_are_those_of_zstd() -> Result<()> {
        let mut lens = Vec::new();
        for window_log in 10..=31 {
            for chain_log in (6..=30).step_by(4) {
                for index in 0..9 * 10 * 2 * 2 {
                    let mut request = Request::new(1);
                    request.set(101, window_log)?;
                    request.set(103, chain_log)?;
                    request.set(107, 1 + index / 40)?;
                    request.set(402, index / 4 % 10)?;
                    request.set(160, 2 - index / 2 % 2)?;
                    request.set(401, index % 2 * 600_000)?;
                    let tuning = request.tuning(None, Purpose::Frame { dictionary_len: 0 });
                    let (section, overlap) =
                        section_and_overlap_len(&request.plan(tuning), &request);
                    lens.extend([section as u32, overlap as u32].map(u32::to_le_bytes));
                }
            }
        }
        assert_eq!(XxHash64::hash(lens.as_flattened()) as u32, 0xF440_CB58);
        Ok(())
    }
}
