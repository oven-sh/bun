// Port of src/glob/glob.zig

// ──────────────────────────────────────────────────────────────────────────
// B-1 GATE: Phase-A draft modules preserved behind #[cfg(any())].
// Stub surface exposed below. Un-gate in B-2.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(any())]
pub mod matcher;
#[cfg(any())]
#[path = "GlobWalker.rs"]
pub mod glob_walker;

// ─── stub: matcher ────────────────────────────────────────────────────────
#[cfg(not(any()))]
pub mod matcher {
    // TODO(b1): bun_str::strings missing; bun_collections::BoundedArray lacks new/push/pop/len/as_slice
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum MatchResult {
        NoMatch,
        Match,
        NegateNoMatch,
        NegateMatch,
    }
    impl MatchResult {
        pub fn matches(self) -> bool {
            matches!(self, MatchResult::Match | MatchResult::NegateMatch)
        }
    }
    pub fn r#match(_glob: &[u8], _path: &[u8]) -> MatchResult {
        todo!("b1-stub: matcher::match")
    }
}

// ─── stub: glob_walker ────────────────────────────────────────────────────
#[cfg(not(any()))]
pub mod glob_walker {
    use core::marker::PhantomData;
    pub struct SyscallAccessor;
    pub struct GlobWalker_<A, const SENTINEL: bool>(PhantomData<A>);
    impl<A, const SENTINEL: bool> GlobWalker_<A, SENTINEL> {
        pub fn new() -> Self {
            todo!("b1-stub: GlobWalker_::new")
        }
    }
}

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
