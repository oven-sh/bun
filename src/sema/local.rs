//! Task-local storage.
//!
//! A task first writes what it computes into stores that are fields of the `Task`. No other thread reads them, so they
//! need no atomic operations and are small enough to stay in cache. Anything that no commit publishes is freed with the
//! task.
//!
//! A type, signature, mapper, component list, atom or handle created by a task has `LOCAL` set in its id, and the rest
//! of the id counts from 0 within the task. Results computed about one are therefore stored in a vector, with no
//! hashing.
//!
//! Results computed about a node or a symbol need no hashing either. The nodes of the file the task is visiting have a
//! row: a vector indexed by node number. The rows of files it visited earlier are kept. A node of any other file has a
//! cell in a 64-cell page, found by the node's number among the nodes of all files (see `Pages`). A published id has
//! such a cell too.
//!
//! This file has the containers. `crate::types::OwnStore` has the records, `crate::table` the tables, and
//! `crate::check::task` the task. Their memory is on the regular heap, and the thread that runs the task frees it when
//! the task ends.

use crate::util::{LocalVec, Placement, free_slot, is_too_full, slot_value, slots_for};
use std::cell::{Cell, RefCell};
use std::hint::cold_path;
use std::marker::PhantomData;
use std::ops::Range;

/// Set in the id of a type, signature, mapper, component list, atom or handle that belongs to a task.
pub const LOCAL: u32 = 1 << 30;

#[inline]
pub const fn is_local_number(number: u32) -> bool {
    number & LOCAL != 0
}

/// Tells whether a value contains an id with `LOCAL` set. The shared part of a table never has an entry under such a
/// key.
pub trait MaybeLocal {
    fn is_local(&self) -> bool;
}

impl MaybeLocal for () {
    #[inline]
    fn is_local(&self) -> bool {
        false
    }
}
impl MaybeLocal for bool {
    #[inline]
    fn is_local(&self) -> bool {
        false
    }
}
impl MaybeLocal for u8 {
    #[inline]
    fn is_local(&self) -> bool {
        false
    }
}
impl<T: MaybeLocal> MaybeLocal for Option<T> {
    #[inline]
    fn is_local(&self) -> bool {
        self.as_ref().is_some_and(MaybeLocal::is_local)
    }
}
impl<T: MaybeLocal> MaybeLocal for Box<[T]> {
    #[inline]
    fn is_local(&self) -> bool {
        self.iter().any(MaybeLocal::is_local)
    }
}
impl<A: MaybeLocal, B: MaybeLocal> MaybeLocal for (A, B) {
    #[inline]
    fn is_local(&self) -> bool {
        self.0.is_local() || self.1.is_local()
    }
}
impl<A: MaybeLocal, B: MaybeLocal, C: MaybeLocal> MaybeLocal for (A, B, C) {
    #[inline]
    fn is_local(&self) -> bool {
        self.0.is_local() || self.1.is_local() || self.2.is_local()
    }
}

pub(crate) struct TaskPlacement;

impl Placement for TaskPlacement {
    const MIN_SLOTS: usize = 256;
    /// Hashes the tag again, because its low bits make a poor index on their own.
    #[inline]
    fn start(tag: u32) -> usize {
        (u64::from(tag).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32) as usize
    }
}

/// The slots of a `HashIndex`, and a mark for each slot.
#[derive(Default)]
struct MarkedSlots {
    /// See `slot_value`. A slot whose mark is 0 is free, whatever it contains.
    slots: Box<[u64]>,
    /// 0 for a free slot, otherwise `mark_of` the slot's tag. Both lists have the same length: 0 or a power of two.
    ///
    /// Most searches are for a key that hasn't been added yet, and they only read marks. The marks are an eighth of the
    /// size of the slots, so they stay in the cache when a large table's slots don't.
    marks: Box<[u8]>,
}

/// Returns the mark of an occupied slot with `tag`. It's never 0. `TaskPlacement::start` mixes all bits of the tag, so
/// neighboring slots rarely have the same mark.
#[inline]
fn mark_of(tag: u32) -> u8 {
    0x80 | (tag >> 25) as u8
}

impl MarkedSlots {
    /// Returns the free slot for a new entry with `tag`.
    #[inline]
    fn free_slot(&self, tag: u32) -> usize {
        free_slot::<TaskPlacement>(self.marks.len(), tag, |at| u64::from(self.marks[at]))
    }

    #[inline]
    fn put(&mut self, at: usize, packed: u64) {
        self.marks[at] = mark_of((packed >> 32) as u32);
        self.slots[at] = packed;
    }

    #[cold]
    #[inline(never)]
    fn grow(&mut self, count: usize) {
        let len = slots_for::<TaskPlacement>(count, self.marks.len());
        let mut bigger = MarkedSlots {
            slots: vec![0; len].into_boxed_slice(),
            marks: vec![0; len].into_boxed_slice(),
        };
        // If a zeroed page from the operating system is read before it's written, its first write causes a second page
        // fault, which interrupts every other thread. So write to each page first. A slot is only read after it's
        // written.
        for page in bigger.marks.chunks_mut(4 << 10) {
            *std::hint::black_box(&mut page[0]) = 0;
        }
        for (&packed, _) in (self.slots.iter().zip(&self.marks)).filter(|it| *it.1 != 0) {
            bigger.put(bigger.free_slot((packed >> 32) as u32), packed);
        }
        *self = bigger;
    }
}

/// A hash index: finds a value's index by the value's hash. The one thread that owns it adds entries through a shared
/// reference.
#[derive(Default)]
pub struct HashIndex {
    /// No other thread reads the table, so its pointers and lengths are stored right here, and it's freed as soon as a
    /// bigger one replaces it.
    table: RefCell<MarkedSlots>,
    count: Cell<usize>,
}

/// Where an unsuccessful search of a `HashIndex` ended.
#[derive(Copy, Clone)]
pub struct Vacancy {
    /// The free slot.
    at: usize,
    /// The number of slots at the time.
    table_len: usize,
}

impl Vacancy {
    /// No search was done.
    const UNKNOWN: Vacancy = Vacancy {
        at: 0,
        table_len: 0,
    };
}

impl HashIndex {
    /// `is_match` must not add to this `HashIndex`.
    #[inline]
    pub fn find(&self, spread: u64, is_match: impl FnMut(u32) -> bool) -> Option<u32> {
        self.find_or_vacancy(spread, is_match).ok()
    }

    /// Like `find`, but a miss returns the `Vacancy` to pass to `fill`.
    #[inline]
    pub fn find_or_vacancy(
        &self,
        spread: u64,
        mut is_match: impl FnMut(u32) -> bool,
    ) -> Result<u32, Vacancy> {
        let table = self.table.borrow();
        let (slots, marks): (&[u64], &[u8]) = (&table.slots, &table.marks);
        let table_len = marks.len();
        if table_len == 0 {
            return Err(Vacancy::UNKNOWN);
        }
        let (tag, mask) = (spread as u32, table_len - 1);
        let mut at = TaskPlacement::start(tag) & mask;
        loop {
            let mark = marks[at];
            if mark == 0 {
                return Err(Vacancy { at, table_len });
            }
            if mark == mark_of(tag) {
                let packed = slots[at];
                if (packed >> 32) as u32 == tag && is_match(packed as u32 - 1) {
                    return Ok(packed as u32 - 1);
                }
            }
            at = (at + 1) & mask;
        }
    }

    #[inline]
    pub fn add(&self, spread: u64, number: u32) {
        self.fill(Vacancy::UNKNOWN, spread, number);
    }

    /// Like `add`, for use after `find_or_vacancy` returned `vacancy` for `spread`, with no `clear` in between. Entries
    /// may have been added since. A slot is never freed, so if that slot is still free and the table still has that
    /// size, it's still the first free slot a search for `spread` reaches.
    #[inline]
    pub fn fill(&self, vacancy: Vacancy, spread: u64, number: u32) {
        let count = self.count.get() + 1;
        self.count.set(count);
        let mut table = self.table.borrow_mut();
        if is_too_full(count, table.marks.len()) {
            table.grow(count);
        }
        let at = match table.marks.get(vacancy.at) {
            Some(0) if vacancy.table_len == table.marks.len() => vacancy.at,
            _ => table.free_slot(spread as u32),
        };
        table.put(at, slot_value(spread, number));
    }

    /// Keeps the table for the next task, so it doesn't have to regrow the table step by step or allocate fresh memory.
    /// A table that this task barely used is freed instead, so clearing takes time proportional to what was added.
    pub fn clear(&mut self) {
        let count = self.count.replace(0);
        let table = self.table.get_mut();
        if count != 0 && table.marks.len() <= 4 * slots_for::<TaskPlacement>(count, 0) {
            table.marks.fill(0);
        } else if count != 0 {
            *table = MarkedSlots::default();
        }
    }

    /// True if nothing can be found. The number of free slots doesn't count.
    #[cfg(test)]
    pub(crate) fn is_like_new(&self) -> bool {
        self.count.get() == 0 && self.table.borrow().marks.iter().all(|&mark| mark == 0)
    }
}

/// A hash map that iterates in insertion order. The entries are in a vector and the hash index stores indices into it.
/// Equivalent to `bun_collections::ArrayHashMap`, which this crate doesn't depend on, and which can't insert with a
/// precomputed hash when the key has no `Default`.
pub struct Hashed<K, V> {
    entries: Vec<(K, V)>,
    found: HashIndex,
}

impl<K, V> Default for Hashed<K, V> {
    fn default() -> Self {
        Hashed {
            entries: Vec::new(),
            found: HashIndex::default(),
        }
    }
}

impl<K: Eq, V> Hashed<K, V> {
    /// Returns the insertion-order index of the entry for `key`. Here and below, `spread` is the hash of `key`.
    #[inline]
    pub fn index_of(&self, spread: u64, key: &K) -> Option<u32> {
        (self.found).find(spread, |entry_index| {
            self.entries[entry_index as usize].0 == *key
        })
    }

    #[inline]
    pub fn get(&self, spread: u64, key: &K) -> Option<&V> {
        let entry_index = self.index_of(spread, key)?;
        Some(&self.entries[entry_index as usize].1)
    }

    /// Doesn't overwrite an existing entry. Returns the stored value.
    #[inline]
    pub fn insert(&mut self, spread: u64, key: K, value: V) -> &V {
        let entry_index = match self.index_or_vacancy(spread, &key) {
            Ok(entry_index) => entry_index,
            Err(vacancy) => self.add(vacancy, spread, key, value),
        };
        &self.entries[entry_index as usize].1
    }

    /// Overwrites any existing value for `key`. The entry keeps its position in the insertion order.
    #[inline]
    pub fn replace(&mut self, spread: u64, key: K, value: V) {
        match self.index_or_vacancy(spread, &key) {
            Ok(entry_index) => self.entries[entry_index as usize].1 = value,
            Err(vacancy) => {
                self.add(vacancy, spread, key, value);
            }
        }
    }

    #[inline]
    fn index_or_vacancy(&self, spread: u64, key: &K) -> Result<u32, Vacancy> {
        (self.found).find_or_vacancy(spread, |entry_index| {
            self.entries[entry_index as usize].0 == *key
        })
    }

    fn add(&mut self, vacancy: Vacancy, spread: u64, key: K, value: V) -> u32 {
        let entry_index = self.entries.len() as u32;
        self.found.fill(vacancy, spread, entry_index);
        self.entries.push((key, value));
        entry_index
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Returns the entry at index `entry_index` in insertion order.
    #[inline]
    pub fn entry(&self, entry_index: u32) -> Option<&(K, V)> {
        self.entries.get(entry_index as usize)
    }
}

/// Hashes a one-word key. `HashIndex` uses the low half, so that half has to depend on both halves of the word, and on
/// more than their XOR: as many nodes (file, index) share one `file ^ index` as the task has files.
#[inline]
pub fn spread_word(word: u64) -> u64 {
    let product = word.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    product ^ product >> 32
}

#[inline]
fn cell_at<C: Copy + Default>(cells: &mut Vec<C>, index: usize) -> &mut C {
    if index >= cells.len() {
        cold_path();
        cells.resize(index + 1, C::default());
    }
    &mut cells[index]
}

#[inline]
fn cell_mut<C: Copy + Default>(cells: &mut Vec<C>, index: u32) -> &mut C {
    cell_at(cells, index as usize)
}

#[inline]
fn put_in_if_empty<C>(cells: &mut Vec<C>, index: u32, raw: C) -> C
where
    C: Copy + Default + PartialEq,
{
    let cell = cell_mut(cells, index);
    if *cell == C::default() {
        *cell = raw;
    }
    *cell
}

fn clear_cells<C>(cells: &mut Vec<C>) {
    if cells.capacity() > 1 << 20 {
        *cells = Vec::new();
    } else {
        cells.clear();
    }
}

// ───────────────────────────── pages ─────────────────────────────

/// The number of cells in a page, and of page numbers in a list of pages.
const PAGE: usize = 64;

/// Sparse cells over a large range of numbers. A cell is 0 until it's written. All of a task's tables allocate their
/// pages here, so a task pays for what it touches, 256 bytes at a time, rather than for the size of the program.
///
/// Each table has a directory, a `Vec<u32>`. Cell `at` is found in three steps: `directory[at / PAGE / PAGE]` is the
/// number of a list, entry `at / PAGE % PAGE` of that list is the number of a page, and entry `at % PAGE` of that page
/// is the cell. A number is 0 where nothing was written, which ends the search.
#[derive(Default)]
struct Pages {
    /// The lists and the pages. Entry 0 is unused, because the number 0 means "nothing written".
    pool: Vec<[u32; PAGE]>,
}

impl Pages {
    #[inline]
    fn get(&self, directory: &[u32], at: usize) -> u32 {
        let list = directory.get(at / PAGE / PAGE).copied().unwrap_or(0);
        if list == 0 {
            return 0;
        }
        let page = self.pool[list as usize][at / PAGE % PAGE];
        if page == 0 {
            return 0;
        }
        self.pool[page as usize][at % PAGE]
    }

    #[cold]
    #[inline(never)]
    fn add(&mut self) -> u32 {
        if self.pool.is_empty() {
            self.pool.push([0; PAGE]);
        }
        self.pool.push([0; PAGE]);
        (self.pool.len() - 1) as u32
    }

    #[inline]
    fn cell(&mut self, directory: &mut Vec<u32>, at: usize) -> &mut u32 {
        let list = cell_at(directory, at / PAGE / PAGE);
        if *list == 0 {
            *list = self.add();
        }
        let list = *list as usize;
        let mut page = self.pool[list][at / PAGE % PAGE];
        if page == 0 {
            page = self.add();
            self.pool[list][at / PAGE % PAGE] = page;
        }
        &mut self.pool[page as usize][at % PAGE]
    }

    /// Calls `take` for each nonzero cell in `range` and resets those cells to 0.
    fn take_range(
        &mut self,
        directory: &[u32],
        range: &Range<usize>,
        mut take: impl FnMut(usize, u32),
    ) {
        let mut at = range.start;
        while at < range.end {
            let list = directory.get(at / PAGE / PAGE).copied().unwrap_or(0);
            if list == 0 {
                at = (at / PAGE / PAGE + 1) * PAGE * PAGE;
                continue;
            }
            let page = self.pool[list as usize][at / PAGE % PAGE] as usize;
            let end = ((at / PAGE + 1) * PAGE).min(range.end);
            if page != 0 {
                for at in at..end {
                    let raw = std::mem::take(&mut self.pool[page][at % PAGE]);
                    if raw != 0 {
                        take(at, raw);
                    }
                }
            }
            at = end;
        }
    }

    fn clear(&mut self) {
        if self.pool.capacity() > (4 << 20) / size_of::<[u32; PAGE]>() {
            self.pool = Vec::new();
        } else {
            self.pool.clear();
        }
    }
}

// ───────────────────────────── the task-local parts of the `Buffered` tables
// ─────────────────────────────

const NO_FILE: u32 = u32::MAX;

/// How much of a file's published entries `Half::dense` already includes.
#[derive(Clone, Copy, PartialEq, Eq)]
enum PublishedInRow {
    /// Not copied yet, so a lookup may still have to check the published part.
    Unknown,
    /// `Buffer::set_whole` ran and the task saw no published entry for the file.
    None,
    /// `Buffer::set_whole` ran and `Buffer::seed` copied at least one published entry.
    Some,
}

/// The task-local part of one `Buffered` table. A cell holds a packed value, 0 for empty.
///
/// The fields that a lookup of a node of `file` reads come first and share one cache line.
#[repr(C, align(64))]
pub(crate) struct Half<'s> {
    /// In a table keyed by id: one cell per task-local id, indexed by the id without `LOCAL`.
    /// In a table keyed by node: the row of `file`, with one cell per node, indexed by node number.
    dense: Vec<u32>,
    /// In a table keyed by node: the file that `dense` covers, and its `Buffer::ordinal`.
    file: u32,
    ordinal: u32,
    published_in_row: PublishedInRow,
    /// In a table keyed by node: the number of nodes in `file`.
    nodes: u32,
    /// The directory of the table's cells in `Buffer::pages`. A table keyed by node indexes them by the node's number
    /// among the nodes of all files. A table keyed by id indexes them by the number of a published id.
    directory: Vec<u32>,
    /// In a table keyed by node: the former `dense` vectors of the files the task visited earlier, each with its file,
    /// indexed by ordinal minus one. A vector is saved as is, so nothing is copied when the task moves on to the next
    /// file. `NO_FILE` means there's no vector for that ordinal.
    earlier: Vec<(u32, Vec<u32>)>,
    /// In a table keyed by node: the entries of `Buffer::shadow`, keyed by `node_word`.
    sparse: Hashed<u64, u32>,
    /// Type-erased storage: the `S::In` of the table's `Slot<S>`. For an indirect table it's a `LocalVec<(u64, T)>` of
    /// the values with their keys, indexed by handle without `LOCAL`. For a `ByKey` it's a `Hashed<K, V>`.
    typed: Option<Box<dyn Reusable + Send + 's>>,
}

/// Implemented for every type. Type-erased storage is dropped through this trait.
pub(crate) trait Typed {
    /// Used by a debug assertion.
    fn name(&self) -> &'static str;
}

impl<T> Typed for T {
    fn name(&self) -> &'static str {
        std::any::type_name::<T>()
    }
}

/// Storage that one task after another reuses.
pub(crate) trait Reusable: Typed {
    /// Drops the contents but keeps some of the memory for the next task.
    fn clear(&mut self);
    #[cfg(test)]
    fn is_like_new(&self) -> bool;
}

impl<T> Reusable for LocalVec<T> {
    fn clear(&mut self) {
        LocalVec::clear(self);
    }
    #[cfg(test)]
    fn is_like_new(&self) -> bool {
        self.len() == 0
    }
}

impl<K, V> Reusable for Hashed<K, V> {
    fn clear(&mut self) {
        self.found.clear();
        clear_cells(&mut self.entries);
    }
    #[cfg(test)]
    fn is_like_new(&self) -> bool {
        self.entries.is_empty() && self.found.is_like_new()
    }
}

/// Selects the type a table stores in `Half::typed`. The implementor is only a marker type.
pub(crate) trait InTask {
    type In<'s>: Reusable + Send + 's
    where
        Self: 's;

    fn new<'s>() -> Self::In<'s>
    where
        Self: 's;
}

/// `LocalVec<T>`
pub(crate) struct ListInTask<T>(PhantomData<T>);

impl<T: Send> InTask for ListInTask<T> {
    type In<'s>
        = LocalVec<T>
    where
        Self: 's;

    fn new<'s>() -> Self::In<'s>
    where
        Self: 's,
    {
        LocalVec::new()
    }
}

/// `Hashed<K, V>`
pub(crate) struct HashedInTask<K, V>(PhantomData<(K, V)>);

impl<K: Eq + Send, V: Send> InTask for HashedInTask<K, V> {
    type In<'s>
        = Hashed<K, V>
    where
        Self: 's;

    fn new<'s>() -> Self::In<'s>
    where
        Self: 's,
    {
        Hashed::default()
    }
}

/// The index of a table's task-local part within a task. It can't be copied, so only one table owns it.
pub(crate) struct SlotNumber(u32);

impl SlotNumber {
    /// # Safety
    /// No other `Buffered` table that's used with the same tasks may get this number.
    pub(crate) unsafe fn new(number: u32) -> SlotNumber {
        SlotNumber(number)
    }

    /// For a table that doesn't use `Half::typed`.
    pub(crate) fn number(self) -> u32 {
        self.0
    }

    /// `S` selects the type of the table's `Half::typed`.
    pub(crate) fn typed<S>(self) -> Slot<S> {
        Slot {
            number: self.0,
            stored_type: PhantomData,
        }
    }
}

/// A `SlotNumber` plus the only `Half::typed` type that's ever stored or requested under it.
pub(crate) struct Slot<S> {
    number: u32,
    stored_type: PhantomData<fn() -> S>,
}

impl<S> Slot<S> {
    /// `number_tables` hasn't assigned a number yet. `Buffer` has no `Half` for this slot.
    pub(crate) const NONE: Slot<S> = Slot {
        number: u32::MAX,
        stored_type: PhantomData,
    };

    #[inline]
    pub(crate) fn number(&self) -> u32 {
        self.number
    }
}

/// Packs a node into a key for `Half::sparse`.
#[inline]
pub(crate) fn node_word(file: u32, index: u32) -> u64 {
    u64::from(file) << 32 | u64::from(index)
}

impl<'s> Half<'s> {
    fn new() -> Self {
        Half {
            dense: Vec::new(),
            file: NO_FILE,
            ordinal: 0,
            published_in_row: PublishedInRow::Unknown,
            nodes: 0,
            directory: Vec::new(),
            earlier: Vec::new(),
            sparse: Hashed::default(),
            typed: None,
        }
    }

    #[inline]
    fn sparse_cell(&self, word: u64) -> u32 {
        (self.sparse.get(spread_word(word), &word)).map_or(0, |&raw| raw)
    }

    /// Its pages stay in `Buffer::pages` until the task ends.
    pub(crate) fn clear_cells(&mut self) {
        // Destructure every field, so adding one without handling it here is a compile error.
        let Half {
            dense,
            file,
            ordinal,
            published_in_row,
            nodes,
            directory,
            earlier,
            sparse,
            typed: _,
        } = self;
        clear_cells(dense);
        (*file, *ordinal, *nodes) = (NO_FILE, 0, 0);
        *published_in_row = PublishedInRow::Unknown;
        directory.clear();
        earlier.clear();
        sparse.clear();
    }

    /// True if no lookup can tell it from what `new` returns.
    #[cfg(test)]
    fn is_like_new(&self) -> bool {
        let Half {
            dense,
            file,
            ordinal,
            published_in_row,
            nodes,
            directory,
            earlier,
            sparse,
            typed,
        } = self;
        dense.is_empty()
            && (*file, *ordinal, *nodes) == (NO_FILE, 0, 0)
            && *published_in_row == PublishedInRow::Unknown
            && directory.is_empty()
            && earlier.is_empty()
            && Reusable::is_like_new(sparse)
            && typed.as_ref().is_none_or(|typed| typed.is_like_new())
    }

    /// Returns the cell at `index` of the row `dense`. The first write allocates a cell for every node of the file, so
    /// the row doesn't grow step by step.
    #[inline(always)]
    fn cell_in_row(&mut self, index: u32) -> &mut u32 {
        if index as usize >= self.dense.len() {
            self.grow_row(index);
        }
        &mut self.dense[index as usize]
    }

    #[cold]
    #[inline(never)]
    fn grow_row(&mut self, index: u32) {
        let cells = (self.nodes as usize).max(index as usize + 1);
        match self.dense.is_empty() {
            true => self.dense = vec![0; cells],
            false => self.dense.resize(cells, 0),
        }
    }

    /// True if `earlier` has the row of `file`. `ordinal` is the file's ordinal, or 0 if it has none.
    #[inline]
    fn has_earlier_row(&self, file: u32, ordinal: u32) -> bool {
        let row = ordinal
            .checked_sub(1)
            .and_then(|at| self.earlier.get(at as usize));
        row.is_some_and(|row| row.0 == file)
    }

    /// Makes `cells` the row of `file` in `earlier`. `ordinal` is the file's ordinal and isn't 0.
    fn save_row(&mut self, file: u32, ordinal: u32, cells: Vec<u32>) {
        let at = ordinal as usize - 1;
        if at >= self.earlier.len() {
            self.earlier.resize_with(at + 1, || (NO_FILE, Vec::new()));
        }
        self.earlier[at] = (file, cells);
    }
}

/// The keys a task has stored entries under since its last commit, in order. The values stay where the task's lookups
/// find them, and a commit publishes whatever value each key has at that point. See `crate::check::commit`.
#[derive(Default)]
pub(crate) struct Log {
    /// A slot, and either the number of a published id or the index of an entry in a `Hashed`.
    pub(crate) record_keys: Vec<[u32; 2]>,
    /// A slot, a file, and the number of a node in the file.
    pub(crate) node_keys: Vec<[u32; 3]>,
}

impl Log {
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.record_keys.len() + self.node_keys.len()
    }
}

/// A `Buffer` has room for this many tables.
pub(crate) const MAX_TABLES: usize = 80;

/// The task-local parts of all `Buffered` tables, indexed by slot. A field of the `Task`. They're stored inline in the
/// task, not behind a pointer, so a table whose slot is a compile-time constant finds its part at a fixed offset from
/// the task.
pub(crate) struct Buffer<'s> {
    /// The file the task is visiting (`NO_FILE` if none) and its ordinal.
    file: u32,
    ordinal: u32,
    /// True if another file can refer to `file`.
    is_imported: bool,
    /// `Some` if the task commits while it runs.
    log: Option<Log>,
    /// Indexed by file: 1 for the first file the task visited, 2 for the second, and so on. 0 or out of range means the
    /// task hasn't visited the file.
    ordinals: Vec<u32>,
    /// The number of files that have an ordinal.
    files: u32,
    pages: Pages,
    halves: [Half<'s>; MAX_TABLES],
}

impl<'s> Buffer<'s> {
    pub(crate) fn new() -> Self {
        Buffer {
            file: NO_FILE,
            ordinal: 0,
            is_imported: false,
            log: None,
            ordinals: Vec::new(),
            files: 0,
            pages: Pages::default(),
            halves: std::array::from_fn(|_| Half::new()),
        }
    }

    /// Starts logging the keys of new entries.
    pub(crate) fn begin_log(&mut self) {
        self.log = Some(Log::default());
    }

    /// The number of logged keys.
    #[inline]
    pub(crate) fn logged(&self) -> usize {
        self.log.as_ref().map_or(0, Log::len)
    }

    /// The number of logged keys of each kind: records, then nodes.
    pub(crate) fn log_lengths(&self) -> [usize; 2] {
        (self.log.as_ref()).map_or([0; 2], |log| [log.record_keys.len(), log.node_keys.len()])
    }

    /// The keys logged since `log_lengths` returned `from`.
    pub(crate) fn logged_since(&self, from: [usize; 2]) -> (&[[u32; 2]], &[[u32; 3]]) {
        let Some(log) = &self.log else {
            return (&[], &[]);
        };
        (
            log.record_keys.get(from[0]..).unwrap_or(&log.record_keys),
            log.node_keys.get(from[1]..).unwrap_or(&log.node_keys),
        )
    }

    /// Returns the log and replaces it with an empty one.
    pub(crate) fn take_log(&mut self) -> Log {
        self.log.as_mut().map(std::mem::take).unwrap_or_default()
    }

    /// Hands back the log that `take_log` returned, so its memory is reused.
    pub(crate) fn recycle_log(&mut self, mut old_log: Log) {
        if let Some(log) = &mut self.log
            && log.len() == 0
        {
            old_log.record_keys.clear();
            old_log.node_keys.clear();
            *log = old_log;
        }
    }

    /// Logs that an entry was stored under a published id or at an index of a `Hashed`.
    #[inline]
    pub(crate) fn log_record(&mut self, slot: u32, key: u32) {
        if let Some(log) = &mut self.log {
            log.record_keys.push([slot, key]);
        }
    }

    /// Logs that an entry was stored under a node. Skips a file that no other file can refer to, because nothing is
    /// ever published under its nodes.
    #[inline]
    pub(crate) fn log_node(&mut self, slot: u32, file: u32, index: u32) {
        if let Some(log) = &mut self.log
            && (file != self.file || self.is_imported)
        {
            log.node_keys.push([slot, file, index]);
        }
    }

    /// From now on, new entries under nodes of `file` are stored densely. Nothing is dropped. `is_imported` is true if
    /// another file can refer to `file`.
    pub(crate) fn begin_file(&mut self, file: u32, is_imported: bool) {
        self.ordinal = ordinal_or_new(&mut self.ordinals, &mut self.files, file);
        (self.file, self.is_imported) = (file, is_imported);
        // For a task that sees commits, the published entries it sees in a file only stay the same while it visits that
        // file.
        if self.log.is_some() {
            for half in &mut self.halves {
                half.published_in_row = PublishedInRow::Unknown;
            }
        }
    }

    /// Drops every entry.
    pub(crate) fn clear(&mut self) {
        // Destructure every field, so adding one without handling it here is a compile error.
        let Buffer {
            file,
            ordinal,
            is_imported,
            log,
            ordinals,
            files,
            pages,
            halves,
        } = self;
        (*file, *ordinal, *files) = (NO_FILE, 0, 0);
        (*is_imported, *log) = (false, None);
        clear_cells(ordinals);
        pages.clear();
        for half in halves {
            half.clear_cells();
            if let Some(typed) = &mut half.typed {
                typed.clear();
            }
        }
    }

    /// True if no lookup can tell it from what `new` returns.
    #[cfg(test)]
    pub(crate) fn is_like_new(&self) -> bool {
        let Buffer {
            file,
            ordinal,
            is_imported,
            log,
            ordinals,
            files,
            pages,
            halves,
        } = self;
        (*file, *ordinal, *files) == (NO_FILE, 0, 0)
            && !*is_imported
            && log.is_none()
            && ordinals.is_empty()
            && pages.pool.is_empty()
            && halves.iter().all(Half::is_like_new)
    }

    /// Returns `None` if the table has no slot.
    #[inline]
    pub(crate) fn half(&self, slot: u32) -> Option<&Half<'s>> {
        self.halves.get(slot as usize)
    }

    #[inline]
    pub(crate) fn half_mut(&mut self, slot: u32) -> &mut Half<'s> {
        assert!(
            (slot as usize) < MAX_TABLES,
            "table has no slot: see `number_tables`"
        );
        &mut self.halves[slot as usize]
    }

    /// Returns the `Half::typed` of the table that owns `slot`, if it exists.
    #[inline]
    pub(crate) fn typed<S: InTask + 's>(&self, slot: &Slot<S>) -> Option<&S::In<'s>> {
        let typed = self.half(slot.number)?.typed.as_deref()?;
        debug_assert_eq!((*typed).name(), std::any::type_name::<S::In<'s>>());
        // SAFETY: only `typed_or_new` stores a value here, through a `Slot` with this number, and every such `Slot` has
        // the type `S`. See `SlotNumber::new`.
        Some(unsafe { &*std::ptr::from_ref(typed).cast::<S::In<'s>>() })
    }

    #[inline]
    pub(crate) fn typed_mut<S: InTask + 's>(&mut self, slot: &Slot<S>) -> Option<&mut S::In<'s>> {
        let typed = (self.halves.get_mut(slot.number as usize)?.typed).as_deref_mut()?;
        debug_assert_eq!((*typed).name(), std::any::type_name::<S::In<'s>>());
        // SAFETY: same as in `typed`.
        Some(unsafe { &mut *std::ptr::from_mut(typed).cast::<S::In<'s>>() })
    }

    /// Like `typed_mut`, but creates the storage if it doesn't exist.
    #[inline]
    pub(crate) fn typed_or_new<S: InTask + 's>(&mut self, slot: &Slot<S>) -> &mut S::In<'s> {
        let half = self.half_mut(slot.number);
        if half.typed.is_none() {
            let typed: S::In<'s> = S::new();
            half.typed = Some(Box::new(typed));
        }
        self.typed_mut(slot).unwrap()
    }

    // ── a table keyed by id ──

    /// Returns the cell of the task-local id `number`, passed without `LOCAL`.
    #[inline]
    pub(crate) fn own_id(&self, slot: u32, number: u32) -> u32 {
        (self.half(slot)).map_or(0, |half| {
            half.dense.get(number as usize).copied().unwrap_or(0)
        })
    }

    /// Returns the cell's value afterwards: `raw`, or the existing value.
    #[inline]
    pub(crate) fn put_own_id_if_empty(&mut self, slot: u32, number: u32, raw: u32) -> u32 {
        put_in_if_empty(&mut self.half_mut(slot).dense, number, raw)
    }

    #[inline]
    pub(crate) fn store_own_id(&mut self, slot: u32, number: u32, raw: u32) {
        *cell_mut(&mut self.half_mut(slot).dense, number) = raw;
    }

    #[inline]
    pub(crate) fn published_id(&self, slot: u32, number: u32) -> u32 {
        let Some(half) = self.half(slot) else {
            return 0;
        };
        self.pages.get(&half.directory, number as usize)
    }

    /// The cell in `pages` for the published id `number`.
    #[inline]
    fn published_id_cell(&mut self, slot: u32, number: u32) -> &mut u32 {
        let directory = &mut self.halves[slot as usize].directory;
        self.pages.cell(directory, number as usize)
    }

    #[inline]
    pub(crate) fn put_published_id_if_empty(&mut self, slot: u32, number: u32, raw: u32) -> u32 {
        let cell = self.published_id_cell(slot, number);
        let existing = *cell;
        if existing != 0 {
            return existing;
        }
        *cell = raw;
        self.log_record(slot, number);
        raw
    }

    /// `put_published_id_if_empty` for an entry that no commit publishes.
    #[inline]
    pub(crate) fn put_unlogged_if_empty(&mut self, slot: u32, number: u32, raw: u32) -> u32 {
        let cell = self.published_id_cell(slot, number);
        if *cell == 0 {
            *cell = raw;
        }
        *cell
    }

    #[inline]
    pub(crate) fn store_published_id(&mut self, slot: u32, number: u32, raw: u32) {
        *self.published_id_cell(slot, number) = raw;
        self.log_record(slot, number);
    }

    // ── a table keyed by node ──
    //
    // A key has exactly one entry. It's in its file's row (`dense` or `earlier`) if the `Half` has one, otherwise in a
    // page. A file gets a row when the task visits it and looks something up in the table (`cover`). Entries already in
    // pages are moved to the row then, so a 0 cell in a row means the task has no entry.
    // `at` is the node's number among the nodes of all files. It's `None` for a node that isn't counted among them,
    // which means nothing imports its file. Only a task that visits that file reaches such a node. Its file gets a row
    // when there's something to store.

    /// The file the task is visiting.
    #[inline]
    pub(crate) fn file(&self) -> u32 {
        self.file
    }

    /// True if `dense` is the row of `file`.
    #[inline]
    pub(crate) fn covers(&self, slot: u32, file: u32) -> bool {
        self.half(slot).is_some_and(|half| half.file == file)
    }

    /// True if `dense` is the row of `file` and `set_whole` has been called since it became that row.
    #[inline]
    pub(crate) fn has_whole_row(&self, slot: u32, file: u32) -> bool {
        (self.half(slot)).is_some_and(|half| {
            half.file == file && half.published_in_row != PublishedInRow::Unknown
        })
    }

    /// True if `set_whole` was called with `has_seeds`.
    #[inline]
    pub(crate) fn has_seeds(&self, slot: u32) -> bool {
        self.half(slot)
            .is_some_and(|half| half.published_in_row == PublishedInRow::Some)
    }

    /// Returns the cell of `dense` for a node of `file`. Returns `None` if `dense` isn't the row of `file`, or if the
    /// row isn't whole and the published part has to be checked. That's the case when the cell is 0, or when the task
    /// sees commits, because a published entry may have appeared next to the task's own.
    #[inline]
    pub(crate) fn in_row(&self, slot: u32, file: u32, index: u32) -> Option<u32> {
        let half = self.half(slot)?;
        if half.file != file {
            return None;
        }
        let raw = half.dense.get(index as usize).copied().unwrap_or(0);
        let is_whole = half.published_in_row != PublishedInRow::Unknown;
        (is_whole || raw != 0 && self.log.is_none()).then_some(raw)
    }

    /// Returns the cell at `index` of `dense`.
    #[inline]
    pub(crate) fn cell_in_row(&mut self, slot: u32, index: u32) -> &mut u32 {
        self.half_mut(slot).cell_in_row(index)
    }

    /// Makes `dense` the row of `file`, which the task is visiting, and saves the previous file's row. `nodes` is the
    /// range of the file's nodes among the nodes of all files. `count` is how many nodes `file` has.
    #[cold]
    pub(crate) fn cover(&mut self, slot: u32, file: u32, nodes: &Range<usize>, count: usize) {
        debug_assert_eq!(file, self.file);
        let (half, ordinal) = (&mut self.halves[slot as usize], self.ordinal);
        if half.file == file {
            return;
        }
        let row = std::mem::take(&mut half.dense);
        // An empty row isn't saved, so it costs nothing. Later entries under that file's nodes go into pages.
        if half.ordinal != 0 && !row.is_empty() {
            half.save_row(half.file, half.ordinal, row);
        }
        (half.file, half.ordinal, half.nodes) = (file, ordinal, count as u32);
        half.published_in_row = PublishedInRow::Unknown;
        if half.has_earlier_row(file, ordinal) {
            // The task has visited the file before.
            let before = &mut half.earlier[ordinal as usize - 1];
            half.dense = std::mem::replace(before, (NO_FILE, Vec::new())).1;
            return;
        }
        let (row, first) = (&mut half.dense, nodes.start);
        (self.pages).take_range(&half.directory, nodes, |at, raw| {
            *cell_at(row, at - first) = raw
        });
    }

    /// Copies a node's published entry into `dense`. Returns the previous value, which is 0 unless the task sees
    /// commits and stored its own entry before it saw this one.
    #[inline]
    pub(crate) fn seed(&mut self, slot: u32, index: u32, raw: u32) -> u32 {
        std::mem::replace(self.cell_in_row(slot, index), raw)
    }

    /// Call once `seed` has run for every node with a published entry that the task sees. From then on the row also
    /// covers the published part. `has_seeds` is true if there was such a node.
    pub(crate) fn set_whole(&mut self, slot: u32, has_seeds: bool) {
        let half = self.half_mut(slot);
        half.published_in_row = match has_seeds {
            true => PublishedInRow::Some,
            false => PublishedInRow::None,
        };
    }

    /// Returns 0 if the task hasn't visited `file`.
    #[inline]
    fn ordinal_of(&self, file: u32) -> u32 {
        self.ordinals.get(file as usize).copied().unwrap_or(0)
    }

    /// Returns the task's entry for a node of `file`, wherever it's stored, or 0 if there is none.
    #[inline]
    pub(crate) fn node_anywhere(&self, slot: u32, file: u32, index: u32, at: Option<usize>) -> u32 {
        let Some(half) = self.half(slot) else {
            return 0;
        };
        if half.file == file {
            return half.dense.get(index as usize).copied().unwrap_or(0);
        }
        let ordinal = self.ordinal_of(file);
        if half.has_earlier_row(file, ordinal) {
            let row = &half.earlier[ordinal as usize - 1].1;
            return row.get(index as usize).copied().unwrap_or(0);
        }
        at.map_or(0, |at| self.pages.get(&half.directory, at))
    }

    /// Returns the cell with the task's entry, or the cell where a new entry belongs.
    #[inline]
    pub(crate) fn cell_anywhere(
        &mut self,
        slot: u32,
        file: u32,
        index: u32,
        at: Option<usize>,
    ) -> &mut u32 {
        let ordinal = self.ordinal_of(file);
        let half = &mut self.halves[slot as usize];
        if half.file == file {
            return half.cell_in_row(index);
        }
        if half.has_earlier_row(file, ordinal) {
            return cell_mut(&mut half.earlier[ordinal as usize - 1].1, index);
        }
        let Some(at) = at else {
            let ordinal = ordinal_or_new(&mut self.ordinals, &mut self.files, file);
            half.save_row(file, ordinal, Vec::new());
            return cell_mut(&mut half.earlier[ordinal as usize - 1].1, index);
        };
        self.pages.cell(&mut half.directory, at)
    }

    /// Saves the task's entry for a node that already has a published entry the task sees. Lookups never find it,
    /// because the published entry wins. It's only saved for the commit, where it loses the race.
    #[cold]
    pub(crate) fn shadow(&mut self, slot: u32, file: u32, index: u32, raw: u32) {
        let word = node_word(file, index);
        (self.half_mut(slot).sparse).replace(spread_word(word), word, raw);
    }

    /// Returns what `shadow` saved for the node, or 0.
    #[inline]
    pub(crate) fn shadowed(&self, slot: u32, file: u32, index: u32) -> u32 {
        match self.half(slot) {
            Some(half) if !half.sparse.is_empty() => half.sparse_cell(node_word(file, index)),
            _ => 0,
        }
    }
}

/// Returns the ordinal of `file` in `ordinals`, assigning the next one after `files` if it has none.
fn ordinal_or_new(ordinals: &mut Vec<u32>, files: &mut u32, file: u32) -> u32 {
    let ordinal = cell_mut(ordinals, file);
    if *ordinal == 0 {
        *files += 1;
        *ordinal = *files;
    }
    *ordinal
}

// ───────────────────────────── the entries of the `FileLocal` tables ─────────────────────────────

/// One task's entries for one `FileLocal` table.
struct FileLocalTable {
    /// One word per node of the task's file, 0 for empty.
    cells: Vec<u64>,
    /// Words for the nodes of other files, keyed by `node_word`.
    sparse: Hashed<u64, u64>,
}

/// One task's entries for all `FileLocal` tables, indexed by slot. A field of the `Task`. A node of the task's file has
/// a word in a vector, indexed by its number. Every other key is hashed.
pub struct FileLocalTables {
    /// The file the task is visiting, or `NO_FILE`.
    file: u32,
    tables: Vec<FileLocalTable>,
}

impl FileLocalTables {
    pub(crate) fn new() -> Self {
        FileLocalTables {
            file: NO_FILE,
            tables: Vec::new(),
        }
    }

    /// Drops every entry. From now on, nodes of `file` are stored densely.
    pub(crate) fn begin_file(&mut self, file: u32) {
        for table in &mut self.tables {
            clear_cells(&mut table.cells);
            table.sparse.clear();
        }
        self.file = file;
    }

    /// Drops every entry.
    pub(crate) fn clear(&mut self) {
        self.begin_file(NO_FILE);
    }

    /// True if no lookup can tell it from what `new` returns.
    #[cfg(test)]
    pub(crate) fn is_like_new(&self) -> bool {
        let FileLocalTables { file, tables } = self;
        let is_empty = |table: &FileLocalTable| {
            let FileLocalTable { cells, sparse } = table;
            cells.is_empty() && Reusable::is_like_new(sparse)
        };
        *file == NO_FILE && tables.iter().all(is_empty)
    }

    #[inline]
    fn table_mut(&mut self, slot: u32) -> &mut FileLocalTable {
        if slot as usize >= self.tables.len() {
            self.grow(slot);
        }
        &mut self.tables[slot as usize]
    }

    #[cold]
    fn grow(&mut self, slot: u32) {
        assert!(slot != u32::MAX, "table has no slot: see `number_tables`");
        (self.tables).resize_with(slot as usize + 1, || FileLocalTable {
            cells: Vec::new(),
            sparse: Hashed::default(),
        });
    }

    /// Returns 0 if there's no entry.
    #[inline]
    pub(crate) fn cell(&self, slot: u32, file: u32, index: u32) -> u64 {
        let Some(table) = self.tables.get(slot as usize) else {
            return 0;
        };
        if file == self.file {
            table.cells.get(index as usize).copied().unwrap_or(0)
        } else {
            let word = node_word(file, index);
            (table.sparse.get(spread_word(word), &word)).map_or(0, |&raw| raw)
        }
    }

    /// Returns the cell's value afterwards: `raw`, or the existing value.
    #[inline]
    pub(crate) fn put_if_empty(&mut self, slot: u32, file: u32, index: u32, raw: u64) -> u64 {
        let is_dense = file == self.file;
        let table = self.table_mut(slot);
        if is_dense {
            put_in_if_empty(&mut table.cells, index, raw)
        } else {
            let word = node_word(file, index);
            *table.sparse.insert(spread_word(word), word, raw)
        }
    }

    /// Overwrites the cell.
    #[inline]
    pub(crate) fn store(&mut self, slot: u32, file: u32, index: u32, raw: u64) {
        let is_dense = file == self.file;
        let table = self.table_mut(slot);
        if is_dense {
            *cell_mut(&mut table.cells, index) = raw;
        } else {
            let word = node_word(file, index);
            table.sparse.replace(spread_word(word), word, raw);
        }
    }
}
