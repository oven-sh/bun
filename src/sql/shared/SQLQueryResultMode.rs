// PORT NOTE: Zig uses `enum(u2)`; Rust has no `u2` repr, so we use the smallest
// available (`u8`). Only 3 variants, so layout/ABI is unaffected for any consumer.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SQLQueryResultMode {
    Objects = 0,
    Values = 1,
    Raw = 2,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/shared/SQLQueryResultMode.zig (5 lines)
//   confidence: high
//   todos:      0
//   notes:      enum(u2) widened to repr(u8); no u2 in Rust
// ──────────────────────────────────────────────────────────────────────────
