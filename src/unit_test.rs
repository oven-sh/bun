// Zig `test { _ = @import("./shell_parser/braces.zig"); _ = @import("./runtime/node/assert/myers_diff.zig"); }`
// is a force-reference block so the Zig test runner picks up tests in those files.
// Dropped per PORTING.md ("Rust links what's pub") — Rust discovers `#[test]` fns via the module tree.
// TODO(port): ensure `bun_shell_parser::braces` and `bun_runtime::node::assert::myers_diff` test modules
// are reachable from their crate roots so `cargo test` finds them.

#[cfg(test)]
mod tests {
    use bun_str::{String, Tag};

    #[test]
    fn basic_string_usage() {
        let s = String::clone_utf8(b"hi");
        // `defer s.deref()` deleted — `impl Drop for bun_str::String` decrements the refcount.
        assert!(s.tag() != Tag::Dead && s.tag() != Tag::Empty);
        assert_eq!(s.length(), 2);
        assert_eq!(s.as_utf8().unwrap(), b"hi");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/unit_test.zig (17 lines)
//   confidence: high
//   todos:      1
//   notes:      test-only entry point; force-ref imports dropped, Phase B must ensure those crates' tests are wired
// ──────────────────────────────────────────────────────────────────────────
