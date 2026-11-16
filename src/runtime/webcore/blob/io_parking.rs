//! A `ReadFile`/`WriteFile` parked on the io loop.

use core::sync::atomic::{AtomicBool, AtomicU8, Ordering};

use bun_core::IntrusiveField;
use bun_io as io;
use bun_jsc::{Completion, OwnedJobContext};
use bun_sys::{self as sys, Fd, FdExt as _};
use bun_threading::work_pool::Batch;
use bun_threading::{Link, OwnedQueue, OwnedTaskIn, WorkPool};

use super::read_file::ReadFile;
use super::write_file::WriteFile;
use super::{ClosingState, FileOpener};

/// Which thread has a `ReadFile`/`WriteFile` that may park on the io
/// loop waiting for a pipe/tty/socket to become ready — the one wait a
/// `Bun.file` read or write can be stuck on indefinitely, and so the one
/// its VM's stop phase must be able to end
/// ([`OwnedJobContext::cancel`]). All transitions are
/// compare-exchanges on one byte, so the JS thread's cancel, the io
/// thread's arm/fire, and the pool thread's park agree on who completes
/// the job, exactly once. Cancellation is sticky: once cancelled the job
/// never parks again.
#[derive(Default)]
pub(crate) struct IoParking(AtomicU8);

/// A pool thread has it (running, or about to). The default.
const IDLE: u8 = 0;
/// It is queued for the io thread, not yet processed.
const PARKED: u8 = 1;
/// The io thread registered its poll; readiness sends it back to the pool.
const ARMED: u8 = 2;
/// Cancelled while parked/armed: the io thread closes it out.
const CANCELLED: u8 = 3;
/// Cancelled while a pool thread had it: that thread fails it at its next
/// attempt to park.
const DOOMED: u8 = 4;

/// Whether a job was cancelled while armed since the io thread last looked.
static HAS_CANCELLED: AtomicBool = AtomicBool::new(false);

impl IoParking {
    /// Pool thread, before queuing the job: `false` ⇒ cancelled
    /// already — fail the operation instead of parking.
    fn park(&self) -> bool {
        self.0
            .compare_exchange(IDLE, PARKED, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    /// io thread, processing the queued job: `true` ⇒ register the poll;
    /// `false` ⇒ cancelled meanwhile — close it out instead.
    fn arm(&self) -> bool {
        let r = self
            .0
            .compare_exchange(PARKED, ARMED, Ordering::SeqCst, Ordering::SeqCst);
        debug_assert!(
            matches!(r, Ok(_) | Err(CANCELLED)),
            "io wait request processed while not parked ({r:?})"
        );
        r.is_ok()
    }

    /// io thread, the poll fired or errored: `true` ⇒ hand back to the
    /// pool; `false` ⇒ cancelled meanwhile — `close_cancelled` closes it out.
    fn fire(&self) -> bool {
        self.0
            .compare_exchange(ARMED, IDLE, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst) == CANCELLED
    }

    /// JS thread (the VM's stop phase): cancel, whichever thread has it.
    /// The io thread closes out a job that is armed or queued, and the pool
    /// thread that has the job fails it when it next tries to park (or
    /// just finishes).
    pub(crate) fn cancel(&self) {
        loop {
            let cur = self.0.load(Ordering::SeqCst);
            let next = match cur {
                IDLE => DOOMED,
                PARKED | ARMED => CANCELLED,
                _ => return,
            };
            if self
                .0
                .compare_exchange(cur, next, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                if cur == ARMED {
                    HAS_CANCELLED.store(true, Ordering::SeqCst);
                    io::IoRequestLoop::wake();
                }
                return;
            }
        }
    }
}

/// Poll and close state of a [`Parkable`] job.
#[derive(Default)]
pub(crate) struct IoState {
    poll: io::Poll,
    /// Whether `poll` has to be unregistered before the fd is closed.
    close_after_io: bool,
    pub(crate) state: ClosingState,
}

/// A job that can wait on the io loop.
pub(crate) trait Parkable:
    FileOpener
    + OwnedJobContext<OffThread = Self, Shared = IoParking>
    + OwnedTaskIn<Completion<Self>>
    + IntrusiveField<Link<Self>>
{
    const IO_TAG: io::Tag;
    const SYSCALL: sys::Tag;

    /// The jobs that were given to the io thread and that it has not processed.
    fn pending() -> &'static OwnedQueue<Completion<Self>>;
    fn io_mut(&mut self) -> &mut IoState;
    fn is_allowed_to_close(&self) -> bool;

    fn set_error(&mut self, err: &sys::Error) {
        self.set_errno(bun_errno::from_errno(err.errno as i32).into());
        self.set_system_error(err.to_system_error().into());
    }

    /// Records `err` when the wait on the io loop couldn't start or was ended.
    fn fail_wait(&mut self, err: &sys::Error) {
        self.set_error(err);
        self.io_mut().state = ClosingState::Closing;
    }

    fn fail_cancelled(&mut self) {
        self.fail_wait(&sys::Error::from_code(sys::E::ECANCELED, Self::SYSCALL));
    }

    /// Pool thread: park on the io loop until the fd is ready, or finish now if cancelled.
    fn wait_for_io(mut this: Completion<Self>) {
        if let Err(err) = io::IoRequestLoop::ensure_init::<IoThread>() {
            this.fail_wait(&err);
            return Self::on_finish(this);
        }
        if !this.shared().park() {
            this.fail_cancelled();
            return Self::on_finish(this);
        }
        this.io_mut().close_after_io = true;
        Self::pending().push(this);
        io::IoRequestLoop::wake();
    }

    /// Pool thread. With `close_after_io`, the job comes back as [`ClosingState::Closing`] to call this again.
    fn on_finish(mut this: Completion<Self>) {
        if this.io_mut().close_after_io {
            this.io_mut().state = ClosingState::Closing;
            Self::pending().push(this);
            return io::IoRequestLoop::wake();
        }

        let fd = this.opened_fd();
        if this.is_allowed_to_close() && fd != Fd::INVALID && fd.stdio_tag().is_none() {
            let _ = fd.close_allowing_bad_file_descriptor(None);
            this.set_opened_fd(Fd::INVALID);
        }
        this.finish();
    }
}

#[derive(Default)]
struct IoThread {
    reads: ArmedJobs<ReadFile>,
    writes: ArmedJobs<WriteFile>,
}

impl io::RequestHandler for IoThread {
    fn process_pending(&mut self, changelist: &mut io::Changelist) {
        if HAS_CANCELLED.load(Ordering::SeqCst) {
            HAS_CANCELLED.store(false, Ordering::SeqCst);
            self.reads.close_cancelled(changelist);
            self.writes.close_cancelled(changelist);
        }
        self.reads.process_pending(changelist);
        self.writes.process_pending(changelist);
    }

    fn on_update(&mut self, pollable: io::Pollable, result: sys::Result<()>) {
        match pollable.tag {
            io::Tag::ReadFile => self.reads.on_update(pollable, result),
            io::Tag::WriteFile => self.writes.on_update(pollable, result),
        }
    }
}

/// The jobs whose poll is registered, by [`io::Pollable::index`].
struct ArmedJobs<T: Parkable> {
    slots: Vec<Slot<T>>,
    free_list: Vec<u32>,
}

struct Slot<T: Parkable> {
    job: Option<Completion<T>>,
    /// Changes when `job` is taken.
    generation: u32,
}

impl<T: Parkable> Default for ArmedJobs<T> {
    fn default() -> Self {
        Self {
            slots: Vec::new(),
            free_list: Vec::new(),
        }
    }
}

impl<T: Parkable> ArmedJobs<T> {
    fn take_if(&mut self, index: u32, predicate: fn(&IoParking) -> bool) -> Option<Completion<T>> {
        let slot = &mut self.slots[index as usize];
        let job = slot.job.take_if(|job| predicate(job.shared()))?;
        slot.generation = slot.generation.wrapping_add(1);
        self.free_list.push(index);
        Some(job)
    }

    fn close_cancelled(&mut self, changelist: &mut io::Changelist) {
        for index in 0..self.slots.len() as u32 {
            if let Some(mut job) = self.take_if(index, IoParking::is_cancelled) {
                job.fail_cancelled();
                Self::close(job, changelist);
            }
        }
    }

    fn process_pending(&mut self, changelist: &mut io::Changelist) {
        // `pop_batch` writes to an empty queue too.
        if T::pending().is_empty() {
            return;
        }
        for mut job in T::pending().pop_batch() {
            if job.io_mut().state == ClosingState::Running && !job.shared().arm() {
                job.fail_cancelled();
            }
            match job.io_mut().state {
                ClosingState::Running => self.register(job, changelist),
                ClosingState::Closing => Self::close(job, changelist),
            }
        }
    }

    fn register(&mut self, job: Completion<T>, changelist: &mut io::Changelist) {
        let index = self.free_list.pop().unwrap_or_else(|| {
            self.slots.push(Slot {
                job: None,
                generation: 0,
            });
            self.slots.len() as u32 - 1
        });
        let slot = &mut self.slots[index as usize];
        let pollable = io::Pollable {
            tag: T::IO_TAG,
            index,
            generation: slot.generation,
        };
        let job = slot.job.insert(job);
        let fd = job.opened_fd();
        if let Err(err) = changelist.register(pollable, &mut job.io_mut().poll, fd) {
            self.on_update(pollable, Err(err));
        }
    }

    fn close(mut job: Completion<T>, changelist: &mut io::Changelist) {
        let fd = job.opened_fd();
        let state = job.io_mut();
        changelist.unregister(&mut state.poll, fd);
        state.close_after_io = false;
        WorkPool::get().schedule(Batch::from_owned(job));
    }

    fn on_update(&mut self, pollable: io::Pollable, result: sys::Result<()>) {
        if self.slots[pollable.index as usize].generation != pollable.generation {
            return;
        }
        let Some(mut job) = self.take_if(pollable.index, IoParking::fire) else {
            return;
        };
        if let Err(err) = result {
            job.set_error(&err);
        }
        // On kqueue platforms we use one-shot mode, so we don't need to unregister.
        if bun_core::Environment::IS_KQUEUE {
            job.io_mut().close_after_io = false;
        }
        WorkPool::get().schedule(Batch::from_owned(job));
    }
}
