//! Which test file each worker slot of `bun test --parallel` runs, and which one it gets next.
#![forbid(unsafe_code)]

use core::cmp::Reverse;
use core::ops::Range;

pub struct TestFile {
    pub path: &'static [u8],
    /// Megabytes by which its worker grew in an earlier compiled run. Most files take next to nothing, so one without a record has 0.
    pub growth: u64,
}

pub fn is_heavy(growth: u64) -> bool {
    growth > 1024
}

/// What a slot that has run out of files takes from another.
pub enum Steal {
    /// Of the longest queue. Neighbours share imports, so both keep a contiguous range.
    BackHalf,
    /// The next file of the queue with the most time left. Queues are sorted slowest first.
    Slowest {
        /// Milliseconds, for each file.
        costs: Vec<u64>,
    },
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    /// No process, or one that has not said that it is ready.
    Starting,
    Running {
        file: usize,
        since_ms: i64,
    },
    /// Only heavy files are left for it, and there is no room for one.
    WaitingForRoom,
    /// Between two files. It stays so once its `Free` is spent on a shutdown or dropped.
    Idle,
}

impl Phase {
    /// The file, and when it was handed out.
    pub fn running(self) -> Option<(usize, i64)> {
        match self {
            Phase::Running { file, since_ms } => Some((file, since_ms)),
            Phase::Starting | Phase::WaitingForRoom | Phase::Idle => None,
        }
    }

    pub fn file(self) -> Option<usize> {
        Some(self.running()?.0)
    }
}

/// A slot that has just come free. No other can be given a file.
#[must_use]
pub struct Free(usize);

impl Free {
    pub fn slot(&self) -> usize {
        self.0
    }
}

#[derive(PartialEq, Eq, Debug)]
pub enum Next {
    Run(usize),
    Wait,
    ShutDown,
}

struct Slot {
    phase: Phase,
    /// Of `files`. None of them has been handed out, so their order is free.
    queue: Range<usize>,
}

pub struct Schedule {
    files: Vec<TestFile>,
    slots: Vec<Slot>,
    steal: Steal,
    /// A run needs room for its heaviest file, so heavy files that took no more together may run at once.
    room_for_heavy: u64,
    /// What the other slots take together where each runs an average file.
    room_beside_heavy: u64,
    heavy_files_queued: usize,
}

impl Schedule {
    /// One queue per slot. Together they hold each of `files` once.
    pub fn new(files: Vec<TestFile>, queues: Vec<Range<usize>>, steal: Steal) -> Self {
        let growths = || files.iter().map(|file| file.growth);
        let other_slots = queues.len().saturating_sub(1) as u64;
        let slot = |queue| Slot {
            phase: Phase::Starting,
            queue,
        };
        Schedule {
            room_for_heavy: growths().max().unwrap_or(0),
            room_beside_heavy: growths().sum::<u64>() * other_slots / files.len().max(1) as u64,
            heavy_files_queued: growths().filter(|&growth| is_heavy(growth)).count(),
            slots: queues.into_iter().map(slot).collect(),
            files,
            steal,
        }
    }

    pub fn path(&self, file: usize) -> &'static [u8] {
        self.files[file].path
    }

    pub fn phase(&self, slot: usize) -> Phase {
        self.slots[slot].phase
    }

    pub fn running(&self) -> impl Iterator<Item = (usize, i64)> {
        self.slots.iter().filter_map(|slot| slot.phase.running())
    }

    pub fn queued(&self) -> impl Iterator<Item = usize> {
        self.slots.iter().flat_map(|slot| slot.queue.clone())
    }

    pub fn has_queued(&self) -> bool {
        self.slots.iter().any(|slot| !slot.queue.is_empty())
    }

    /// For a run that cannot go on: the next file that nobody will run.
    pub fn give_up_queued(&mut self) -> Option<usize> {
        (0..self.slots.len()).find_map(|slot| self.pop(slot))
    }

    pub fn ready(&mut self, slot: usize) -> Option<Free> {
        self.free(slot, Phase::Starting)
    }

    pub fn ask_again(&mut self, slot: usize) -> Option<Free> {
        self.free(slot, Phase::WaitingForRoom)
    }

    /// With the time at which `file` was handed out. `None` unless `slot` runs it.
    pub fn finish(&mut self, slot: usize, file: usize) -> Option<(Free, i64)> {
        let (_, since_ms) = self.phase(slot).running()?;
        let free = self.free(slot, Phase::Running { file, since_ms })?;
        Some((free, since_ms))
    }

    fn free(&mut self, slot: usize, from: Phase) -> Option<Free> {
        let phase = &mut self.slots[slot].phase;
        (*phase == from).then(|| {
            *phase = Phase::Idle;
            Free(slot)
        })
    }

    /// The process of `slot` is gone. The caller accounts for what it was at.
    #[must_use]
    pub fn vacate(&mut self, slot: usize) -> Phase {
        core::mem::replace(&mut self.slots[slot].phase, Phase::Starting)
    }

    pub fn assign(&mut self, Free(slot): Free, since_ms: i64) -> Next {
        debug_assert_eq!(self.phase(slot), Phase::Idle);
        let Some(owner) = self.queue_for(slot) else {
            return Next::ShutDown;
        };
        let (phase, next) = match self.take_from(owner) {
            Some(file) => (Phase::Running { file, since_ms }, Next::Run(file)),
            None => (Phase::WaitingForRoom, Next::Wait),
        };
        self.slots[slot].phase = phase;
        next
    }

    /// The slot whose queue has the next file for `slot`. It need not have a process yet.
    fn queue_for(&mut self, slot: usize) -> Option<usize> {
        if !self.slots[slot].queue.is_empty() {
            return Some(slot);
        }
        let victim = self.victim()?;
        match self.steal {
            Steal::Slowest { .. } => Some(victim),
            Steal::BackHalf => {
                let queue = &mut self.slots[victim].queue;
                let stolen = queue.start + queue.len() / 2..queue.end;
                queue.end = stolen.start;
                self.slots[slot].queue = stolen;
                Some(slot)
            }
        }
    }

    /// The first of the slots that have the most left.
    fn victim(&self) -> Option<usize> {
        let queue = |slot: usize| self.slots[slot].queue.clone();
        let slots = (0..self.slots.len()).filter(|&slot| !queue(slot).is_empty());
        slots.min_by_key(|&slot| {
            Reverse(match &self.steal {
                Steal::BackHalf => queue(slot).len() as u64,
                Steal::Slowest { costs } => costs[queue(slot)].iter().sum(),
            })
        })
    }

    fn take_from(&mut self, owner: usize) -> Option<usize> {
        if is_heavy(self.room_for_heavy) {
            let queue = self.slots[owner].queue.clone();
            let next = self.choose_by_growth(queue.clone())?;
            self.files.swap(queue.start, next);
            if let Steal::Slowest { costs } = &mut self.steal {
                costs.swap(queue.start, next);
            }
        }
        self.pop(owner)
    }

    /// The one way out of the queues.
    fn pop(&mut self, owner: usize) -> Option<usize> {
        let file = self.slots[owner].queue.next()?;
        if is_heavy(self.files[file].growth) {
            self.heavy_files_queued = self.heavy_files_queued.saturating_sub(1);
        }
        Some(file)
    }

    /// While heavy files run or are left: one that has room, else the first that fits beside them, else the lightest unless it is heavy.
    fn choose_by_growth(&self, mut queue: Range<usize>) -> Option<usize> {
        let growth = |file: &usize| self.files[*file].growth;
        let running = || self.running().map(|(file, _)| growth(&file));
        let heavy: u64 = running().filter(|&it| is_heavy(it)).sum();
        if heavy == 0 && self.heavy_files_queued == 0 {
            return queue.next();
        }
        let is_light = |file: &usize| !is_heavy(growth(file));
        let beside: u64 = running().filter(|&it| !is_heavy(it)).sum();
        let has_room =
            |file: &usize| !is_light(file) && heavy + growth(file) <= self.room_for_heavy;
        let fits = |file: &usize| is_light(file) && beside + growth(file) <= self.room_beside_heavy;
        queue
            .clone()
            .find(has_room)
            .or_else(|| queue.clone().find(fits))
            .or_else(|| queue.min_by_key(growth).filter(is_light))
    }
}

#[cfg(test)]
mod tests;
