//! Linear memories.

mod access;
mod budget;
mod pages;
pub(crate) mod system;

use core::cell::{Cell, RefCell};
use core::ops::Range;
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_asm::Width;
use bun_engine_wasm_compiler::abi::{
    GUARD_SIZE, LOW_GUARD_SIZE, MemoryMode, MemoryView, PAGE_SIZE_LOG2,
};
use bun_engine_wasm_format::limits::max_pages;
use bun_engine_wasm_format::{Memory as MemoryType, OutOfMemory};

pub(crate) use self::access::{copy_bytes, fill_bytes};
use self::budget::{ADDRESS_SPACE, COMMITTED, Need};
pub use self::pages::Pages;
use crate::host::Urgency;
use crate::registry::{Registration, Registry};
use crate::store::Store;
use crate::value::HostCell;

/// That of the longest buffer.
const MAX_LENGTH: u64 = 1 << 32;
const MAX_PAGES: u64 = MAX_LENGTH >> PAGE_SIZE_LOG2;
const GUARDED_SIZE: u64 = (1 << 32) + GUARD_SIZE;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GrowError {
    /// More than a memory with such addresses can declare, or less than it has.
    InvalidSize,
    ExceedsMaximum,
    OutOfMemory,
}

/// What all linear memories of the process take, in bytes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct MemoryUsage {
    pub reserved: u64,
    pub committed: u64,
}

pub fn memory_usage() -> MemoryUsage {
    MemoryUsage {
        reserved: ADDRESS_SPACE.used(),
        committed: COMMITTED.used(),
    }
}

/// A shared memory on its way to another thread.
#[derive(Clone)]
pub struct SharedMemory {
    ty: MemoryType,
    mode: MemoryMode,
    pages: Arc<Pages>,
}

impl SharedMemory {
    pub fn pages(&self) -> &Arc<Pages> {
        &self.pages
    }

    /// For a thread that has only a buffer.
    pub fn grow_to(&self, pages: u64) -> Result<(), GrowError> {
        let growth = self.pages.lock_growth();
        let old = self.pages.len();
        let added = pages.checked_sub(old >> PAGE_SIZE_LOG2);
        let added = added.ok_or(GrowError::InvalidSize)?;
        let grew = growth.extend_to(length_after_growth(&self.ty, old, added)?);
        grew.then_some(()).ok_or(GrowError::OutOfMemory)
    }
}

pub struct Memory {
    store: Rc<Store>,
    ty: MemoryType,
    mode: MemoryMode,
    pages: RefCell<Arc<Pages>>,
    /// Where a fault means that an access is out of bounds.
    faulting: Range<usize>,
    views: Registry<MemoryView>,
    owner: Cell<Option<HostCell>>,
}

impl Memory {
    /// The limits are valid for the type of address, and a shared memory has a maximum. `wanted` is a wish.
    pub fn new(
        store: &Rc<Store>,
        ty: MemoryType,
        wanted: MemoryMode,
    ) -> Result<Rc<Self>, OutOfMemory> {
        if ty.pages.initial > MAX_PAGES {
            return Err(OutOfMemory);
        }
        let length = ty.pages.initial << PAGE_SIZE_LOG2;
        let room = room_for(&ty);
        let options = store.engine().options();
        let is_worth_guarding = wanted == MemoryMode::Guarded
            && ty.address == Width::W32
            && room != 0
            && options.guard_memories
            // One that another thread takes is seen by code that may leave the check to a fault.
            && (!ty.shared || options.handle_faults);
        let guarded = is_worth_guarding.then(|| reserve_guarded(store)).flatten();
        let (mode, pages) = match guarded {
            Some(pages) => (MemoryMode::Guarded, Some(pages)),
            None if ty.shared => {
                let pages = reserve_room(room, Need::Function)
                    .or_else(|| insisting(store, || Pages::reserve(room, Need::Function)));
                (MemoryMode::Checked, pages)
            }
            None => {
                let pages = (room > length)
                    .then(|| reserve_room(room, Need::Speed))
                    .flatten()
                    .or_else(|| insisting(store, || Pages::reserve(length, Need::Bounded)));
                (MemoryMode::Checked, pages)
            }
        };
        let pages = pages.ok_or(OutOfMemory)?;
        insisting(store, || {
            pages.lock_growth().extend_to(length).then_some(())
        })
        .ok_or(OutOfMemory)?;
        if ADDRESS_SPACE.is_short(Need::Speed) || COMMITTED.is_short(Need::Function) {
            store.collect_garbage(Urgency::Soon);
        }
        Ok(Self::with_pages(store, ty, mode, Arc::new(pages)))
    }

    pub fn from_shared(store: &Rc<Store>, shared: SharedMemory) -> Rc<Self> {
        assert!(shared.mode == MemoryMode::Checked || store.engine().options().handle_faults);
        Self::with_pages(store, shared.ty, shared.mode, shared.pages)
    }

    fn with_pages(
        store: &Rc<Store>,
        ty: MemoryType,
        mode: MemoryMode,
        pages: Arc<Pages>,
    ) -> Rc<Self> {
        let stays = mode == MemoryMode::Guarded || ty.shared;
        Rc::new(Self {
            store: Rc::clone(store),
            ty,
            mode,
            faulting: if stays { pages.reservation() } else { 0..0 },
            pages: RefCell::new(pages),
            views: Registry::default(),
            owner: Cell::new(None),
        })
    }

    /// `None` unless it is shared.
    pub fn share(&self) -> Option<SharedMemory> {
        self.ty.shared.then(|| SharedMemory {
            ty: self.ty,
            mode: self.mode,
            pages: self.pages(),
        })
    }

    /// As it was declared.
    pub fn ty(&self) -> &MemoryType {
        &self.ty
    }

    pub fn mode(&self) -> MemoryMode {
        self.mode
    }

    /// A memory that is neither guarded nor shared may leave them for others when it grows.
    pub fn pages(&self) -> Arc<Pages> {
        Arc::clone(&self.pages.borrow())
    }

    /// In bytes.
    #[inline]
    pub fn len(&self) -> u64 {
        self.pages.borrow().len()
    }

    /// What it can grow to.
    pub fn max_len(&self) -> u64 {
        room_for(&self.ty)
    }

    pub fn page_count(&self) -> u64 {
        self.len() >> PAGE_SIZE_LOG2
    }

    pub fn owner(&self) -> Option<HostCell> {
        self.owner.get()
    }

    /// For instances to keep alive along with the memory.
    ///
    /// # Safety
    /// The cell keeps the memory.
    pub unsafe fn set_owner(&self, owner: HostCell) {
        self.owner.set(Some(owner));
    }

    /// Gives the number of pages before.
    pub fn grow(&self, pages: u64) -> Result<u64, GrowError> {
        let old = match self.try_grow(pages) {
            Err(Denied::ForNow) => {
                self.store.collect_garbage(Urgency::Now);
                self.try_grow(pages)
            }
            outcome => outcome,
        };
        let old = old.map_err(|denied| match denied {
            Denied::ForNow => GrowError::OutOfMemory,
            Denied::ForGood(error) => error,
        })?;
        if self.ty.shared && pages == 0 {
            return Ok(old);
        }
        self.views.write_all(|| self.view());
        let (host, vm) = self.store.host();
        host.memory_grew(vm, self, old << PAGE_SIZE_LOG2);
        if pages != 0 && COMMITTED.is_short(Need::Function) {
            self.store.collect_garbage(Urgency::Soon);
        }
        Ok(old)
    }

    fn try_grow(&self, added: u64) -> Result<u64, Denied> {
        let pages = self.pages();
        let growth = pages.lock_growth();
        let old = pages.len();
        let length = length_after_growth(&self.ty, old, added).map_err(Denied::ForGood)?;
        let grew = if length <= pages.reserved() {
            growth.extend_to(length)
        } else {
            self.move_from(&pages, length)
        };
        grew.then_some(old >> PAGE_SIZE_LOG2).ok_or(Denied::ForNow)
    }

    fn move_from(&self, old: &Pages, length: u64) -> bool {
        assert!(self.faulting.is_empty());
        let room = room_for(&self.ty);
        let new = reserve_room(room, Need::Speed)
            .or_else(|| Pages::reserve((length * 2).min(room), Need::Bounded))
            .or_else(|| Pages::reserve(length, Need::Bounded))
            .filter(|new| new.lock_growth().extend_to(length));
        let Some(new) = new else { return false };
        // SAFETY: both have at least this many accessible bytes.
        unsafe { copy_bytes(new.base(), old.base(), old.len() as usize) };
        self.pages.replace(Arc::new(new));
        true
    }

    fn view(&self) -> MemoryView {
        let pages = self.pages.borrow();
        let (length, shared_length) = match self.ty.shared {
            true => (0, pages.length_address()),
            false => (pages.len(), 0),
        };
        MemoryView {
            base: pages.base().addr(),
            length,
            shared_length,
        }
    }

    /// # Safety
    /// `view` is valid for writes until it is removed.
    pub(crate) unsafe fn add_view(&self, view: *mut MemoryView) -> Registration {
        // SAFETY: the caller's.
        unsafe {
            view.write(self.view());
            self.views.add(view)
        }
    }

    pub(crate) fn remove_view(&self, registration: Registration) {
        self.views.remove(registration);
    }

    /// For the handler of faults.
    pub(crate) fn faults_at(&self, address: usize) -> bool {
        self.faulting.contains(&address)
    }

    pub(crate) fn store(&self) -> &Rc<Store> {
        &self.store
    }
}

enum Denied {
    /// Collecting garbage may help.
    ForNow,
    ForGood(GrowError),
}

fn length_after_growth(ty: &MemoryType, length: u64, pages: u64) -> Result<u64, GrowError> {
    match (length >> PAGE_SIZE_LOG2).checked_add(pages) {
        None => Err(GrowError::InvalidSize),
        Some(new) if new > max_pages(ty.address) => Err(GrowError::InvalidSize),
        Some(new) if new > MAX_PAGES => Err(GrowError::OutOfMemory),
        Some(new) if ty.pages.maximum.is_some_and(|it| new > it) => Err(GrowError::ExceedsMaximum),
        Some(new) => Ok(new << PAGE_SIZE_LOG2),
    }
}

/// The most bytes it can ever have.
fn room_for(ty: &MemoryType) -> u64 {
    ty.pages.maximum.unwrap_or(MAX_PAGES).min(MAX_PAGES) << PAGE_SIZE_LOG2
}

/// So much that the budget bounds the number of mappings too, which the system limits.
fn reserve_room(room: u64, need: Need) -> Option<Pages> {
    const LEAST: u64 = 128 << 20;
    Pages::reserve(room.max(LEAST), need)
}

fn insisting<T>(store: &Store, attempt: impl Fn() -> Option<T>) -> Option<T> {
    attempt().or_else(|| {
        store.collect_garbage(Urgency::Now);
        attempt()
    })
}

fn reserve_guarded(store: &Store) -> Option<Pages> {
    let attempt = || Pages::reserve_with_margin(LOW_GUARD_SIZE, GUARDED_SIZE, Need::Speed);
    attempt().or_else(|| {
        if ADDRESS_SPACE.used() < GUARDED_SIZE {
            return None;
        }
        store.collections_for_speed.attempt(|| {
            store.collect_garbage(Urgency::Now);
            attempt()
        })
    })
}

/// Tries ever more rarely what keeps failing.
#[derive(Default)]
pub(crate) struct Backoff {
    failures: Cell<u32>,
    skips_left: Cell<u32>,
}

impl Backoff {
    pub(crate) fn attempt<T>(&self, attempt: impl FnOnce() -> Option<T>) -> Option<T> {
        if let Some(left) = self.skips_left.get().checked_sub(1) {
            self.skips_left.set(left);
            return None;
        }
        let outcome = attempt();
        let failures = match outcome {
            Some(_) => 0,
            None => (self.failures.get() + 1).min(16),
        };
        self.failures.set(failures);
        self.skips_left.set((1 << failures) - 1);
        outcome
    }
}
