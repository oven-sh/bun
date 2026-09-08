//! Single source of truth for one-pass relative-path classification.
//! Callers OR `has_sep`/`has_dot` for "needs resolution" routing and gate
//! `..`-clamp work on `climbs_above_start`.

use crate::PathChar;
use crate::component_iterator::PathFormat;

/// Facts about a relative path segment, computed in one pass.
#[derive(Clone, Copy, Debug)]
pub struct RelPathFacts {
    /// Any separator for the given format.
    pub has_sep: bool,
    /// Any `.` anywhere (including inside names like `a.b`).
    pub has_dot: bool,
    /// Some component is exactly `.` or `..`; names like `a.b` or `...` don't
    /// count.
    pub has_dot_component: bool,
    /// `..` resolution climbs above the segment's own start: the running
    /// component depth (name +1, `..` −1, `.`/empty 0) ever goes negative.
    pub climbs_above_start: bool,
}

/// Classify `rel` in a single pass. Exits early only once every field is
/// final: depth gone negative at a separator (bare trailing `..` still walks
/// to the end so `has_sep` stays honest).
pub fn classify_rel_t<T: PathChar>(rel: &[T], fmt: PathFormat) -> RelPathFacts {
    let mut facts = RelPathFacts {
        has_sep: false,
        has_dot: false,
        has_dot_component: false,
        climbs_above_start: false,
    };
    let mut depth = 0isize; // net component depth so far
    let mut dots = 0usize; // `.` count in the current component
    let mut other = false; // non-dot chars in the current component
    fn close_component(dots: usize, other: bool, facts: &mut RelPathFacts, depth: &mut isize) {
        match (other, dots) {
            (false, 0) => {}
            (false, 1) => facts.has_dot_component = true,
            (false, 2) => {
                facts.has_dot_component = true;
                *depth -= 1;
            }
            _ => *depth += 1,
        }
    }
    for &c in rel {
        if fmt.is_sep(c) {
            facts.has_sep = true;
            close_component(dots, other, &mut facts, &mut depth);
            dots = 0;
            other = false;
            if depth < 0 {
                break; // only `..` decrements, so every field is final here
            }
        } else if c.eq_ascii(b'.') {
            facts.has_dot = true;
            dots += 1;
        } else {
            other = true;
        }
    }
    close_component(dots, other, &mut facts, &mut depth);
    facts.climbs_above_start = depth < 0;
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[track_caller]
    fn check(rel: &str, fmt: PathFormat, want: (bool, bool, bool)) {
        let f = classify_rel_t(rel.as_bytes(), fmt);
        assert_eq!(
            (f.has_sep, f.has_dot, f.climbs_above_start),
            want,
            "{rel:?} {fmt:?}"
        );
        // Same answers for u16 input.
        let wide: Vec<u16> = rel.encode_utf16().collect();
        let f = classify_rel_t(&wide, fmt);
        assert_eq!(
            (f.has_sep, f.has_dot, f.climbs_above_start),
            want,
            "{rel:?} {fmt:?} (u16)"
        );
    }

    #[test]
    fn windows_cases() {
        use PathFormat::Windows as W;
        check("", W, (false, false, false));
        check("a", W, (false, false, false));
        check("a.b", W, (false, true, false));
        check("a\\b", W, (true, false, false));
        check("a/b", W, (true, false, false));
        // Bare `..`: no separator, but it climbs.
        check("..", W, (false, true, true));
        check("..\\x", W, (true, true, true));
        check("a/../b", W, (true, true, false));
        check("a\\..", W, (true, true, false));
        check("..a", W, (false, true, false));
        check("a..", W, (false, true, false));
        check("...", W, (false, true, false));
        check("a\\...\\b", W, (true, true, false));
        // Doubled separator: the empty component costs no depth.
        check("a\\\\..", W, (true, true, false));
        check("a\\", W, (true, false, false));
        // The `!other` guard: dots mixed with other chars never form `..`.
        check("..a\\x", W, (true, true, false));
        check("a..\\x", W, (true, true, false));
        check(".a.\\x", W, (true, true, false));
        // Field-exactness: the closing separator flips has_sep, nothing else.
        check("..\\", W, (true, true, true));
        // Within-tree `..` never climbs; net-negative walks do.
        check("a\\..\\b", W, (true, true, false));
        check("a\\..\\..", W, (true, true, true));
        check("..a\\..", W, (true, true, false));
        check(".\\..", W, (true, true, true));
        check("a\\..\\b\\..\\..", W, (true, true, true));
    }

    #[test]
    fn posix_cases() {
        use PathFormat::Posix as P;
        // Backslash is not a separator: one component `a\b`.
        check("a\\b", P, (false, false, false));
        // Component is `a\..`, not `..`.
        check("a\\..", P, (false, true, false));
        check("..", P, (false, true, true));
        check("a/../b", P, (true, true, false));
        check("a/..", P, (true, true, false));
    }

    #[track_caller]
    fn check_dot_component(rel: &str, fmt: PathFormat, want: bool) {
        assert_eq!(
            classify_rel_t(rel.as_bytes(), fmt).has_dot_component,
            want,
            "{rel:?} {fmt:?}"
        );
        let wide: Vec<u16> = rel.encode_utf16().collect();
        assert_eq!(
            classify_rel_t(&wide, fmt).has_dot_component,
            want,
            "{rel:?} {fmt:?} (u16)"
        );
    }

    #[test]
    fn dot_components() {
        use PathFormat::Windows as W;
        for rel in [
            ".",
            "..",
            ".\\",
            "..\\",
            ".\\a",
            "../a",
            "a\\.",
            "a/..",
            "a\\.\\b",
            "a\\..\\b",
            "a\\\\..",
            "C:\\a\\..\\b",
            "\\\\?\\C:\\a\\.",
        ] {
            check_dot_component(rel, W, true);
        }
        // Dots inside a name, and three or more dots, are ordinary names.
        for rel in [
            "",
            "a",
            "a\\",
            "a.b",
            ".a",
            "a.",
            "..a",
            "a..",
            "...",
            "a\\...\\b",
            ".hidden\\x",
            "a.b\\c.d",
            "C:\\a.b\\c",
        ] {
            check_dot_component(rel, W, false);
        }
        // Under the posix format a backslash is part of the name.
        check_dot_component("a/./b", PathFormat::Posix, true);
        check_dot_component("a\\.", PathFormat::Posix, false);
        check_dot_component(".\\a", PathFormat::Posix, false);
    }
}
