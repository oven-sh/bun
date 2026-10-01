//! What a thread keeps to itself while it checks a file that nothing else refers to.
//!
//! Most of a program is files nothing imports: tests, scripts, entry points. Nobody can ask about what is in one but whoever checks it, so
//! its syntax tree need only be there meanwhile, and everything that was worked out about it can go when it is done. That is most of what a
//! checker ever works out.
//!
//! So a thing is either shared or local. It is local if it mentions something local: a node or a symbol of the file at hand, or a type,
//! signature or mapper that is local itself. A local type, signature or mapper has `LOCAL` set in its number. Whatever is made of shared things
//! alone is shared, whoever happens to make it, and is there for every thread as ever.
//!
//! What is local lives here, in the thread. It takes no atomic operations, it is small enough to stay in the cache, and it is all dropped at once.

use std::any::Any;
use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::sync::atomic::{AtomicU32, Ordering};

/// Set in the number of a type, a signature, a mapper or a handle that is local.
pub const LOCAL: u32 = 1 << 30;

#[inline]
pub const fn is_local_number(number: u32) -> bool {
    number & LOCAL != 0
}

/// Whether something mentions what is local.
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

/// A vector whose elements never move and that is emptied without giving its memory back.
pub struct Chunked<T> {
    chunks: Vec<Box<[MaybeUninit<T>]>>,
    len: usize,
}

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
    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    pub fn push(&mut self, value: T) -> usize {
        let index = self.len;
        if index / CHUNK == self.chunks.len() {
            self.chunks
                .push((0..CHUNK).map(|_| MaybeUninit::uninit()).collect());
        }
        self.chunks[index / CHUNK][index % CHUNK].write(value);
        self.len += 1;
        index
    }

    #[inline]
    pub fn get(&self, index: usize) -> &T {
        assert!(index < self.len);
        // SAFETY: the first `len` are written.
        unsafe { self.chunks[index / CHUNK][index % CHUNK].assume_init_ref() }
    }

    pub fn clear(&mut self) {
        let len = std::mem::take(&mut self.len);
        if std::mem::needs_drop::<T>() {
            for index in 0..len {
                // SAFETY: the first `len` were written, and none is reached any more.
                unsafe { self.chunks[index / CHUNK][index % CHUNK].assume_init_drop() };
            }
        }
        // One big file does not make the thread big for good.
        self.chunks.truncate(64);
    }
}

impl<T> Drop for Chunked<T> {
    fn drop(&mut self) {
        self.clear();
    }
}

/// Finds numbers by the hash of what they stand for. It holds those of local things, and those of shared things that were looked for here
/// before, which spares looking through the big shared table again.
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
            let place = self.places[at];
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

/// What a table keeps for the thread.
#[derive(Default)]
pub struct LocalTable {
    /// A cell for each number, 0 for nothing. Or a bit for each.
    cells: Vec<u64>,
    /// What does not fit a cell.
    kept: Vec<Box<dyn Any>>,
    /// What goes by more than a number.
    map: Option<Box<dyn LocalMap>>,
    is_touched: bool,
}

pub trait LocalMap: Any {
    fn clear(&mut self);
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

impl<K: 'static, V: 'static> LocalMap for crate::util::FxHashMap<K, V> {
    fn clear(&mut self) {
        if self.capacity() > 1 << 16 {
            *self = Default::default();
        } else {
            crate::util::FxHashMap::clear(self);
        }
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

#[derive(Default)]
struct Tables {
    by_slot: Vec<LocalTable>,
    touched: Vec<u32>,
}

struct State {
    /// The file at hand, `u32::MAX` if there is none.
    file: Cell<u32>,
    /// Its `program::Module`.
    module: Cell<*const ()>,
    tables: UnsafeCell<Tables>,
}

thread_local! {
    static STATE: State = const {
        State {
            file: Cell::new(u32::MAX),
            module: Cell::new(std::ptr::null()),
            tables: UnsafeCell::new(Tables { by_slot: Vec::new(), touched: Vec::new() }),
        }
    };
}

/// How many threads have a file at hand.
static THREADS_ON: AtomicU32 = AtomicU32::new(0);

/// Whether any thread has a file at hand. If none has, this one has none, which is found out without asking for what is the thread's own.
#[inline(always)]
pub fn is_any_on() -> bool {
    THREADS_ON.load(Ordering::Relaxed) != 0
}

/// The number of the file at hand, `u32::MAX` if there is none.
#[inline]
pub fn file() -> u32 {
    if !is_any_on() {
        return u32::MAX;
    }
    file_of_thread()
}

#[inline(never)]
fn file_of_thread() -> u32 {
    STATE.with(|s| s.file.get())
}

#[inline]
pub fn is_on() -> bool {
    file() != u32::MAX
}

/// The module of the file at hand.
#[inline]
pub fn module() -> *const () {
    STATE.with(|s| s.module.get())
}

/// From now on `file`, which `module` is, is at hand in this thread.
pub fn begin(file: u32, module: *const ()) {
    STATE.with(|s| {
        debug_assert!(s.file.get() == u32::MAX);
        THREADS_ON.fetch_add(1, Ordering::Relaxed);
        s.file.set(file);
        s.module.set(module);
    });
}

/// Nothing is at hand any more. What the tables kept is dropped. The stores of types, signatures and mappers are their owner's to empty.
pub fn end() {
    STATE.with(|s| {
        THREADS_ON.fetch_sub(1, Ordering::Relaxed);
        s.file.set(u32::MAX);
        s.module.set(std::ptr::null());
        // SAFETY: nothing else in the thread is looking at the tables: see `with_table`.
        let tables = unsafe { &mut *s.tables.get() };
        for slot in std::mem::take(&mut tables.touched) {
            let table = &mut tables.by_slot[slot as usize];
            table.is_touched = false;
            if table.cells.capacity() > 1 << 20 {
                table.cells = Vec::new();
            } else {
                table.cells.clear();
            }
            table.kept.clear();
            if let Some(map) = &mut table.map {
                map.clear();
            }
        }
    });
}

static NEXT_SLOT: AtomicU32 = AtomicU32::new(0);

/// A number for a table, by which it finds what it keeps in each thread.
pub fn new_slot() -> u32 {
    NEXT_SLOT.fetch_add(1, Ordering::Relaxed)
}

/// `work` must not get back here.
#[inline]
fn with_table<R>(slot: u32, work: impl FnOnce(&mut LocalTable) -> R) -> R {
    STATE.with(|s| {
        // SAFETY: the state is the thread's own, and `work` is one of the few functions below, none of which calls out.
        let tables = unsafe { &mut *s.tables.get() };
        let slot_index = slot as usize;
        if slot_index >= tables.by_slot.len() {
            tables.by_slot.resize_with(slot_index + 1, Default::default);
        }
        let table = &mut tables.by_slot[slot_index];
        if !table.is_touched {
            table.is_touched = true;
            tables.touched.push(slot);
        }
        work(table)
    })
}

/// 0: nothing.
#[inline(never)]
pub fn cell(slot: u32, index: u32) -> u64 {
    with_table(slot, |t| t.cells.get(index as usize).copied().unwrap_or(0))
}

/// What the cell holds afterwards: `raw`, or what was there first.
#[inline(never)]
pub fn put_if_empty(slot: u32, index: u32, raw: u64) -> u64 {
    with_table(slot, |t| {
        let index = index as usize;
        if index >= t.cells.len() {
            t.cells.resize(index + 1, 0);
        }
        if t.cells[index] == 0 {
            t.cells[index] = raw;
        }
        t.cells[index]
    })
}

#[inline(never)]
pub fn store(slot: u32, index: u32, raw: u64) {
    with_table(slot, |t| {
        let index = index as usize;
        if index >= t.cells.len() {
            t.cells.resize(index + 1, 0);
        }
        t.cells[index] = raw;
    });
}

#[inline]
pub fn bit(slot: u32, index: u32) -> bool {
    cell(slot, index / 64) & 1 << (index % 64) != 0
}

/// Whether it was clear.
#[inline(never)]
pub fn set_bit(slot: u32, index: u32) -> bool {
    with_table(slot, |t| {
        let word = (index / 64) as usize;
        if word >= t.cells.len() {
            t.cells.resize(word + 1, 0);
        }
        let was = t.cells[word] & 1 << (index % 64) != 0;
        t.cells[word] |= 1 << (index % 64);
        !was
    })
}

/// Keeps `value` until the file at hand is done, and says where.
pub fn keep<T: 'static>(slot: u32, value: T) -> u32 {
    with_table(slot, |t| {
        t.kept.push(Box::new(value));
        t.kept.len() as u32 - 1
    })
}

/// What `keep` was given.
///
/// # Safety
/// The reference is good until `end`. Whoever extends it beyond the call must not hold on to it for longer.
#[inline]
pub unsafe fn kept<'a, T: 'static>(slot: u32, index: u32) -> &'a T {
    with_table(slot, |t| {
        let value: &T = t.kept[index as usize]
            .downcast_ref()
            .expect("a table keeps one type of thing");
        // SAFETY: a box does not move what it holds, and it is dropped in `end`.
        unsafe { &*std::ptr::from_ref(value) }
    })
}

#[inline]
pub fn map_get<K: std::hash::Hash + Eq + 'static, V: Clone + 'static>(
    slot: u32,
    key: &K,
) -> Option<V> {
    with_table(slot, |t| {
        t.map
            .as_mut()?
            .as_any_mut()
            .downcast_mut::<crate::util::FxHashMap<K, V>>()
            .expect("a table keeps one type of thing")
            .get(key)
            .cloned()
    })
}

/// Keeps what is there already, and returns what is kept.
#[inline]
pub fn map_insert<K: std::hash::Hash + Eq + 'static, V: Clone + 'static>(
    slot: u32,
    key: K,
    value: V,
) -> V {
    with_table(slot, |t| {
        t.map
            .get_or_insert_with(|| Box::new(crate::util::FxHashMap::<K, V>::default()))
            .as_any_mut()
            .downcast_mut::<crate::util::FxHashMap<K, V>>()
            .expect("a table keeps one type of thing")
            .entry(key)
            .or_insert(value)
            .clone()
    })
}
