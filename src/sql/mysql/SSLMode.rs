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
//   source:     src/sql/mysql/SSLMode.zig (7 lines)
//   confidence: high
//   todos:      0
//   notes:      plain #[repr(u8)] enum; variant names PascalCased from Zig snake_case
// ──────────────────────────────────────────────────────────────────────────
