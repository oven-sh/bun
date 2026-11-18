//! Caches of property lookups that all code shares. An entry is good for one `Vm::prototype_chain_epoch`, so it need
//! not keep any cell alive.

mod copy_plan;
mod has_own_property;
mod megamorphic;

use core::cell::Cell;
use core::mem::offset_of;
use core::ptr::NonNull;

use bun_engine_text::{PropertyName, StringRef};

pub(crate) use copy_plan::Move;
pub use has_own_property::{
    HasOwnPropertyEntry, has_own_property, known_own_property, try_has_own_property,
};
pub use megamorphic::{
    ENTRY_SHIFT, LoadEntry, PRIMARY_SHAPE_SHIFTS, SHAPE_SHIFT, StoreEntry, get_megamorphic,
    get_quietly, has_megamorphic, name_hash, primary_hash, put_megamorphic, put_quietly,
    secondary_hash,
};
pub(crate) use megamorphic::{
    define_megamorphic, get_megamorphic_if_present, get_megamorphic_with_receiver,
    get_own_megamorphic, get_private_megamorphic, has_enumerable_megamorphic,
    has_private_megamorphic, is_known_to_be_absent, put_megamorphic_in,
    replace_private_megamorphic,
};

use crate::heap::{Scope, virtual_memory};
use crate::{JsObject, Vm};

/// The address of a name. No other gets it while the entry is good, because a shape that has the property holds a
/// count of it, or else the entry does.
#[repr(transparent)]
struct CachedName(Cell<usize>);

impl CachedName {
    #[inline(always)]
    fn address(&self) -> usize {
        self.0.get()
    }

    #[inline(always)]
    fn is(&self, name: PropertyName<'_>) -> bool {
        self.address() == name.address()
    }

    /// It is clear.
    #[inline(always)]
    fn set(&self, name: PropertyName<'_>, is_counted: bool) {
        if is_counted {
            name.to_identifier().into_string().into_raw();
        }
        self.0.set(name.as_ptr().as_ptr().expose_provenance());
    }

    /// It is clear.
    #[inline(always)]
    fn take_from(&self, other: &CachedName) {
        self.0.set(other.0.take());
    }

    /// # Safety
    /// `is_counted` is what it was set with.
    #[inline(always)]
    unsafe fn clear(&self, is_counted: bool) {
        let name = NonNull::new(core::ptr::with_exposed_provenance_mut(self.0.take()));
        if let Some(name) = name.filter(|_| is_counted) {
            // SAFETY: the caller's.
            drop(unsafe { StringRef::from_raw(name) });
        }
    }
}

#[repr(transparent)]
struct Table<T, const N: usize>([T; N]);

impl<T, const N: usize> Table<T, N> {
    #[inline(always)]
    fn at(&self, hash: u32) -> &T {
        const { assert!(N.is_power_of_two()) };
        &self.0[hash as usize % N]
    }
}

/// All zeros to begin with.
#[repr(C)]
pub struct LookupTables {
    loads: Table<LoadEntry, { LoadEntry::PRIMARY_COUNT }>,
    secondary_loads: Table<LoadEntry, { LoadEntry::SECONDARY_COUNT }>,
    stores: Table<StoreEntry, { StoreEntry::PRIMARY_COUNT }>,
    secondary_stores: Table<StoreEntry, { StoreEntry::SECONDARY_COUNT }>,
    has_own_property: Table<HasOwnPropertyEntry, { HasOwnPropertyEntry::COUNT }>,
}

impl LookupTables {
    pub const OFFSET_OF_LOADS: usize = offset_of!(Self, loads);
    pub const OFFSET_OF_SECONDARY_LOADS: usize = offset_of!(Self, secondary_loads);
    pub const OFFSET_OF_STORES: usize = offset_of!(Self, stores);
    pub const OFFSET_OF_SECONDARY_STORES: usize = offset_of!(Self, secondary_stores);
    pub const OFFSET_OF_HAS_OWN_PROPERTY: usize = offset_of!(Self, has_own_property);

    /// Nothing matches an entry without a name.
    fn clear(&self) {
        (self.loads.0.iter().chain(&self.secondary_loads.0)).for_each(LoadEntry::clear);
        (self.stores.0.iter().chain(&self.secondary_stores.0)).for_each(StoreEntry::clear);
        (self.has_own_property.0.iter()).for_each(HasOwnPropertyEntry::clear);
    }
}

pub(crate) struct State {
    tables: NonNull<LookupTables>,
    has_entries: Cell<bool>,
    /// Since all code last forgot those that it had recorded.
    has_wrapped_epoch: Cell<bool>,
    pub(crate) copy_plans: copy_plan::CopyPlans,
}

const MAPPED_SIZE: usize = size_of::<LookupTables>().next_multiple_of(1 << 16);

impl Default for State {
    fn default() -> State {
        let address = virtual_memory::reserve(MAPPED_SIZE)
            // SAFETY: what has just been reserved.
            .filter(|&address| unsafe { virtual_memory::commit(address, MAPPED_SIZE) })
            .and_then(|address| NonNull::new(core::ptr::with_exposed_provenance_mut(address)));
        State {
            tables: address.unwrap_or_else(|| bun_alloc::out_of_memory()),
            has_entries: Cell::new(false),
            has_wrapped_epoch: Cell::new(false),
            copy_plans: Default::default(),
        }
    }
}

impl Drop for State {
    fn drop(&mut self) {
        self.release_names();
        // SAFETY: from `reserve`.
        unsafe { virtual_memory::release(self.tables.addr().get(), MAPPED_SIZE) };
    }
}

impl State {
    pub(crate) const OFFSET_OF_TABLES: usize = offset_of!(State, tables);

    #[inline(always)]
    fn tables(&self) -> &LookupTables {
        // SAFETY: mapped for as long as `self`, and zeros are a value of each field.
        unsafe { self.tables.as_ref() }
    }

    fn tables_to_fill(&self) -> &LookupTables {
        self.has_entries.set(true);
        self.tables()
    }

    fn release_names(&self) {
        if self.has_entries.take() {
            self.tables().clear();
        }
    }

    /// Whether a symbol lives on depends on who has its name.
    pub(crate) fn will_collect(&self, scope: Scope) {
        if scope == Scope::Full {
            self.release_names();
        }
    }

    #[cold]
    pub(crate) fn did_wrap_epoch(&self) {
        self.release_names();
        self.copy_plans.clear();
        self.has_wrapped_epoch.set(true);
    }

    #[inline(always)]
    pub(crate) fn has_wrapped_epoch(&self) -> bool {
        self.has_wrapped_epoch.get()
    }

    pub(crate) fn will_reconcile_all_code(&self) {
        self.has_wrapped_epoch.set(false);
    }
}

impl crate::services::Service for State {}

impl Vm {
    /// The address does not change.
    pub fn lookup_tables(&self) -> &LookupTables {
        self.services.caches.tables()
    }
}

/// Whether the shape and the static tables say all about an own property of that name, which is no index.
#[inline(always)]
pub(crate) fn is_looked_up_in_shape(object: &JsObject, name: PropertyName<'_>) -> bool {
    !object.overrides_get_own_property_slot() || object.shape().is_ordinary_name(name)
}
