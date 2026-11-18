//! What the run time keeps for a thread and its heap.

use core::cell::{Cell, OnceCell, RefCell};
use core::ops::Range;
use core::ptr;
use core::sync::atomic::{AtomicU8, Ordering};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Instant;

use bun_engine_exec_memory::usage;

use crate::code::{Compilers, RetiredCode};
use crate::engine::Engine;
use crate::host::{Host, Urgency, Vm};
use crate::interpreted::ValueStack;
use crate::interrupts::Interrupts;
use crate::memory::Backoff;
use crate::value::HostCell;

/// What has to be left of the stack below the limit, for stubs and operations.
pub const STACK_RESERVE: usize = if cfg!(bun_asan) { 64 << 10 } else { 32 << 10 };

pub struct Store {
    engine: &'static Engine,
    vm: Vm,
    allocators: usize,
    stack: Range<usize>,
    value_stack: OnceCell<ValueStack>,
    interrupts: Arc<Interrupts>,
    pub(crate) compilers: RefCell<Compilers>,
    pub(crate) retired: Arc<RetiredCode>,
    pub(crate) collections_for_speed: Backoff,
    /// How many collections in a row have not made room for code, and until when no other is worth it.
    collections_in_vain: Cell<(u32, Instant)>,
    /// The least that the process has had of generated code since this last asked for a collection because of it.
    least_code_bytes: Cell<usize>,
}

impl Store {
    /// # Safety
    /// `vm` is that of this thread, and outlives all uses but drops of what is made with the store. The stack of the
    /// thread extends for [`STACK_RESERVE`] bytes below `stack`, and can be touched in any order down to that.
    pub unsafe fn new(engine: &'static Engine, vm: Vm, stack: Range<usize>) -> Rc<Self> {
        Rc::new(Self {
            engine,
            vm,
            allocators: engine.host().allocators(vm),
            interrupts: Arc::new(Interrupts::new(stack.start)),
            stack,
            value_stack: OnceCell::new(),
            compilers: RefCell::default(),
            retired: Arc::default(),
            collections_for_speed: Backoff::default(),
            collections_in_vain: Cell::new((0, Instant::now())),
            least_code_bytes: Cell::new(usage().bytes_in_use),
        })
    }

    #[inline]
    pub fn engine(&self) -> &'static Engine {
        self.engine
    }

    #[inline]
    pub fn vm(&self) -> Vm {
        self.vm
    }

    #[inline]
    pub(crate) fn host(&self) -> (&'static dyn Host, Vm) {
        (self.engine.host(), self.vm)
    }

    #[inline]
    pub(crate) fn allocators(&self) -> usize {
        self.allocators
    }

    pub fn interrupts(&self) -> &Arc<Interrupts> {
        &self.interrupts
    }

    pub(crate) fn stack_limit(&self) -> usize {
        self.stack.start
    }

    /// `None` for want of memory.
    #[inline]
    pub(crate) fn value_stack(&self) -> Option<&ValueStack> {
        self.value_stack.get().or_else(|| {
            let stack = ValueStack::new(self.stack.len())?;
            Some(self.value_stack.get_or_init(|| stack))
        })
    }

    pub(crate) fn existing_value_stack(&self) -> &ValueStack {
        self.value_stack.get().expect("an entry has made it")
    }

    /// The addresses of words that the collector has to treat like those on the stack.
    pub fn interpreted_values(&self) -> Range<usize> {
        (self.value_stack.get()).map_or(0..0, ValueStack::addresses_in_use)
    }

    /// What native code can use from there down.
    pub(crate) fn stack_below(&self, address: usize) -> usize {
        address.saturating_sub(self.stack_limit().saturating_sub(STACK_RESERVE))
    }

    /// After a cell has been stored in `cell` or in what it traces.
    #[inline]
    pub(crate) fn write_barrier(&self, cell: HostCell) {
        let state = cell.field(self.engine.layout().cell_state);
        // SAFETY: every cell has this byte.
        let state = unsafe { AtomicU8::from_ptr(state) }.load(Ordering::Relaxed);
        if state <= self.engine.barrier_threshold() {
            self.engine.host().write_barrier(self.vm, cell);
        }
    }

    pub(crate) fn collect_garbage(&self, urgency: Urgency) {
        self.engine.host().collect_garbage(self.vm, urgency);
    }

    /// There is less room for code than for anything else, so modules that are not used any more cannot wait as long.
    pub(crate) fn collect_if_code_adds_up(&self) {
        let now = usage();
        let least = self.least_code_bytes.get().min(now.bytes_in_use);
        if now.bytes_in_use - least <= now.capacity / 8 {
            return self.least_code_bytes.set(least);
        }
        self.collect_garbage(Urgency::Now);
        self.least_code_bytes.set(usage().bytes_in_use);
    }

    /// For what has failed for want of it. If that goes on, collecting takes no more than half of the time.
    pub(crate) fn after_making_room_for_code(&self, attempt: impl FnOnce() -> bool) -> bool {
        const PATIENCE: u32 = 8;
        let (start, (count, not_before)) = (Instant::now(), self.collections_in_vain.get());
        if count >= PATIENCE && start < not_before {
            return false;
        }
        self.collect_garbage(Urgency::Now);
        let has_helped = attempt();
        let count = if has_helped {
            0
        } else {
            count.saturating_add(1)
        };
        let end = Instant::now();
        self.collections_in_vain.set((count, end + (end - start)));
        has_helped
    }

    #[inline]
    pub(crate) fn top_frame(&self) -> *mut usize {
        ptr::with_exposed_provenance_mut(self.vm.0 + self.engine.layout().vm_top_frame as usize)
    }

    pub(crate) fn set_top_frame(&self, fp: usize) {
        // SAFETY: the VM has the word there.
        unsafe { self.top_frame().write(fp) };
    }

    /// For the collector, on any thread. Frees code that has been replaced.
    ///
    /// # Safety
    /// The thread of the store is in native code, and all return addresses on its stacks are among `words`.
    pub unsafe fn release_code_not_on_stack(&self, words: &[usize]) {
        // SAFETY: the caller's.
        unsafe { self.retired.release_all_but(words) };
    }
}
