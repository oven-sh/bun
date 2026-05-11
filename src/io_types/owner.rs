use core::fmt;
use core::hash::{Hash, Hasher};
use core::marker::PhantomData;
use core::num::NonZeroUsize;

pub struct OwnerToken<T> {
    id: NonZeroUsize,
    _marker: PhantomData<fn() -> T>,
}

impl<T> OwnerToken<T> {
    #[inline]
    pub const fn from_nonzero(id: NonZeroUsize) -> Self {
        Self {
            id,
            _marker: PhantomData,
        }
    }

    #[inline]
    pub const fn from_usize(id: usize) -> Option<Self> {
        match NonZeroUsize::new(id) {
            Some(id) => Some(Self::from_nonzero(id)),
            None => None,
        }
    }

    #[inline]
    pub const fn get(self) -> usize {
        self.id.get()
    }
}

impl<T> Copy for OwnerToken<T> {}

impl<T> Clone for OwnerToken<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> PartialEq for OwnerToken<T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl<T> Eq for OwnerToken<T> {}

impl<T> Hash for OwnerToken<T> {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}

impl<T> fmt::Debug for OwnerToken<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("OwnerToken").field(&self.id).finish()
    }
}
