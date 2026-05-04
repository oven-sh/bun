// JSInternalPromise was removed from JavaScriptCore upstream. The new module
// loader uses regular JSPromise everywhere. Keep this as a transparent alias so
// existing Rust callers continue to compile.
pub use super::JSPromise::JSPromise as JSInternalPromise;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSInternalPromise.zig (4 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export alias; sibling module path may need snake_case in Phase B
// ──────────────────────────────────────────────────────────────────────────
