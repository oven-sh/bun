// SCRATCH STAND-IN, not delivered: List, Text and GoIndex of the research contract (tscore/golang.rs), which sibling code imports from crate::core.
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
}
