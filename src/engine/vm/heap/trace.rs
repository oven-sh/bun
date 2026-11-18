use super::{Gc, Visitor, delay};
use crate::{CellKind, JsCell, Value};

/// Shows the collector the cells that a value refers to. Derive it.
///
/// # Safety
/// `trace` visits every reference that has to keep its cell alive, and none of them changes without a write barrier.
/// It runs on any thread, beside scripts and beside itself, so what it writes is atomic.
pub unsafe trait Trace {
    fn trace(&self, visitor: &mut Visitor);
}

// SAFETY: the value is the reference.
unsafe impl Trace for Value {
    #[inline(always)]
    fn trace(&self, visitor: &mut Visitor) {
        visitor.append_value(*self);
    }
}

// SAFETY: as above.
unsafe impl<T: CellKind> Trace for Gc<T> {
    #[inline(always)]
    fn trace(&self, visitor: &mut Visitor) {
        visitor.append(self.cell());
    }
}

macro_rules! trace_elements {
    ($(impl<$($parameter:ident $(: $bound:path)?),* $(; const $length:ident)?> $type:ty;)*) => {$(
        // SAFETY: visits each element.
        unsafe impl<T: Trace, $($parameter $(: $bound)?,)* $(const $length: usize)?> Trace for $type {
            #[inline]
            fn trace(&self, visitor: &mut Visitor) {
                for element in self.iter() {
                    delay::of_helper(60);
                    element.trace(visitor);
                }
            }
        }
    )*};
}

trace_elements! {
    impl<> Option<T>;
    impl<> [T];
    impl<; const N> [T; N];
    impl<> Vec<T>;
    impl<> std::collections::VecDeque<T>;
    impl<S> hashbrown::HashSet<T, S>;
}

// SAFETY: visits the content.
unsafe impl<T: Trace + ?Sized> Trace for Box<T> {
    #[inline]
    fn trace(&self, visitor: &mut Visitor) {
        (**self).trace(visitor);
    }
}

// SAFETY: visits each value, and the keys have nothing to visit.
unsafe impl<K: super::GcFree, V: Trace, S> Trace for hashbrown::HashMap<K, V, S> {
    fn trace(&self, visitor: &mut Visitor) {
        for value in self.values() {
            delay::of_helper(60);
            value.trace(visitor);
        }
    }
}

// SAFETY: visits both.
unsafe impl<A: Trace, B: Trace> Trace for (A, B) {
    #[inline]
    fn trace(&self, visitor: &mut Visitor) {
        self.0.trace(visitor);
        self.1.trace(visitor);
    }
}

/// For the macros: picks `Trace` if a type has it and `GcFree` otherwise.
pub mod select_trace {
    use super::super::GcFree;
    use super::{Trace, Visitor};

    pub struct Select<'a, T>(pub &'a T);

    pub trait ViaTrace {
        fn select_trace(&self, visitor: &mut Visitor);
    }

    impl<T: Trace> ViaTrace for &Select<'_, T> {
        #[inline(always)]
        fn select_trace(&self, visitor: &mut Visitor) {
            self.0.trace(visitor);
        }
    }

    pub trait ViaGcFree {
        fn select_trace(&self, visitor: &mut Visitor);
    }

    impl<T: GcFree> ViaGcFree for Select<'_, T> {
        #[inline(always)]
        fn select_trace(&self, _: &mut Visitor) {}
    }
}

/// # Safety
/// `cell` starts with a `T`.
pub unsafe extern "C" fn visit_children_of<T: CellKind>(cell: &JsCell, visitor: &mut Visitor) {
    // SAFETY: the caller's.
    unsafe { Gc::from(cell).cast_unchecked::<T>() }.trace_fields(visitor);
}

/// # Safety
/// `cell` is a dead `T` that has not been destroyed.
pub unsafe extern "C" fn destroy<T: CellKind>(cell: *mut JsCell) {
    // SAFETY: the caller's.
    unsafe { cell.cast::<T>().drop_in_place() }
}
