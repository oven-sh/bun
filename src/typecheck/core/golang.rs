// Go value semantics that the ported bodies rely on: nil-able slices, signed lengths, guarded indexing.

// `string` where a record keeps it or a function hands it on: the bytes of a source text, of an arena or of a constant.
pub type Text<'a> = &'a [u8];

pub trait GoIndex: Copy {
    fn to_index(self) -> Option<usize>;
}
impl GoIndex for usize {
    fn to_index(self) -> Option<usize> {
        Some(self)
    }
}
impl GoIndex for isize {
    fn to_index(self) -> Option<usize> {
        usize::try_from(self).ok()
    }
}
impl GoIndex for i32 {
    fn to_index(self) -> Option<usize> {
        usize::try_from(self).ok()
    }
}

// `[]T` stored in a field or passed to a function: a nil-able slice, `Copy` like a Go slice header.
#[derive(Debug)]
pub struct List<'a, T>(Option<&'a [T]>);

impl<T> Clone for List<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for List<'_, T> {}
impl<T> Default for List<'_, T> {
    fn default() -> Self {
        Self(None)
    }
}

impl<'a, T: Copy + Default> List<'a, T> {
    pub const NIL: Self = Self(None);
    pub const fn from_slice(slice: &'a [T]) -> Self {
        Self(Some(slice))
    }
    pub const fn is_nil(self) -> bool {
        self.0.is_none()
    }
    pub fn as_slice(self) -> &'a [T] {
        self.0.unwrap_or(&[])
    }
    pub fn len(self) -> isize {
        self.as_slice().len() as isize
    }
    pub fn at(self, index: impl GoIndex) -> T {
        index
            .to_index()
            .and_then(|i| self.as_slice().get(i))
            .copied()
            .unwrap_or_default()
    }
    pub fn iter(self) -> impl Iterator<Item = T> + 'a {
        self.as_slice().iter().copied()
    }
    // core.Same: same backing array and same length.
    pub fn same(self, other: Self) -> bool {
        let (a, b) = (self.as_slice(), other.as_slice());
        a.len() == b.len() && (a.is_empty() || std::ptr::eq(a.as_ptr(), b.as_ptr()))
    }
    // s[lo:hi] with Go's bounds turned into a clamp: a part of the nil list is the nil list.
    pub fn sub(self, lo: impl GoIndex, hi: impl GoIndex) -> Self {
        let Some(s) = self.0 else {
            return Self(None);
        };
        let hi = hi.to_index().unwrap_or(0).min(s.len());
        let lo = lo.to_index().unwrap_or(0).min(hi);
        Self(Some(s.get(lo..hi).unwrap_or(&[])))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_is_a_go_slice() {
        let nil = List::<u32>::NIL;
        assert!(nil.is_nil() && List::<u32>::default().is_nil() && nil.len() == 0);
        let data = [1u32, 2, 3];
        let list = List::from_slice(&data);
        assert_eq!(
            (list.len(), list.at(2usize), list.at(3), list.at(-1)),
            (3, 3, 0, 0)
        );
        assert_eq!(list.iter().collect::<Vec<_>>(), [1, 2, 3]);
        // A part of a list shares its backing array; a part of the nil list is nil.
        assert_eq!(list.sub(1, 3).as_slice(), &[2, 3]);
        assert_eq!(list.sub(-1isize, 9isize).as_slice(), &[1, 2, 3]);
        assert!(list.sub(0, 3).same(list) && !list.sub(1, 3).same(list));
        let empty = list.sub(2, 1);
        assert!(!empty.is_nil() && empty.len() == 0);
        assert!(nil.sub(0, 0).is_nil() && nil.sub(0usize, 3usize).is_nil());
        // core.Same: two empty lists are the same, nil or not.
        assert!(nil.same(List::from_slice(&[])) && empty.same(nil));
    }
}
