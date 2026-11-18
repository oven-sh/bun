use core::cell::{Cell, RefCell};
use core::sync::atomic::{AtomicU32, Ordering};
use std::rc::Rc;

use bun_engine_text::{SharedString, StringRef, Text};
use bun_engine_vm::{ErrorType, JsCell, Thrown, TypeFlags};
use bun_threading::Guarded;

use super::prelude::*;
use crate::{Cache, Error, ErrorKind, Result};

static PREFERRED_LANGUAGES: Guarded<Vec<SharedString>> = Guarded::new(Vec::new());
static LANGUAGE_CHANGES: AtomicU32 = AtomicU32::new(0);

/// In place of the language of the host, for the whole process. Other threads notice at their next call.
pub fn set_preferred_languages(cx: &Cx, languages: &[Text<'_>]) {
    let share = |&language| StringRef::to_shared(&StringRef::from_text(language));
    *PREFERRED_LANGUAGES.lock() = languages.iter().map(share).collect();
    LANGUAGE_CHANGES.fetch_add(1, Ordering::Relaxed);
    let state = cx.intl_state().cast::<State>();
    state.shared.follow_language_change();
}

#[derive(Default)]
struct SharedCache {
    cache: RefCell<Cache>,
    seen_language_changes: Cell<u32>,
    has_own_language: bool,
}

impl SharedCache {
    #[cold]
    fn follow_language_change(&self) {
        (self.seen_language_changes).set(LANGUAGE_CHANGES.load(Ordering::Relaxed));
        if !self.has_own_language {
            let languages = PREFERRED_LANGUAGES.lock();
            let languages: Vec<_> = languages.iter().map(|it| it.text()).collect();
            self.cache.borrow_mut().set_preferred_languages(&languages);
        }
    }
}

/// The realms that have no language of their own share the cache of the `Vm`.
#[cell(flags = TypeFlags::SHAPE_IS_IMMORTAL)]
struct State {
    base: JsCell,
    shared: Rc<SharedCache>,
}

pub(super) fn initialize(cx: &Cx) {
    let language = (cx.global().hooks().default_language)();
    let shared = if language.is_empty() {
        cx.extension::<SharedCache>()
    } else {
        let mut cache = Cache::default();
        cache.set_preferred_languages(&[language.text()]);
        Rc::new(SharedCache {
            cache: RefCell::new(cache),
            seen_language_changes: Cell::new(0),
            has_own_language: true,
        })
    };
    let base = cx.shape_for::<State>();
    let state = cx.allocate::<State>(StateInit { base, shared });
    cx.global().init_intl_state(state.cell());
}

#[inline(always)]
pub(super) fn with_cache<T>(cx: &Cx, call: impl FnOnce(&Cache) -> Result<T>) -> JsResult<T> {
    let state = cx.intl_state().cast::<State>();
    let shared = &state.anchor().shared;
    if shared.seen_language_changes.get() != LANGUAGE_CHANGES.load(Ordering::Relaxed) {
        shared.follow_language_change();
    }
    let cache = shared.cache.borrow();
    let result = call(&cache);
    let allocated_bytes = cache.take_allocated_bytes();
    drop(cache);
    if allocated_bytes != 0 {
        cx.heap.report_untracked_extra_memory(allocated_bytes);
    }
    result.or_throw(cx)
}

pub(super) trait OrThrow<T> {
    fn or_throw(self, cx: &Cx) -> JsResult<T>;
}

impl<T> OrThrow<T> for Result<T> {
    #[inline(always)]
    fn or_throw(self, cx: &Cx) -> JsResult<T> {
        self.map_err(|error| throw(cx, &error))
    }
}

#[cold]
pub(super) fn throw(cx: &Cx, error: &Error) -> Thrown {
    match error.kind() {
        ErrorKind::Error => cx.throw_error(ErrorType::Error, error.message()),
        ErrorKind::RangeError => cx.throw_range_error(error.message()),
        ErrorKind::TypeError => cx.throw_type_error(error.message()),
        ErrorKind::OutOfMemory => cx.throw_out_of_memory(),
        ErrorKind::Interruption => cx.throw_termination(),
    }
}
