//! Changes that last until the end of a scope.

use core::cell::Cell;
use core::ops::{Deref, DerefMut};

/// `&mut T`, with a field that gets its value back on drop.
#[must_use]
pub struct SetForScope<'a, T, V, F: Fn(&mut T) -> &mut V> {
    target: &'a mut T,
    field: F,
    saved: V,
}

impl<'a, T, V, F: Fn(&mut T) -> &mut V> SetForScope<'a, T, V, F> {
    pub fn new(target: &'a mut T, field: F, value: V) -> Self {
        let saved = core::mem::replace(field(target), value);
        Self {
            target,
            field,
            saved,
        }
    }

    /// For a field that the scope sets later, or not at all.
    pub fn saving(target: &'a mut T, field: F) -> Self
    where
        V: Copy,
    {
        let saved = *field(target);
        Self {
            target,
            field,
            saved,
        }
    }
}

impl<T, V, F: Fn(&mut T) -> &mut V> Deref for SetForScope<'_, T, V, F> {
    type Target = T;
    fn deref(&self) -> &T {
        self.target
    }
}

impl<T, V, F: Fn(&mut T) -> &mut V> DerefMut for SetForScope<'_, T, V, F> {
    fn deref_mut(&mut self) -> &mut T {
        self.target
    }
}

impl<T, V, F: Fn(&mut T) -> &mut V> Drop for SetForScope<'_, T, V, F> {
    fn drop(&mut self) {
        core::mem::swap((self.field)(self.target), &mut self.saved);
    }
}

/// Stores a value in a cell on drop.
#[must_use]
pub struct SetOnDrop<'a, T: Copy> {
    cell: &'a Cell<T>,
    value: T,
}

impl<T: Copy> Drop for SetOnDrop<'_, T> {
    fn drop(&mut self) {
        self.cell.set(self.value);
    }
}

pub trait ScopedCell<T: Copy> {
    /// The cell gets its value back on drop.
    fn set_for_scope(&self, value: T) -> SetOnDrop<'_, T>;
}

impl<T: Copy> ScopedCell<T> for Cell<T> {
    fn set_for_scope(&self, value: T) -> SetOnDrop<'_, T> {
        SetOnDrop {
            cell: self,
            value: self.replace(value),
        }
    }
}

pub trait ScopedFlag {
    /// `true` now and `false` on drop, whatever it was.
    fn raise_for_scope(&self) -> SetOnDrop<'_, bool>;
}

impl ScopedFlag for Cell<bool> {
    fn raise_for_scope(&self) -> SetOnDrop<'_, bool> {
        self.set(true);
        SetOnDrop {
            cell: self,
            value: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_field_gets_its_value_back_on_every_exit() {
        struct Parser {
            path: Vec<u8>,
            depth: u32,
        }
        fn descend(parser: &mut Parser, fails_at: u32) -> Result<(), u32> {
            let depth = parser.depth + 1;
            let mut deeper = SetForScope::new(parser, |parser| &mut parser.depth, depth);
            let mut parser = SetForScope::new(&mut *deeper, |parser| &mut parser.path, Vec::new());
            assert!(parser.path.is_empty());
            parser.path.push(b'x');
            if parser.depth == fails_at {
                return Err(parser.depth);
            }
            descend(&mut parser, fails_at)?;
            unreachable!()
        }

        let mut parser = Parser {
            path: b"root".to_vec(),
            depth: 0,
        };
        assert_eq!(descend(&mut parser, 3), Err(3));
        assert_eq!((&parser.path[..], parser.depth), (&b"root"[..], 0));

        {
            let mut parser = SetForScope::saving(&mut parser, |parser| &mut parser.depth);
            assert_eq!(parser.depth, 0);
            parser.depth = 7;
        }
        assert_eq!(parser.depth, 0);
    }

    #[test]
    fn cells() {
        let flag = Cell::new(true);
        {
            let _lowered = flag.set_for_scope(false);
            assert!(!flag.get());
        }
        assert!(flag.get());
        {
            let _raised = flag.raise_for_scope();
            assert!(flag.get());
        }
        assert!(!flag.get());
    }
}
