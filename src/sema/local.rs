//! Task-local storage.
//!
//! What a task computes goes into stores that are fields of the `Task` first. No other thread reads
//! them, so they need no atomic operations, they are small enough to stay in the cache, and what no
//! commit publishes is freed with the task.
//!
//! A type, signature, mapper, component list, atom or handle that a task has created has `LOCAL`
//! set in its id, and the rest of the id counts from 0 within the task. So results computed about
//! one need no hashing either: they are stored in a vector.
//!
//! Nor do results computed about a node or a symbol. The nodes of the file that the task is visiting
//! have a row: a vector, indexed by their numbers. The rows of the files that it has visited stay. A
//! node of any other file has a cell in a page of 64, which is found by the number of the node
//! among the nodes of all files: `Pages`. A published id has such a cell too.
//!
//! This file has the containers. `crate::types::OwnStore` has the records, `crate::table` the
//! tables, `crate::check::task` the task. Their memory is on the regular heap, and the thread that
//! runs the task frees it when the task ends.

use crate::util::{LocalVec, Placement, free_slot, is_too_full, place_of, search, slots_for};
use std::cell::{Cell, RefCell};
use std::marker::PhantomData;
use std::ops::Range;

/// Set in the id of a type, a signature, a mapper, a component list, an atom or a handle that
/// belongs to a task.
pub const LOCAL: u32 = 1 << 30;

#[inline]
pub const fn is_local_number(number: u32) -> bool {
    number & LOCAL != 0
}

/// Whether a value mentions an id with `LOCAL`. The shared part of a table has no entry under such
/// a key.
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

pub(crate) struct OfTask;

impl Placement for OfTask {
    const LEAST: usize = 256;
    /// The tag is hashed again: its low bits alone are a poor index.
    #[inline]
    fn start(tag: u32) -> usize {
        (u64::from(tag).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32) as usize
    }
}

/// Finds indices by the hash of the values they represent. It is added to through a shared
/// reference, by the one thread that has it.
#[derive(Default)]
pub struct Found {
    /// None, or a power of two of them: see `place_of`. No other thread reads them, so their address
    /// and their number are here, and a table that a bigger one replaces is freed at once.
    slots: RefCell<Box<[u64]>>,
    count: Cell<usize>,
}

/// Where a search of a `Found` for a hash has ended without a result.
#[derive(Copy, Clone)]
pub struct Vacancy {
    /// The free slot.
    at: usize,
    /// The number of slots at the time.
    of: usize,
}

impl Vacancy {
    /// Nothing has been searched.
    const UNKNOWN: Vacancy = Vacancy { at: 0, of: 0 };
}

impl Found {
    /// `is_it` does not add to this.
    #[inline]
    pub fn find(&self, spread: u64, is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        self.find_or_vacancy(spread, is_it).ok()
    }

    /// `find`. `Err`: for `fill`.
    #[inline]
    pub fn find_or_vacancy(
        &self,
        spread: u64,
        is_it: impl FnMut(u32) -> bool,
    ) -> Result<u32, Vacancy> {
        let held = self.slots.borrow();
        let slots: &[u64] = &held;
        let of = slots.len();
        if of == 0 {
            return Err(Vacancy::UNKNOWN);
        }
        search::<OfTask>(of, spread, |at| slots[at], is_it).map_err(|at| Vacancy { at, of })
    }

    #[inline]
    pub fn add(&self, spread: u64, number: u32) {
        self.fill(Vacancy::UNKNOWN, spread, number);
    }

    /// `add`, after `find_or_vacancy` has returned `vacancy` for `spread`, with no `clear` in
    /// between. Whatever has been added since: a slot is never freed, so if that slot is still free
    /// in a table of that size, it is still the first free one that a search for `spread` gets to.
    #[inline]
    pub fn fill(&self, vacancy: Vacancy, spread: u64, number: u32) {
        let count = self.count.get() + 1;
        self.count.set(count);
        let mut held = self.slots.borrow_mut();
        if is_too_full(count, held.len()) {
            Self::grow(&mut held, count);
        }
        let slots: &mut [u64] = &mut held;
        let at = match slots.get(vacancy.at) {
            Some(0) if vacancy.of == slots.len() => vacancy.at,
            _ => free_slot::<OfTask>(slots.len(), spread as u32, |at| slots[at]),
        };
        slots[at] = place_of(spread, number);
    }

    #[cold]
    #[inline(never)]
    fn grow(slots: &mut Box<[u64]>, count: usize) {
        let mut bigger = vec![0; slots_for::<OfTask>(count, slots.len())].into_boxed_slice();
        // A page of zeroed memory from the operating system that is read first takes a second page fault at its first
        // write, which interrupts every other thread.
        for page in bigger.chunks_mut((4 << 10) / size_of::<u64>()) {
            *std::hint::black_box(&mut page[0]) = 0;
        }
        for &place in slots.iter().filter(|&&place| place != 0) {
            let at = free_slot::<OfTask>(bigger.len(), (place >> 32) as u32, |at| bigger[at]);
            bigger[at] = place;
        }
        *slots = bigger;
    }

    /// The slots stay for the next task, which then neither grows them step by step nor gets fresh memory for them, unless
    /// this one has used few of them: emptying them takes time in proportion to what was added.
    pub fn clear(&mut self) {
        let count = self.count.replace(0);
        let slots = self.slots.get_mut();
        if count != 0 && slots.len() <= 4 * slots_for::<OfTask>(count, 0) {
            slots.fill(0);
        } else if count != 0 {
            *slots = Box::default();
        }
    }
}

/// A hash map that iterates in insertion order: the entries are in a vector, and the hash index
/// holds indices into it. Equivalent to `bun_collections::ArrayHashMap`, which this crate does not
/// depend on, and which has no insert with a precomputed hash for a key without `Default`.
pub struct Hashed<K, V> {
    entries: Vec<(K, V)>,
    found: Found,
}

impl<K, V> Default for Hashed<K, V> {
    fn default() -> Self {
        Hashed {
            entries: Vec::new(),
            found: Found::default(),
        }
    }
}

impl<K: Eq, V> Hashed<K, V> {
    /// The index of the entry for `key` in insertion order. `spread`: the hash of `key`, here and
    /// below.
    #[inline]
    pub fn place(&self, spread: u64, key: &K) -> Option<u32> {
        (self.found).find(spread, |place| self.entries[place as usize].0 == *key)
    }

    #[inline]
    pub fn get(&self, spread: u64, key: &K) -> Option<&V> {
        let place = self.place(spread, key)?;
        Some(&self.entries[place as usize].1)
    }

    /// Does not overwrite an existing entry. Returns the stored value.
    #[inline]
    pub fn insert(&mut self, spread: u64, key: K, value: V) -> &V {
        let place = match self.place_or_vacancy(spread, &key) {
            Ok(place) => place,
            Err(vacancy) => self.add(vacancy, spread, key, value),
        };
        &self.entries[place as usize].1
    }

    /// Overwrites any existing value for `key`. The entry keeps its position in the insertion
    /// order.
    #[inline]
    pub fn replace(&mut self, spread: u64, key: K, value: V) {
        match self.place_or_vacancy(spread, &key) {
            Ok(place) => self.entries[place as usize].1 = value,
            Err(vacancy) => {
                self.add(vacancy, spread, key, value);
            }
        }
    }

    #[inline]
    fn place_or_vacancy(&self, spread: u64, key: &K) -> Result<u32, Vacancy> {
        (self.found).find_or_vacancy(spread, |place| self.entries[place as usize].0 == *key)
    }

    fn add(&mut self, vacancy: Vacancy, spread: u64, key: K, value: V) -> u32 {
        let place = self.entries.len() as u32;
        self.found.fill(vacancy, spread, place);
        self.entries.push((key, value));
        place
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// The entry at `place` in insertion order.
    #[inline]
    pub fn entry(&self, place: u32) -> Option<&(K, V)> {
        self.entries.get(place as usize)
    }
}

/// The hash of a one-word key. `Found` uses the low half, so that half has to depend on both halves
/// of the word, and not on their exclusive or: the number of nodes (file, index) with the same
/// `file ^ index` equals the number of files of the task.
#[inline]
pub fn spread_word(word: u64) -> u64 {
    let product = word.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    product ^ product >> 32
}

#[inline]
fn cell_at<C: Copy + Default>(cells: &mut Vec<C>, index: usize) -> &mut C {
    if index >= cells.len() {
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

/// Cells for a few of a long range of numbers, 0 until they are written. All tables of a task take
/// their pages from here, so a task pays for what it touches, 256 bytes at a time, and not for the
/// size of the program.
///
/// A table has a directory, a `Vec<u32>`. The cell `at` is found in three steps:
/// `directory[at / PAGE / PAGE]` is the number of a list, the entry `at / PAGE % PAGE` of the list is
/// the number of a page, and the entry `at % PAGE` of the page is the cell. A number is 0 where
/// nothing was written, which ends the search.
#[derive(Default)]
struct Pages {
    /// The lists and the pages. The first is neither: nothing has the number 0.
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

    /// `for_each` for the cells in `range`, which are 0 afterwards.
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

// ───────────────────────────── keys of two or three numbers ─────────────────────────────

// ───────────────────────────── the task-local parts of the `Buffered` tables
// ─────────────────────────────

const NO_FILE: u32 = u32::MAX;

/// How much of a file's published entries `Half::dense` already includes.
#[derive(Clone, Copy, PartialEq, Eq)]
enum PublishedInRow {
    /// Not copied yet, so a lookup may still have to ask the published part.
    Unknown,
    /// `Buffer::set_whole` ran and the task saw no published entry for the file.
    None,
    /// `Buffer::set_whole` ran and `Buffer::seed` copied at least one published entry.
    Some,
}

/// The task-local part of one `Buffered` table. A cell holds a packed value, 0 for empty.
///
/// What a lookup under a node of `file` reads comes first, and is in one cache line.
#[repr(C, align(64))]
pub(crate) struct Half<'s> {
    /// A table keyed by id: one cell per task-local id, indexed by the id without `LOCAL`.
    /// A table keyed by node: the row of `file`. It has one cell per node, indexed by its number.
    dense: Vec<u32>,
    /// A table keyed by node: the file that `dense` covers, and its `Buffer::ordinal`.
    file: u32,
    ordinal: u32,
    published_in_row: PublishedInRow,
    /// The directory of its cells in `Buffer::pages`. A table keyed by node: by the number of the
    /// node among those of all files. A table keyed by id: by the number of a published id.
    directory: Vec<u32>,
    /// A table keyed by node: the former `dense` vectors of the files that the task has visited
    /// before, each with its file, indexed by ordinal minus one. A vector is saved unchanged:
    /// nothing is moved when the task moves on to the next file. `NO_FILE`: there is no vector for
    /// the ordinal.
    earlier: Vec<(u32, Vec<u32>)>,
    /// A table keyed by node: `Buffer::shadow`, by `node_word`.
    sparse: Hashed<u64, u32>,
    /// Type-erased storage: `S::In` of the table's `Slot<S>`. An indirect table:
    /// `LocalVec<(u64, T)>`, the values with their keys, indexed by handle without `LOCAL`.
    /// A `ByKey`: `Hashed<K, V>`.
    typed: Option<Box<dyn Reused + Send + 's>>,
}

/// Any type. What is stored without its type is dropped as this.
pub(crate) trait Typed {
    /// For a debug assertion.
    fn name(&self) -> &'static str;
}

impl<T> Typed for T {
    fn name(&self) -> &'static str {
        std::any::type_name::<T>()
    }
}

/// What one task after the other uses.
pub(crate) trait Reused: Typed {
    /// Drops what it holds. It keeps some of its memory for the next task.
    fn clear(&mut self);
}

impl<T> Reused for LocalVec<T> {
    fn clear(&mut self) {
        LocalVec::clear(self);
    }
}

impl<K, V> Reused for Hashed<K, V> {
    fn clear(&mut self) {
        self.found.clear();
        clear_cells(&mut self.entries);
    }
}

/// What a table stores in `Half::typed`. The implementor is only a name for it.
pub(crate) trait InTask {
    type In<'s>: Reused + Send + 's
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

/// The index at which a task holds the task-local part of a table. It cannot be copied, so one
/// table has it.
pub(crate) struct SlotNumber(u32);

impl SlotNumber {
    /// # Safety
    /// Among the `Buffered` tables that are used with the same tasks, no other one gets this
    /// number.
    pub(crate) unsafe fn new(number: u32) -> SlotNumber {
        SlotNumber(number)
    }

    /// For a table that has no `Half::typed`.
    pub(crate) fn number(self) -> u32 {
        self.0
    }

    /// `S`: the type of `Half::typed` for the table.
    pub(crate) fn typed<S>(self) -> Slot<S> {
        Slot {
            number: self.0,
            holds: PhantomData,
        }
    }
}

/// A `SlotNumber` and the only type of `Half::typed` that is ever stored or requested under it.
pub(crate) struct Slot<S> {
    number: u32,
    holds: PhantomData<fn() -> S>,
}

impl<S> Slot<S> {
    /// `number_tables` has not assigned one yet. `Buffer` has no `Half` for it.
    pub(crate) const NONE: Slot<S> = Slot {
        number: u32::MAX,
        holds: PhantomData,
    };

    #[inline]
    pub(crate) fn number(&self) -> u32 {
        self.number
    }
}

/// A node as a key of `Half::sparse`.
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
        clear_cells(&mut self.dense);
        (self.file, self.ordinal) = (NO_FILE, 0);
        self.published_in_row = PublishedInRow::Unknown;
        self.directory.clear();
        self.earlier.clear();
        self.sparse.clear();
    }

    /// Whether `earlier` has the row of `file`, whose ordinal is `ordinal`, or 0.
    #[inline]
    fn has_earlier_row(&self, file: u32, ordinal: u32) -> bool {
        let row = ordinal
            .checked_sub(1)
            .and_then(|at| self.earlier.get(at as usize));
        row.is_some_and(|row| row.0 == file)
    }

    /// Makes `cells` the row of `file` in `earlier`. `ordinal`: of `file`, and not 0.
    fn keep_row(&mut self, file: u32, ordinal: u32, cells: Vec<u32>) {
        let at = ordinal as usize - 1;
        if at >= self.earlier.len() {
            self.earlier.resize_with(at + 1, || (NO_FILE, Vec::new()));
        }
        self.earlier[at] = (file, cells);
    }
}

/// Under which keys a task has stored since its last commit, in that order. The values are where the lookups of the task
/// find them: a commit stores what a key has by then. See `crate::check::commit`.
#[derive(Default)]
pub(crate) struct Log {
    /// A slot, and the number of a published id or the place of an entry in a `Hashed`.
    pub(crate) of_records: Vec<[u32; 2]>,
    /// A slot, a file, and the number of a node in the file.
    pub(crate) of_nodes: Vec<[u32; 3]>,
}

impl Log {
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.of_records.len() + self.of_nodes.len()
    }
}

/// A `Buffer` has room for this many tables.
pub(crate) const MOST_TABLES: usize = 80;

/// The task-local parts of all `Buffered` tables, indexed by slot. A field of the `Task`. They are
/// in the task itself, not behind a pointer, so a table that knows its slot when it is compiled finds
/// its part at a fixed distance from the task.
pub(crate) struct Buffer<'s> {
    /// The file that the task is visiting, `NO_FILE` if it has none, and its ordinal.
    file: u32,
    ordinal: u32,
    /// Whether another file can refer to `file`.
    is_imported: bool,
    /// `Some`: the task commits while it runs.
    log: Option<Log>,
    /// Indexed by file: 1 for the first file that the task has visited, 2 for the second, and so
    /// on. 0, or out of range: the task has not visited it.
    ordinals: Vec<u32>,
    /// The number of files that have an ordinal.
    files: u32,
    pages: Pages,
    halves: [Half<'s>; MOST_TABLES],
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

    /// From now on the keys of the new entries are logged.
    pub(crate) fn begin_log(&mut self) {
        self.log = Some(Log::default());
    }

    /// How many keys are logged.
    #[inline]
    pub(crate) fn logged(&self) -> usize {
        self.log.as_ref().map_or(0, Log::len)
    }

    /// How many keys of each kind are logged: of records, of nodes.
    pub(crate) fn lengths_of_log(&self) -> [usize; 2] {
        (self.log.as_ref()).map_or([0; 2], |log| [log.of_records.len(), log.of_nodes.len()])
    }

    /// The keys that were logged when `lengths_of_log` was `from` or later.
    pub(crate) fn logged_since(&self, from: [usize; 2]) -> (&[[u32; 2]], &[[u32; 3]]) {
        let Some(log) = &self.log else {
            return (&[], &[]);
        };
        (
            log.of_records.get(from[0]..).unwrap_or(&log.of_records),
            log.of_nodes.get(from[1]..).unwrap_or(&log.of_nodes),
        )
    }

    /// None are logged afterwards.
    pub(crate) fn take_log(&mut self) -> Log {
        self.log.as_mut().map(std::mem::take).unwrap_or_default()
    }

    /// What `take_log` has returned, for its memory.
    pub(crate) fn give_back_log(&mut self, mut taken: Log) {
        if let Some(log) = &mut self.log
            && log.len() == 0
        {
            taken.of_records.clear();
            taken.of_nodes.clear();
            *log = taken;
        }
    }

    /// An entry was stored under a published id, or at a place of a `Hashed`.
    #[inline]
    pub(crate) fn log_record(&mut self, slot: u32, key: u32) {
        if let Some(log) = &mut self.log {
            log.of_records.push([slot, key]);
        }
    }

    /// Nothing is ever published under a node of a file that no other file can refer to.
    #[inline]
    pub(crate) fn log_node(&mut self, slot: u32, file: u32, index: u32) {
        if let Some(log) = &mut self.log
            && (file != self.file || self.is_imported)
        {
            log.of_nodes.push([slot, file, index]);
        }
    }

    /// From now on the new entries under the nodes of `file` are dense. Nothing is dropped.
    /// `is_imported`: whether another file can refer to `file`.
    pub(crate) fn begin_file(&mut self, file: u32, is_imported: bool) {
        self.ordinal = ordinal_or_new(&mut self.ordinals, &mut self.files, file);
        (self.file, self.is_imported) = (file, is_imported);
        // What a task that sees commits sees in a file stays the same only while it visits the file.
        if self.log.is_some() {
            for half in &mut self.halves {
                half.published_in_row = PublishedInRow::Unknown;
            }
        }
    }

    /// Drops every entry.
    pub(crate) fn clear(&mut self) {
        (self.file, self.ordinal, self.files) = (NO_FILE, 0, 0);
        (self.is_imported, self.log) = (false, None);
        clear_cells(&mut self.ordinals);
        self.pages.clear();
        for half in &mut self.halves {
            half.clear_cells();
            if let Some(typed) = &mut half.typed {
                typed.clear();
            }
        }
    }

    /// `None`: the table has no slot.
    #[inline]
    pub(crate) fn half(&self, slot: u32) -> Option<&Half<'s>> {
        self.halves.get(slot as usize)
    }

    #[inline]
    pub(crate) fn half_mut(&mut self, slot: u32) -> &mut Half<'s> {
        assert!(
            (slot as usize) < MOST_TABLES,
            "a table without a slot: `number_tables`"
        );
        &mut self.halves[slot as usize]
    }

    /// `Half::typed` of the table that has `slot`, if there is one.
    #[inline]
    pub(crate) fn typed<S: InTask + 's>(&self, slot: &Slot<S>) -> Option<&S::In<'s>> {
        let typed = self.half(slot.number)?.typed.as_deref()?;
        debug_assert_eq!((*typed).name(), std::any::type_name::<S::In<'s>>());
        // SAFETY: only `typed_or_new` stores one, under a `Slot` with this number, and all of those
        // have the type `S`: see `SlotNumber::new`.
        Some(unsafe { &*std::ptr::from_ref(typed).cast::<S::In<'s>>() })
    }

    #[inline]
    pub(crate) fn typed_mut<S: InTask + 's>(&mut self, slot: &Slot<S>) -> Option<&mut S::In<'s>> {
        let typed = (self.halves.get_mut(slot.number as usize)?.typed).as_deref_mut()?;
        debug_assert_eq!((*typed).name(), std::any::type_name::<S::In<'s>>());
        // SAFETY: as in `typed`.
        Some(unsafe { &mut *std::ptr::from_mut(typed).cast::<S::In<'s>>() })
    }

    /// Creates one if there is none.
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

    /// The cell of the task-local id `number`, which is given without `LOCAL`.
    #[inline]
    pub(crate) fn own_id(&self, slot: u32, number: u32) -> u32 {
        (self.half(slot)).map_or(0, |half| {
            half.dense.get(number as usize).copied().unwrap_or(0)
        })
    }

    /// Returns the value the cell holds afterwards: `raw`, or the existing value.
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
    fn cell_of_published_id(&mut self, slot: u32, number: u32) -> &mut u32 {
        let directory = &mut self.halves[slot as usize].directory;
        self.pages.cell(directory, number as usize)
    }

    #[inline]
    pub(crate) fn put_published_id_if_empty(&mut self, slot: u32, number: u32, raw: u32) -> u32 {
        let cell = self.cell_of_published_id(slot, number);
        let kept = *cell;
        if kept != 0 {
            return kept;
        }
        *cell = raw;
        self.log_record(slot, number);
        raw
    }

    /// `put_published_id_if_empty` for an entry that no commit stores.
    #[inline]
    pub(crate) fn put_unlogged_if_empty(&mut self, slot: u32, number: u32, raw: u32) -> u32 {
        let cell = self.cell_of_published_id(slot, number);
        if *cell == 0 {
            *cell = raw;
        }
        *cell
    }

    #[inline]
    pub(crate) fn store_published_id(&mut self, slot: u32, number: u32, raw: u32) {
        *self.cell_of_published_id(slot, number) = raw;
        self.log_record(slot, number);
    }

    // ── a table keyed by node ──
    //
    // A key has exactly one entry. It is in the row of its file if the `Half` has one: in `dense`, or
    // in `earlier`. Otherwise it is in a page. A file gets a row when the task visits it and asks
    // the table about it (`cover`), and what is in pages by then is moved to the row, so a cell of
    // a row that is 0 means that the task has no entry.
    // `at` is the number of the node among the nodes of all files. It is `None` for a node that is
    // not counted among them, which is one of a file that nothing imports. Only a task that visits
    // the file gets to it. Its file gets a row when there is something to store.

    /// The file that the task is visiting.
    #[inline]
    pub(crate) fn file(&self) -> u32 {
        self.file
    }

    /// Whether `dense` is the row of `file`.
    #[inline]
    pub(crate) fn covers(&self, slot: u32, file: u32) -> bool {
        self.half(slot).is_some_and(|half| half.file == file)
    }

    /// Whether `dense` is the row of `file` and `set_whole` was called since it is.
    #[inline]
    pub(crate) fn has_whole_row(&self, slot: u32, file: u32) -> bool {
        (self.half(slot)).is_some_and(|half| {
            half.file == file && half.published_in_row != PublishedInRow::Unknown
        })
    }

    /// Whether `set_whole` was told so.
    #[inline]
    pub(crate) fn has_seeds(&self, slot: u32) -> bool {
        self.half(slot)
            .is_some_and(|half| half.published_in_row == PublishedInRow::Some)
    }

    /// What `dense` says about a node of `file`. `None`: it is not the row of `file`, or it is not
    /// whole and the published part has to be asked: the cell is 0, or the task sees commits, so
    /// that a published entry may have turned up beside its own.
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

    /// The cell of `dense`.
    #[inline]
    pub(crate) fn cell_in_row(&mut self, slot: u32, index: u32) -> &mut u32 {
        cell_mut(&mut self.half_mut(slot).dense, index)
    }

    /// From now on `dense` is the row of `file`, which the task is visiting. The row of the previous
    /// file is saved. `nodes`: those of `file` among those of all files.
    #[cold]
    pub(crate) fn cover(&mut self, slot: u32, file: u32, nodes: &Range<usize>) {
        debug_assert_eq!(file, self.file);
        let (half, ordinal) = (&mut self.halves[slot as usize], self.ordinal);
        if half.file == file {
            return;
        }
        let row = std::mem::take(&mut half.dense);
        // A file without a row costs nothing. What is stored under its nodes later is paged.
        if half.ordinal != 0 && !row.is_empty() {
            half.keep_row(half.file, half.ordinal, row);
        }
        (half.file, half.ordinal) = (file, ordinal);
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

    /// Puts what is published for a node into `dense`. Returns what was there: 0, unless the task
    /// sees commits and has stored an entry before it saw this one.
    #[inline]
    pub(crate) fn seed(&mut self, slot: u32, index: u32, raw: u32) -> u32 {
        std::mem::replace(self.cell_in_row(slot, index), raw)
    }

    /// `seed` was called for every node for which the task sees a published entry. So the row answers
    /// for the published part too. `has_seeds`: there was such a node.
    pub(crate) fn set_whole(&mut self, slot: u32, has_seeds: bool) {
        let half = self.half_mut(slot);
        half.published_in_row = match has_seeds {
            true => PublishedInRow::Some,
            false => PublishedInRow::None,
        };
    }

    /// 0: the task has not visited `file`.
    #[inline]
    fn ordinal_of(&self, file: u32) -> u32 {
        self.ordinals.get(file as usize).copied().unwrap_or(0)
    }

    /// The task's entry for a node of `file`, wherever it is. 0: there is none.
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

    /// The cell that holds the task's entry, or that a new entry goes into.
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
            return cell_mut(&mut half.dense, index);
        }
        if half.has_earlier_row(file, ordinal) {
            return cell_mut(&mut half.earlier[ordinal as usize - 1].1, index);
        }
        let Some(at) = at else {
            let ordinal = ordinal_or_new(&mut self.ordinals, &mut self.files, file);
            half.keep_row(file, ordinal, Vec::new());
            return cell_mut(&mut half.earlier[ordinal as usize - 1].1, index);
        };
        self.pages.cell(&mut half.directory, at)
    }

    /// Keeps an entry of the task under a node for which it sees a published one. No lookup finds it:
    /// the published entry stays what it is. It is there for the commit, where it loses.
    #[cold]
    pub(crate) fn shadow(&mut self, slot: u32, file: u32, index: u32, raw: u32) {
        let word = node_word(file, index);
        (self.half_mut(slot).sparse).replace(spread_word(word), word, raw);
    }

    /// What `shadow` has kept for the node. 0: nothing.
    #[inline]
    pub(crate) fn shadowed(&self, slot: u32, file: u32, index: u32) -> u32 {
        match self.half(slot) {
            Some(half) if !half.sparse.is_empty() => half.sparse_cell(node_word(file, index)),
            _ => 0,
        }
    }
}

/// The ordinal of `file` in `ordinals`. If it has none, it gets the next one after `files`.
fn ordinal_or_new(ordinals: &mut Vec<u32>, files: &mut u32, file: u32) -> u32 {
    let ordinal = cell_mut(ordinals, file);
    if *ordinal == 0 {
        *files += 1;
        *ordinal = *files;
    }
    *ordinal
}

// ───────────────────────────── the entries of the `FileLocal` tables ─────────────────────────────

/// The entries of one task for one `FileLocal` table.
struct FileLocalTable {
    /// One word per node of the task's file, 0 for empty.
    cells: Vec<u64>,
    /// Words for the nodes of other files, by `node_word`.
    sparse: Hashed<u64, u64>,
}

/// The entries of all `FileLocal` tables of one task, indexed by slot. A field of the `Task`. A
/// node of the task's file has a word in a vector, indexed by its number. Every other key is
/// hashed.
pub struct FileLocalTables {
    /// The file that the task is visiting, `NO_FILE` if it has none.
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

    /// Drops every entry. From now on the nodes of `file` have dense words.
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

    #[inline]
    fn table_mut(&mut self, slot: u32) -> &mut FileLocalTable {
        if slot as usize >= self.tables.len() {
            self.grow(slot);
        }
        &mut self.tables[slot as usize]
    }

    #[cold]
    fn grow(&mut self, slot: u32) {
        assert!(slot != u32::MAX, "a table without a slot: `number_tables`");
        (self.tables).resize_with(slot as usize + 1, || FileLocalTable {
            cells: Vec::new(),
            sparse: Hashed::default(),
        });
    }

    /// 0: nothing.
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

    /// Returns the value the cell holds afterwards: `raw`, or the existing value.
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
