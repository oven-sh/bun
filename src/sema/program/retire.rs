//! Letting the trees of a module go while a build lowers the other files.
//!
//! A build would hold the HIR and the binder's tables of every file until the last file is lowered. Their long lists are
//! plain data that nothing writes after the load. So once a file is lowered, a packed copy is kept in place of the lists,
//! and whoever reads the module again unpacks it for as long as it reads. What is unpacked at a time is what the tasks
//! that run read.
//!
//! Every reference into a module comes from `ModuleCell::deref`, and none outlives the task that took it. Nobody counts
//! the readers of a module that is still waited for. Once it is not, it is watched: a task leaves its bit in the cell
//! before it reads, until it ends. The trees go when the tasks that ran at that moment have ended and no bit is set.

use super::{FileId, Files, Module};
use crate::hir::{ListBlock, LongList};
use crate::session::ArenaBox;
use bun_threading::Guarded;
use std::cell::{Cell, RefCell, UnsafeCell};
use std::sync::atomic::Ordering::{Relaxed, SeqCst};
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, AtomicU32, AtomicU64, AtomicUsize};

const WORDS: usize = 4;
/// A word of `ModuleCell::readers` and a bit in it.
type Bit = (usize, u64);
/// In place of the bit of a thread that runs no task. Nobody knows when it stops reading.
const OUTSIDER: Bit = (0, 0);
/// In place of the bit of `ReadingNoTrees`.
const NO_TREES: Bit = (1, 0);

const HERE: u8 = 0;
const LEAVING: u8 = 1;
const GONE: u8 = 2;
/// Here for good.
const KEPT: u8 = 3;

/// Entry in the list of all modules. A `Module` is thousands of bytes, so it's boxed in the arena of the thread that
/// loaded it and never moved. The `UnsafeCell` lets `Files::free_tree` and this file mutate it through `&Files`.
pub struct ModuleCell<'s> {
    pub(super) module: UnsafeCell<ArenaBox<'s, Module<'s>>>,
    /// The module. Null while it is watched: whoever reads it then says so first.
    unwatched: AtomicPtr<Module<'s>>,
    /// The tasks that ran when the watch began have ended.
    is_ripe: AtomicBool,
    state: AtomicU8,
    /// The commits to wait for: its own, or, if it has none, that of each file that refers to it.
    awaited: AtomicU32,
    /// `let_trees_go_behind` has listed it.
    is_committed: AtomicBool,
    /// The tasks that have read the module since it is watched and still run.
    readers: [AtomicU64; WORDS],
    /// Held by whoever lets the trees go or brings them back.
    set_aside: Guarded<Option<&'s SetAside>>,
}

// SAFETY: a module is only mutated through `&mut Files`, by `Files::free_tree`, or here while nothing reads it.
unsafe impl Sync for ModuleCell<'_> {}

/// The long lists of a module. The session owns it, because nothing drops a program.
struct SetAside {
    /// The block of the HIR and that of the binder's tables, packed, and compressed where that makes them smaller.
    packed: Guarded<[Box<[u8]>; 2]>,
    /// Before they were compressed.
    packed_sizes: [usize; 2],
    sizes: [usize; 2],
    list_count: u32,
    /// A bit for each list, in the order of `Module::for_each_long_list`: it went. Then, for each that went, where it begins
    /// in its block, with `IN_SECOND_BLOCK` if that is the binder's, and its size. Most lists of most modules are empty.
    parts: Box<[u32]>,
}

const IN_SECOND_BLOCK: u32 = 1 << 31;

/// The bit of the task that the thread runs. A bare slot, not `thread_local!`.
#[thread_local]
static TASK: Cell<Bit> = Cell::new(OUTSIDER);

thread_local! {
    static COMPRESSION: RefCell<Option<bun_zstd::Contexts>> = const { RefCell::new(None) };
    /// The cells that hold the bit of the task.
    static READ: RefCell<Vec<*const ModuleCell<'static>>> = const { RefCell::new(Vec::new()) };
}

struct Tasks {
    /// Counts the watches.
    time: u64,
    /// The `time` at which each task that runs began.
    running: Vec<u64>,
    /// The bits that tasks hold.
    taken: [u64; WORDS],
    /// The watched cells that are not ripe, each with the `time` of its watch.
    unripe: Vec<(u64, *const ModuleCell<'static>)>,
}

// SAFETY: `watch_no_more` takes the cells of a program out before the program ends.
unsafe impl Send for Tasks {}

static TASKS: Guarded<Tasks> = Guarded::new(Tasks {
    time: 0,
    running: Vec::new(),
    taken: [0; WORDS],
    unripe: Vec::new(),
});

/// The files that `let_trees_go_behind` has listed and that are not committed yet, of all programs. At zero nothing is left to lower,
/// and the trees are about to be freed: packing one then costs time and saves nothing.
static AWAITED_COMMITS: AtomicUsize = AtomicUsize::new(0);

/// Held, with others, by a thread that has taken ripe cells out of `Tasks::unripe`, until it has let their trees go. The list is that
/// of the process, so they may be cells of another program. That program holds it alone when it takes its cells out of the list:
/// from then on nobody else has one, and it may end.
static RELEASING_RIPE_CELLS: bun_threading::RwLock<()> = bun_threading::RwLock::new(());

impl<'s> std::ops::Deref for ModuleCell<'s> {
    type Target = Module<'s>;
    #[inline(always)]
    fn deref(&self) -> &Module<'s> {
        let module = self.unwatched.load(Relaxed);
        if module.is_null() {
            return self.read_watched();
        }
        // SAFETY: see above.
        unsafe { &*module }
    }
}

impl<'s> std::ops::DerefMut for ModuleCell<'s> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut Module<'s> {
        debug_assert_ne!(*self.state.get_mut(), GONE);
        self.module.get_mut()
    }
}

impl<'s> ModuleCell<'s> {
    pub(super) fn new(module: ArenaBox<'s, Module<'s>>) -> ModuleCell<'s> {
        let mut module = module;
        ModuleCell {
            unwatched: AtomicPtr::new(&raw mut *module),
            module: UnsafeCell::new(module),
            is_ripe: AtomicBool::new(false),
            state: AtomicU8::new(HERE),
            awaited: AtomicU32::new(0),
            is_committed: AtomicBool::new(false),
            readers: [const { AtomicU64::new(0) }; WORDS],
            set_aside: Guarded::new(None),
        }
    }

    fn erased(&self) -> *const ModuleCell<'static> {
        std::ptr::from_ref(self).cast()
    }

    /// Before `awaited` goes down: a listed file awaits its own commit and no other.
    fn await_own_commit_no_more(&self) {
        if self.is_committed.load(Relaxed) && self.awaited.load(Relaxed) != 0 {
            AWAITED_COMMITS.fetch_sub(1, SeqCst);
        }
    }

    fn end_watch(&self) {
        // SAFETY: the box is never replaced.
        let module: &Module<'s> = unsafe { &*self.module.get() };
        self.unwatched
            .store(std::ptr::from_ref(module).cast_mut(), SeqCst);
    }

    #[cold]
    #[inline(never)]
    extern "rust-cold" fn read_watched(&self) -> &Module<'s> {
        self.begin_reading();
        // SAFETY: as in `deref`.
        unsafe { &*self.module.get() }
    }

    fn begin_reading(&self) {
        let (word, bit) = TASK.get();
        if (word, bit) == NO_TREES {
            return;
        }
        if (word, bit) == OUTSIDER {
            let set_aside = self.set_aside.lock();
            self.bring_back(*set_aside);
            self.state.store(KEPT, SeqCst);
            self.end_watch();
            return;
        }
        if self.readers[word].load(Relaxed) & bit != 0 {
            return;
        }
        self.readers[word].fetch_or(bit, SeqCst);
        READ.with_borrow_mut(|read| read.push(self.erased()));
        // Whoever lets the trees go says so first, and then looks for bits.
        if matches!(self.state.load(SeqCst), LEAVING | GONE) {
            let set_aside = self.set_aside.lock();
            self.bring_back(*set_aside);
        }
    }

    /// The caller holds the lock.
    fn bring_back(&self, set_aside: Option<&SetAside>) {
        if self.state.load(Relaxed) != GONE {
            return;
        }
        let set_aside = set_aside.expect("the trees went there");
        // SAFETY: everybody who wants to read the module waits for the lock.
        let module = unsafe { &mut **self.module.get() };
        let arena = module.hir.lazy.session.arena();
        let mut firsts = [std::ptr::null_mut(); 2];
        let blocks = module.list_blocks().into_iter().zip(&mut firsts);
        let packed = set_aside.packed.lock();
        let sizes = set_aside.packed_sizes.iter().zip(&set_aside.sizes);
        let kept = packed.iter().zip(sizes);
        for ((block, first), (packed, (&packed_size, &size))) in blocks.zip(kept) {
            *block = ListBlock::new_in(arena, size);
            match packed.len() == packed_size {
                true => unpack(packed, block.bytes()),
                false => unpack(&decompress(packed, packed_size), block.bytes()),
            }
            *first = block.bytes().as_mut_ptr();
        }
        let mut parts = set_aside.parts();
        module.for_each_long_list(&mut |list| {
            if let Some((block, offset, size)) = parts.next().expect("a module keeps its lists") {
                // SAFETY: the bytes there are those of the list, and stay until the list is released.
                unsafe { list.lend(firsts[block].add(offset), size) };
            }
        });
        self.state.store(HERE, SeqCst);
    }

    fn let_go(&self) {
        let mut set_aside = self.set_aside.lock();
        if self.state.load(Relaxed) != HERE {
            return;
        }
        self.state.store(LEAVING, SeqCst);
        if self.readers.iter().any(|word| word.load(SeqCst) != 0) {
            // The last of them tries again.
            self.state.store(HERE, SeqCst);
            return;
        }
        // SAFETY: no task has a reference, and one that wants one from now on waits for the lock.
        let module = unsafe { &mut **self.module.get() };
        let kept = match *set_aside {
            Some(kept) => kept,
            None => {
                let Some(kept) = SetAside::of(module) else {
                    self.state.store(KEPT, SeqCst);
                    self.end_watch();
                    return;
                };
                *set_aside.insert(module.hir.lazy.session.keep(kept))
            }
        };
        let mut parts = kept.parts();
        module.for_each_long_list(&mut |list| {
            if parts.next().expect("a module keeps its lists").is_some() {
                list.release();
            }
        });
        for block in module.list_blocks() {
            if cfg!(debug_assertions) {
                block.bytes().fill(0xA5);
            }
            *block = ListBlock::default();
        }
        // SAFETY: as above. A file that owns its lists owns its cells.
        unsafe { module.hir.clear_caches() };
        self.state.store(GONE, SeqCst);
    }
}

impl SetAside {
    /// None: the module owns no list.
    fn of(module: &mut Module<'_>) -> Option<SetAside> {
        let ranges = module
            .list_blocks()
            .map(|block| block.bytes().as_ptr_range());
        if ranges.iter().all(|range| range.is_empty()) {
            return None;
        }
        let mut went: Vec<bool> = Vec::new();
        let mut places: Vec<u32> = Vec::new();
        module.for_each_long_list(&mut |list| {
            let (first, size) = list.lent_bytes();
            // A list can also be lent by a parser.
            let block = ranges.iter().position(|range| range.contains(&first));
            let block = block.filter(|_| size != 0);
            went.push(block.is_some());
            if let Some(block) = block {
                let offset = (first as usize - ranges[block].start as usize) as u32;
                assert!(offset < IN_SECOND_BLOCK);
                places.extend([offset | (IN_SECOND_BLOCK * block as u32), size as u32]);
            }
        });
        let mut parts = vec![0; went.len().div_ceil(32)];
        for (list, _) in went.iter().enumerate().filter(|it| *it.1) {
            parts[list / 32] |= 1 << (list % 32);
        }
        parts.extend(places);
        let packed = module.list_blocks().map(|block| pack(block.bytes()));
        Some(SetAside {
            sizes: ranges.map(|range| range.end as usize - range.start as usize),
            packed_sizes: [packed[0].len(), packed[1].len()],
            packed: Guarded::new(packed.map(|packed| compress(&packed))),
            list_count: went.len() as u32,
            parts: parts[..].into(),
        })
    }

    /// For each list, in the order of `Module::for_each_long_list`: the block, where it begins there, and its size. None:
    /// the list stays with the module.
    fn parts(&self) -> impl Iterator<Item = Option<(usize, usize, usize)>> {
        let list_count = self.list_count as usize;
        let (went, places) = self.parts.split_at(list_count.div_ceil(32));
        let mut places = places.as_chunks::<2>().0.iter();
        (0..list_count).map(move |list| {
            (went[list / 32] >> (list % 32) & 1 != 0).then(|| {
                let &[first, size] = places.next().expect("one for each list that went");
                let offset = first & !IN_SECOND_BLOCK;
                ((first >> 31) as usize, offset as usize, size as usize)
            })
        })
    }
}

/// The lists hold small numbers and the two words for "none" more than anything else. For each 16 bits of `plain`, two
/// bits say what follows: nothing for 0, nothing for 0xffff, one byte, or two. The bits of all come first.
fn pack(plain: &[u8]) -> Vec<u8> {
    let (groups, rest) = plain.as_chunks::<8>();
    assert!(rest.is_empty(), "a block is made of 128-bit words");
    let mut packed: Vec<u8> = Vec::with_capacity(groups.len() + plain.len() + 2);
    let first = packed.as_mut_ptr();
    // SAFETY: there is room for the bits, for two bytes for each 16 bits, and for the two bytes that the last write may
    // go beyond what counts. All that counts is written.
    unsafe {
        let mut next = first.add(groups.len());
        for (index, group) in groups.iter().enumerate() {
            let group = u64::from_le_bytes(*group);
            let mut codes = 0;
            for place in 0..4 {
                let number = (group >> (16 * place)) as u16;
                let is_written = usize::from(number.wrapping_add(1) > 1);
                let is_wide = usize::from(number > 0xff) & is_written;
                codes |= (is_written << 1 | is_wide | usize::from(number == 0xffff)) << (2 * place);
                next.cast::<[u8; 2]>().write_unaligned(number.to_le_bytes());
                next = next.add(is_written + is_wide);
            }
            first.add(index).write(codes as u8);
        }
        packed.set_len(next.offset_from_unsigned(first));
    }
    packed
}

/// What is packed still repeats itself. Returns `packed` itself if it doesn't get smaller.
fn compress(packed: &[u8]) -> Box<[u8]> {
    const FASTEST_LEVEL: i32 = 1;
    let mut compressed = Vec::with_capacity(bun_zstd::compress_bound(packed.len()));
    let is_smaller = COMPRESSION.with_borrow_mut(|contexts| {
        if contexts.is_none() {
            *contexts = bun_zstd::Contexts::new();
        }
        let result = (contexts.as_mut())
            .map(|contexts| contexts.compress_append(&mut compressed, packed, FASTEST_LEVEL));
        matches!(result, Some(bun_zstd::Result::Success(size)) if size < packed.len())
    });
    // Not `into_boxed_slice`: the allocator leaves what shrinks to no less than half its size where it is, in a block that is
    // larger than the lists were.
    match is_smaller {
        true => compressed[..].into(),
        false => packed.into(),
    }
}

fn decompress(compressed: &[u8], size: usize) -> Vec<u8> {
    let mut packed = vec![0; size];
    COMPRESSION.with_borrow_mut(|contexts| {
        if contexts.is_none() {
            *contexts = bun_zstd::Contexts::new();
        }
        let contexts = contexts.as_mut().expect("out of memory");
        let result = contexts.decompress_into(&mut packed, compressed);
        result.expect("the bytes come from `compress`");
    });
    packed
}

fn unpack(packed: &[u8], plain: &mut [u8]) {
    let (groups, _) = plain.as_chunks_mut::<8>();
    let (codes, values) = packed.split_at(groups.len());
    let mut values = values.iter();
    let mut next = || *values.next().expect("the bytes come from `pack`");
    for (group, &codes) in groups.iter_mut().zip(codes) {
        for (place, value) in group.as_chunks_mut::<2>().0.iter_mut().enumerate() {
            *value = match codes >> (2 * place) & 3 {
                0 => [0, 0],
                1 => [0xff, 0xff],
                2 => [next(), 0],
                _ => [next(), next()],
            };
        }
    }
}

impl<'s> Module<'s> {
    fn list_blocks(&mut self) -> [&mut ListBlock<'s>; 2] {
        [&mut self.hir.lazy.block, &mut self.bound.block]
    }

    fn for_each_long_list(&mut self, each: &mut dyn FnMut(&mut dyn LongList)) {
        self.hir.for_each_long_list(each);
        self.bound.for_each_long_list(each);
    }
}

impl Files<'_> {
    fn for_each_awaiting(&self, file: FileId, each: &mut dyn FnMut(&ModuleCell<'_>)) {
        let module = &self.modules[file.idx()];
        each(module);
        for &read in module.edges.iter().chain(module.code_edges) {
            let read = &self.modules[read.idx()];
            if !read.is_committed.load(Relaxed) {
                each(read);
            }
        }
    }

    /// From now on the trees of each of `files` go once it is `note_commit`ted, which happens once, and those of any other
    /// file once the files that refer to it are. No task runs.
    pub fn let_trees_go_behind(&self, files: &[FileId]) {
        for &file in files {
            self.modules[file.idx()].is_committed.store(true, Relaxed);
        }
        AWAITED_COMMITS.fetch_add(files.len(), SeqCst);
        for &file in files {
            self.for_each_awaiting(file, &mut |module| {
                module.awaited.fetch_add(1, Relaxed);
            });
        }
    }

    pub fn note_commit(&self, file: FileId) {
        self.modules[file.idx()].await_own_commit_no_more();
        self.for_each_awaiting(file, &mut |module| {
            if module.awaited.load(Relaxed) != 0 && module.awaited.fetch_sub(1, SeqCst) == 1 {
                module.unwatched.store(std::ptr::null_mut(), SeqCst);
                let mut tasks = TASKS.lock();
                let time = tasks.time;
                tasks.time += 1;
                tasks.unripe.push((time, module.erased()));
            }
        });
    }

    pub fn is_tree_gone(&self, file: FileId) -> bool {
        self.modules[file.idx()].state.load(SeqCst) == GONE
    }

    /// No tree goes from now on, not even one that a thread is about to let go. It waits for no such thread, and tasks of
    /// this program may run. `watch_no_more` still follows.
    pub fn let_no_more_trees_go(&self) {
        for cell in self.modules.iter() {
            let _lock = cell.set_aside.lock();
            if cell.state.load(SeqCst) == HERE {
                cell.state.store(KEPT, SeqCst);
                cell.end_watch();
            }
        }
    }

    /// The end of `let_trees_go_behind`: no tree goes anymore. What is gone comes back for whoever reads it. No task of
    /// this program runs.
    pub fn watch_no_more(&self) {
        let cells = self.modules.as_ptr_range();
        let cells = cells.start.cast::<ModuleCell<'static>>()..cells.end.cast();
        {
            let _no_thread_is_releasing = RELEASING_RIPE_CELLS.write();
            TASKS
                .lock()
                .unripe
                .retain(|entry| !cells.contains(&entry.1));
        }
        for cell in self.modules.iter() {
            cell.await_own_commit_no_more();
            cell.awaited.store(0, Relaxed);
            cell.is_committed.store(false, Relaxed);
            let _lock = cell.set_aside.lock();
            if cell.state.load(SeqCst) == HERE {
                cell.state.store(KEPT, SeqCst);
                cell.end_watch();
            }
        }
    }

    /// `free_long_lists` of a module whose trees may be gone.
    pub(super) fn forget_what_went(&self, index: usize) {
        let cell = &self.modules[index];
        if let Some(set_aside) = cell.set_aside.lock().take() {
            *set_aside.packed.lock() = Default::default();
        }
        cell.state.store(KEPT, SeqCst);
        cell.end_watch();
    }
}

/// While it lives, the thread reads of modules only what stays when their trees go: no long list of `hir` or `bound`, and
/// nothing that is computed from one.
pub struct ReadingNoTrees(Bit);

impl ReadingNoTrees {
    pub fn begin() -> ReadingNoTrees {
        ReadingNoTrees(TASK.replace(NO_TREES))
    }
}

impl Drop for ReadingNoTrees {
    fn drop(&mut self) {
        TASK.set(self.0);
    }
}

/// While it lives, what the thread reads of a module stays. A thread can begin a task in the middle of another.
pub struct ReadingTask {
    /// `OUTSIDER`: all bits are taken, so it reads like a thread without a task.
    bit: Bit,
    began: u64,
    outer: Bit,
    read_by_outer: Vec<*const ModuleCell<'static>>,
}

impl ReadingTask {
    pub fn begin() -> ReadingTask {
        let mut tasks = TASKS.lock();
        let word = tasks.taken.iter().position(|&word| word != u64::MAX);
        let bit = word.map_or(OUTSIDER, |word| {
            let bit = 1 << tasks.taken[word].trailing_ones();
            tasks.taken[word] |= bit;
            (word, bit)
        });
        let began = tasks.time;
        tasks.running.push(began);
        ReadingTask {
            bit,
            began,
            outer: TASK.replace(bit),
            read_by_outer: READ.take(),
        }
    }
}

impl Drop for ReadingTask {
    fn drop(&mut self) {
        let read = READ.replace(std::mem::take(&mut self.read_by_outer));
        TASK.set(self.outer);
        let (word, bit) = self.bit;
        let is_more_to_lower = AWAITED_COMMITS.load(SeqCst) != 0;
        for module in read {
            // SAFETY: the program outlives its tasks.
            let module = unsafe { &*module };
            module.readers[word].fetch_and(!bit, SeqCst);
            if is_more_to_lower && module.is_ripe.load(SeqCst) {
                module.let_go();
            }
        }
        let _releasing = RELEASING_RIPE_CELLS.read();
        let ripe: Vec<(u64, *const ModuleCell<'static>)> = {
            let mut tasks = TASKS.lock();
            tasks.taken[word] &= !bit;
            let at = tasks.running.iter().position(|&began| began == self.began);
            tasks.running.swap_remove(at.expect("it began"));
            let first = tasks.running.iter().copied().min().unwrap_or(u64::MAX);
            tasks
                .unripe
                .extract_if(.., |entry| entry.0 < first)
                .collect()
        };
        for (_, module) in ripe {
            // SAFETY: `watch_no_more` of its program waits for `RELEASING_RIPE_CELLS`.
            let module = unsafe { &*module };
            module.is_ripe.store(true, SeqCst);
            if is_more_to_lower {
                module.let_go();
            }
        }
    }
}

#[cfg(test)]
mod tests;
