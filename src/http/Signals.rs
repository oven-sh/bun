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

    // PERF(port): was `comptime field: std.meta.FieldEnum(Signals)` + `@field` reflection —
    // demoted to a runtime match; profile in Phase B.
    pub fn get(self, field: Field) -> bool {
        let ptr: Option<NonNull<AtomicBool>> = match field {
            Field::HeaderProgress => self.header_progress,
            Field::ResponseBodyStreaming => self.response_body_streaming,
            Field::Aborted => self.aborted,
            Field::CertErrors => self.cert_errors,
            Field::Upgraded => self.upgraded,
        };
        let Some(ptr) = ptr else { return false };
        // SAFETY: ptr was created via `NonNull::from(&store.<field>)` in `Store::to`;
        // the caller guarantees the Store outlives this Signals.
        unsafe { ptr.as_ref() }.load(Ordering::Relaxed) // Zig .monotonic == LLVM monotonic == Rust Relaxed
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/Signals.zig (34 lines)
//   confidence: high
//   todos:      1
//   notes:      pointer fields kept as Option<NonNull<AtomicBool>> (BACKREF into Store); comptime FieldEnum lowered to runtime enum match
// ──────────────────────────────────────────────────────────────────────────
