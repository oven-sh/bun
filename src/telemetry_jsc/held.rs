use bun_jsc::bindgen::StrongWrapper;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_ptr::JsCell;
use bun_removable_features::{removable_body_behind_value, removable_definition};
use bun_telemetry::{Record, SpanData};

use crate::engine::Entered;
use crate::outcome::{Outcome, Thrown};
use crate::promise;
use crate::span::Span;
use crate::state::VmState;

/// The span of an event that script handles: it is the active one in the handler, and native code ends it. One
/// word, null while tracing is off. The first end counts. Dropped, it is not exported.
#[derive(Default)]
pub struct HeldSpan(JsCell<Option<StrongWrapper<Span>>>);

/// Keeps a [`HeldSpan`] active until it drops.
pub struct Active<'a>(Option<Entered<'a>>);

impl Active<'_> {
    /// What to call in the place of a `callback` that went through `with_async_context_if_needed`, which would
    /// replace the async context.
    #[inline(always)]
    pub fn adopt(&self, callback: JSValue) -> JSValue {
        self.0.as_ref().map_or(callback, |e| e.adopt(callback))
    }
}

impl HeldSpan {
    pub(crate) fn new(global: &JSGlobalObject, data: SpanData) -> HeldSpan {
        HeldSpan(JsCell::new(Some(Span::create_held(global, data))))
    }

    /// `None` too once the VM has let go of its objects.
    #[inline(always)]
    fn get(&self) -> Option<&StrongWrapper<Span>> {
        (self.0.get().as_ref()).filter(|_| VmState::current().is_some())
    }

    #[inline(always)]
    pub(crate) fn is_some(&self) -> bool {
        self.0.get().is_some()
    }

    #[inline(always)]
    pub fn take(&self) -> HeldSpan {
        HeldSpan(JsCell::new(self.0.take()))
    }

    #[inline(always)]
    pub fn enter<'a>(&self, global: &'a JSGlobalObject) -> Active<'a> {
        Active((self.0.get().as_ref()).map(|span| Entered::new(global, Some(span.to_js()))))
    }

    /// `f` runs no script.
    #[inline(always)]
    pub fn describe(&self, f: impl FnOnce(&mut Record)) {
        if self.0.get().is_some() {
            removable_body_behind_value!(Telemetry, {
                if let Some(span) = self.get() {
                    span.payload().record(f);
                }
            });
        }
    }

    /// `error` is a thrown value or its `Exception`, on its way to script.
    #[inline(always)]
    pub fn fail(&self, global: &JSGlobalObject, error: JSValue) {
        self.describe(|r| Thrown(global, error).record(r));
    }

    #[inline(always)]
    pub fn end(&self) {
        if self.0.get().is_some() {
            self.end_started();
        }
    }

    #[inline(never)]
    fn end_started(&self) {
        removable_definition!(Telemetry, HeldSpan::end_started);
        if let Some(span) = self.take().get() {
            span.payload().finish(span.global(), span.to_js(), 0);
        }
    }

    pub(crate) fn has_ended(&self) -> bool {
        self.get().is_none_or(|span| span.payload().get_ended())
    }

    /// Ends the span now, or when the promise that the handler returned settles.
    #[inline(always)]
    pub fn end_with_result(&self, global: &JSGlobalObject, result: JSValue) {
        if self.0.get().is_some() {
            self.end_started_with_result(global, result);
        }
    }

    #[inline(never)]
    fn end_started_with_result(&self, global: &JSGlobalObject, result: JSValue) {
        removable_definition!(Telemetry, HeldSpan::end_started_with_result);
        if let Some(span) = self.get() {
            promise::end_with_value(global, span.to_js(), result);
        }
    }
}
