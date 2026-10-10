//! Task-local storage.
//!
//! During a step the published state is read-only. Everything a task creates or computes goes into
//! stores that are fields of the `Task`: no other thread reads them, so they need no atomic
//! operations, they are small enough to stay in the cache, and what is not passed to the barrier is
//! freed with the task.
//!
//! A type, signature, mapper, component list, atom or handle that a task has created has `LOCAL`
//! set in its id, and the rest of the id counts from 0 within the task. So results computed about
//! one need no hashing either: they are stored in a vector.
//!
//! This file has the containers. `crate::types::OwnStore` has the records, `crate::table` the
//! tables, `crate::check::task` the task. Their memory is on the regular heap, and the thread that
//! runs the task frees it when the task ends.

use crate::util::{LocalVec, Placement, Places};
use std::alloc::Global;
use std::cell::{Cell, RefCell};
use std::marker::PhantomData;
use std::sync::atomic::Ordering;

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
    const STORE: Ordering = Ordering::Relaxed;
    /// The tag is hashed again: its low bits alone are a poor index.
    #[inline]
    fn start(tag: u32) -> usize {
        (u64::from(tag).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32) as usize
    }
}

/// Finds indices by the hash of the values they represent. It is added to through a shared
/// reference, by the one thread that has it.
pub struct Found {
    places: RefCell<Places<OfTask>>,
    count: Cell<usize>,
}

impl Default for Found {
    fn default() -> Self {
        Found {
            places: RefCell::new(Places::new_in(Global)),
            count: Cell::new(0),
        }
    }
}

impl Found {
    /// `is_it` does not add to this.
    #[inline]
    pub fn find(&self, spread: u64, is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        self.places.borrow().find(spread, Ordering::Relaxed, is_it)
    }

    /// A table that a bigger one replaces is freed at once: no other thread reads it.
    #[inline]
    pub fn add(&self, spread: u64, number: u32) {
        let count = self.count.replace(self.count.get() + 1);
        let mut places = self.places.borrow_mut();
        places.add(count, 1, std::iter::once((spread, number)));
        places.forget_older();
    }

    pub fn clear(&mut self) {
        if self.count.replace(0) != 0 {
            self.places.get_mut().clear();
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
        let place = match self.place(spread, &key) {
            Some(place) => place,
            None => self.add(spread, key, value),
        };
        &self.entries[place as usize].1
    }

    /// Overwrites any existing value for `key`. The entry keeps its position in the insertion
    /// order.
    #[inline]
    pub fn replace(&mut self, spread: u64, key: K, value: V) {
        match self.place(spread, &key) {
            Some(place) => self.entries[place as usize].1 = value,
            None => {
                self.add(spread, key, value);
            }
        }
    }

    fn add(&mut self, spread: u64, key: K, value: V) -> u32 {
        let place = self.entries.len() as u32;
        self.found.add(spread, place);
        self.entries.push((key, value));
        place
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The entries in insertion order. It is empty afterwards.
    pub fn take(&mut self) -> Vec<(K, V)> {
        self.found.clear();
        std::mem::take(&mut self.entries)
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
fn cell_mut<C: Copy + Default>(cells: &mut Vec<C>, index: u32) -> &mut C {
    let index = index as usize;
    if index >= cells.len() {
        cells.resize(index + 1, C::default());
    }
    &mut cells[index]
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

// ───────────────────────────── the task-local parts of the `Buffered` tables
// ─────────────────────────────

const NO_FILE: u32 = u32::MAX;

/// The task-local part of one `Buffered` table. A cell holds a packed value, 0 for empty.
pub(crate) struct Half<'s> {
    /// A table keyed by id: one cell per task-local id, indexed by the id without `LOCAL`.
    /// A table keyed by node: one cell per node of `file`, indexed by its number.
    dense: Vec<u32>,
    /// A table keyed by node: the file that `dense` covers, and its `Buffer::ordinal`.
    file: u32,
    ordinal: u32,
    /// A table keyed by node: an entry for a node of `file` may be in `sparse`, because the task
    /// stored it while `dense` covered another file. A task that visits the files of a cycle
    /// evaluates nodes of the later files from the earlier ones. Such an entry is not moved, so an
    /// empty dense cell does not imply that there is no entry. Never set for the first file of a
    /// task.
    may_be_hashed: bool,
    /// A table keyed by node: the former `dense` vectors of the files that the task has visited
    /// before, each with its file, indexed by ordinal minus one. A vector is saved unchanged:
    /// nothing is hashed when the task moves on to the next file. `NO_FILE`: there is no vector for
    /// the ordinal.
    earlier: Vec<(u32, Vec<u32>)>,
    /// New entries under published keys: a published id is keyed by its number. A node is keyed by
    /// `file << 32 | index`, if `dense` covered another file when the entry was stored.
    sparse: Hashed<u64, u32>,
    /// Type-erased storage: `S::In` of the table's `Slot<S>`. An indirect table:
    /// `LocalVec<(u64, T)>`, the values with their keys, indexed by handle without `LOCAL`.
    /// A `ByKey`: `Hashed<K, V>`.
    typed: Option<Box<dyn Typed + Send + 's>>,
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

/// What a table stores in `Half::typed`. The implementor is only a name for it.
pub(crate) trait InTask {
    type In<'s>: Send + 's
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
            may_be_hashed: false,
            earlier: Vec::new(),
            sparse: Hashed::default(),
            typed: None,
        }
    }

    #[inline]
    fn sparse_cell(&self, word: u64) -> u32 {
        (self.sparse.get(spread_word(word), &word)).map_or(0, |&raw| raw)
    }

    /// The cell for the node `index` of the earlier file with `ordinal`. `None`: there is no vector
    /// for it, or the vector is shorter.
    #[inline]
    fn earlier_cell(&mut self, ordinal: u32, index: u32) -> Option<&mut u32> {
        let cells = &mut self.earlier.get_mut(ordinal.checked_sub(1)? as usize)?.1;
        cells.get_mut(index as usize)
    }

    /// From now on `dense` covers the nodes of `file`. The vector of the previous file is saved.
    /// `may_be_hashed`: whether the task can have evaluated a node of `file` while `dense` covered
    /// another file.
    #[cold]
    fn adopt(&mut self, file: u32, ordinal: u32, may_be_hashed: bool) {
        self.may_be_hashed = may_be_hashed && !self.sparse.is_empty();
        let cells = std::mem::take(&mut self.dense);
        if let Some(at) = self.ordinal.checked_sub(1) {
            if at as usize >= self.earlier.len() {
                (self.earlier).resize_with(at as usize + 1, || (NO_FILE, Vec::new()));
            }
            self.earlier[at as usize] = (self.file, cells);
        }
        (self.file, self.ordinal) = (file, ordinal);
        // The task has visited the file before.
        if let Some(before) = self.earlier.get_mut(ordinal as usize - 1) {
            self.dense = std::mem::replace(before, (NO_FILE, Vec::new())).1;
        }
    }

    /// The non-empty cells: those of the earlier files, in file order, by index. Then the dense
    /// ones, by index. Then the hashed entries, in insertion order. Each is `(key, raw)`. The key
    /// of a dense cell is `dense_key(self, index)`. No cells are left afterwards.
    pub(crate) fn take_cells(
        &mut self,
        dense_key: impl Fn(&Half<'s>, u32) -> u64,
        mut take: impl FnMut(u64, u32),
    ) {
        for (file, cells) in self.earlier.drain(..) {
            for (index, raw) in cells.into_iter().enumerate() {
                if raw != 0 {
                    take(node_word(file, index as u32), raw);
                }
            }
        }
        for (index, &raw) in self.dense.iter().enumerate() {
            if raw != 0 {
                take(dense_key(self, index as u32), raw);
            }
        }
        for (word, raw) in self.sparse.take() {
            take(word, raw);
        }
        self.clear_cells();
    }

    /// The file that `dense` covers.
    pub(crate) fn file(&self) -> u32 {
        self.file
    }

    pub(crate) fn clear_cells(&mut self) {
        clear_cells(&mut self.dense);
        (self.file, self.ordinal, self.may_be_hashed) = (NO_FILE, 0, false);
        self.earlier.clear();
        self.sparse.take();
    }
}

/// The task-local parts of all `Buffered` tables, indexed by slot. A field of the `Task`.
pub(crate) struct Buffer<'s> {
    /// The file that the task is visiting, `NO_FILE` if it has none, and its ordinal.
    file: u32,
    ordinal: u32,
    /// Whether the task can have evaluated a node of `file` before it started visiting `file`. See
    /// `Half::may_be_hashed`.
    may_be_hashed: bool,
    /// Indexed by file: 1 for the first file that the task has visited, 2 for the second, and so
    /// on. 0, or out of range: the task has not visited it.
    ordinals: Vec<u32>,
    /// The number of files that have an ordinal.
    files: u32,
    halves: Vec<Half<'s>>,
}

impl<'s> Buffer<'s> {
    pub(crate) fn new() -> Self {
        Buffer {
            file: NO_FILE,
            ordinal: 0,
            may_be_hashed: false,
            ordinals: Vec::new(),
            files: 0,
            halves: Vec::new(),
        }
    }

    /// From now on the new entries under the nodes of `file` are dense. Nothing is dropped.
    /// `is_imported`: whether another file can refer to `file`. If none can, the task has evaluated
    /// no node of `file` so far, unless it has visited `file` before.
    pub(crate) fn begin_file(&mut self, file: u32, is_imported: bool) {
        let ordinal = cell_mut(&mut self.ordinals, file);
        let is_new = *ordinal == 0;
        if is_new {
            self.files += 1;
            *ordinal = self.files;
        }
        (self.file, self.ordinal) = (file, *ordinal);
        self.may_be_hashed =
            (is_imported || !is_new) && self.halves.iter().any(|half| !half.sparse.is_empty());
    }

    /// Drops every entry.
    pub(crate) fn clear(&mut self) {
        (self.file, self.ordinal, self.may_be_hashed, self.files) = (NO_FILE, 0, false, 0);
        clear_cells(&mut self.ordinals);
        for half in &mut self.halves {
            half.clear_cells();
            half.typed = None;
        }
    }

    #[inline]
    pub(crate) fn half(&self, slot: u32) -> Option<&Half<'s>> {
        self.halves.get(slot as usize)
    }

    #[inline]
    pub(crate) fn half_mut(&mut self, slot: u32) -> &mut Half<'s> {
        if slot as usize >= self.halves.len() {
            self.grow(slot);
        }
        &mut self.halves[slot as usize]
    }

    #[cold]
    fn grow(&mut self, slot: u32) {
        assert!(slot != u32::MAX, "a table without a slot: `number_tables`");
        (self.halves).resize_with(slot as usize + 1, Half::new);
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
        (self.half(slot)).map_or(0, |half| half.sparse_cell(u64::from(number)))
    }

    #[inline]
    pub(crate) fn put_published_id_if_empty(&mut self, slot: u32, number: u32, raw: u32) -> u32 {
        let word = u64::from(number);
        *(self.half_mut(slot).sparse).insert(spread_word(word), word, raw)
    }

    #[inline]
    pub(crate) fn store_published_id(&mut self, slot: u32, number: u32, raw: u32) {
        let word = u64::from(number);
        (self.half_mut(slot).sparse).replace(spread_word(word), word, raw);
    }

    // ── a table keyed by node ──
    //
    // A key has exactly one entry. It is in the vector of its file if that was `dense` when the
    // entry was stored, and otherwise in `sparse`.

    #[inline]
    pub(crate) fn node(&self, slot: u32, file: u32, index: u32) -> u32 {
        let Some(half) = self.half(slot) else {
            return 0;
        };
        if file == half.file {
            let raw = half.dense.get(index as usize).copied().unwrap_or(0);
            if raw != 0 || !half.may_be_hashed {
                return raw;
            }
        } else if !half.earlier.is_empty()
            && let Some(at) = self.ordinal_of(file).checked_sub(1)
            && let Some((_, cells)) = half.earlier.get(at as usize)
            && let Some(&raw) = cells.get(index as usize)
            && raw != 0
        {
            return raw;
        }
        half.sparse_cell(node_word(file, index))
    }

    /// 0: the task has not visited `file`.
    #[inline]
    fn ordinal_of(&self, file: u32) -> u32 {
        self.ordinals.get(file as usize).copied().unwrap_or(0)
    }

    /// The vector cell that holds the entry for the node, or that a new entry goes into. `Err`: it
    /// is in `sparse`, or goes there.
    #[inline]
    fn cell_for_node(
        &mut self,
        slot: u32,
        file: u32,
        index: u32,
    ) -> Result<&mut u32, &mut Half<'s>> {
        let (own, ordinal, may_be_hashed) = (self.file, self.ordinal, self.may_be_hashed);
        let ordinal_of_file = if file == own {
            ordinal
        } else {
            self.ordinal_of(file)
        };
        let half = self.half_mut(slot);
        if file != half.file && file == own {
            half.adopt(own, ordinal, may_be_hashed);
        }
        if file == half.file {
            if half.may_be_hashed && half.sparse_cell(node_word(file, index)) != 0 {
                return Err(half);
            }
            return Ok(cell_mut(&mut half.dense, index));
        }
        // A new entry under a node of an earlier file is hashed.
        if half
            .earlier_cell(ordinal_of_file, index)
            .is_some_and(|cell| *cell != 0)
        {
            return Ok(half.earlier_cell(ordinal_of_file, index).unwrap());
        }
        Err(half)
    }

    /// Returns the value the cell holds afterwards: `raw`, or the existing value.
    #[inline]
    pub(crate) fn put_node_if_empty(&mut self, slot: u32, file: u32, index: u32, raw: u32) -> u32 {
        match self.cell_for_node(slot, file, index) {
            Ok(cell) => {
                if *cell == 0 {
                    *cell = raw;
                }
                *cell
            }
            Err(half) => {
                let word = node_word(file, index);
                *half.sparse.insert(spread_word(word), word, raw)
            }
        }
    }

    #[inline]
    pub(crate) fn store_node(&mut self, slot: u32, file: u32, index: u32, raw: u32) {
        match self.cell_for_node(slot, file, index) {
            Ok(cell) => *cell = raw,
            Err(half) => {
                let word = node_word(file, index);
                half.sparse.replace(spread_word(word), word, raw);
            }
        }
    }
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
            table.sparse.take();
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
