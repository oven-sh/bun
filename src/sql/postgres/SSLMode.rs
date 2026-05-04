#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SSLMode {
    Disable = 0,
    Prefer = 1,
    Require = 2,
    VerifyCa = 3,
    VerifyFull = 4,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/SSLMode.zig (7 lines)
//   confidence: high
//   todos:      0
//   notes:      trivial #[repr(u8)] enum; no dependencies
// ──────────────────────────────────────────────────────────────────────────
