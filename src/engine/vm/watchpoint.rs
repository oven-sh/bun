//! Assumptions that caches and compiled code rest on, and who is told when one stops being true.

use core::cell::{Cell, RefCell};
use core::mem::{ManuallyDrop, offset_of};
use std::rc::{Rc, Weak};

use crate::{Forbidden, Gc, GcFree, JsCell, Vm};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum WatchpointState {
    /// The first `touch` only starts the watch.
    Clear = 0,
    Watched = 1,
    Invalidated = 2,
}

/// Runs with collection deferred. It runs no script.
pub trait Watcher: GcFree {
    fn fire(&self, vm: &Vm, owner: Gc<JsCell>, this: &Watchpoint);
}

struct Node {
    owner: usize,
    watcher: Box<dyn Watcher>,
}

/// Is in the sets that it has been added to until it is dropped.
#[derive(Clone)]
pub struct Watchpoint(Rc<Node>);

// SAFETY: looks whether its owner is alive.
unsafe impl GcFree for Watchpoint {}

impl Watchpoint {
    /// # Safety
    /// The watchpoint is dropped no later than when `owner` is destroyed.
    pub unsafe fn new(owner: &JsCell, watcher: impl Watcher + 'static) -> Watchpoint {
        Watchpoint(Rc::new(Node {
            owner: owner.address(),
            watcher: Box::new(watcher),
        }))
    }

    fn fire(&self, vm: &Vm) {
        // SAFETY: not destroyed, and used only if it is alive.
        unsafe {
            if vm.heap.is_live(self.0.owner) {
                self.0
                    .watcher
                    .fire(vm, Gc::from_address(self.0.owner), self);
            }
        }
    }
}

#[repr(C)]
pub struct WatchpointSet {
    state: Cell<WatchpointState>,
    watchers: RefCell<Vec<Weak<Node>>>,
}

// SAFETY: has only watchpoints.
unsafe impl GcFree for WatchpointSet {}

impl WatchpointSet {
    pub const OFFSET_OF_STATE: usize = offset_of!(WatchpointSet, state);

    pub const fn new(state: WatchpointState) -> WatchpointSet {
        WatchpointSet {
            state: Cell::new(state),
            watchers: RefCell::new(Vec::new()),
        }
    }

    pub fn create(state: WatchpointState) -> Rc<WatchpointSet> {
        Rc::new(WatchpointSet::new(state))
    }

    #[inline(always)]
    pub fn state(&self) -> WatchpointState {
        self.state.get()
    }

    #[inline(always)]
    pub fn is_still_valid(&self) -> bool {
        self.state() != WatchpointState::Invalidated
    }

    pub fn is_being_watched(&self) -> bool {
        let watchers = self.watchers.borrow();
        watchers.iter().any(|watcher| watcher.strong_count() != 0)
    }

    /// Panics if the set has been invalidated.
    pub fn add(&self, watchpoint: &Watchpoint) {
        assert!(self.is_still_valid());
        self.state.set(WatchpointState::Watched);
        let mut watchers = self.watchers.borrow_mut();
        if watchers.len() == watchers.capacity() {
            watchers.retain(|watcher| watcher.strong_count() != 0);
            let live = watchers.len();
            watchers.reserve(live.max(1));
        }
        watchers.push(Rc::downgrade(&watchpoint.0));
    }

    pub fn start_watching(&self) {
        if self.state() == WatchpointState::Clear {
            self.state.set(WatchpointState::Watched);
        }
    }

    /// Only a set that is watched fires.
    #[inline]
    pub fn fire(&self, vm: &Vm) {
        if self.state() == WatchpointState::Watched {
            self.invalidate(vm);
        }
    }

    #[inline]
    pub fn touch(&self, vm: &Vm) {
        match self.state() {
            WatchpointState::Clear => self.state.set(WatchpointState::Watched),
            WatchpointState::Watched => self.invalidate(vm),
            WatchpointState::Invalidated => {}
        }
    }

    pub fn invalidate(&self, vm: &Vm) {
        drop(self.invalidate_deferred(vm));
    }

    fn invalidate_deferred<'a>(&self, vm: &'a Vm) -> DeferredFire<'a> {
        self.state.set(WatchpointState::Invalidated);
        DeferredFire {
            vm,
            watchers: self.watchers.take(),
        }
    }
}

/// Fires when it is dropped, which is after the change that the watchers want to look at.
pub struct DeferredFire<'a> {
    vm: &'a Vm,
    watchers: Vec<Weak<Node>>,
}

impl<'a> DeferredFire<'a> {
    #[inline]
    pub fn new(vm: &'a Vm) -> DeferredFire<'a> {
        vm.count_rearrangement();
        DeferredFire {
            vm,
            watchers: Vec::new(),
        }
    }

    #[cold]
    fn fire(&mut self) {
        if (self.watchers.iter()).any(|watcher| watcher.strong_count() != 0) {
            self.vm.assert_is_allowed(Forbidden::INVALIDATING);
            #[cfg(debug_assertions)]
            crate::direct::will_fire_watchpoint(self.vm);
        }
        let _defer = self.vm.heap.defer_collection();
        for watcher in core::mem::take(&mut self.watchers) {
            if let Some(node) = watcher.upgrade() {
                Watchpoint(node).fire(self.vm);
            }
        }
    }
}

impl Drop for DeferredFire<'_> {
    #[inline]
    fn drop(&mut self) {
        if !self.watchers.is_empty() {
            self.fire();
        }
    }
}

/// One word until something watches it.
#[repr(transparent)]
#[cfg_attr(rootcheck, rootcheck::stays("lends nothing"))]
pub struct InlineWatchpointSet(Cell<usize>);

impl InlineWatchpointSet {
    pub const IS_THIN: usize = 1;
    const STATE_SHIFT: u32 = 1;
    pub const THIN_WATCHED: usize = Self::thin(WatchpointState::Watched);
    pub const THIN_INVALIDATED: usize = Self::thin(WatchpointState::Invalidated);

    const fn thin(state: WatchpointState) -> usize {
        (state as usize) << Self::STATE_SHIFT | Self::IS_THIN
    }

    pub const fn new(state: WatchpointState) -> InlineWatchpointSet {
        InlineWatchpointSet(Cell::new(Self::thin(state)))
    }

    #[inline(always)]
    pub fn bits(&self) -> usize {
        self.0.get()
    }

    /// Invalidates the set in a way that code which looks for `THIN_INVALIDATED` does not recognize.
    pub fn invalidate_and_keep_slow(&self, vm: &Vm) {
        let mut deferred = DeferredFire::new(vm);
        self.invalidate_into(&mut deferred);
        self.0
            .set(Self::THIN_INVALIDATED + (1 << Self::STATE_SHIFT));
    }

    #[inline(always)]
    fn fat(&self) -> Option<ManuallyDrop<Rc<WatchpointSet>>> {
        let word = self.0.get();
        // SAFETY: from `Rc::into_raw` in `inflate`. The count that `self` holds is left alone.
        (word & Self::IS_THIN == 0).then(|| unsafe {
            ManuallyDrop::new(Rc::from_raw(core::ptr::with_exposed_provenance(word)))
        })
    }

    #[inline]
    pub fn state(&self) -> WatchpointState {
        match self.fat() {
            Some(set) => set.state(),
            None => match self.0.get() >> Self::STATE_SHIFT {
                0 => WatchpointState::Clear,
                1 => WatchpointState::Watched,
                _ => WatchpointState::Invalidated,
            },
        }
    }

    #[inline]
    pub fn is_still_valid(&self) -> bool {
        self.state() != WatchpointState::Invalidated
    }

    #[inline(always)]
    pub fn is_watched(&self) -> bool {
        self.0.get() == Self::thin(WatchpointState::Watched)
            || (self.fat()).is_some_and(|set| set.state() == WatchpointState::Watched)
    }

    pub fn is_being_watched(&self) -> bool {
        self.fat().is_some_and(|set| set.is_being_watched())
    }

    pub fn inflate(&self) -> Rc<WatchpointSet> {
        if let Some(set) = self.fat() {
            return Rc::clone(&set);
        }
        let set = WatchpointSet::create(self.state());
        self.0
            .set(Rc::into_raw(Rc::clone(&set)).expose_provenance());
        set
    }

    pub fn add(&self, watchpoint: &Watchpoint) {
        self.inflate().add(watchpoint);
    }

    pub fn start_watching(&self) {
        match self.fat() {
            Some(set) => set.start_watching(),
            None if self.state() == WatchpointState::Clear => {
                self.0.set(Self::thin(WatchpointState::Watched));
            }
            None => {}
        }
    }

    #[inline]
    pub fn fire(&self, vm: &Vm) {
        if self.state() == WatchpointState::Watched {
            self.invalidate(vm);
        }
    }

    #[inline]
    pub fn touch(&self, vm: &Vm) {
        match self.state() {
            WatchpointState::Clear => self.start_watching(),
            WatchpointState::Watched => self.invalidate(vm),
            WatchpointState::Invalidated => {}
        }
    }

    pub fn invalidate(&self, vm: &Vm) {
        self.invalidate_into(&mut DeferredFire::new(vm));
    }

    #[inline]
    pub fn invalidate_into(&self, deferred: &mut DeferredFire<'_>) {
        if let Some(set) = self.fat() {
            let set = ManuallyDrop::into_inner(set);
            let mut fire = set.invalidate_deferred(deferred.vm);
            deferred.watchers.append(&mut fire.watchers);
        }
        self.0.set(Self::THIN_INVALIDATED);
    }
}

impl Drop for InlineWatchpointSet {
    fn drop(&mut self) {
        drop(self.fat().map(ManuallyDrop::into_inner));
    }
}
