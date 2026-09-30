// internal/stringutil/compare.go
use crate::stringutil::util::{strings, unicode, utf8};

pub fn equate_string_case_insensitive(a: &[u8], b: &[u8]) -> bool {
    strings::equal_fold(a, b)
}

pub fn equate_string_case_sensitive(a: &[u8], b: &[u8]) -> bool {
    a == b
}

pub fn get_string_equality_comparer(ignore_case: bool) -> fn(&[u8], &[u8]) -> bool {
    if ignore_case {
        return equate_string_case_insensitive;
    }
    equate_string_case_sensitive
}

pub type Comparison = isize;

pub const COMPARISON_LESS_THAN: Comparison = -1;
pub const COMPARISON_EQUAL: Comparison = 0;
pub const COMPARISON_GREATER_THAN: Comparison = 1;

pub fn compare_strings_case_insensitive(a: &[u8], b: &[u8]) -> Comparison {
    if a == b {
        return COMPARISON_EQUAL;
    }
    let mut a = a;
    let mut b = b;
    loop {
        let (ca, sa) = utf8::decode_rune_in_string(a);
        let (cb, sb) = utf8::decode_rune_in_string(b);
        if sa == 0 {
            if sb == 0 {
                return COMPARISON_EQUAL;
            }
            return COMPARISON_LESS_THAN;
        }
        if sb == 0 {
            return COMPARISON_GREATER_THAN;
        }
        let lca = unicode::to_lower(ca);
        let lcb = unicode::to_lower(cb);
        if lca != lcb {
            if lca < lcb {
                return COMPARISON_LESS_THAN;
            }
            return COMPARISON_GREATER_THAN;
        }
        a = a.get(sa..).unwrap_or(&[]);
        b = b.get(sb..).unwrap_or(&[]);
    }
}

pub fn compare_strings_case_sensitive(a: &[u8], b: &[u8]) -> Comparison {
    strings::compare(a, b)
}

pub fn get_string_comparer(ignore_case: bool) -> fn(&[u8], &[u8]) -> Comparison {
    if ignore_case {
        return compare_strings_case_insensitive;
    }
    compare_strings_case_sensitive
}

pub fn has_prefix(s: &[u8], prefix: &[u8], case_sensitive: bool) -> bool {
    if case_sensitive {
        return s.starts_with(prefix);
    }
    if prefix.len() > s.len() {
        return false;
    }
    strings::equal_fold(s.get(..prefix.len()).unwrap_or(&[]), prefix)
}

pub fn has_suffix(s: &[u8], suffix: &[u8], case_sensitive: bool) -> bool {
    if case_sensitive {
        return s.ends_with(suffix);
    }
    if suffix.len() > s.len() {
        return false;
    }
    strings::equal_fold(s.get(s.len() - suffix.len()..).unwrap_or(&[]), suffix)
}

pub fn has_prefix_and_suffix_without_overlap(
    s: &[u8],
    prefix: &[u8],
    suffix: &[u8],
    case_sensitive: bool,
) -> bool {
    if prefix.len() + suffix.len() > s.len() {
        return false;
    }
    has_prefix(s, prefix, case_sensitive) && has_suffix(s, suffix, case_sensitive)
}

pub fn compare_strings_case_insensitive_then_sensitive(a: &[u8], b: &[u8]) -> Comparison {
    let cmp = compare_strings_case_insensitive(a, b);
    if cmp != COMPARISON_EQUAL {
        return cmp;
    }
    compare_strings_case_sensitive(a, b)
}

// CompareStringsCaseInsensitiveEslintCompatible performs a case-insensitive comparison using toLowerCase() instead of toUpperCase() for ESLint compatibility: the choice affects the relative order of letters and ASCII characters 91-96, of which `_` is a valid character in an identifier.
pub fn compare_strings_case_insensitive_eslint_compatible(a: &[u8], b: &[u8]) -> Comparison {
    if a == b {
        return COMPARISON_EQUAL;
    }
    let a = strings::to_lower(a);
    let b = strings::to_lower(b);
    strings::compare(&a, &b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stringutil::util::strings::split;

    fn unhex(s: &[u8]) -> Vec<u8> {
        let digit = |b: u8| (b as char).to_digit(16).unwrap() as u8;
        s.as_chunks::<2>()
            .0
            .iter()
            .map(|pair| (digit(pair[0]) << 4) | digit(pair[1]))
            .collect()
    }

    // Replays what upstream's Go functions printed for each pair of strings: seven flags and four comparisons.
    #[test]
    fn matches_upstream_vectors() {
        let text = include_bytes!("testdata/compare.tsv");
        let mut checked = 0;
        for line in split(text, b"\n") {
            if line.is_empty() {
                continue;
            }
            let f = split(line, b"\t");
            let (a, b) = (unhex(f[0]), unhex(f[1]));
            let flags = [
                equate_string_case_insensitive(&a, &b),
                equate_string_case_sensitive(&a, &b),
                has_prefix(&a, &b, true),
                has_prefix(&a, &b, false),
                has_suffix(&a, &b, true),
                has_suffix(&a, &b, false),
                has_prefix_and_suffix_without_overlap(&a, &b, &b, false),
            ];
            let mut got = String::new();
            for flag in flags {
                got.push(if flag { '1' } else { '0' });
            }
            for comparison in [
                compare_strings_case_insensitive(&a, &b),
                compare_strings_case_sensitive(&a, &b),
                compare_strings_case_insensitive_then_sensitive(&a, &b),
                compare_strings_case_insensitive_eslint_compatible(&a, &b),
            ] {
                got.push_str(&format!(" {comparison}"));
            }
            let line = std::str::from_utf8(line).unwrap();
            assert_eq!(got.as_bytes(), f[2], "{line}");
            checked += 1;
        }
        assert_eq!(checked, 1936);
    }

    #[test]
    fn comparers_follow_the_case_flag() {
        assert!(get_string_equality_comparer(true)(b"Path", b"pATH"));
        assert!(!get_string_equality_comparer(false)(b"Path", b"pATH"));
        assert_eq!(get_string_comparer(true)(b"a", b"B"), COMPARISON_LESS_THAN);
        assert_eq!(
            get_string_comparer(false)(b"a", b"B"),
            COMPARISON_GREATER_THAN
        );
    }
}
