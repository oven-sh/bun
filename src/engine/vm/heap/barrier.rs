use core::sync::atomic::{AtomicU8, AtomicU64, Ordering};

use bun_threading::Guarded;

use super::container::{self, Container};
use super::{CellState, MutatorState};
use crate::JsCell;

pub const BLACK_THRESHOLD: u8 = CellState::PossiblyBlack as u8;
const WHITE_THRESHOLD: u8 = CellState::DefinitelyWhite as u8;

/// The highest threshold of all heaps, for code that has no `Vm` at hand.
static THRESHOLD: AtomicU8 = AtomicU8::new(BLACK_THRESHOLD);

#[inline(always)]
pub(crate) fn threshold() -> u8 {
    THRESHOLD.load(Ordering::Relaxed)
}

pub(super) fn threshold_for(is_marking_concurrently: bool) -> u8 {
    match is_marking_concurrently {
        true => WHITE_THRESHOLD,
        false => BLACK_THRESHOLD,
    }
}

/// Of a heap, on its thread.
pub(super) fn did_change_threshold(is_marking_concurrently: bool) {
    static HEAPS_MARKING: Guarded<usize> = Guarded::new(0);
    let mut count = HEAPS_MARKING.lock();
    match is_marking_concurrently {
        true => *count += 1,
        false => *count -= 1,
    }
    THRESHOLD.store(threshold_for(*count != 0), Ordering::Relaxed);
}

/// Where generated code that has no `Vm` at hand reads it.
pub fn threshold_address() -> usize {
    THRESHOLD.as_ptr().expose_provenance()
}

/// If not, no marker runs beside this thread until the next allocation. It may be true for the sake of another thread,
/// and then change at any time.
#[inline(always)]
pub(crate) fn is_fenced() -> bool {
    threshold() != BLACK_THRESHOLD
}

pub fn is_needed_for(cell: &JsCell) -> bool {
    cell.state() == BLACK_THRESHOLD
        || cell.state() == WHITE_THRESHOLD
            && cell.heap().is_marking_concurrently()
            && matches!(container::of(cell.address()),
                Container::Block(it) if !it.is_hidden_if_white(cell.address()))
}

#[cold]
#[inline(never)]
pub fn slow_path(cell: &JsCell) {
    let container = container::of(cell.address());
    let heap = container.heap();
    if heap.is_marking_concurrently() {
        let is_hidden = cell.state() == WHITE_THRESHOLD
            && matches!(container, Container::Block(it) if it.is_hidden_if_white(cell.address()));
        let is_dead = || {
            heap.mutator_state() == MutatorState::Sweeping
                // SAFETY: a destructor gets at no cell that has been freed.
                && !unsafe { heap.is_live(cell.address()) }
        };
        if !is_hidden && !is_dead() {
            heap.remember(cell);
        }
        return;
    }
    // Black from an earlier collection, and either dead or not reached yet by this one, which will see the store.
    let is_unmarked =
        || heap.mutator_state() != MutatorState::Running && !heap.marks().contains(cell.address());
    if cell.state() == BLACK_THRESHOLD && !is_unmarked() {
        heap.remember(cell);
    }
}

/// As `memmove`, but a marker never sees half a word.
///
/// # Safety
/// Both are valid and aligned for `count` words that only this thread writes.
#[inline]
pub unsafe fn move_words(source: *const u64, target: *mut u64, count: usize) {
    if !is_fenced() {
        // SAFETY: the caller's, and no other thread is reading.
        return unsafe { core::ptr::copy(source, target, count) };
    }
    // SAFETY: the caller's.
    let copy = |index: usize| unsafe {
        AtomicU64::from_ptr(target.add(index)).store(*source.add(index), Ordering::Relaxed);
    };
    if target.addr() <= source.addr() {
        (0..count).for_each(copy);
    } else {
        (0..count).rev().for_each(copy);
    }
}

/// # Safety
/// As for `move_words`.
#[inline]
pub(crate) unsafe fn fill_words(target: *mut u64, count: usize, word: u64) {
    if !is_fenced() {
        // SAFETY: the caller's, and no other thread is reading.
        let words = unsafe {
            core::slice::from_raw_parts_mut(target.cast::<core::mem::MaybeUninit<u64>>(), count)
        };
        words.write_filled(word);
        return;
    }
    for index in 0..count {
        // SAFETY: the caller's.
        unsafe { AtomicU64::from_ptr(target.add(index)) }.store(word, Ordering::Relaxed);
    }
}

/// # Safety
/// As for `move_words`.
#[inline]
pub(crate) unsafe fn reverse_words(first: *mut u64, count: usize) {
    if !is_fenced() {
        // SAFETY: the caller's, and no other thread is reading.
        return unsafe { core::slice::from_raw_parts_mut(first, count) }.reverse();
    }
    for index in 0..count / 2 {
        // SAFETY: the caller's.
        unsafe {
            let (front, back) = (first.add(index), first.add(count - 1 - index));
            let word = *front;
            AtomicU64::from_ptr(front).store(*back, Ordering::Relaxed);
            AtomicU64::from_ptr(back).store(word, Ordering::Relaxed);
        }
    }
}
