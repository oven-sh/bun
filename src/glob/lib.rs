#![warn(unused_must_use)]
#[path = "GlobWalker.rs"]
pub mod glob_walker;
pub mod matcher;
pub mod pattern;
pub mod scan;

// `match` is a Rust keyword; re-export with raw identifier.
pub use crate::glob_walker as walk;
pub use crate::matcher::{Dots, MatchResult, r#match};
pub use crate::pattern::{Candidate, Pattern};
pub use walk::GlobWalker;

/// A pattern whose groups were found once. Use it to match one pattern against many paths.
pub struct Prepared<P> {
    pattern: P,
    shape: matcher::Shape,
}

impl<P: AsRef<[u8]>> Prepared<P> {
    pub fn new(pattern: P) -> Prepared<P> {
        let shape = matcher::Shape::of(pattern.as_ref());
        Prepared { pattern, shape }
    }

    pub fn pattern(&self) -> &[u8] {
        self.pattern.as_ref()
    }

    /// What `new` was given.
    pub fn source(&self) -> &P {
        &self.pattern
    }

    /// Answers like [`r#match`].
    pub fn r#match(&self, path: &[u8]) -> MatchResult {
        let pattern = self.pattern.as_ref();
        matcher::match_prepared::<{ cfg!(windows) }>(pattern, &self.shape, path, Dots::Match)
    }
}

// `ignore_filter_fn` is a runtime fn-pointer field supplied at `init()` rather than a type
// parameter (const-generic fn ptrs are unstable).
pub type BunGlobWalker = walk::GlobWalker<walk::SyscallAccessor, false>;
pub type BunGlobWalkerZ = walk::GlobWalker<walk::SyscallAccessor, true>;

/// Returns true if `text` has an unescaped `@(`, `+(` or `!(`.
/// The other two extglob prefixes, `?` and `*`, are glob syntax on their own.
pub fn has_extglob_prefix(text: &[u8]) -> bool {
    let mut from = 0;
    while let Some(paren) = bun_core::strings::index_of_char_pos(text, b'(', from) {
        if paren > 0 && matches!(text[paren - 1], b'@' | b'+' | b'!') {
            let before = &text[..paren - 1];
            let backslashes = before.iter().rev().take_while(|it| **it == b'\\').count();
            if backslashes % 2 == 0 {
                return true;
            }
        }
        from = paren + 1;
    }
    false
}

/// Returns true if the given string contains glob syntax,
/// excluding those escaped with backslashes
/// TODO: this doesn't play nicely with Windows directory separator and
/// backslashing, should we just require the user to supply posix filepaths?
pub fn detect_glob_syntax(potential_pattern: &[u8]) -> bool {
    // Negation only allowed in the beginning of the pattern
    if !potential_pattern.is_empty() && potential_pattern[0] == b'!' {
        return true;
    }

    if has_extglob_prefix(potential_pattern) {
        return true;
    }

    // In descending order of how popular the token is
    const SPECIAL_SYNTAX: [u8; 4] = *b"*{[?";

    for &token in SPECIAL_SYNTAX.iter() {
        let mut slice = potential_pattern;
        while !slice.is_empty() {
            if let Some(idx) = bun_core::strings::index_of_char_usize(slice, token) {
                // Check for even number of backslashes preceding the
                // token to know that it's not escaped. `idx` is relative to
                // `slice`; a backslash run can't extend past its start (the
                // byte before it is the previous, unescaped-or-not, token).
                let mut i = idx;
                let mut escaped = false;

                while i > 0 && slice[i - 1] == b'\\' {
                    escaped = !escaped;
                    i -= 1;
                }

                if !escaped {
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
