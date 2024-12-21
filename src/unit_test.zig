//! Unit tests for Zig-only code.
//!
//! To register a new test suite, add it to the bottom of the `_ = @import(...)`
//! list below.
//!
//! ## IMPORTANT NOTE
//!
//! You cannot register files that import `bun` (that is, `@import("root").bun`)
//! or rely on externally linked C code. These tests are built and run in isolation,
//! meaning C libraries won't be linked + available.
test {
    _ = @import("./glob/ascii.zig");
}
