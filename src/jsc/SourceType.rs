// From SourceProvider.h
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum SourceType {
    Program = 0,
    Module = 1,
    WebAssembly = 2,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/SourceType.zig (6 lines)
//   confidence: high
//   todos:      0
//   notes:      trivial #[repr(u8)] enum mirroring JSC SourceProvider.h
// ──────────────────────────────────────────────────────────────────────────
