//! Hooks the runtime installs so lower-tier crates (sql, http_jsc, C++) can
//! start/end leaf spans without depending on `bun_runtime`.

use core::ffi::c_void;
use std::sync::OnceLock;

use crate::{Instrument, ScopeId, SpanContext, SpanKind, SpanStub, SpanWriter, batch, clock};

pub struct Hooks {
    /// The active span's identity for `global` (a `JSGlobalObject*`), or null.
    /// Points into the JS cell; valid until the caller next runs JS.
    pub active_span: fn(global: *mut c_void) -> *const SpanStub,
    /// Called after a span is recorded on this thread (arms the flush timer).
    pub after_record: fn(),
    pub sampler: fn() -> crate::Sampler,
    pub capture_db_statement: fn() -> bool,
}

static HOOKS: OnceLock<Hooks> = OnceLock::new();

pub fn install(h: Hooks) {
    let _ = HOOKS.set(h);
}

#[inline]
pub fn hooks() -> Option<&'static Hooks> {
    HOOKS.get()
}

/// The active span's identity. Valid until the caller next runs JS.
#[inline]
pub fn active_span<'a>(global: *mut c_void) -> Option<&'a SpanStub> {
    let h = HOOKS.get()?;
    let p = (h.active_span)(global);
    if p.is_null() {
        None
    } else {
        Some(unsafe { &*p })
    }
}

#[inline]
pub fn active_context(global: *mut c_void) -> Option<SpanContext> {
    active_span(global)
        .map(|s| s.ctx)
        .filter(SpanContext::is_valid)
}

#[inline]
pub fn capture_db_statement() -> bool {
    HOOKS
        .get()
        .map(|h| (h.capture_db_statement)())
        .unwrap_or(true)
}

/// Start a leaf span for `i` under the active span. `SpanStub::NONE` when
/// disabled or when `i` requires a parent and there is none.
#[inline]
pub fn start_leaf(global: *mut c_void, i: Instrument) -> SpanStub {
    if !crate::enabled(i) {
        return SpanStub::NONE;
    }
    let Some(h) = HOOKS.get() else {
        return SpanStub::NONE;
    };
    let parent = active_context(global);
    if parent.is_none() && !crate::allows_root(i) {
        return SpanStub::NONE;
    }
    SpanStub::start(parent.as_ref(), &(h.sampler)(), clock::now_unix_nanos())
}

/// End a leaf span started with [`start_leaf`]; `write` adds attributes.
#[inline]
pub fn end_leaf(
    i: Instrument,
    stub: &SpanStub,
    name: &[u8],
    kind: SpanKind,
    write: impl FnOnce(&mut SpanWriter<'_>),
) {
    end_leaf_at(i, stub, name, kind, 0, write)
}

pub fn end_leaf_at(
    i: Instrument,
    stub: &SpanStub,
    name: &[u8],
    kind: SpanKind,
    end_ns: u64,
    write: impl FnOnce(&mut SpanWriter<'_>),
) {
    if !stub.is_recording() {
        return;
    }
    let end_ns = if end_ns == 0 {
        clock::now_unix_nanos()
    } else {
        end_ns
    };
    batch::record(ScopeId::from(i), |buf| {
        let mut w = SpanWriter::begin(buf, stub, name, kind, end_ns);
        write(&mut w);
        w.finish();
    });
    if let Some(h) = HOOKS.get() {
        (h.after_record)();
    }
}
