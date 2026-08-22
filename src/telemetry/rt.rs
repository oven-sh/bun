//! Hooks the runtime installs so lower-tier crates (sql, http_jsc, C++) can
//! start/end leaf spans without depending on `bun_runtime`.

use core::cell::RefCell;
use core::ffi::c_void;
use std::sync::OnceLock;

use crate::{
    Instrument, Local, ScopeId, SpanContext, SpanKind, SpanStub, SpanWriter, batch, clock,
};

pub struct Hooks {
    /// The active span's identity for `global` (a `JSGlobalObject*`), or null.
    /// Points into the JS cell; valid until the caller next runs JS.
    pub active_span: fn(global: *mut c_void) -> *const SpanStub,
    /// The per-VM state for `global` (null once the VM is exiting); lives as
    /// long as the VM.
    pub local: fn(global: *mut c_void) -> *const RefCell<Local>,
    /// Called after a span is recorded on `global`'s VM (arms the flush timer).
    pub after_record: fn(global: *mut c_void),
    /// A pooled span that had a JS cell materialized for it ended: release it.
    pub release_cell: fn(js_cell: crate::pool::JsCellRef),
    pub sampler: fn() -> crate::Sampler,
    pub limits: fn() -> crate::data::Limits,
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

/// Run `f` with `global`'s per-VM state. `None` before the runtime installed
/// its hooks (telemetry never configured) or once the VM is exiting. Must not
/// be nested, and `f` must not run JS.
#[inline]
pub fn with_local<R>(global: *mut c_void, f: impl FnOnce(&mut Local) -> R) -> Option<R> {
    let p = (HOOKS.get()?.local)(global);
    if p.is_null() {
        return None;
    }
    // SAFETY: `Hooks::local` returns null or the VM-owned cell for a live global; we are on that VM's thread.
    let cell = unsafe { &*p };
    Some(f(&mut cell.borrow_mut()))
}

/// The active span's identity.
#[inline]
pub fn active_span(global: *mut c_void) -> Option<SpanStub> {
    let h = HOOKS.get()?;
    let p = (h.active_span)(global);
    if p.is_null() {
        None
    } else {
        // SAFETY: `Hooks::active_span` returns null or a pointer valid until JS next runs.
        Some(unsafe { *p })
    }
}

#[inline]
pub fn active_context(global: *mut c_void) -> Option<SpanContext> {
    active_span(global)
        .map(|s| s.ctx)
        .filter(SpanContext::is_valid)
}

/// The configured span limits (defaults before the runtime is configured).
#[inline]
pub fn limits() -> crate::Limits {
    HOOKS
        .get()
        .map(|h| (h.limits)())
        .unwrap_or(crate::DEFAULT_LIMITS)
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
    let sampler = (h.sampler)();
    with_local(global, |l| {
        SpanStub::start(
            &mut l.rng,
            parent.as_ref(),
            &sampler,
            clock::now_unix_nanos(),
        )
    })
    .unwrap_or(SpanStub::NONE)
}

/// End a leaf span started with [`start_leaf`]; `write` adds attributes.
#[inline]
pub fn end_leaf(
    global: *mut c_void,
    i: Instrument,
    stub: &SpanStub,
    name: &[u8],
    kind: SpanKind,
    mut write: impl FnMut(&mut SpanWriter<'_>),
) {
    end_leaf_at(global, i, stub, name, kind, 0, &mut write)
}

/// One out-of-line copy for every integration (the attribute writer is
/// dynamically dispatched; leaf spans are not the hot path).
#[inline(never)]
pub fn end_leaf_at(
    global: *mut c_void,
    i: Instrument,
    stub: &SpanStub,
    name: &[u8],
    kind: SpanKind,
    end_ns: u64,
    write: &mut dyn FnMut(&mut SpanWriter<'_>),
) {
    if !stub.is_recording() {
        return;
    }
    let end_ns = clock::or_now(end_ns);
    let recorded = with_local(global, |l| {
        batch::record(&mut l.batch, ScopeId::from(i), &mut |buf: &mut Vec<u8>| {
            let mut w = SpanWriter::begin(buf, stub, name, kind, end_ns);
            write(&mut w);
            w.finish();
        });
    });
    if let (Some(()), Some(h)) = (recorded, HOOKS.get()) {
        (h.after_record)(global);
    }
}
