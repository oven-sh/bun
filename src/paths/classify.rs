//! Single source of truth for one-pass relative-path classification.
//! Callers OR `has_sep`/`has_dot` for "needs resolution" routing and gate
//! `..`-clamp work on `climbs_above_start` (`has_dotdot_component` = any `..`).

use crate::PathChar;
use crate::component_iterator::PathFormat;

/// Facts about a relative path segment, computed in one pass.
#[derive(Clone, Copy, Debug)]
pub struct RelPathFacts {
    /// Any separator for the given format.
    pub has_sep: bool,
    /// Any `.` anywhere (including inside names like `a.b`).
    pub has_dot: bool,
    /// A whole `..` component (delimited by start/end/separators).
    pub has_dotdot_component: bool,
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
        has_dotdot_component: false,
        climbs_above_start: false,
    };
    let mut depth = 0isize; // net component depth so far
    let mut dots = 0usize; // `.` count in the current component
    let mut other = false; // non-dot chars in the current component
    for &c in rel {
        if fmt.is_sep(c) {
            facts.has_sep = true;
            if other || dots > 2 {
                depth += 1;
            } else if dots == 2 {
                facts.has_dotdot_component = true;
                depth -= 1;
            }
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
    if dots == 2 && !other {
        facts.has_dotdot_component = true; // trailing `..` applies its −1 too
        depth -= 1;
    }
    facts.climbs_above_start = depth < 0;
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[track_caller]
    fn check(rel: &str, fmt: PathFormat, want: (bool, bool, bool, bool)) {
        let f = classify_rel_t(rel.as_bytes(), fmt);
        assert_eq!(
            (
                f.has_sep,
                f.has_dot,
                f.has_dotdot_component,
                f.climbs_above_start
            ),
            want,
            "{rel:?} {fmt:?}"
        );
        // Same answers for u16 input.
        let wide: Vec<u16> = rel.encode_utf16().collect();
        let f = classify_rel_t(&wide, fmt);
        assert_eq!(
            (
                f.has_sep,
                f.has_dot,
                f.has_dotdot_component,
                f.climbs_above_start
            ),
            want,
            "{rel:?} {fmt:?} (u16)"
        );
    }

    #[test]
    fn windows_cases() {
        use PathFormat::Windows as W;
        check("", W, (false, false, false, false));
        check("a", W, (false, false, false, false));
        check("a.b", W, (false, true, false, false));
        check("a\\b", W, (true, false, false, false));
        check("a/b", W, (true, false, false, false));
        // Bare `..`: no separator, but the component is a `..`.
        check("..", W, (false, true, true, true));
        check("..\\x", W, (true, true, true, true));
        check("a/../b", W, (true, true, true, false));
        check("a\\..", W, (true, true, true, false));
        check("..a", W, (false, true, false, false));
        check("a..", W, (false, true, false, false));
        check("...", W, (false, true, false, false));
        check("a\\...\\b", W, (true, true, false, false));
        // Doubled separator: empty component, then a `..` component.
        check("a\\\\..", W, (true, true, true, false));
        check("a\\", W, (true, false, false, false));
        // The `!other` guard: dots mixed with other chars never form `..`.
        check("..a\\x", W, (true, true, false, false));
        check("a..\\x", W, (true, true, false, false));
        check(".a.\\x", W, (true, true, false, false));
        // Field-exactness: the closing separator flips has_sep, nothing else.
        check("..\\", W, (true, true, true, true));
        // Within-tree `..` never climbs; net-negative walks do.
        check("a\\..\\b", W, (true, true, true, false));
        check("a\\..\\..", W, (true, true, true, true));
        check("..a\\..", W, (true, true, true, false));
        check(".\\..", W, (true, true, true, true));
        check("a\\..\\b\\..\\..", W, (true, true, true, true));
    }

    #[test]
    fn posix_cases() {
        use PathFormat::Posix as P;
        // Backslash is not a separator: one component `a\b`.
        check("a\\b", P, (false, false, false, false));
        // Component is `a\..`, not `..`.
        check("a\\..", P, (false, true, false, false));
        check("..", P, (false, true, true, true));
        check("a/../b", P, (true, true, true, false));
        check("a/..", P, (true, true, true, false));
    }
}
