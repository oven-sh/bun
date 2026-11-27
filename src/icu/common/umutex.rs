//! Process-wide state. Under a `Mutex`: look up, insert or remove, and take no second one, but to load time zone names.

use crate::common::memory::try_box;
pub(crate) use crate::common::static_map::StaticMap;
use crate::common::utypes::UErrorCode;
pub(crate) use crate::sys::ptr::AtomicRef;
pub(crate) use bun_core::Mutex;
use std::sync::OnceLock;

/// A lazily initialized `static`. Racing threads each run `init`, without a lock, and the first to finish wins.
pub(crate) struct OnceBox<T>(OnceLock<Box<T>>);

impl<T> OnceBox<T> {
    pub(crate) const fn new() -> Self {
        Self(OnceLock::new())
    }

    #[inline]
    pub(crate) fn get(&self) -> Option<&T> {
        self.0.get().map(|value| &**value)
    }

    /// Returns the value, or stores the result of `init`. Stores nothing if `init` fails or the OOM flag is set.
    #[inline]
    pub(crate) fn get_or_try_init(
        &self,
        init: impl FnOnce() -> Result<T, UErrorCode>,
    ) -> Result<&T, UErrorCode> {
        self.get().map_or_else(|| self.initialize(init), Ok)
    }

    #[cold]
    #[inline(never)]
    fn initialize(&self, init: impl FnOnce() -> Result<T, UErrorCode>) -> Result<&T, UErrorCode> {
        let value = try_box(init()?)?;
        Ok(self.0.get_or_init(|| value))
    }
}

impl<T> OnceBox<Result<T, UErrorCode>> {
    /// Like `get_or_try_init`, but stores an error of `init` too.
    #[inline]
    pub(crate) fn get_or_init_caching_err(
        &self,
        init: impl FnOnce() -> Result<T, UErrorCode>,
    ) -> Result<&T, UErrorCode> {
        self.get_or_try_init(|| Ok(init()))?
            .as_ref()
            .map_err(|code| *code)
    }
}
