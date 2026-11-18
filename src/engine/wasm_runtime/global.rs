//! Globals that exist apart from an instance.

use core::cell::Cell;
use std::rc::Rc;

use bun_engine_wasm_format::{CanonicalValType, ValType};

use crate::store::Store;
use crate::value::{Bits, HostCell, Reference};
use crate::words;

pub struct Global {
    store: Rc<Store>,
    ty: CanonicalValType,
    mutable: bool,
    /// Compiled code writes as many bytes as the type has.
    value: Cell<Bits>,
    owner: Cell<Option<HostCell>>,
}

impl Global {
    /// The value is zero or null.
    pub fn new(store: &Rc<Store>, ty: CanonicalValType, mutable: bool) -> Rc<Self> {
        let value = default_value(ty.erased());
        Rc::new(Self {
            store: Rc::clone(store),
            ty,
            mutable,
            value: Cell::new(value),
            owner: Cell::new(None),
        })
    }

    pub fn ty(&self) -> &CanonicalValType {
        &self.ty
    }

    pub fn is_mutable(&self) -> bool {
        self.mutable
    }

    pub fn owner(&self) -> Option<HostCell> {
        self.owner.get()
    }

    /// Before a reference is put in.
    ///
    /// # Safety
    /// The cell keeps and traces the global. The value has its type by the time an instance uses it.
    pub unsafe fn set_owner(&self, owner: HostCell) {
        self.owner.set(Some(owner));
    }

    pub fn get(&self) -> Bits {
        self.value.get()
    }

    /// # Safety
    /// `value` has the type of the global.
    pub unsafe fn set(&self, value: Bits) {
        if !self.ty.erased().is_ref() {
            return self.value.set(value);
        }
        // SAFETY: the low half. The other stays zero.
        unsafe { words::store(self.value.as_ptr().cast(), value as u64) };
        if Reference(value as u64).cell().is_some() {
            self.store.write_barrier(self.owner().expect("an owner"));
        }
    }

    /// On any thread, while the thread of the global runs.
    pub fn trace(&self, visit: impl FnMut(HostCell)) {
        if self.ty.erased().is_ref() {
            // SAFETY: only `set` writes it.
            let value = Reference(unsafe { words::load(self.value.as_ptr().cast()) });
            value.cell().into_iter().for_each(visit);
        }
    }

    pub(crate) fn value_address(&self) -> usize {
        self.value.as_ptr().expose_provenance()
    }

    pub(crate) fn store(&self) -> &Rc<Store> {
        &self.store
    }
}

pub(crate) fn default_value(ty: ValType) -> Bits {
    if ty.is_ref() {
        Reference::NULL.into()
    } else {
        0
    }
}
