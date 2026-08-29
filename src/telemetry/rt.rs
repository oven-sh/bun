//! The runtime's side of span recording, for the lower-tier crates (sql,
//! http_jsc, the C++ bindings) that start/end spans without depending on
//! `bun_runtime`: a fn-pointer table this crate declares and `bun_runtime`
//! defines once as the `#[no_mangle]` static `__BUN_TELEMETRY_HOOKS`, resolved
//! at link time (the same shape as `SqlRuntimeHooks` / `RuntimeHooks`), so
//! there is no install step and no "before install" state.

use core::cell::RefCell;
use core::ffi::c_void;

use crate::pool::{self, JsCellRef, NativeSpan, Slot};
use crate::{
    Instrument, Local, ScopeId, SpanContext, SpanKind, SpanStub, SpanWriter, batch, clock,
};

pub struct Hooks {
    /// The active span's identity for `global` (a `JSGlobalObject*`), by value.
    pub active_span: fn(global: *mut c_void) -> Option<SpanStub>,
    /// The per-VM state for `global`: null until tracing is configured on that
    /// VM and once it is exiting; otherwise lives as long as the VM.
    pub local: fn(global: *mut c_void) -> *const RefCell<Local>,
    /// Called after a span is recorded on `global`'s VM (arms the flush timer).
    pub after_record: fn(global: *mut c_void),
    /// A pooled span that had a JS cell materialized for it ended: release it.
    /// `snapshot`: what the ended span's cell keeps answering (see [`pool::Ended`]);
    /// `None` when the span was discarded.
    pub release_cell: fn(js_cell: crate::pool::JsCellRef, snapshot: Option<&crate::pool::CellSnapshot>),
    /// `f(tracestate)` once, with the active span's W3C `tracestate` (empty if
    /// none); `f` may call [`with_local`]. Used by [`begin_pooled`].
    pub active_trace_state: fn(global: *mut c_void, f: &mut dyn FnMut(&[u8])),
    /// `f(tracestate, baggage)` once: what an outgoing request made now should
    /// forward (the api Context's baggage wins over the span's inherited one).
    /// Used by [`propagation_headers`].
    pub active_propagation: fn(global: *mut c_void, f: &mut dyn FnMut(&[u8], &[u8])),
}

unsafe extern "Rust" {
    /// Defined `#[no_mangle]` in `bun_runtime::telemetry`. An immutable table of
    /// fn pointers with a single definition, so reading it needs nothing but a
    /// successful link → `safe static`.
    safe static __BUN_TELEMETRY_HOOKS: Hooks;
}

#[inline(always)]
fn hooks() -> &'static Hooks {
    &__BUN_TELEMETRY_HOOKS
}

/// Run `f` with `global`'s per-VM state. `None` when tracing was never
/// configured on this VM or it is exiting. Must not be nested, and `f` must
/// not run JS.
#[inline]
pub fn with_local<R>(global: *mut c_void, f: impl FnOnce(&mut Local) -> R) -> Option<R> {
    let p = (hooks().local)(global);
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
    (hooks().active_span)(global)
}

/// Start a leaf span for `i` under the active span. `SpanStub::NONE` when
/// disabled or when `i` requires a parent and there is none.
#[inline]
pub fn start_leaf(global: *mut c_void, i: Instrument) -> SpanStub {
    if !crate::enabled(i) {
        return SpanStub::NONE;
    }
    let active = active_span(global);
    if active.is_some_and(|s| s.ctx.flags.suppressed()) {
        return SpanStub::NONE;
    }
    let parent = active.map(|s| s.ctx).filter(SpanContext::is_valid);
    if parent.is_none() && !crate::allows_root(i) {
        return SpanStub::NONE;
    }
    with_local(global, |l| {
        SpanStub::start(
            &mut l.rng,
            parent.as_ref(),
            &crate::state().sampler,
            clock::now_unix_nanos(),
        )
    })
    .unwrap_or(SpanStub::NONE)
}

/// Claim a pool slot for `stub` (normally from [`start_leaf`]) as a child of the
/// active span: the slot starts out carrying the active span's W3C `tracestate`,
/// then `init` runs. `NativeSpan::NONE` for `SpanStub::NONE`, before the runtime
/// installed its hooks, or once the VM is exiting. Must not be nested inside
/// [`with_local`]; `init` must not run JS.
pub fn begin_pooled(
    global: *mut c_void,
    i: Instrument,
    stub: SpanStub,
    name: &[u8],
    kind: SpanKind,
    init: impl FnOnce(&mut Slot),
) -> NativeSpan {
    if !stub.is_some() {
        return NativeSpan::NONE;
    }
    let h = hooks();
    let mut init = Some(init);
    let mut span = NativeSpan::NONE;
    (h.active_trace_state)(global, &mut |trace_state: &[u8]| {
        span = with_local(global, |l| {
            pool::begin_with(
                &mut l.pool,
                stub,
                ScopeId::from(i),
                name,
                kind,
                trace_state,
                init.take()
                    .expect("Hooks::active_trace_state calls f exactly once"),
            )
        })
        .unwrap_or(NativeSpan::NONE);
    });
    span
}

/// End a pooled span into the VM's batch (`extra` adds end-time attributes),
/// release the JS cell that was materialized for it, and arm the flush timer.
/// Returns whether the handle was still live. `NONE`/stale handles are a no-op.
pub fn end_pooled(
    global: *mut c_void,
    span: NativeSpan,
    end_ns: u64,
    extra: &mut dyn FnMut(&mut SpanWriter<'_>),
) -> bool {
    if !span.is_some() {
        return false;
    }
    let ended = with_local(global, |l| pool::end(l, span, end_ns, extra)).flatten();
    let live = ended.is_some();
    if let Some(e) = ended {
        release_cell(e.js_cell, e.snapshot.as_deref());
        if e.recorded {
            (hooks().after_record)(global);
        }
    }
    live
}

/// Release a pooled span without recording it (the operation never produced
/// an outcome worth reporting).
pub fn discard_pooled(global: *mut c_void, span: NativeSpan) {
    if !span.is_some() {
        return;
    }
    if let Some(cell) = with_local(global, |l| pool::discard(&mut l.pool, span)) {
        release_cell(cell, None);
    }
}

fn release_cell(cell: JsCellRef, snapshot: Option<&crate::pool::CellSnapshot>) {
    if cell.is_some() {
        (hooks().release_cell)(cell, snapshot);
    }
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
            let mut w = SpanWriter::begin(
                buf,
                stub,
                name,
                kind,
                end_ns,
                crate::state().limits.attribute_value_length,
            );
            write(&mut w);
            w.finish();
        });
    });
    if recorded.is_some() {
        (hooks().after_record)(global);
    }
}

/// The W3C headers an outgoing request made under `stub` carries, as raw
/// `name: value\r\n` lines appended to `out`: `traceparent` naming `stub`
/// (when trace-context propagation is on), the active `tracestate` with it,
/// and the active `baggage` (its own switch). Nothing when `stub` is none.
/// The HTTP/1 seams that build their own request head (WebSocket upgrade)
/// use this; fetch and node:http write through their header maps instead.
pub fn propagation_headers(global: *mut c_void, stub: &SpanStub, out: &mut Vec<u8>) {
    if !stub.is_some() {
        return;
    }
    let st = crate::state();
    if st.propagate_trace_context {
        let mut tp = [0u8; crate::propagation::TRACEPARENT_LEN];
        crate::propagation::format_traceparent(&stub.ctx, &mut tp);
        out.extend_from_slice(b"traceparent: ");
        out.extend_from_slice(&tp);
        out.extend_from_slice(b"\r\n");
    }
    if st.propagate_trace_context || st.propagate_baggage {
        (hooks().active_propagation)(global, &mut |trace_state: &[u8], baggage: &[u8]| {
            if st.propagate_trace_context
                && !trace_state.is_empty()
                && crate::propagation::tracestate_is_reasonable(trace_state)
            {
                out.extend_from_slice(b"tracestate: ");
                out.extend_from_slice(trace_state);
                out.extend_from_slice(b"\r\n");
            }
            if st.propagate_baggage
                && !baggage.is_empty()
                && crate::propagation::baggage_is_reasonable(baggage)
            {
                out.extend_from_slice(b"baggage: ");
                out.extend_from_slice(baggage);
                out.extend_from_slice(b"\r\n");
            }
        });
    }
}
