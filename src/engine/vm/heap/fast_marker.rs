//! The loop that marking spends its time in. It has what it needs of the `Visitor` in registers.

use core::sync::atomic::{AtomicU64, Ordering};

use super::mark_stack::REVISIT;
use super::marking::{Company, WORK_PER_TURN};
use super::marks::Marks;
use super::stack::prefetch;
use super::visitor::MIN_RECORDS_TO_SHARE;
use super::{CellState, Gc, JsCell, Visitor, barrier, delay, shape_base};
use crate::primitive::cost_of_fiber;
use crate::{Shape, ShapeId, Storage, Value, object};

/// What a visit to one of the most common kinds of cells needs. See `Visitor` for the methods.
pub(crate) trait Marker {
    fn is_fenced(&self) -> bool;
    fn is_first_visit(&self) -> bool;
    fn did_race(&mut self);
    /// # Safety
    /// As for `ShapeId::decode`.
    unsafe fn decode(&self, id: ShapeId) -> Gc<Shape>;
    fn append_shape(&mut self, id: ShapeId);
    unsafe fn append_word(&mut self, word: u64);
    unsafe fn append_hidden_words(&mut self, first: *const u64, count: usize);
    unsafe fn mark_auxiliary(&mut self, base: usize);
    /// As `append_hidden_words`, of memory outside the cell.
    unsafe fn append_slots(&mut self, first: *const u64, count: usize);
    /// # Safety
    /// It has been marked, and the elements are values.
    unsafe fn append_elements(&mut self, storage: Storage);
    /// # Safety
    /// As for `cost_of_fiber`.
    unsafe fn report_characters(&mut self, fiber: usize);
}

impl Marker for Visitor {
    #[inline(always)]
    fn is_fenced(&self) -> bool {
        self.is_mutator_running()
    }

    #[inline(always)]
    fn is_first_visit(&self) -> bool {
        self.is_first_visit()
    }

    fn did_race(&mut self) {
        self.did_race();
    }

    #[inline(always)]
    unsafe fn decode(&self, id: ShapeId) -> Gc<Shape> {
        // SAFETY: the caller's.
        unsafe { id.decode() }
    }

    #[inline(always)]
    fn append_shape(&mut self, id: ShapeId) {
        self.append_shape(id);
    }

    #[inline(always)]
    unsafe fn append_word(&mut self, word: u64) {
        // SAFETY: the caller's.
        unsafe { self.append_word(word) }
    }

    #[inline(always)]
    unsafe fn append_hidden_words(&mut self, first: *const u64, count: usize) {
        // SAFETY: the caller's.
        unsafe { self.append_hidden_words(first, count) }
    }

    #[inline(always)]
    unsafe fn mark_auxiliary(&mut self, base: usize) {
        // SAFETY: the caller's.
        unsafe { self.mark_auxiliary(base) }
    }

    #[inline(always)]
    unsafe fn append_slots(&mut self, first: *const u64, count: usize) {
        // SAFETY: the caller's.
        unsafe { self.append_hidden_words(first, count) }
    }

    #[inline(always)]
    unsafe fn append_elements(&mut self, storage: Storage) {
        // SAFETY: the caller's.
        unsafe {
            let length = storage.public_length_concurrently();
            self.append_hidden_words(storage.elements_ptr(), length as usize);
        }
    }

    #[inline(always)]
    unsafe fn report_characters(&mut self, fiber: usize) {
        // SAFETY: the caller's.
        self.report_extra_memory(unsafe { cost_of_fiber(fiber) });
    }
}

/// More than what is pushed for one entry of the queue.
const HEADROOM: usize = 2 * MIN_RECORDS_TO_SHARE;
/// How many cells are fetched at a time.
const CELLS_IN_QUEUE: usize = 16;
/// A visit adds at most two entries, which add none.
const QUEUE_CAPACITY: usize = 64;

/// What an entry of the queue is, if it is no cell.
const KIND_MASK: usize = 6;
/// With their count above the address.
const SLOTS: usize = 2;
const ELEMENTS: usize = 4;
const CHARACTERS: usize = 6;
const COUNT_SHIFT: u32 = 48;

macro_rules! cold_paths {
    ($(fn $name:ident($visitor:ident $(, $argument:ident: $type:ty)*) $(-> $result:ty)? $body:block)*) => {$(
        /// Leaves the registers of the caller as they are.
        #[cold]
        #[inline(never)]
        extern "rust-cold" fn $name($visitor: &mut Visitor $(, $argument: $type)*) $(-> $result)? $body
    )*};
}

cold_paths! {
    fn put_off_words(visitor, first: *const u64, count: usize) {
        visitor.put_off_records::<1>(first, count);
    }

    fn put_off(visitor, entry: usize) {
        visitor.findings.put_off.push(entry);
    }

    fn grow_stack(visitor) {
        visitor.stack.reserve(HEADROOM);
    }
}

/// An entry waits here while its memory is on the way.
pub(super) type Queue = [usize; QUEUE_CAPACITY];

/// For while nobody watches.
pub(super) struct FastMarker<'a, const COMPANY: Company> {
    /// Of the stack of the visitor, whose length is out of date.
    top: *mut usize,
    bottom: *mut usize,
    /// Up to here there is `HEADROOM` left.
    limit: *mut usize,
    queue: &'a mut Queue,
    head: usize,
    tail: usize,
    last_shape: ShapeId,
    shape_base: usize,
    marks: Marks,
    entry: usize,
    visitor: &'a mut Visitor,
}

impl<'a, const COMPANY: Company> FastMarker<'a, COMPANY> {
    #[inline(always)]
    pub(super) fn new(visitor: &'a mut Visitor, queue: &'a mut Queue) -> Self {
        let mut marker = FastMarker {
            top: core::ptr::null_mut(),
            bottom: core::ptr::null_mut(),
            limit: core::ptr::null_mut(),
            queue,
            head: 0,
            tail: 0,
            last_shape: ShapeId::NONE,
            shape_base: shape_base(),
            marks: visitor.marks,
            entry: 0,
            visitor,
        };
        grow_stack(marker.visitor);
        marker.load();
        marker
    }

    #[inline(always)]
    fn load(&mut self) {
        let stack = &mut self.visitor.stack;
        let start = stack.cells.as_mut_ptr();
        self.bottom = start.wrapping_add(stack.given);
        self.top = start.wrapping_add(stack.cells.len());
        self.limit = start.wrapping_add(stack.cells.capacity() - HEADROOM);
    }

    #[inline(always)]
    fn store(&mut self) {
        // SAFETY: within the capacity, and written up to there.
        unsafe {
            let cells = &mut self.visitor.stack.cells;
            let length = self.top.offset_from_unsigned(cells.as_ptr());
            cells.set_len(length);
        }
    }

    #[inline(always)]
    fn with_visitor<R>(&mut self, body: impl FnOnce(&mut Visitor) -> R) -> R {
        self.store();
        let result = body(self.visitor);
        self.load();
        result
    }

    #[inline(always)]
    fn grow_stack(&mut self) {
        self.store();
        grow_stack(self.visitor);
        self.load();
    }

    #[inline(always)]
    pub(super) fn finish(mut self) {
        self.store();
    }

    #[inline(always)]
    fn enqueue(&mut self, entry: usize, address: usize) {
        prefetch(address);
        self.queue[self.tail % QUEUE_CAPACITY] = entry;
        self.tail += 1;
    }

    #[inline(always)]
    fn push(&mut self, entry: usize) {
        // SAFETY: there is room for all that a visit pushes.
        unsafe {
            self.top.write(entry);
            self.top = self.top.add(1);
        }
    }

    /// Whether it was not marked.
    #[inline(always)]
    fn mark(&self, cell: usize) -> bool {
        if COMPANY == Company::Nobody {
            self.marks.add_exclusively(cell)
        } else {
            self.marks.add(cell)
        }
    }

    /// # Safety
    /// As for `Visitor::append_hidden_words`, and they are fewer than `MIN_RECORDS_TO_SHARE` values.
    #[inline(always)]
    pub(super) unsafe fn append_records<const WORDS: usize>(
        &mut self,
        first: *const u64,
        count: usize,
    ) {
        for index in 0..count {
            delay::of_helper(64);
            // SAFETY: the caller's.
            unsafe {
                let record = first.add(index * WORDS).cast_mut();
                self.append_word(AtomicU64::from_ptr(record).load(Ordering::Relaxed));
                if WORDS == 3 {
                    self.append_word(AtomicU64::from_ptr(record.add(2)).load(Ordering::Relaxed));
                }
            }
        }
    }

    /// Until nothing is left, or it is told to stop.
    #[inline(always)]
    pub(super) fn drain(mut self) {
        loop {
            if self.tail - self.head < CELLS_IN_QUEUE {
                if self.top != self.bottom {
                    // SAFETY: not empty.
                    let popped = unsafe {
                        self.top = self.top.sub(1);
                        self.top.read()
                    };
                    self.enqueue(popped, popped);
                    if self.tail - self.head < CELLS_IN_QUEUE {
                        continue;
                    }
                } else if self.visitor.stack.has_runs() {
                    if self.with_visitor(Visitor::visit_chunk_and_end_turn) {
                        break;
                    }
                    continue;
                } else if self.tail == self.head {
                    break;
                }
            }
            let entry = self.queue[self.head % QUEUE_CAPACITY];
            self.head += 1;
            if self.top > self.limit {
                self.grow_stack();
            }
            if entry & KIND_MASK == 0 {
                self.visit(entry);
            } else if let Some((first, count)) = self.words_of(entry) {
                // SAFETY: promised to the method that has made the entry.
                unsafe { self.append_hidden_words(first, count) };
            }
            if self.head.is_multiple_of(WORK_PER_TURN) && self.with_visitor(Visitor::did_take_turn)
            {
                break;
            }
        }
        self.visitor.findings.visit_count += self.head;
        // It may have company by now, so it marks nothing.
        while self.tail != self.head {
            self.tail -= 1;
            let entry = self.queue[self.tail % QUEUE_CAPACITY];
            if entry & KIND_MASK == 0 {
                self.grow_stack();
                self.push(entry);
            } else if let Some((first, count)) = self.words_of(entry) {
                put_off_words(self.visitor, first, count);
            }
        }
        self.finish();
    }

    #[inline(always)]
    fn visit(&mut self, entry: usize) {
        // SAFETY: marked.
        let cell = unsafe { Gc::<JsCell>::from_address(entry & !REVISIT) };
        self.entry = entry;
        // Spares writing the memory of what has survived before.
        if cell.state() != barrier::BLACK_THRESHOLD {
            cell.set_state(CellState::PossiblyBlack);
        }
        delay::of_helper(600);
        if !object::visit_common_cell(cell, self) {
            let is_first_visit = self.is_first_visit();
            self.with_visitor(|visitor| visitor.visit_through_class(cell, is_first_visit));
        }
    }

    /// Those that are left to append. Sees to an entry that has none.
    #[inline(always)]
    fn words_of(&mut self, entry: usize) -> Option<(*const u64, usize)> {
        delay::of_helper(200);
        let address = entry & ((1 << COUNT_SHIFT) - 1) & !KIND_MASK;
        // SAFETY: promised to the method that has made the entry.
        let count = unsafe {
            match entry & KIND_MASK {
                SLOTS => entry >> COUNT_SHIFT,
                ELEMENTS => Storage::from_address(address).public_length_concurrently() as usize,
                _ => {
                    let total = &mut self.visitor.findings.extra_memory;
                    *total = total.saturating_add(cost_of_fiber(address));
                    return None;
                }
            }
        };
        Some((core::ptr::with_exposed_provenance(address), count))
    }
}

impl<const COMPANY: Company> Marker for FastMarker<'_, COMPANY> {
    #[inline(always)]
    fn is_fenced(&self) -> bool {
        COMPANY == Company::Mutator
    }

    #[inline(always)]
    fn is_first_visit(&self) -> bool {
        self.entry & REVISIT == 0
    }

    #[inline(always)]
    fn did_race(&mut self) {
        put_off(self.visitor, self.entry);
    }

    #[inline(always)]
    unsafe fn decode(&self, id: ShapeId) -> Gc<Shape> {
        // SAFETY: the caller's.
        unsafe { Gc::from_address(self.shape_base + id.bits() as usize) }
    }

    #[inline(always)]
    fn append_shape(&mut self, id: ShapeId) {
        // One that seems to be marked may only be hidden.
        if id == self.last_shape && !self.is_fenced() {
            return;
        }
        self.last_shape = id;
        let nuked_bit = if self.is_fenced() {
            ShapeId::NUKED_BIT
        } else {
            0
        };
        let shape = self.shape_base + (id.bits() & !nuked_bit) as usize;
        if self.mark(shape) {
            self.push(shape);
        }
    }

    #[inline(always)]
    unsafe fn append_word(&mut self, word: u64) {
        if word & Value::NOT_CELL_MASK != 0 {
            return;
        }
        if word == 0 {
            return core::hint::cold_path();
        }
        if self.mark(word as usize) {
            self.push(word as usize);
        }
    }

    #[inline(always)]
    unsafe fn append_hidden_words(&mut self, first: *const u64, count: usize) {
        if count >= MIN_RECORDS_TO_SHARE {
            return put_off_words(self.visitor, first, count);
        }
        // SAFETY: the caller's.
        unsafe { self.append_records::<1>(first, count) }
    }

    #[inline(always)]
    unsafe fn mark_auxiliary(&mut self, base: usize) {
        self.mark(base);
    }

    #[inline(always)]
    unsafe fn append_slots(&mut self, first: *const u64, count: usize) {
        if count >= MIN_RECORDS_TO_SHARE {
            put_off_words(self.visitor, first, count);
        } else if count != 0 {
            let first = first.expose_provenance();
            self.enqueue(first | SLOTS | count << COUNT_SHIFT, first);
        }
    }

    #[inline(always)]
    unsafe fn append_elements(&mut self, storage: Storage) {
        let lengths = (storage.address()).wrapping_add_signed(Storage::OFFSET_OF_PUBLIC_LENGTH);
        self.enqueue(storage.address() | ELEMENTS, lengths);
    }

    #[inline(always)]
    unsafe fn report_characters(&mut self, fiber: usize) {
        self.enqueue(fiber | CHARACTERS, fiber);
    }
}
