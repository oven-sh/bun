#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum JSPromiseRejectionOperation {
    Reject = 0,
    Handle = 1,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSPromiseRejectionOperation.zig (4 lines)
//   confidence: high
//   todos:      0
//   notes:      trivial #[repr(u32)] enum; no dependencies
// ──────────────────────────────────────────────────────────────────────────
