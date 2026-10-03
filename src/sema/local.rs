//! What a task keeps to itself.
//!
//! During a step the published state is read-only. Whatever a task creates or works out goes into stores that are fields of the `Task`:
//! no other thread reads them, so they take no atomic operations, they are small enough to stay in the cache, and what is not handed to
//! the barrier is freed with the task.
//!
//! A type, signature, mapper, component list, atom or handle that a task has created has `LOCAL` set in its number, and the rest of the
//! number counts from 0 within the task. So what is worked out about one needs no hashing either: it goes in a vector.
//!
//! This file has the containers. `crate::types::OwnStore` has the records, `crate::table` the tables, `crate::check::task` the task.

use std::alloc::Layout;
use std::any::Any;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Set in the number of a type, a signature, a mapper, a component list, an atom or a handle that belongs to a task.
pub const LOCAL: u32 = 1 << 30;

#[inline]
pub const fn is_local_number(number: u32) -> bool {
    number & LOCAL != 0
}

/// Whether something mentions an id with `LOCAL`. The published half of a table has no entry under such a key.
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

/// A vector whose elements never move and that is emptied without giving its memory back. A reference to an element stays good while
/// others are pushed: the chunks are reached through raw pointers, so a push makes no reference to anything but its own slot.
pub struct Chunked<T> {
    chunks: Vec<*mut T>,
    len: usize,
}

// SAFETY: owns its elements.
unsafe impl<T: Send> Send for Chunked<T> {}
// SAFETY: a shared reference gives out shared references to the elements only.
unsafe impl<T: Sync> Sync for Chunked<T> {}

const CHUNK: usize = 1024;

impl<T> Default for Chunked<T> {
    fn default() -> Self {
        Chunked {
            chunks: Vec::new(),
            len: 0,
        }
    }
}

impl<T> Chunked<T> {
    const LAYOUT: Layout = match Layout::array::<T>(CHUNK) {
        Ok(layout) if layout.size() != 0 => layout,
        _ => panic!("no chunks of this"),
    };

    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn push(&mut self, value: T) -> usize {
        let index = self.len;
        if index / CHUNK == self.chunks.len() {
            // SAFETY: the size is not zero.
            let chunk = unsafe { std::alloc::alloc(Self::LAYOUT) }.cast::<T>();
            if chunk.is_null() {
                std::alloc::handle_alloc_error(Self::LAYOUT);
            }
            self.chunks.push(chunk);
        }
        // SAFETY: inside the chunk, and nothing is there.
        unsafe { self.chunks[index / CHUNK].add(index % CHUNK).write(value) };
        self.len += 1;
        index
    }

    #[inline]
    pub fn get(&self, index: usize) -> &T {
        assert!(index < self.len);
        // SAFETY: the first `len` are written, so the chunks they are in are there.
        unsafe { &*self.chunks.get_unchecked(index / CHUNK).add(index % CHUNK) }
    }

    /// Moves the elements out, in order, and leaves it empty.
    pub fn drain(&mut self, mut take: impl FnMut(usize, T)) {
        let len = std::mem::take(&mut self.len);
        for index in 0..len {
            // SAFETY: the first `len` were written, and none is reached any more.
            take(index, unsafe {
                self.chunks[index / CHUNK].add(index % CHUNK).read()
            });
        }
        self.release(64);
    }

    pub fn clear(&mut self) {
        if std::mem::needs_drop::<T>() {
            self.drain(|_, value| drop(value));
        } else {
            self.len = 0;
            self.release(64);
        }
    }

    /// One big file does not make its owner big for good.
    fn release(&mut self, keep: usize) {
        debug_assert!(self.len == 0);
        for chunk in self.chunks.drain(keep.min(self.chunks.len())..) {
            // SAFETY: allocated in `push` with this layout, and nothing is in it.
            unsafe { std::alloc::dealloc(chunk.cast::<u8>(), Self::LAYOUT) };
        }
    }
}

impl<T> Drop for Chunked<T> {
    fn drop(&mut self) {
        self.clear();
        self.release(0);
    }
}

/// Finds numbers by the hash of what they stand for.
#[derive(Default)]
pub struct Found {
    /// 0, or the low half of the hash above the number plus one.
    places: Vec<u64>,
    count: usize,
}

impl Found {
    #[inline]
    pub fn find(&self, spread: u64, mut is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        if self.places.is_empty() {
            return None;
        }
        let mask = self.places.len() - 1;
        let tag = spread as u32;
        let mut at = Self::start(u64::from(tag)) & mask;
        loop {
            // SAFETY: `mask` is one less than there are places.
            let place = unsafe { *self.places.get_unchecked(at) };
            if place == 0 {
                return None;
            }
            if (place >> 32) as u32 == tag && is_it(place as u32 - 1) {
                return Some(place as u32 - 1);
            }
            at = (at + 1) & mask;
        }
    }

    pub fn add(&mut self, spread: u64, number: u32) {
        if (self.count + 1) * 4 > self.places.len() * 3 {
            let bigger = (self.places.len() * 2).max(256);
            let old = std::mem::replace(&mut self.places, vec![0; bigger]);
            // The place goes by bits of the hash that are not kept, so the tag has to do: it is spread again.
            for place in old {
                if place != 0 {
                    self.put(place);
                }
            }
        }
        self.put(u64::from(spread as u32) << 32 | u64::from(number + 1));
        self.count += 1;
    }

    fn put(&mut self, place: u64) {
        let mask = self.places.len() - 1;
        let mut at = Self::start(place >> 32) & mask;
        while self.places[at] != 0 {
            at = (at + 1) & mask;
        }
        self.places[at] = place;
    }

    #[inline]
    fn start(tag: u64) -> usize {
        (tag.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32) as usize
    }

    pub fn clear(&mut self) {
        if self.count == 0 {
            return;
        }
        self.count = 0;
        if self.places.len() > 1 << 16 {
            self.places = Vec::new();
        } else {
            self.places.fill(0);
        }
    }
}

/// A hash map that lists its entries IN INSERTION ORDER: they are in a vector, and the hash index holds places in it. What
/// `bun_collections::ArrayHashMap` is, which this crate does not depend on, and which has no insert with a hash that is already computed
/// for a key without `Default`.
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
    /// Where the entry for `key` is in the insertion order. `spread`: the hash of `key`, here and below.
    #[inline]
    pub fn place(&self, spread: u64, key: &K) -> Option<u32> {
        (self.found).find(spread, |place| self.entries[place as usize].0 == *key)
    }

    #[inline]
    pub fn get(&self, spread: u64, key: &K) -> Option<&V> {
        let place = self.place(spread, key)?;
        Some(&self.entries[place as usize].1)
    }

    /// Keeps what is there already, and returns what is kept.
    #[inline]
    pub fn insert(&mut self, spread: u64, key: K, value: V) -> &V {
        let place = match self.place(spread, &key) {
            Some(place) => place,
            None => self.add(spread, key, value),
        };
        &self.entries[place as usize].1
    }

    /// Whatever was there for `key` is gone. The entry keeps its place in the insertion order.
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

/// The hash of a key that is one word. `Found` goes by the low half, so that has to depend on BOTH halves of the word, and not on their
/// exclusive or: the nodes (file, index) with one `file ^ index` are as many as the task has files.
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
fn put_in_if_empty<C: Copy + Default + PartialEq>(cells: &mut Vec<C>, index: u32, raw: C) -> C {
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

// ───────────────────────────── the task's halves of the `Buffered` tables ─────────────────────────────

const NO_FILE: u32 = u32::MAX;

/// What one task has for one `Buffered` table. A cell holds a packed value, 0 for nothing.
pub(crate) struct Half {
    /// A table by id: a cell for each id of the task's own, by its number without `LOCAL`.
    /// A table by node: a cell for each node of `file`, by its number.
    dense: Vec<u32>,
    /// A table by node: the file that `dense` is for, and its `Buffer::ordinal`.
    file: u32,
    ordinal: u32,
    /// A table by node: AN ENTRY UNDER A NODE OF `file` MAY BE IN `sparse`, because the task stored it while `dense` was for another file.
    /// A task that goes through the files of a cycle evaluates nodes of the later ones from the earlier ones. Such an entry stays
    /// where it is, so an empty dense cell does not say that there is no entry. Never set for the first file of a task.
    may_be_hashed: bool,
    /// A table by node: WHAT `dense` WAS FOR THE FILES THAT THE TASK HAS GONE THROUGH BEFORE, each with its file, by ordinal less one. A vector
    /// is put away as it is: nothing is hashed when the task goes on to the next file. `NO_FILE`: the half has none for the ordinal.
    earlier: Vec<(u32, Vec<u32>)>,
    /// A PUBLISHED KEY THAT GETS A NEW ENTRY: a published id by its number. A node by `file << 32 | index`, if `dense` was for another file
    /// when the entry was stored.
    sparse: Hashed<u64, u32>,
    /// What only the table knows the type of. A kept table: `Chunked<(u64, T)>`, the values with their keys, by handle without `LOCAL`.
    /// A `ByKey`: `Hashed<K, V>`.
    typed: Option<Box<dyn Any + Send>>,
}

impl Default for Half {
    fn default() -> Self {
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
}

/// A node as a key of `Half::sparse`.
#[inline]
pub(crate) fn node_word(file: u32, index: u32) -> u64 {
    u64::from(file) << 32 | u64::from(index)
}

impl Half {
    #[inline]
    fn sparse_cell(&self, word: u64) -> u32 {
        (self.sparse.get(spread_word(word), &word)).map_or(0, |&raw| raw)
    }

    /// The cell for the node `index` of the earlier file with `ordinal`. `None`: the half has no vector for it, or a shorter one.
    #[inline]
    fn earlier_cell(&mut self, ordinal: u32, index: u32) -> Option<&mut u32> {
        let cells = &mut self.earlier.get_mut(ordinal.checked_sub(1)? as usize)?.1;
        cells.get_mut(index as usize)
    }

    /// From now on `dense` is for the nodes of `file`. What it was for the file before is put away.
    /// `may_be_hashed`: whether the task can have evaluated a node of `file` while `dense` was for another file.
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
        // The task has gone through the file before.
        if let Some(before) = self.earlier.get_mut(ordinal as usize - 1) {
            self.dense = std::mem::replace(before, (NO_FILE, Vec::new())).1;
        }
    }

    /// The cells that are not empty: those of the earlier files, in the order of the files, by index. Then the dense ones, by index. Then the
    /// hashed entries, in insertion order. `(key, raw)`. The key of a dense cell is `dense_key(self, index)`. The half has no cells
    /// afterwards.
    pub(crate) fn take_cells(
        &mut self,
        dense_key: impl Fn(&Half, u32) -> u64,
        mut take: impl FnMut(u64, u32),
    ) {
        for (file, cells) in std::mem::take(&mut self.earlier) {
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

    /// The file that `dense` is for.
    pub(crate) fn file(&self) -> u32 {
        self.file
    }

    pub(crate) fn clear_cells(&mut self) {
        clear_cells(&mut self.dense);
        (self.file, self.ordinal, self.may_be_hashed) = (NO_FILE, 0, false);
        self.earlier.clear();
        self.sparse.take();
    }

    /// # Safety
    /// `T` is the one type that the table of this half asks for.
    #[inline]
    pub(crate) unsafe fn typed<T: 'static>(&self) -> Option<&T> {
        let typed = self.typed.as_deref()?;
        debug_assert!(typed.is::<T>());
        // SAFETY: it is a `T`.
        Some(unsafe { &*std::ptr::from_ref(typed).cast::<T>() })
    }

    /// # Safety
    /// As for `typed`.
    pub(crate) unsafe fn existing_typed_mut<T: 'static>(&mut self) -> Option<&mut T> {
        let typed = self.typed.as_deref_mut()?;
        debug_assert!(typed.is::<T>());
        // SAFETY: it is a `T`.
        Some(unsafe { &mut *std::ptr::from_mut(typed).cast::<T>() })
    }

    /// Makes one if there is none.
    ///
    /// # Safety
    /// As for `typed`.
    #[inline]
    pub(crate) unsafe fn typed_mut<T: Default + Send + 'static>(&mut self) -> &mut T {
        let typed = &mut **(self.typed).get_or_insert_with(|| Box::new(T::default()));
        debug_assert!(typed.is::<T>());
        // SAFETY: it is a `T`.
        unsafe { &mut *std::ptr::from_mut(typed).cast::<T>() }
    }
}

/// The task's halves of all `Buffered` tables, by slot. A field of the `Task`.
pub(crate) struct Buffer {
    /// The file that the task is going through, `NO_FILE` if it has none, and its ordinal.
    file: u32,
    ordinal: u32,
    /// Whether the task can have evaluated a node of `file` before it came to `file`. See `Half::may_be_hashed`.
    may_be_hashed: bool,
    /// By file: 1 for the first file that the task has come to, 2 for the second, and so on. 0, or no place: the task has not come to it.
    ordinals: Vec<u32>,
    /// How many files have an ordinal.
    files: u32,
    halves: Vec<Half>,
}

impl Default for Buffer {
    fn default() -> Self {
        Buffer {
            file: NO_FILE,
            ordinal: 0,
            may_be_hashed: false,
            ordinals: Vec::new(),
            files: 0,
            halves: Vec::new(),
        }
    }
}

impl Buffer {
    /// From now on the new entries under the nodes of `file` are dense. Nothing is dropped. `is_imported`: whether another file can refer
    /// to `file`. If none can, the task has evaluated no node of `file` so far, unless it has gone through `file` before.
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
    pub(crate) fn half(&self, slot: u32) -> Option<&Half> {
        self.halves.get(slot as usize)
    }

    #[inline]
    pub(crate) fn half_mut(&mut self, slot: u32) -> &mut Half {
        if slot as usize >= self.halves.len() {
            self.grow(slot);
        }
        &mut self.halves[slot as usize]
    }

    #[cold]
    fn grow(&mut self, slot: u32) {
        assert!(slot != u32::MAX, "a table without a slot: `number_tables`");
        self.halves.resize_with(slot as usize + 1, Half::default);
    }

    // ── a table by id ──

    /// The cell of the task's own id `number`, which is without `LOCAL`.
    #[inline]
    pub(crate) fn own_id(&self, slot: u32, number: u32) -> u32 {
        (self.half(slot)).map_or(0, |half| {
            half.dense.get(number as usize).copied().unwrap_or(0)
        })
    }

    /// What the cell holds afterwards: `raw`, or what was there first.
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

    // ── a table by node ──
    //
    // ONE KEY, ONE ENTRY. It is in the vector of its file if that was `dense` when the entry was stored, and else in `sparse`.

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

    /// 0: the task has not come to `file`.
    #[inline]
    fn ordinal_of(&self, file: u32) -> u32 {
        self.ordinals.get(file as usize).copied().unwrap_or(0)
    }

    /// The cell of a vector in which the entry for the node is, or into which a new one goes. `Err`: it is in `sparse` of the half, or goes
    /// there.
    #[inline]
    fn cell_for_node(&mut self, slot: u32, file: u32, index: u32) -> Result<&mut u32, &mut Half> {
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

    /// What the cell holds afterwards: `raw`, or what was there first.
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

/// What one task has for one `FileLocal` table.
#[derive(Default)]
struct FileLocalTable {
    /// A word for each node of the task's file, 0 for nothing.
    cells: Vec<u64>,
    /// Words for the nodes of other files, by (file, index).
    sparse: crate::util::FxHashMap<(u32, u32), u64>,
    /// What does not fit a word.
    kept: Vec<Box<dyn Any>>,
}

/// The entries of all `FileLocal` tables of one task, by slot. A field of the `Task`. A node of the task's file has a word in a vector,
/// by its number. Every other key is hashed. NOTHING LISTS THE ENTRIES, so the order of the map does not matter.
pub struct FileLocalTables {
    /// The file that the task is going through, `NO_FILE` if it has none.
    file: u32,
    tables: Vec<FileLocalTable>,
}

impl Default for FileLocalTables {
    fn default() -> Self {
        FileLocalTables {
            file: NO_FILE,
            tables: Vec::new(),
        }
    }
}

static PEAK_BYTES: AtomicUsize = AtomicUsize::new(0);

/// The most that the `FileLocal` tables of one task have taken for one file, without kept values. For `--timing`.
pub fn peak_file_local_bytes() -> usize {
    PEAK_BYTES.load(Ordering::Relaxed)
}

impl FileLocalTables {
    /// Drops every entry. From now on the nodes of `file` have dense words.
    pub(crate) fn begin_file(&mut self, file: u32) {
        let bytes = |t: &FileLocalTable| {
            t.cells.capacity() * 8 + t.sparse.capacity() * size_of::<((u32, u32), u64)>()
        };
        let taken = self.tables.iter().map(bytes).sum();
        if taken > PEAK_BYTES.load(Ordering::Relaxed) {
            PEAK_BYTES.fetch_max(taken, Ordering::Relaxed);
        }
        for table in &mut self.tables {
            clear_cells(&mut table.cells);
            if table.sparse.capacity() > 1 << 16 {
                table.sparse = Default::default();
            } else {
                table.sparse.clear();
            }
            table.kept.clear();
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
        (self.tables).resize_with(slot as usize + 1, FileLocalTable::default);
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
            table.sparse.get(&(file, index)).copied().unwrap_or(0)
        }
    }

    /// What the cell holds afterwards: `raw`, or what was there first.
    #[inline]
    pub(crate) fn put_if_empty(&mut self, slot: u32, file: u32, index: u32, raw: u64) -> u64 {
        let is_dense = file == self.file;
        let table = self.table_mut(slot);
        if is_dense {
            put_in_if_empty(&mut table.cells, index, raw)
        } else {
            *table.sparse.entry((file, index)).or_insert(raw)
        }
    }

    /// Whatever the cell held is gone.
    #[inline]
    pub(crate) fn store(&mut self, slot: u32, file: u32, index: u32, raw: u64) {
        let is_dense = file == self.file;
        let table = self.table_mut(slot);
        if is_dense {
            *cell_mut(&mut table.cells, index) = raw;
        } else {
            table.sparse.insert((file, index), raw);
        }
    }

    /// Keeps `value` until the task ends or begins another file, and says where.
    pub(crate) fn keep<T: 'static>(&mut self, slot: u32, value: T) -> u32 {
        let table = self.table_mut(slot);
        table.kept.push(Box::new(value));
        table.kept.len() as u32 - 1
    }

    /// What `keep` was given.
    ///
    /// # Safety
    /// `T` is the type of what `keep` was given. The reference is good until `begin_file`: whoever extends it beyond the call must not
    /// hold on to it for longer.
    #[inline]
    pub(crate) unsafe fn kept<'a, T: 'static>(&self, slot: u32, index: u32) -> &'a T {
        let value = &*self.tables[slot as usize].kept[index as usize];
        debug_assert!(value.is::<T>());
        // SAFETY: it is a `T`. A box does not move what it holds, and it is dropped in `begin_file`.
        unsafe { &*std::ptr::from_ref(value).cast::<T>() }
    }
}
