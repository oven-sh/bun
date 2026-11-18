use core::cell::Cell;

use bun_engine_text::{PropertyName, STATIC_ATOM_COUNT, StringRef};

use crate::heap::Scope;
use crate::vm::StartsZeroed;
use crate::{Gc, JsString, Visitor, Vm};

/// The strings of the static atoms. They never die.
#[repr(C)]
pub struct SmallStrings {
    empty: Cell<usize>,
    /// The first 256, of one Latin-1 character, are made with the `Vm`. The others are zero until they are needed.
    of_static_atoms: [Cell<usize>; STATIC_ATOM_COUNT],
    has_young: Cell<bool>,
}

// SAFETY: integers and a `bool`.
unsafe impl StartsZeroed for SmallStrings {}

impl SmallStrings {
    /// Never changes. What tells whether a string is empty is its length.
    pub const OFFSET_OF_EMPTY: usize = core::mem::offset_of!(SmallStrings, empty);
    /// 256 words that never change, by code unit. The strings are atoms.
    pub const OFFSET_OF_SINGLE_CHARACTERS: usize =
        core::mem::offset_of!(SmallStrings, of_static_atoms);

    pub(crate) fn initialize(&self, vm: &Vm) {
        let allocate = |string| JsString::allocate(vm, string).address();
        self.has_young.set(true);
        self.empty.set(allocate(StringRef::empty()));
        for (entry, character) in self.of_static_atoms.iter().zip(0..=u8::MAX) {
            entry.set(allocate(StringRef::single_character(character)));
        }
    }

    #[inline(always)]
    pub fn empty(&self) -> Gc<JsString> {
        // SAFETY: a root, made with the `Vm`.
        unsafe { Gc::from_address(self.empty.get()) }
    }

    #[inline(always)]
    pub fn single_character(&self, character: u8) -> Gc<JsString> {
        // SAFETY: as above.
        unsafe { Gc::from_address(self.of_static_atoms[usize::from(character)].get()) }
    }

    /// Panics unless the index is below `STATIC_ATOM_COUNT`.
    #[inline(always)]
    pub fn of_static_atom(&self, vm: &Vm, index: usize) -> Gc<JsString> {
        match self.of_static_atoms[index].get() {
            0 => self.create(vm, index),
            // SAFETY: a root.
            address => unsafe { Gc::from_address(address) },
        }
    }

    #[cold]
    #[inline(never)]
    fn create(&self, vm: &Vm, index: usize) -> Gc<JsString> {
        let string = JsString::allocate(vm, StringRef::static_atom(index));
        self.of_static_atoms[index].set(string.address());
        self.has_young.set(true);
        string
    }

    pub(crate) fn visit(&self, visitor: &mut Visitor) {
        if !self.has_young.take() && visitor.scope() == Scope::Eden {
            return;
        }
        for string in core::iter::once(&self.empty).chain(&self.of_static_atoms) {
            // SAFETY: zero or a root.
            unsafe { visitor.append_word(string.get() as u64) };
        }
    }
}

impl JsString {
    /// Of a symbol, the description.
    #[inline(always)]
    pub fn from_name(vm: &Vm, name: PropertyName<'_>) -> Gc<JsString> {
        match name.static_atom_index() {
            Some(index) => vm.small_strings.of_static_atom(vm, index),
            None => Self::from_name_cached(vm, name),
        }
    }
}
