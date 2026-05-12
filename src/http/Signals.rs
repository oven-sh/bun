use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, Ordering};

#[derive(Default, Clone, Copy)]
pub struct Signals {
    // TODO(port): lifetime — these are non-owning pointers into a `Store` held by the caller.
    // LIFETIMES.tsv had no entry; classified as BACKREF (raw) per PORTING.md.
    pub header_progress: Option<NonNull<AtomicBool>>,
    pub response_body_streaming: Option<NonNull<AtomicBool>>,
    pub aborted: Option<NonNull<AtomicBool>>,
    pub cert_errors: Option<NonNull<AtomicBool>>,
    pub upgraded: Option<NonNull<AtomicBool>>,
}

impl Signals {
    pub fn is_empty(&self) -> bool {
        self.aborted.is_none()
            && self.response_body_streaming.is_none()
            && self.header_progress.is_none()
            && self.cert_errors.is_none()
            && self.upgraded.is_none()
    }

    /// Resolve `field` to a [`BackRef`] over its `AtomicBool` slot, if wired.
    ///
    /// Centralises the back-reference upgrade so [`get`]/[`store`] are
    /// unsafe-free. Every non-None pointer here was created via
    /// `NonNull::from(&store.<field>)` in `Store::to` (or an equivalent
    /// caller-side `NonNull::from(&signal_store.<field>)`); the BACKREF
    /// invariant — the `Store` outlives every `Signals` derived from it — is
    /// exactly the [`bun_ptr::BackRef`] contract, so the safe `From<NonNull>`
    /// + `Deref` path applies. `AtomicBool` is `Sync` interior-mutable, so a
    /// shared `&` (via `BackRef::Deref`) suffices for both load and store.
    ///
    /// [`BackRef`]: bun_ptr::BackRef
    #[inline]
    fn slot(&self, field: Field) -> Option<bun_ptr::BackRef<AtomicBool>> {
        let ptr: NonNull<AtomicBool> = match field {
            Field::HeaderProgress => self.header_progress,
            Field::ResponseBodyStreaming => self.response_body_streaming,
            Field::Aborted => self.aborted,
            Field::CertErrors => self.cert_errors,
            Field::Upgraded => self.upgraded,
        }?;
        Some(bun_ptr::BackRef::from(ptr))
    }

    // PERF(port): was `comptime field: std.meta.FieldEnum(Signals)` + `@field` reflection —
    // demoted to a runtime match; profile in Phase B.
    pub fn get(self, field: Field) -> bool {
        // Zig .monotonic == LLVM monotonic == Rust Relaxed
        self.slot(field).is_some_and(|a| a.load(Ordering::Relaxed))
    }

    /// Store `value` into the named signal slot if present. No-op when the
    /// slot is `None` (matches Zig `if (this.signals.<field>) |p| p.store(..)`).
    pub fn store(self, field: Field, value: bool, ordering: Ordering) {
        if let Some(a) = self.slot(field) {
            a.store(value, ordering);
        }
    }
}

pub struct Store {
    pub header_progress: AtomicBool,
    pub response_body_streaming: AtomicBool,
    pub aborted: AtomicBool,
    pub cert_errors: AtomicBool,
    pub upgraded: AtomicBool,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            header_progress: AtomicBool::new(false),
            response_body_streaming: AtomicBool::new(false),
            aborted: AtomicBool::new(false),
            cert_errors: AtomicBool::new(false),
            upgraded: AtomicBool::new(false),
        }
    }
}

impl Store {
    pub fn to(&mut self) -> Signals {
        Signals {
            header_progress: Some(NonNull::from(&self.header_progress)),
            response_body_streaming: Some(NonNull::from(&self.response_body_streaming)),
            aborted: Some(NonNull::from(&self.aborted)),
            cert_errors: Some(NonNull::from(&self.cert_errors)),
            upgraded: Some(NonNull::from(&self.upgraded)),
        }
    }
}

/// Mirrors `std.meta.FieldEnum(Signals)`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Field {
    HeaderProgress,
    ResponseBodyStreaming,
    Aborted,
    CertErrors,
    Upgraded,
}

// ported from: src/http/Signals.zig
