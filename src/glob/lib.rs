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

    /// Whether `path` is under the directory `base` ([`strip_base`]) and this pattern, which is empty or starts with a separator, matches the rest.
    pub fn match_under(&self, base: &[u8], path: &[u8]) -> bool {
        let is_rooted =
            |pattern: &[u8]| pattern.first().is_none_or(|&c| bun_paths::is_sep_native(c));
        debug_assert!(is_rooted(self.pattern()));
        strip_base(base, path).is_some_and(|below| self.r#match(below).matches())
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

/// The length of the longest prefix that `joined`, a glob joined onto the directory `dir`, shares with `dir` up to a component boundary of both.
pub fn literal_base_len(dir: &[u8], joined: &[u8]) -> usize {
    let at_boundary =
        |path: &[u8], i: usize| path.get(i).is_none_or(|&c| bun_paths::is_sep_native(c));
    let mut len = 0;
    for i in 0..=dir.len().min(joined.len()) {
        if at_boundary(dir, i) && at_boundary(joined, i) {
            len = i;
        }
        if dir.get(i) != joined.get(i) {
            break;
        }
    }
    len
}

/// `path` without the directory `base` in front. The bytes must be equal, except that on Windows `/` and `\` are one separator.
pub fn strip_base<'a>(base: &[u8], path: &'a [u8]) -> Option<&'a [u8]> {
    let exact = path.strip_prefix(base);
    if exact.is_some() || !cfg!(windows) {
        return exact;
    }
    let (head, below) = path.split_at_checked(base.len())?;
    let same = |(&a, &b): (&u8, &u8)| {
        a == b || (bun_paths::is_sep_native(a) && bun_paths::is_sep_native(b))
    };
    head.iter().zip(base).all(same).then_some(below)
}

// Run with `bun run rust:miri -p bun_glob`. A plain `cargo test` does not link the highway kernels.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_base_len_cuts_where_the_directory_ends() {
        for (dir, joined, base) in [
            // The glob stays under the directory.
            (
                "/t/[client]/app",
                "/t/[client]/app/src/*.js",
                "/t/[client]/app",
            ),
            ("/t/[client]/app", "/t/[client]/app", "/t/[client]/app"),
            ("/t/[client]/app", "/t/[client]/app/", "/t/[client]/app"),
            // `..` in the glob climbed out of it, and maybe back in.
            ("/t/[client]/app", "/t/[client]/lib/*.js", "/t/[client]"),
            ("/t/[client]/app", "/t/[client]/app2/*.js", "/t/[client]"),
            ("/t/[client]/app", "/t/[client]/ap/*.js", "/t/[client]"),
            ("/t/[client]/app", "/t/[client]", "/t/[client]"),
            ("/t/[client]/app", "/t/[clients]/app/*.js", "/t"),
            ("/t/[client]/app", "/t/[", "/t"),
            ("/t/[client]/app", "/other/*.js", ""),
            ("/t/[client]/app", "/", ""),
            ("/t/[client]/app", "", ""),
            // The filesystem root, and a joined glob that is not absolute.
            ("/", "/src/*.js", ""),
            ("/", "/", "/"),
            ("", "src/*.js", ""),
            ("", "!src/*.js", ""),
            ("", "/src/*.js", ""),
        ] {
            let len = literal_base_len(dir.as_bytes(), joined.as_bytes());
            assert_eq!(&joined[..len], base, "{dir:?} {joined:?}");
        }
    }

    #[test]
    fn match_under_reads_the_base_as_a_name_and_the_glob_as_a_glob() {
        for (base, glob, path, expected) in [
            // Each base also matches, as a glob, the other path of its pair.
            (
                "/t/[client]/app",
                "/src/*.js",
                "/t/[client]/app/src/a.js",
                true,
            ),
            ("/t/[client]/app", "/src/*.js", "/t/c/app/src/a.js", false),
            (
                "/t/{old,new}/app",
                "/src/*.js",
                "/t/{old,new}/app/src/a.js",
                true,
            ),
            (
                "/t/{old,new}/app",
                "/src/*.js",
                "/t/old/app/src/a.js",
                false,
            ),
            ("/t/a*b", "/src/*.js", "/t/a*b/src/a.js", true),
            ("/t/a*b", "/src/*.js", "/t/axb/src/a.js", false),
            ("/t/a?b", "", "/t/a?b", true),
            ("/t/a?b", "", "/t/axb", false),
            ("/t/[!c]", "/*", "/t/[!c]/a.js", true),
            ("/t/[!c]", "/*", "/t/d/a.js", false),
            ("/t/+(a)", "/*.js", "/t/+(a)/a.js", true),
            ("/t/+(a)", "/*.js", "/t/aa/a.js", false),
            ("/t/c++(old)", "/*.js", "/t/c++(old)/a.js", true),
            ("/t/c++(old)", "/*.js", "/t/c+old/a.js", false),
            ("/t/@(a)", "/*.js", "/t/@(a)/a.js", true),
            ("/t/@(a)", "/*.js", "/t/a/a.js", false),
            ("/t/?(a)", "/*.js", "/t/?(a)/a.js", true),
            ("/t/?(a)", "/*.js", "/t/a/a.js", false),
            ("/t/*(a)", "/*.js", "/t/*(a)/a.js", true),
            ("/t/*(a)", "/*.js", "/t/aa/a.js", false),
            ("/t/!(a)", "/*.js", "/t/!(a)/a.js", true),
            ("/t/!(a)", "/*.js", "/t/b/a.js", false),
            ("/t/{1..3}", "", "/t/{1..3}", true),
            ("/t/{1..3}", "", "/t/2", false),
            ("/t/a[b", "/*.js", "/t/a[b/a.js", true),
            ("/t/a{b", "/*.js", "/t/a{b/a.js", true),
            // The glob stays a glob.
            (
                "/t/[client]/app",
                "/src/[ab].js",
                "/t/[client]/app/src/a.js",
                true,
            ),
            (
                "/t/[client]/app",
                "/src/[ab].js",
                "/t/[client]/app/src/[ab].js",
                false,
            ),
            (
                "/t/[client]/app",
                "/**/*.js",
                "/t/[client]/app/src/deep/a.js",
                true,
            ),
            (
                "/t/[client]/app",
                "/src/*.js",
                "/t/[client]/app/lib/a.js",
                false,
            ),
            // Under the base, not beside it.
            ("/t/app", "/*.js", "/t/app2/a.js", false),
            ("/t/app", "/**", "/t/app2/a.js", false),
            ("/t/app", "", "/t/app2", false),
            ("/t/app", "", "/t/app", true),
            ("", "/t/*/a.js", "/t/app/a.js", true),
        ] {
            let matched = Prepared::new(glob).match_under(base.as_bytes(), path.as_bytes());
            assert_eq!(matched, expected, "{base:?} {glob:?} {path:?}");
        }
        assert!(Prepared::new(b"/*.js").match_under(b"/t/\xe3[x]", b"/t/\xe3[x]/a.js"));
    }
}
