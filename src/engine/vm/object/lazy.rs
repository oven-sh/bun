//! Fields that are filled when they are first read. C++ has the same.

use core::marker::PhantomData;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_engine_macros::FieldOffsets;

use crate::{CellKind, Field, Gc, GcFree, JsCell, JsObject, Shape, Trace, Visitor, Vm};

#[repr(C)]
struct Initializer<'a> {
    vm: &'a Vm,
    owner: &'a JsCell,
    field: &'a AtomicUsize,
}

type Initialize = unsafe extern "C" fn(&Initializer<'_>) -> Option<Gc<JsCell>>;

/// The address of a cell or, with the low bit, that of a pointer to the function that makes it.
#[repr(transparent)]
pub struct LazyField<T>(AtomicUsize, PhantomData<T>);

impl<T> !GcFree for LazyField<T> {}

const IS_LAZY: usize = 1;
const TAGS: usize = 3;

impl LazyField<JsCell> {
    /// # Safety
    /// The object has such a field there.
    #[cfg_attr(rootcheck, rootcheck::stays("points into the cell"))]
    pub(crate) unsafe fn at(object: &JsObject, offset: usize) -> &LazyField<JsCell> {
        // SAFETY: the caller's.
        unsafe { &*core::ptr::with_exposed_provenance(object.address() + offset) }
    }
}

impl<T: CellKind> LazyField<T> {
    pub(crate) fn get(&self, vm: &Vm, owner: &JsCell) -> Option<Gc<T>> {
        let word = self.0.load(Ordering::Relaxed);
        // SAFETY: the tag says which it is, and the function makes a `T`.
        unsafe {
            if word & IS_LAZY == 0 {
                return (word != 0).then(|| Gc::from_address(word));
            }
            let initialize = *core::ptr::with_exposed_provenance::<Initialize>(word & !TAGS);
            let field = &self.0;
            initialize(&Initializer { vm, owner, field }).map(|cell| cell.cast_unchecked())
        }
    }
}

// SAFETY: whoever stores the cell runs the barrier.
unsafe impl<T> Trace for LazyField<T> {
    fn trace(&self, visitor: &mut Visitor) {
        let word = self.0.load(Ordering::Relaxed);
        if word & IS_LAZY == 0 {
            // SAFETY: zero or a cell that the owner keeps alive.
            unsafe { visitor.append_word(word as u64) };
        }
    }
}

#[derive(FieldOffsets)]
#[repr(C)]
pub struct LazyClass {
    shape: LazyField<Shape>,
    constructor: Field<Option<Gc<JsObject>>>,
}

impl LazyClass {
    /// # Safety
    /// The object has such a field there.
    #[cfg_attr(rootcheck, rootcheck::stays("points into the cell"))]
    pub(crate) unsafe fn at(object: &JsObject, offset: usize) -> &LazyClass {
        // SAFETY: the caller's.
        unsafe { &*core::ptr::with_exposed_provenance(object.address() + offset) }
    }

    pub(crate) fn constructor(&self, vm: &Vm, owner: &JsCell) -> Option<Gc<JsObject>> {
        self.shape.get(vm, owner);
        self.constructor.get()
    }
}
