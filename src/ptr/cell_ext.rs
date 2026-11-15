use core::cell::Cell;
use core::mem::ManuallyDrop;
use std::collections::VecDeque;

use crate::{RefCounted, RefPtr};

pub trait CellExt<T> {
    /// The cell holds `T::default()` while `f` runs, and what is stored in it meanwhile is dropped.
    fn with_taken<R>(&self, f: impl FnOnce(&mut T) -> R) -> R;

    /// `set` after a `take()`, without the drop glue of `T`: what was stored meanwhile is leaked.
    fn put_back(&self, value: T);
}

impl<T: Default> CellExt<T> for Cell<T> {
    fn with_taken<R>(&self, f: impl FnOnce(&mut T) -> R) -> R {
        let mut value = self.take();
        let result = f(&mut value);
        self.set(value);
        result
    }

    fn put_back(&self, value: T) {
        let _default = ManuallyDrop::new(self.replace(value));
    }
}

pub trait OptionCellExt {
    /// One load, where `with_taken` copies a large `T` out and back.
    fn is_some(&self) -> bool;

    fn is_none(&self) -> bool {
        !self.is_some()
    }
}

impl<T> OptionCellExt for Cell<Option<T>> {
    fn is_some(&self) -> bool {
        let value = self.take();
        let is_some = value.is_some();
        self.put_back(value);
        is_some
    }
}

/// Reads and changes the `Vec` without the copies and the drop glue of `with_taken`.
pub trait VecCellExt<T> {
    fn len(&self) -> usize;

    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn capacity(&self) -> usize;

    fn push(&self, value: T);

    fn pop(&self) -> Option<T>;

    fn extend_from_slice(&self, values: &[T])
    where
        T: Copy;

    fn clear(&self)
    where
        T: Copy;
}

impl<T> VecCellExt<T> for Cell<Vec<T>> {
    fn len(&self) -> usize {
        // SAFETY: a shared `Cell` lends no reference to its value.
        unsafe { &*self.as_ptr() }.len()
    }

    fn capacity(&self) -> usize {
        // SAFETY: as in `len`.
        unsafe { &*self.as_ptr() }.capacity()
    }

    fn push(&self, value: T) {
        loop {
            // SAFETY: as in `len`, and with spare capacity `push` only moves a `T`.
            let vec = unsafe { &mut *self.as_ptr() };
            if vec.len() < vec.capacity() {
                return vec.push(value);
            }
            reserve_vec(self, 1);
        }
    }

    fn pop(&self) -> Option<T> {
        // SAFETY: as in `len`, and `pop` only moves a `T`.
        unsafe { &mut *self.as_ptr() }.pop()
    }

    fn extend_from_slice(&self, values: &[T])
    where
        T: Copy,
    {
        loop {
            // SAFETY: as in `len`, and the new length covers what was just written.
            unsafe {
                let vec = &mut *self.as_ptr();
                if let Some(spare) = vec.spare_capacity_mut().get_mut(..values.len()) {
                    spare.write_copy_of_slice(values);
                    return vec.set_len(vec.len() + values.len());
                }
            }
            reserve_vec(self, values.len());
        }
    }

    fn clear(&self)
    where
        T: Copy,
    {
        // SAFETY: as in `len`, and a `Copy` `T` has no drop glue.
        unsafe { &mut *self.as_ptr() }.clear();
    }
}

/// Taken, because the panic hook runs if this fails.
#[cold]
fn reserve_vec<T>(cell: &Cell<Vec<T>>, additional: usize) {
    cell.with_taken(|vec| vec.reserve(additional));
}

/// As [`VecCellExt`].
pub trait VecDequeCellExt<T> {
    fn len(&self) -> usize;

    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn push_back(&self, value: T);

    fn push_front(&self, value: T);

    fn pop_front(&self) -> Option<T>;
}

impl<T> VecDequeCellExt<T> for Cell<VecDeque<T>> {
    fn len(&self) -> usize {
        // SAFETY: a shared `Cell` lends no reference to its value.
        unsafe { &*self.as_ptr() }.len()
    }

    fn push_back(&self, value: T) {
        loop {
            // SAFETY: as in `len`, and with spare capacity `push_back` only moves a `T`.
            let deque = unsafe { &mut *self.as_ptr() };
            if deque.len() < deque.capacity() {
                return deque.push_back(value);
            }
            reserve_vec_deque(self, 1);
        }
    }

    fn push_front(&self, value: T) {
        loop {
            // SAFETY: as in `len`, and with spare capacity `push_front` only moves a `T`.
            let deque = unsafe { &mut *self.as_ptr() };
            if deque.len() < deque.capacity() {
                return deque.push_front(value);
            }
            reserve_vec_deque(self, 1);
        }
    }

    fn pop_front(&self) -> Option<T> {
        // SAFETY: as in `len`, and `pop_front` only moves a `T`.
        unsafe { &mut *self.as_ptr() }.pop_front()
    }
}

/// As [`reserve_vec`].
#[cold]
fn reserve_vec_deque<T>(cell: &Cell<VecDeque<T>>, additional: usize) {
    cell.with_taken(|deque| deque.reserve(additional));
}

pub trait RefPtrDequeCellExt<T: RefCounted> {
    /// As `get(index).cloned()`.
    fn get_cloned(&self, index: usize) -> Option<RefPtr<T>>;
}

impl<T: RefCounted> RefPtrDequeCellExt<T> for Cell<VecDeque<RefPtr<T>>> {
    fn get_cloned(&self, index: usize) -> Option<RefPtr<T>> {
        // SAFETY: a shared `Cell` lends no reference to its value, and this one ends before `T::did_ref` runs.
        let ptr = unsafe { &*self.as_ptr() }.get(index)?.as_ptr();
        // SAFETY: the deque still holds its ref.
        Some(unsafe { RefPtr::init_ref(ptr) })
    }
}

pub trait PairDequeCellExt<A: Copy> {
    /// As `get(index).map(|&(first, _)| first)`.
    fn get_first(&self, index: usize) -> Option<A>;
}

impl<A: Copy, B> PairDequeCellExt<A> for Cell<VecDeque<(A, B)>> {
    fn get_first(&self, index: usize) -> Option<A> {
        // SAFETY: a shared `Cell` lends no reference to its value, and copying an `A` runs no code.
        unsafe { &*self.as_ptr() }
            .get(index)
            .map(|&(first, _)| first)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;

    #[test]
    fn put_back_drops_nothing() {
        struct Panics;
        impl Drop for Panics {
            fn drop(&mut self) {
                unreachable!()
            }
        }
        let cell = Cell::new(None);
        let taken = cell.take();
        cell.put_back(Some(Panics));
        cell.put_back(taken);
        assert!(cell.is_none());
    }

    #[test]
    fn is_some_leaves_the_value() {
        let counted = Rc::new(());
        let cell = Cell::new(Some(Rc::clone(&counted)));
        assert!(cell.is_some());
        assert_eq!(Rc::strong_count(&counted), 2);
        cell.set(None);
        assert!(cell.is_none());
        assert_eq!(Rc::strong_count(&counted), 1);
    }

    #[test]
    fn vec_changes_in_place() {
        let cell = Cell::new(Vec::new());
        assert!(cell.is_empty());
        cell.push(1u8);
        cell.extend_from_slice(&[2, 3]);
        assert_eq!(cell.pop(), Some(3));
        assert_eq!(cell.len(), 2);
        assert!(cell.capacity() >= 3);
        assert_eq!(cell.take(), [1, 2]);
    }

    #[test]
    fn clear_keeps_the_capacity() {
        let cell = Cell::new(vec![1u8, 2, 3]);
        cell.clear();
        assert!(cell.is_empty());
        assert!(cell.capacity() >= 3);
    }

    #[test]
    fn vec_deque_changes_in_place() {
        let cell = Cell::new(VecDeque::new());
        assert!(cell.is_empty());
        cell.push_front(Box::new(2));
        cell.push_back(Box::new(3));
        cell.push_front(Box::new(1));
        assert_eq!(cell.len(), 3);
        assert_eq!(cell.pop_front(), Some(Box::new(1)));
        assert_eq!(cell.take(), [Box::new(2), Box::new(3)]);
    }

    #[test]
    fn did_ref_can_change_the_deque_under_get_cloned() {
        #[derive(crate::RefCounted)]
        #[ref_count(did_ref = Self::leave)]
        struct Item {
            ref_count: crate::RefCount,
            queue: Rc<Cell<VecDeque<RefPtr<Item>>>>,
        }
        impl Item {
            fn leave(this: &RefPtr<Self>) {
                drop(this.queue.take());
            }
        }
        let queue = Rc::new(Cell::new(VecDeque::new()));
        queue.push_back(RefPtr::new(Item {
            ref_count: crate::RefCount::init(),
            queue: Rc::clone(&queue),
        }));
        assert!(queue.get_cloned(1).is_none());
        let item = queue.get_cloned(0).unwrap();
        assert!(RefPtr::has_one_ref(&item));
        assert!(queue.is_empty());
    }

    #[test]
    fn get_first_leaves_the_pair() {
        let cell = Cell::new(VecDeque::from([(1, Box::new(2))]));
        assert_eq!(cell.get_first(0), Some(1));
        assert_eq!(cell.get_first(1), None);
        assert_eq!(cell.pop_front(), Some((1, Box::new(2))));
    }

    #[test]
    fn extend_from_slice_does_not_call_clone() {
        #[derive(Copy)]
        struct Panics;
        impl Clone for Panics {
            fn clone(&self) -> Self {
                unreachable!()
            }
        }
        let cell = Cell::new(Vec::new());
        cell.extend_from_slice(&[Panics, Panics]);
        assert_eq!(cell.len(), 2);
    }

    #[test]
    fn the_panic_hook_can_use_a_cell_that_cannot_grow() {
        thread_local!(static FULL: Cell<Vec<()>> = const { Cell::new(Vec::new()) });
        FULL.set(vec![(); usize::MAX]);
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| drop(FULL.take())));
        let result = std::panic::catch_unwind(|| FULL.with(|cell| cell.push(())));
        std::panic::set_hook(previous);
        assert!(result.is_err());
    }
}
