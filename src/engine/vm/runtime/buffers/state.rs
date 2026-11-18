use core::cell::{Cell, RefCell};
use core::ptr::NonNull;

use bun_alloc::default_alloc;

use super::array_buffer::{ArrayBuffer, ArrayBufferRef};
use super::waiters;
use crate::heap::{Scope, Survivors};
use crate::{Gc, JsArrayBufferView, Vm, WatchpointSet, WatchpointState};

/// Frees what views and buffers have outside the heap, so that they need no destructor.
pub(crate) struct State {
    /// Those that a cell refers to.
    buffers: RefCell<Vec<ArrayBufferRef>>,
    /// The buffers from here on are new since the last collection.
    first_young_buffer: Cell<usize>,
    old_buffers_with_new_referrers: RefCell<Vec<NonNull<ArrayBuffer>>>,
    /// Some have got a buffer since.
    oversize_views: RefCell<Vec<usize>>,
    first_young_oversize_view: Cell<usize>,
    /// Kept until the finalizers have run.
    dead_buffers: RefCell<Vec<ArrayBufferRef>>,
    dead_vectors: RefCell<Vec<*mut u8>>,
    detach_watchpoints: WatchpointSet,
}

impl Default for State {
    fn default() -> State {
        State {
            buffers: RefCell::default(),
            first_young_buffer: Cell::new(0),
            old_buffers_with_new_referrers: RefCell::default(),
            oversize_views: RefCell::default(),
            first_young_oversize_view: Cell::new(0),
            dead_buffers: RefCell::default(),
            dead_vectors: RefCell::default(),
            detach_watchpoints: WatchpointSet::new(WatchpointState::Watched),
        }
    }
}

/// # Safety
/// From one of the lists, and not swept.
unsafe fn view_at(address: usize) -> Gc<JsArrayBufferView> {
    // SAFETY: the caller's.
    unsafe { Gc::from_address(address) }
}

/// # Safety
/// From `take_oversize_vector`, and nothing accesses them any more.
unsafe fn free_vectors(vectors: impl IntoIterator<Item = *mut u8>) {
    for vector in vectors {
        // SAFETY: the caller's.
        unsafe { default_alloc::free(vector.cast()) };
    }
}

impl State {
    #[inline]
    pub(super) fn add(&self, buffer: ArrayBufferRef) {
        self.buffers.borrow_mut().push(buffer);
    }

    pub(super) fn did_add_referrer_to_old(&self, buffer: &ArrayBuffer) {
        let mut buffers = self.old_buffers_with_new_referrers.borrow_mut();
        buffers.push(NonNull::from(buffer));
    }

    #[inline]
    pub(super) fn add_oversize_view(&self, view: &JsArrayBufferView) {
        self.oversize_views.borrow_mut().push(view.address());
    }

    fn prune_buffers(&self, survivors: &Survivors) {
        let changed = self.old_buffers_with_new_referrers.take();
        let mut first = 0;
        if survivors.scope() == Scope::Eden {
            first = self.first_young_buffer.get();
            for buffer in changed {
                // SAFETY: in `buffers`.
                let is_referred_to = unsafe { buffer.as_ref() }.prune_referrers(survivors);
                assert!(is_referred_to);
            }
        }
        let mut buffers = self.buffers.borrow_mut();
        let dead = buffers.extract_if(first.., |buffer| !buffer.prune_referrers(survivors));
        self.dead_buffers.borrow_mut().extend(dead);
        self.first_young_buffer.set(buffers.len());
    }

    fn prune_oversize_views(&self, survivors: &Survivors) {
        let first = match survivors.scope() {
            Scope::Eden => self.first_young_oversize_view.get(),
            Scope::Full => 0,
        };
        // SAFETY: nothing has been swept yet.
        let view_at = |address| unsafe { view_at(address) };
        let mut views = self.oversize_views.borrow_mut();
        let gone = views.extract_if(first.., |&mut view| {
            !survivors.contains_address(view) || view_at(view).has_buffer()
        });
        let vectors = gone.filter_map(|view| view_at(view).take_oversize_vector());
        self.dead_vectors.borrow_mut().extend(vectors);
        self.first_young_oversize_view.set(views.len());
    }
}

impl crate::services::Service for State {
    fn reconcile_weak_references(&self, _: &Vm, survivors: &Survivors) {
        self.prune_buffers(survivors);
        self.prune_oversize_views(survivors);
    }

    fn did_collect(&self, vm: &Vm, _: Scope) {
        // SAFETY: of views that have died.
        unsafe { free_vectors(self.dead_vectors.take()) };
        vm.heap.as_part_of_sweeping(|| {
            for buffer in self.dead_buffers.take() {
                // The last reference may go on another thread, where no watchpoint belongs.
                buffer.detach_watchpoints().invalidate(vm);
            }
        });
    }

    /// The buffers themselves stay for the destructors that unpin them.
    fn will_destroy(&self, vm: &Vm) {
        waiters::forget_agent(vm);
        let views = self.oversize_views.take().into_iter();
        // SAFETY: they are alive, and no script runs any more.
        unsafe { free_vectors(views.filter_map(|view| view_at(view).take_oversize_vector())) };
        let buffers = self.buffers.take();
        for buffer in &buffers {
            buffer.detach_watchpoints().invalidate(vm);
            drop(buffer.forget_referrers());
        }
        self.dead_buffers.borrow_mut().extend(buffers);
    }
}

impl Vm {
    /// Fires when the first buffer that has a view is detached.
    pub fn array_buffer_detach_watchpoints(&self) -> &WatchpointSet {
        &self.services.buffers.detach_watchpoints
    }
}
