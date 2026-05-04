// Port of src/glob/glob.zig

pub mod matcher;
pub mod glob_walker;

// `match` is a Rust keyword; re-export with raw identifier.
pub use crate::matcher::r#match;
pub use crate::glob_walker as walk;
pub use walk::GlobWalker_ as GlobWalker;

// TODO(port): Zig passes `null` as the first comptime arg to `GlobWalker_(null, Accessor, sentinel)`.
// The Rust generic struct shape for that param is unknown here (likely an optional ignore-filter);
// dropped for now — verify against glob_walker.rs in Phase B.
pub type BunGlobWalker = walk::GlobWalker_<walk::SyscallAccessor, false>;
pub type BunGlobWalkerZ = walk::GlobWalker_<walk::SyscallAccessor, true>;

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/glob/glob.zig (40 lines)
//   confidence: medium
//   todos:      1
//   notes:      `match` re-export uses raw ident r#match; first comptime arg `null` to GlobWalker_ dropped pending glob_walker.rs shape
// ──────────────────────────────────────────────────────────────────────────
