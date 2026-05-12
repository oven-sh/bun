// Port of src/glob/glob.zig
#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
#![warn(unreachable_pub)]
#[path = "GlobWalker.rs"]
pub mod glob_walker;
pub mod matcher;

// `match` is a Rust keyword; re-export with raw identifier.
pub use crate::glob_walker as walk;
pub use crate::matcher::{MatchResult, r#match};
pub use walk::GlobWalker;

// PORT NOTE: Zig passes `null` as the first comptime arg to `GlobWalker_(null, Accessor, sentinel)`.
// In the port, `ignore_filter_fn` is a runtime fn-pointer field (const-generic fn ptrs are
// unstable), so the first param is dropped from the type and supplied at `init()`.
pub type BunGlobWalker = walk::GlobWalker<walk::SyscallAccessor, false>;
pub type BunGlobWalkerZ = walk::GlobWalker<walk::SyscallAccessor, true>;

/// Returns true if the given string contains glob syntax,
/// excluding those escaped with backslashes
/// TODO: this doesn't play nicely with Windows directory separator and
/// backslashing, should we just require the user to supply posix filepaths?
pub fn detect_glob_syntax(potential_pattern: &[u8]) -> bool {
    // Negation only allowed in the beginning of the pattern
    if !potential_pattern.is_empty() && potential_pattern[0] == b'!' {
        return true;
    }

    // In descending order of how popular the token is
    const SPECIAL_SYNTAX: [u8; 4] = [b'*', b'{', b'[', b'?'];

    // PERF(port): was `inline for` (unrolled at comptime) — profile in Phase B
    for &token in SPECIAL_SYNTAX.iter() {
        let mut slice = &potential_pattern[..];
        while !slice.is_empty() {
            if let Some(idx) = slice.iter().position(|&b| b == token) {
                // Check for even number of backslashes preceding the
                // token to know that it's not escaped
                let mut i = idx;
                let mut backslash_count: u16 = 0;

                while i > 0 && potential_pattern[i - 1] == b'\\' {
                    backslash_count += 1;
                    i -= 1;
                }

                if backslash_count % 2 == 0 {
                    return true;
                }
                slice = &slice[idx + 1..];
            } else {
                break;
            }
        }
    }

    false
}

// ported from: src/glob/glob.zig
