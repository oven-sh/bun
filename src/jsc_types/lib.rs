#![allow(dead_code)]

use core::fmt;

/// VM-lifetime handle to a JSC-owned global object.
///
/// This is only pointer identity. The concrete JSC crate supplies the typed
/// alias (`bun_jsc::GlobalRef = GlobalRef<JSGlobalObject>`) and keeps all
/// effectful operations on `JSGlobalObject` itself.
#[repr(transparent)]
pub struct GlobalRef<T = ()>(*const T);

impl<T> Copy for GlobalRef<T> {}

impl<T> Clone for GlobalRef<T> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> GlobalRef<T> {
    #[inline(always)]
    pub fn new(global: &T) -> Self {
        Self(core::ptr::from_ref(global))
    }

    /// Raw FFI pointer.
    #[inline(always)]
    pub fn as_ptr(self) -> *mut T {
        self.0.cast_mut()
    }

    #[inline(always)]
    pub fn cast<U>(self) -> GlobalRef<U> {
        GlobalRef(self.0.cast::<U>())
    }
}

impl<T> core::ops::Deref for GlobalRef<T> {
    type Target = T;

    #[inline(always)]
    fn deref(&self) -> &T {
        // SAFETY: constructed only from a live `&T`; callers uphold that the
        // referenced JSC object outlives every stored handle.
        unsafe { &*self.0 }
    }
}

impl<T> From<&T> for GlobalRef<T> {
    #[inline(always)]
    fn from(global: &T) -> Self {
        Self::new(global)
    }
}

impl<T> fmt::Debug for GlobalRef<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("GlobalRef").field(&self.0).finish()
    }
}
