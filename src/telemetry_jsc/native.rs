use bun_jsc::JSGlobalObject;
use bun_ptr::JsCell;
use bun_removable_features::{removable_body_behind_value, removable_definition};
use bun_telemetry::{Instrument, Record, SpanContext, SpanData, SpanKind, SpanStub, clock};

use crate::context::{self, Binding, Parent};
use crate::outcome::Outcome;
use crate::state::VmState;

/// `None` if `instrument` starts no span there.
#[optimize(speed)]
pub(crate) fn parent_for(instrument: Instrument, binding: &Binding<'_>) -> Option<Parent> {
    if binding.suppresses_tracing() {
        return None;
    }
    let parent = binding.parent();
    (parent.ctx.is_some() || bun_telemetry::allows_root(instrument)).then_some(parent)
}

#[optimize(speed)]
pub(crate) fn start_under(
    global: &JSGlobalObject,
    parent: Parent,
    instrument: Instrument,
    kind: SpanKind,
) -> Option<SpanData> {
    let stub = SpanStub::start(
        &mut VmState::get(global)?.local().rng,
        parent.ctx.as_ref(),
        &bun_telemetry::sampler(),
        instrument.into(),
        kind,
        clock::now_unix_nanos(),
    );
    Some(SpanData::new(stub, parent.carried))
}

/// Under the active span. `None` unless it records: it has no child to pass its ids on to.
#[inline(never)]
#[optimize(speed)]
pub(crate) fn start_leaf(
    global: &JSGlobalObject,
    instrument: Instrument,
    kind: SpanKind,
) -> Option<SpanData> {
    parent_for(instrument, &Binding::of(&context::active_binding(global)))
        .and_then(|parent| start_under(global, parent, instrument, kind))
        .filter(SpanData::is_recording)
}

#[inline]
#[optimize(speed)]
pub(crate) fn end(data: &mut SpanData, name: &[u8], end_ns: u64) {
    match VmState::current() {
        Some(state) if data.is_recording() => {
            data.end(&mut state.local().records, name, end_ns);
            state.did_record();
        }
        _ => data.discard(),
    }
}

#[optimize(speed)]
pub(crate) fn active_span_context(global: &JSGlobalObject) -> Option<SpanContext> {
    Binding::of(&context::active_binding(global)).parent().ctx
}

struct Started {
    data: SpanData,
    /// 0 until [`NativeSpan::stop_clock`].
    end_ns: u64,
}

impl Started {
    #[inline(never)]
    #[optimize(speed)]
    fn record(&mut self) -> Option<&mut Record> {
        self.data.record_mut(VmState::take_record)
    }

    #[inline(never)]
    #[allow(clippy::boxed_local, reason = "freed here and not at every call site")]
    #[optimize(speed)]
    fn end(mut self: Box<Self>) {
        removable_definition!(Telemetry, Started::end);
        end(&mut self.data, b"", self.end_ns);
    }
}

/// The span of an operation that runs no script under it. One word, null unless it records. It may travel to
/// another thread and back. Dropped, it is not exported.
#[derive(Default)]
#[repr(transparent)]
pub struct NativeSpan(Option<Box<Started>>);

impl NativeSpan {
    pub const NONE: NativeSpan = NativeSpan(None);

    #[inline(always)]
    pub fn start(
        global: &JSGlobalObject,
        instrument: Instrument,
        kind: SpanKind,
        describe: impl FnOnce(&mut Record),
    ) -> NativeSpan {
        if !bun_telemetry::enabled(instrument) {
            return NativeSpan::NONE;
        }
        removable_body_behind_value!(Telemetry, {
            let Some(data) = start_leaf(global, instrument, kind) else {
                return NativeSpan::NONE;
            };
            let mut started = Box::new(Started { data, end_ns: 0 });
            if let Some(record) = started.record() {
                describe(record);
            }
            NativeSpan(Some(started))
        })
    }

    pub(crate) fn if_recording(data: SpanData) -> NativeSpan {
        NativeSpan((data.is_recording()).then(|| Box::new(Started { data, end_ns: 0 })))
    }

    #[inline(always)]
    pub fn is_some(&self) -> bool {
        self.0.is_some()
    }

    /// For the thread that did the work, so that the way back to the event loop does not count.
    #[inline(always)]
    pub fn stop_clock(&mut self) {
        if let Some(started) = &mut self.0 {
            started.end_ns = removable_body_behind_value!(Telemetry, { clock::now_unix_nanos() });
        }
    }

    #[inline(always)]
    pub fn describe(&mut self, f: impl FnOnce(&mut Record)) {
        if let Some(started) = &mut self.0 {
            removable_body_behind_value!(Telemetry, {
                if let Some(record) = started.record() {
                    f(record);
                }
            });
        }
    }

    #[inline(always)]
    pub fn end(self) {
        if let Some(started) = self.0 {
            started.end();
        }
    }

    #[inline(always)]
    pub fn end_with(self, f: impl FnOnce(&mut Record)) {
        if let Some(mut started) = self.0 {
            removable_body_behind_value!(Telemetry, {
                if let Some(record) = started.record() {
                    f(record);
                }
                started.end();
            });
        }
    }

    /// With an error of any kind, or a `Result` or `Option` of one.
    #[inline(always)]
    pub fn settle(self, outcome: impl Outcome) {
        self.end_with(|r| outcome.record(r));
    }
}

/// A [`NativeSpan`] in a struct whose methods take `&self`. The first end counts.
#[derive(Default)]
pub struct SpanCell(JsCell<NativeSpan>);

impl From<NativeSpan> for SpanCell {
    #[inline(always)]
    fn from(span: NativeSpan) -> SpanCell {
        SpanCell(JsCell::new(span))
    }
}

impl SpanCell {
    /// The span it held is not exported.
    #[inline(always)]
    pub fn set(&self, span: NativeSpan) {
        if span.is_some() || self.0.get().is_some() {
            self.0.set(span);
        }
    }

    #[inline(always)]
    pub fn describe(&self, f: impl FnOnce(&mut Record)) {
        self.0.with_mut(|span| span.describe(f));
    }

    #[inline(always)]
    pub fn take(&self) -> NativeSpan {
        self.0.take()
    }
}
