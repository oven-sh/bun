#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
#[path = "GlobWalker.rs"]
pub mod glob_walker;
pub mod matcher;

// `match` is a Rust keyword; re-export with raw identifier.
pub use crate::glob_walker as walk;
pub use crate::matcher::{MatchResult, r#match};
pub use walk::GlobWalker;

// `ignore_filter_fn` is a runtime fn-pointer field supplied at `init()` rather than a type
// parameter (const-generic fn ptrs are unstable).
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
    const SPECIAL_SYNTAX: [u8; 4] = *b"*{[?";

    for &token in SPECIAL_SYNTAX.iter() {
        let mut slice = potential_pattern;
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

                if backslash_count.is_multiple_of(2) {
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
