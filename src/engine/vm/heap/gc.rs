use core::ops::Deref;
use core::ptr::NonNull;

use crate::{CellType, Class, ClassOps, JsCell, Shape, TypeFlags, Visitor};

/// Holds no reference to a cell, so it may be anywhere in memory.
///
/// # Safety
/// A type that implements it by hand sees to it that the collector knows of what it refers to.
pub unsafe auto trait GcFree {}

/// A reference to a cell. It keeps the cell alive from the stack or from a traced field, and from nowhere else.
#[repr(transparent)]
pub struct Gc<T>(NonNull<T>);

impl<T> !GcFree for Gc<T> {}
// SAFETY: what refers to a cell stays on its thread.
unsafe impl GcFree for bun_engine_bytecode::SharedMachineCode {}

/// A type whose values exist only as cells in the heap. `#[cell]` implements it for a struct whose first field is
/// `base`, the type it extends:
///
/// - `NameInit` has a public field for each field of `Name` and is what `Vm::allocate` takes. A `Field<T>` is given
///   as its `T`; a `TracedVec`, a `TracedMap` and a `GcCell` start empty.
/// - A `Field<T>` or `WeakField<T>` named `x` gets `x()` and `set_x()`; a container gets `x()`, a handle to it. The
///   visibility written on the field is theirs.
/// - Any other field is `Trace` or `GcFree`.
/// - `cell_type = A` or `A..=B`: these types mean this class or one that extends it. `shared_type = A`: the type of
///   the instances, which other classes have too. Without either it is that of the base.
/// - `ops`: an `#[object_ops]` block overrides internal methods. `visit_children`, `visit_output_constraints`,
///   `reconcile_weak_references`, `estimated_size`, `analyze_heap`: the type has a method of that name.
/// - `name`, `flags`, `cleared_flags`, `static_table`, `export` describe the `Class`.
///
/// # Safety
/// `repr(C)`, starts with `Base`, `trace_fields` visits every reference to a cell, and `is` holds only for cells that
/// start with a `Self`.
pub unsafe trait CellKind: Sized + 'static {
    type Base;
    type Init;

    const CLASS: &'static Class;
    const CELL_TYPE: CellType;
    const FLAGS: TypeFlags;
    const OPS: ClassOps;
    /// The cell has its class in a field, where the sweeper finds it after the shape is gone.
    const HOLDS_CLASS: bool;

    fn is(cell: &JsCell) -> bool;

    fn shape_of(init: &Self::Init) -> Gc<Shape>;

    /// # Safety
    /// `this` is a new cell of at least the size of `Self`.
    unsafe fn initialize(this: *mut Self, init: Self::Init);

    fn trace_fields(&self, visitor: &mut Visitor);
}

/// The `Init` of a type whose cells differ in size or class, so that `Vm::allocate` cannot make them.
pub enum Never {}

/// # Safety
/// Every `Self` starts with an `Ancestor`.
#[marker]
pub unsafe trait Extends<Ancestor> {}

// SAFETY: it starts with itself.
unsafe impl<T: CellKind> Extends<T> for T {}

impl<T> Gc<T> {
    /// # Safety
    /// The address of a live cell that starts with a `T`.
    #[inline(always)]
    pub unsafe fn from_address(address: usize) -> Gc<T> {
        // SAFETY: not null. The provenance of all memory of the heap is exposed.
        Gc(unsafe { NonNull::new_unchecked(core::ptr::with_exposed_provenance_mut(address)) })
    }

    #[inline(always)]
    pub fn address(self) -> usize {
        self.0.as_ptr().expose_provenance()
    }

    #[inline(always)]
    pub fn as_ptr(self) -> *mut T {
        self.0.as_ptr()
    }

    /// # Safety
    /// The cell starts with a `U`.
    #[inline(always)]
    pub unsafe fn cast_unchecked<U>(self) -> Gc<U> {
        Gc(self.0.cast())
    }

    #[inline(always)]
    pub fn upcast<U>(self) -> Gc<U>
    where
        T: Extends<U>,
    {
        Gc(self.0.cast())
    }

    /// The cell stays alive for as long as the borrow lasts, and with it what it owns outside itself: a variable whose
    /// address has escaped keeps its place on the stack until it goes out of scope.
    #[inline(always)]
    #[cfg_attr(
        rootcheck,
        rootcheck::stays("if the variable is where the collector looks")
    )]
    pub fn anchor(&self) -> &T {
        // SAFETY: no instruction.
        unsafe {
            core::arch::asm!("/* {0} */", in(reg) self, options(readonly, nostack, preserves_flags));
        }
        self
    }

    /// The cell stays alive up to here.
    #[inline(always)]
    pub fn keep_alive(self) {
        keep_alive(self.address());
    }
}

impl<T: CellKind> Gc<T> {
    #[inline(always)]
    pub fn cell(self) -> Gc<JsCell> {
        Gc(self.0.cast())
    }

    #[inline(always)]
    pub fn downcast<U: CellKind>(self) -> Option<Gc<U>> {
        U::is(&self.cell()).then(|| Gc(self.0.cast()))
    }

    /// Panics if the cell is not a `U`.
    #[inline(always)]
    #[track_caller]
    pub fn cast<U: CellKind>(self) -> Gc<U> {
        assert!(U::is(&self.cell()));
        Gc(self.0.cast())
    }
}

/// `Gc::anchor` for a `&T`, or for a `Gc<T>` that is in no variable: `let this = anchor!(self);`
#[macro_export]
#[allow_internal_unstable(super_let)]
macro_rules! anchor {
    ($cell:expr) => {{
        super let cell = $crate::Gc::from($cell);
        $crate::Gc::anchor(&cell)
    }};
}

/// Makes the compiler hold the word in a register or on the stack up to here.
#[inline(always)]
pub(crate) fn keep_alive(word: usize) {
    // SAFETY: no instruction.
    unsafe {
        core::arch::asm!("/* {0} */", in(reg) word, options(nomem, nostack, preserves_flags));
    }
}

/// Memory that a cell owns outside itself and never replaces. The cell stays alive while this is.
pub struct Held<'a, T: ?Sized> {
    owner: &'a JsCell,
    value: &'a T,
}

impl<T: ?Sized> !GcFree for Held<'_, T> {}

impl<'a, T: ?Sized> Held<'a, T> {
    #[inline(always)]
    pub fn new(owner: &'a JsCell, value: &'a T) -> Held<'a, T> {
        Held { owner, value }
    }
}

impl<T: ?Sized> Deref for Held<'_, T> {
    type Target = T;

    #[inline(always)]
    fn deref(&self) -> &T {
        self.value
    }
}

impl<T: ?Sized> Drop for Held<'_, T> {
    #[inline(always)]
    fn drop(&mut self) {
        keep_alive(self.owner.address());
    }
}

impl<T> Clone for Gc<T> {
    #[inline(always)]
    fn clone(&self) -> Gc<T> {
        *self
    }
}

impl<T> Copy for Gc<T> {}

impl<T> Deref for Gc<T> {
    type Target = T;

    #[inline(always)]
    fn deref(&self) -> &T {
        // SAFETY: the collector sees `self` or the reference, wherever the rules allow them to be.
        unsafe { self.0.as_ref() }
    }
}

impl<T: CellKind> From<&T> for Gc<T> {
    #[inline(always)]
    fn from(cell: &T) -> Gc<T> {
        // SAFETY: no `T` exists outside the heap.
        unsafe { Gc::from_address(core::ptr::from_ref(cell).expose_provenance()) }
    }
}

impl<T, U> PartialEq<Gc<U>> for Gc<T> {
    #[inline(always)]
    fn eq(&self, other: &Gc<U>) -> bool {
        self.0.addr() == other.0.addr()
    }
}

impl<T> Eq for Gc<T> {}

impl<T> core::hash::Hash for Gc<T> {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        state.write_usize(self.0.addr().get());
    }
}

impl<T: CellKind> core::fmt::Debug for Gc<T> {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let name = self.cell().class().name();
        write!(formatter, "{name}@{:#x}", self.address())
    }
}
