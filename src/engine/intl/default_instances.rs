use core::cell::{OnceCell, RefCell};

use bun_engine_text::{StringImpl, StringRef};

use crate::cache::{is_worth_keeping, keep};
use crate::{Cache, LanguageTag, Result};

/// What a locale-sensitive method constructs when it gets no options: one for no locale, one for the last locale.
pub(crate) struct DefaultInstances<T> {
    without_locale: OnceCell<T>,
    last: RefCell<Option<(StringRef, T)>>,
}

impl<T> Default for DefaultInstances<T> {
    fn default() -> DefaultInstances<T> {
        DefaultInstances {
            without_locale: OnceCell::new(),
            last: RefCell::new(None),
        }
    }
}

impl<T> DefaultInstances<T> {
    #[inline(always)]
    pub(crate) fn with<R>(
        &self,
        cache: &Cache,
        locale: Option<&StringImpl>,
        construct: impl FnOnce(&[LanguageTag]) -> Result<T>,
        call: impl FnOnce(&T) -> Result<R>,
    ) -> Result<R> {
        match locale {
            Some(locale) => self.with_locale(cache, locale, construct, call),
            None => call(self.without_locale.get_or_try_init(|| construct(&[]))?),
        }
    }

    fn with_locale<R>(
        &self,
        cache: &Cache,
        locale: &StringImpl,
        construct: impl FnOnce(&[LanguageTag]) -> Result<T>,
        call: impl FnOnce(&T) -> Result<R>,
    ) -> Result<R> {
        let mut last = self.last.borrow_mut();
        match &mut *last {
            Some((written, instance)) if **written == *locale => call(instance),
            other => {
                let instance = construct(&[cache.canonicalize(locale)?])?;
                match is_worth_keeping(locale) {
                    true => call(&other.insert((keep(locale), instance)).1),
                    false => call(&instance),
                }
            }
        }
    }
}
