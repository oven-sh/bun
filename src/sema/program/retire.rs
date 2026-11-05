use super::{FileId, Files, Module};
use crate::check::aot::BuiltinTypeSymbols;
use crate::hir::ListBlock;
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
/// Freed. A freed list reads as empty, so the module stays watched, and whoever comes to read a tree of it is stopped.
const GONE: u8 = 2;
/// Here for good.
const KEPT: u8 = 3;

/// In `ModuleCell::awaited`: a task can read a file of the component though no file that it checks reaches one. No commit
/// takes it away.
const READ_WITHOUT_REFERENCE: u32 = 1 << 31;

/// In place of an index into `Files::modules`.
const NO_CELL: u32 = u32::MAX;

/// Entry in the list of all modules. A `Module` is thousands of bytes, so it's boxed in the arena of the thread that
/// loaded it and never moved. The `UnsafeCell` lets `Files::free_tree` and this file mutate it through `&Files`.
pub struct ModuleCell<'s> {
    pub(super) module: UnsafeCell<ArenaBox<'s, Module<'s>>>,
    /// The module. Null while it is watched: whoever reads it then says so first.
    unwatched: AtomicPtr<Module<'s>>,
    /// The tasks that ran when the watch began have ended.
    is_ripe: AtomicBool,
    state: AtomicU8,
    /// `let_trees_go_behind` has listed it, and `note_commit` has not come.
    awaits_commit: AtomicBool,
    /// Index in `Files::modules` of the first file of its strongly connected component: the files that it reaches and that
    /// reach it. Each would wait for the others forever, so they become done together.
    component: AtomicU32,
    /// The next file of the component, or `NO_CELL`.
    next_in_component: AtomicU32,
    /// In the first file of a component: how many of its files await their commit, and how many references lead to it from
    /// components that are not done. At zero it is done: no file that awaits its commit can reach it.
    awaited: AtomicU32,
    /// The tasks that have read the module since it is watched and still run.
    readers: [AtomicU64; WORDS],
    /// Held by whoever begins the watch, lets the trees go or makes them stay.
    settling: Guarded<()>,
}

// SAFETY: a module is only mutated through `&mut Files`, by `Files::free_tree`, or here while nothing reads it.
unsafe impl Sync for ModuleCell<'_> {}

/// The bit of the task that the thread runs. A bare slot, not `thread_local!`.
#[thread_local]
static TASK: Cell<Bit> = Cell::new(OUTSIDER);

#[thread_local]
static PIN: Cell<Pin> = Cell::new(Pin::NONE);

#[derive(Copy, Clone)]
struct Pin {
    began: u64,
    repins_at: u64,
}

impl Pin {
    const NONE: Pin = Pin {
        began: u64::MAX,
        repins_at: u64::MAX,
    };
}

thread_local! {
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

impl Tasks {
    fn pin(&self) -> Pin {
        Pin {
            began: self.time,
            repins_at: TASKS_ENDED.load(Relaxed) + self.running.len() as u64,
        }
    }
}

static TASKS: Guarded<Tasks> = Guarded::new(Tasks {
    time: 0,
    running: Vec::new(),
    taken: [0; WORDS],
    unripe: Vec::new(),
});

static TASKS_ENDED: AtomicU64 = AtomicU64::new(0);

/// The files that `let_trees_go_behind` has listed and that are not committed yet, of all programs. At zero nothing is left to lower,
/// and all threads are about to free the trees together: a task that let them go at its end would do so alone.
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
            awaits_commit: AtomicBool::new(false),
            component: AtomicU32::new(NO_CELL),
            next_in_component: AtomicU32::new(NO_CELL),
            awaited: AtomicU32::new(0),
            readers: [const { AtomicU64::new(0) }; WORDS],
            settling: Guarded::new(()),
        }
    }

    fn erased(&self) -> *const ModuleCell<'static> {
        std::ptr::from_ref(self).cast()
    }

    /// Whether it awaited one.
    fn stop_awaiting_commit(&self) -> bool {
        let did = self.awaits_commit.swap(false, SeqCst);
        if did {
            AWAITED_COMMITS.fetch_sub(1, SeqCst);
        }
        did
    }

    /// Of the first file of a component. Whether the component is done now.
    fn decrement_awaited(&self) -> bool {
        self.awaited.fetch_sub(1, SeqCst) == 1
    }

    /// Trees that stay for good can never go, so their readers say nothing.
    fn begin_watch(&self) {
        let _settling = self.settling.lock();
        if self.state.load(Relaxed) != HERE {
            return;
        }
        self.unwatched.store(std::ptr::null_mut(), SeqCst);
        let mut tasks = TASKS.lock();
        let time = tasks.time;
        tasks.time += 1;
        tasks.unripe.push((time, self.erased()));
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
            self.keep_for_reader();
            return;
        }
        if self.readers[word].load(Relaxed) & bit != 0 {
            return;
        }
        self.readers[word].fetch_or(bit, SeqCst);
        READ.with_borrow_mut(|read| read.push(self.erased()));
        // Whoever lets the trees go says so first, and then looks for bits.
        if matches!(self.state.load(SeqCst), LEAVING | GONE) {
            let is_gone = {
                let _settling = self.settling.lock();
                self.state.load(Relaxed) == GONE
            };
            if is_gone {
                self.stop_reader_of_freed_trees();
            }
        }
    }

    #[cold]
    #[inline(never)]
    fn stop_reader_of_freed_trees(&self) -> ! {
        // SAFETY: the path stays when the trees go.
        let module: &Module<'s> = unsafe { &*self.module.get() };
        panic!(
            "the trees of {} are read after they were freed",
            bstr::BStr::new(module.file_name())
        );
    }

    /// The trees stay for good, unless they are gone. Whether they stay.
    fn keep_what_is_here(&self) -> bool {
        let _settling = self.settling.lock();
        let is_here = self.state.load(Relaxed) != GONE;
        if is_here {
            self.state.store(KEPT, SeqCst);
            self.end_watch();
        }
        is_here
    }

    /// For a reader of whom nobody knows when it stops reading.
    fn keep_for_reader(&self) {
        if self.state.load(SeqCst) == KEPT {
            return;
        }
        if !self.keep_what_is_here() {
            self.stop_reader_of_freed_trees();
        }
    }

    fn let_go(&self) {
        let _settling = self.settling.lock();
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
        let mut blocks = module.list_blocks();
        // Other programs share its lists, or `Files::free_tree` has come first.
        if blocks.iter_mut().all(|block| block.bytes().is_empty()) {
            self.state.store(KEPT, SeqCst);
            self.end_watch();
            return;
        }
        if cfg!(debug_assertions) {
            for block in blocks {
                block.bytes().fill(0xA5);
            }
        }
        if module.hir.owns_its_lists() {
            // SAFETY: as above, and no other program shares the cells of a file that owns its lists.
            unsafe { module.hir.clear_caches() };
        }
        module.hir.free_long_lists();
        module.bound.free_long_lists();
        self.state.store(GONE, SeqCst);
    }
}

impl<'s> Module<'s> {
    fn list_blocks(&mut self) -> [&mut ListBlock<'s>; 2] {
        [&mut self.hir.lazy.block, &mut self.bound.block]
    }

    /// Every file sees what a file that is not closed declares, the check of any later file looks through the exports of a
    /// file with an `export *` (`Checker::is_export_of_file_checked_before`), and lowering any file can ask about the
    /// declarations that `BuiltinTypeSymbols` lists: those of a file that the program reads for its types alone too, `import type { Later } from "./types"` with
    /// `interface Later extends Promise<T>` there. From there a task goes on to whatever the file refers to.
    fn is_read_without_reference(&self) -> bool {
        self.is_read_by_every_task
            || !self.is_closed
            || !self.bound.export_stars.is_empty()
            || BuiltinTypeSymbols::can_list_declarations_of(&self.hir)
    }
}

/// Tarjan's algorithm. `file` refers to `targets[starts[file]..starts[file + 1]]`. Returns the number of the component of each file,
/// which is higher than that of every other component that the file refers to, and how many components there are.
fn number_components(starts: &[u32], targets: &[u32]) -> (Vec<u32>, usize) {
    const NONE: u32 = u32::MAX;
    let count = starts.len() - 1;
    // When the search came to the file, and the earliest of `open` that it is known to lead back to.
    let (mut found_at, mut leads_back_to) = (vec![NONE; count], vec![0u32; count]);
    let mut component_of = vec![NONE; count];
    // The files that the search has come to and that have no number yet.
    let mut open: Vec<u32> = Vec::new();
    // The way from the root, and for each file on it where in `targets` the search goes on.
    let mut path: Vec<(u32, u32)> = Vec::new();
    let (mut found, mut components) = (0u32, 0u32);
    for root in 0..count {
        if found_at[root] != NONE {
            continue;
        }
        path.push((root as u32, starts[root]));
        while let Some(top) = path.last_mut() {
            let (file, next) = (top.0 as usize, top.1);
            if found_at[file] == NONE {
                (found_at[file], leads_back_to[file]) = (found, found);
                found += 1;
                open.push(file as u32);
            }
            if next < starts[file + 1] {
                top.1 += 1;
                let target = targets[next as usize] as usize;
                if found_at[target] == NONE {
                    path.push((target as u32, starts[target]));
                } else if component_of[target] == NONE {
                    leads_back_to[file] = leads_back_to[file].min(found_at[target]);
                }
                continue;
            }
            path.pop();
            if let Some(&(parent, _)) = path.last() {
                let parent = parent as usize;
                leads_back_to[parent] = leads_back_to[parent].min(leads_back_to[file]);
            }
            if leads_back_to[file] == found_at[file] {
                while let Some(member) = open.pop() {
                    component_of[member as usize] = components;
                    if member as usize == file {
                        break;
                    }
                }
                components += 1;
            }
        }
    }
    (component_of, components as usize)
}

impl Files<'_> {
    /// With repeats, the same at every call: `ModuleCell::awaited` goes up and down by them.
    fn for_each_file_referred_to(&self, file: usize, each: &mut dyn FnMut(u32)) {
        let _reading = ReadingNoTrees::begin();
        let module: &Module<'_> = &self.modules[file];
        let targets = module.edges.iter().chain(module.imports.values());
        for target in targets.chain(module.code_edges) {
            each(target.0);
        }
    }

    /// `file` is done.
    fn begin_watch_of(&self, file: u32) {
        // `Files::new_symbol` adds the symbols that no file declares to those of the first file, and every task reads them there.
        if file != 0 {
            self.modules[file as usize].begin_watch();
        }
    }

    /// From now on a file's trees are freed once no file of `files` that still awaits `note_commit` can reach it through
    /// references. Reach, not direct references: a task follows a type of a file it checks into files that file never names.
    /// No task of this program runs.
    pub fn let_trees_go_behind(&self, files: &[FileId]) {
        let count = self.modules.len();
        let mut starts: Vec<u32> = Vec::with_capacity(count + 1);
        let mut targets: Vec<u32> = Vec::new();
        for file in 0..count {
            starts.push(targets.len() as u32);
            self.for_each_file_referred_to(file, &mut |target| targets.push(target));
        }
        starts.push(targets.len() as u32);
        let targets_of = |file: usize| &targets[starts[file] as usize..starts[file + 1] as usize];
        let (component_of, component_count) = number_components(&starts, &targets);

        let mut first_of = vec![NO_CELL; component_count];
        for (file, cell) in self.modules.iter().enumerate().rev() {
            let first = &mut first_of[component_of[file] as usize];
            cell.next_in_component.store(*first, Relaxed);
            *first = file as u32;
        }
        let mut awaited = vec![0u32; component_count];
        for (file, cell) in self.modules.iter().enumerate() {
            let component = component_of[file];
            cell.component.store(first_of[component as usize], Relaxed);
            if cell.state.load(Relaxed) != GONE && cell.is_read_without_reference() {
                awaited[component as usize] |= READ_WITHOUT_REFERENCE;
            }
            for &target in targets_of(file) {
                let other = component_of[target as usize];
                awaited[other as usize] += u32::from(other != component);
            }
        }
        // The check of any file with two `export *` reads their declarations.
        for module in self.modules_with_nested_export_collisions {
            awaited[component_of[module.file.idx()] as usize] |= READ_WITHOUT_REFERENCE;
        }
        let mut listed = 0;
        for &file in files {
            if !self.modules[file.idx()].awaits_commit.swap(true, Relaxed) {
                awaited[component_of[file.idx()] as usize] += 1;
                listed += 1;
            }
        }
        AWAITED_COMMITS.fetch_add(listed, SeqCst);
        // Each component comes behind all that refer to it.
        for component in (0..component_count).rev() {
            let first = first_of[component];
            self.modules[first as usize]
                .awaited
                .store(awaited[component], Relaxed);
            if awaited[component] != 0 {
                continue;
            }
            let mut member = first;
            while member != NO_CELL {
                for &target in targets_of(member as usize) {
                    let other = component_of[target as usize] as usize;
                    awaited[other] -= u32::from(other != component);
                }
                self.begin_watch_of(member);
                member = self.modules[member as usize]
                    .next_in_component
                    .load(Relaxed);
            }
        }
    }

    pub fn note_commit(&self, file: FileId) {
        let cell = &self.modules[file.idx()];
        if !cell.stop_awaiting_commit() {
            return;
        }
        let first = cell.component.load(Relaxed);
        if !self.modules[first as usize].decrement_awaited() {
            return;
        }
        let mut done = vec![first];
        while let Some(first) = done.pop() {
            let mut member = first;
            while member != NO_CELL {
                self.begin_watch_of(member);
                self.for_each_file_referred_to(member as usize, &mut |target| {
                    let other = self.modules[target as usize].component.load(Relaxed);
                    if other != first && self.modules[other as usize].decrement_awaited() {
                        done.push(other);
                    }
                });
                member = self.modules[member as usize]
                    .next_in_component
                    .load(Relaxed);
            }
        }
    }

    pub fn is_tree_gone(&self, file: FileId) -> bool {
        self.modules[file.idx()].state.load(SeqCst) == GONE
    }

    /// The trees stay for good, or the file owns none. `Files::free_tree` does not ask: that is up to its caller.
    pub fn is_tree_kept(&self, file: FileId) -> bool {
        self.modules[file.idx()].state.load(SeqCst) == KEPT
    }

    /// The trees of `file` stay for good, for a reader that the count by reach leaves out: a task of another program, or a
    /// thread that reads once the tasks have ended. The trees of the files that `file` refers to go as before. The caller can
    /// still read `file`: no task runs yet, or a file that its task checks reaches it.
    pub fn keep_tree(&self, file: FileId) {
        self.modules[file.idx()].keep_for_reader();
    }

    /// No tree goes from now on, not even one that a thread is about to let go, nor behind a later `let_trees_go_behind`. It
    /// waits for no such thread, and tasks of this program may run. `watch_no_more` still follows.
    pub fn let_no_more_trees_go(&self) {
        for cell in self.modules.iter() {
            cell.keep_what_is_here();
        }
    }

    /// The end of `let_trees_go_behind`: no tree goes anymore. What is gone stays gone, and watched. No task of this program runs.
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
            cell.stop_awaiting_commit();
            cell.awaited.store(0, Relaxed);
            cell.component.store(NO_CELL, Relaxed);
            cell.next_in_component.store(NO_CELL, Relaxed);
            cell.keep_what_is_here();
        }
    }

    /// `free_long_lists` of a module whose trees may be gone. Nothing reads a tree again, so nobody is left to stop.
    pub(super) fn forget_what_went(&self, index: usize) {
        let cell = &self.modules[index];
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
    outer: Bit,
    outer_pin: Pin,
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
            outer: TASK.replace(bit),
            outer_pin: PIN.replace(tasks.pin()),
            read_by_outer: READ.take(),
        }
    }

    #[inline]
    pub unsafe fn repin() {
        if TASKS_ENDED.load(Relaxed) >= PIN.get().repins_at {
            Self::repin_now();
        }
    }

    #[cold]
    fn repin_now() {
        let mut tasks = TASKS.lock();
        let began = PIN.get().began;
        let at = tasks.running.iter().position(|&it| it == began);
        tasks.running[at.expect("it began")] = tasks.time;
        PIN.set(tasks.pin());
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
            let began = PIN.replace(self.outer_pin).began;
            let at = tasks.running.iter().position(|&it| it == began);
            tasks.running.swap_remove(at.expect("it began"));
            TASKS_ENDED.fetch_add(1, Relaxed);
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
