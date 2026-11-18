//! The thread that takes the samples.

use core::ops::Range;
use std::sync::Arc;

use bun_engine_number::Random;
use bun_engine_platform::suspend::{SuspendLock, ThreadHandle};
use bun_engine_platform::{StackBounds, clock};
use bun_engine_vm::Vm;
use bun_engine_vm::heap::stack::load_word;
use bun_threading::{Condition, Guarded};

use super::walker::{FirstFrame, RawFrame, Tops, Walker};

pub(super) struct RawSample {
    pub(super) timestamp: f64,
    /// Into `RawSamples::frames`.
    pub(super) frames: Range<usize>,
    pub(super) program_counter: usize,
    pub(super) bytecode_pointer: usize,
    /// The address of the `RegExp` that was searching, or zero.
    pub(super) regexp: usize,
    pub(super) first: FirstFrame,
}

#[derive(Default)]
pub(super) struct RawSamples {
    pub(super) samples: Vec<RawSample>,
    pub(super) frames: Vec<RawFrame>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Paused,
    Running,
    ShutDown,
}

struct State {
    phase: Phase,
    has_thread: bool,
    interval_seconds: f64,
    taken: RawSamples,
}

/// The lock is held from before the thread of the `Vm` is stopped until the sample is among those taken, so whoever
/// takes them out has all that refer to cells which may have died since.
pub(super) struct Sampler {
    state: Guarded<State>,
    changed: Condition,
}

struct Target {
    /// The address. It is there until the phase is `ShutDown`.
    vm: usize,
    thread: ThreadHandle,
    stack: StackBounds,
}

impl Sampler {
    pub(super) fn new(interval_seconds: f64) -> Arc<Sampler> {
        Arc::new(Sampler {
            state: Guarded::new(State {
                phase: Phase::Paused,
                has_thread: false,
                interval_seconds,
                taken: RawSamples::default(),
            }),
            changed: Condition::new(),
        })
    }

    pub(super) fn interval_seconds(&self) -> f64 {
        self.state.lock().interval_seconds
    }

    pub(super) fn set_interval_seconds(&self, seconds: f64) {
        self.state.lock().interval_seconds = seconds;
        self.changed.signal();
    }

    /// # Safety
    /// `shut_down` is called before the `Vm` goes, and it is the same one each time.
    pub(super) unsafe fn start(self: &Arc<Sampler>, vm: &Vm) {
        let mut state = self.state.lock();
        if state.phase == Phase::ShutDown {
            return;
        }
        state.phase = Phase::Running;
        if state.has_thread {
            return self.changed.signal();
        }
        let target = Target {
            vm: core::ptr::from_ref(vm).expose_provenance(),
            thread: ThreadHandle::current(),
            stack: vm.stack_bounds(),
        };
        let (sampler, random) = (Arc::clone(self), Random::new(vm.random_seed() as u32));
        let thread = std::thread::Builder::new().name("SamplingProfiler".into());
        state.has_thread = thread.spawn(move || sampler.run(&target, random)).is_ok();
    }

    pub(super) fn pause(&self) {
        let mut state = self.state.lock();
        if state.phase == Phase::Running {
            state.phase = Phase::Paused;
        }
    }

    pub(super) fn shut_down(&self) {
        self.state.lock().phase = Phase::ShutDown;
        self.changed.signal();
    }

    pub(super) fn take(&self) -> RawSamples {
        core::mem::take(&mut self.state.lock().taken)
    }

    fn run(&self, target: &Target, mut random: Random) {
        const USUAL_DEPTH: usize = 256;
        /// Keeps the samples out of step with whatever else happens at regular intervals.
        const JITTER: f64 = 0.2;
        const SHORTEST_WAIT_NANOSECONDS: u64 = 1000;
        let mut room = vec![RawFrame::default(); USUAL_DEPTH];
        let mut state = self.state.lock();
        loop {
            match state.phase {
                Phase::ShutDown => return,
                Phase::Paused => self.changed.wait_guarded(&mut state),
                Phase::Running => {
                    // SAFETY: not shut down, which takes the lock.
                    unsafe { target.sample(&mut room, &mut state.taken) };
                    let factor = 1.0 + JITTER * (2.0 * random.next_f64() - 1.0);
                    let wait = (state.interval_seconds * factor * 1e9) as u64;
                    let wait = wait.max(SHORTEST_WAIT_NANOSECONDS);
                    let _ = self.changed.timed_wait_guarded(&mut state, wait);
                }
            }
        }
    }
}

impl Target {
    /// # Safety
    /// The `Vm` is there.
    unsafe fn sample(&self, room: &mut Vec<RawFrame>, taken: &mut RawSamples) {
        // SAFETY: a field of the `Vm`.
        let field = |offset: usize| unsafe { load_word(self.vm + offset) };
        if field(Vm::OFFSET_OF_TOP_ENTRY_FRAME) == 0 {
            return;
        }
        let timestamp = clock::monotonic_seconds();
        let owners = bun_engine_exec_memory::lock_owners();
        let mut lock = SuspendLock::lock();
        let Some(suspended) = self.thread.suspend(&mut lock) else {
            return;
        };
        let registers = *suspended.registers();
        // SAFETY: its thread is not using it.
        let regexp =
            unsafe { &*core::ptr::with_exposed_provenance::<Vm>(self.vm) }.running_regexp();
        let tops = Tops {
            call_frame: field(Vm::OFFSET_OF_TOP_CALL_FRAME),
            entry_frame: field(Vm::OFFSET_OF_TOP_ENTRY_FRAME),
            is_searching: regexp != 0,
        };
        // SAFETY: a temporary.
        let walk = unsafe { Walker::new(self.stack, &registers, &owners) }
            .filter(|_| tops.entry_frame != 0)
            .and_then(|walker| walker.walk(&registers, &tops, room));
        drop(suspended);
        drop((lock, owners));

        let Some(walk) = walk.filter(|walk| walk.depth != 0) else {
            return;
        };
        let first = taken.frames.len();
        taken.frames.extend_from_slice(&room[..walk.depth]);
        taken.samples.push(RawSample {
            timestamp,
            frames: first..taken.frames.len(),
            program_counter: registers.program_counter,
            bytecode_pointer: registers.bytecode_pointer,
            regexp,
            first: walk.first,
        });
        if walk.is_cut_short {
            room.resize(room.len() * 2, RawFrame::default());
        }
    }
}
