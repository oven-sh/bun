//! Per-VM span buffers. Integrations end spans into their VM's `LocalBatch`
//! (see [`crate::Local`]) with no synchronisation; the batch is handed to the
//! global [`Processor`](crate::Processor) every `LOCAL_FLUSH_SPANS` spans, on
//! the owning event loop's telemetry tick, and at VM exit.

use crate::ScopeId;

/// Spans buffered per thread before taking the processor lock. Small so that
/// idle threads don't sit on data; large enough that the lock is amortised.
pub const LOCAL_FLUSH_SPANS: u32 = 16;
pub const LOCAL_FLUSH_BYTES: usize = 32 * 1024;

pub struct LocalBatch {
    /// Indexed by `ScopeId`. Each holds concatenated `ScopeSpans.spans` entries.
    pub(crate) scopes: Vec<Vec<u8>>,
    pub(crate) count: u32,
    pub(crate) bytes: usize,
}

impl LocalBatch {
    pub const fn new() -> LocalBatch {
        LocalBatch {
            scopes: Vec::new(),
            count: 0,
            bytes: 0,
        }
    }

    #[inline]
    fn buffer(&mut self, scope: ScopeId) -> &mut Vec<u8> {
        let i = scope.0 as usize;
        if i >= self.scopes.len() {
            self.scopes.resize_with(i + 1, Vec::new);
        }
        &mut self.scopes[i]
    }

    /// Call after writing one span into `buffer(scope)`.
    #[inline]
    fn committed(&mut self, scope: ScopeId, start_len: usize) -> bool {
        let added = self.scopes[scope.0 as usize].len() - start_len;
        self.count += 1;
        self.bytes += added;
        self.count >= LOCAL_FLUSH_SPANS || self.bytes >= LOCAL_FLUSH_BYTES
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Reset after the processor copied the buffers out; capacity is kept.
    #[inline]
    pub(crate) fn clear(&mut self) {
        for v in &mut self.scopes {
            v.clear();
        }
        self.count = 0;
        self.bytes = 0;
    }
}

/// Write one span for `scope` via `write` and hand the batch to the
/// processor if it crossed the threshold. The only way a span enters the
/// batch.
#[inline]
pub fn record(l: &mut LocalBatch, scope: ScopeId, write: &mut dyn FnMut(&mut Vec<u8>)) {
    let buf = l.buffer(scope);
    let start = buf.len();
    write(buf);
    if buf.len() == start {
        return;
    }
    if l.committed(scope, start) {
        flush_local(l);
    }
}

/// Move the VM's buffered spans to the global processor.
pub fn flush_local(l: &mut LocalBatch) {
    if l.is_empty() {
        return;
    }
    // The processor copies the buffers under its lock and we keep ours
    // (and their capacity); it must not call back into the batch.
    let export = crate::processor::global().map(|p| (p, p.accept(l)));
    l.clear();
    if let Some((p, true)) = export {
        p.export();
    }
}
