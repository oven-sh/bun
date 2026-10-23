//! The bun version a package.json declares, checked against the running bun.
//!
//! `packageManager: "bun@<range>"` wins over `engines.bun`, as in setup-bun. Another package
//! manager in `packageManager` falls through to `engines.bun`. The check only warns, so a range
//! that is not semver (`latest`, `canary`) is skipped instead of reported.

use core::fmt;

use bun_core::strings;

use crate::{SlicedString, Version, query};

/// The running version without the `-debug` or `-canary` suffix: a pin of a canary's base version
/// must match that canary.
const RUNNING: &str = bun_core::env::VERSION_STRING;

/// The range after `bun@`, without corepack's `+<hash>` suffix. `None` when `value` names another
/// package manager or has no version.
pub fn package_manager_bun_range(value: &[u8]) -> Option<&[u8]> {
    let range = value.strip_prefix(b"bun@")?;
    let end = strings::index_of_char_usize(range, b'+').unwrap_or(range.len());
    Some(&range[..end])
}

/// The range the two fields declare for bun, or `None` when neither does.
pub fn declared_bun_range<'a>(
    package_manager: Option<&'a [u8]>,
    engines_bun: Option<&'a [u8]>,
) -> Option<&'a [u8]> {
    package_manager
        .and_then(package_manager_bun_range)
        .or(engines_bun)
}

/// `Some(false)` when `range` is a semver range that excludes `version`. `None` when `range` is
/// not a semver range, so that the caller prints nothing.
fn satisfies(version: &[u8], range: &[u8]) -> Option<bool> {
    if !strings::is_all_ascii(range) {
        return None;
    }
    let version_parsed = Version::parse_exact(SlicedString::init(version, version))?;
    let group = query::parse(range, SlicedString::init(range, range)).ok()?;
    if group.is_empty() || group.has_skipped() {
        return None;
    }
    if let Some(exact) = group.get_exact_version() {
        return Some(version_parsed.eql(exact));
    }
    Some(group.satisfies(version_parsed, range, version))
}

/// `Some` when the running bun does not satisfy the `range` that the package.json at `path`
/// declares. This is the one gate for `BUN_CONFIG_IGNORE_ENGINES`, so a command only adds its own
/// `--silent` check.
pub fn mismatch<'a>(path: &'a [u8], range: &'a [u8]) -> Option<Mismatch<'a>> {
    if bun_core::env_var::BUN_CONFIG_IGNORE_ENGINES
        .get()
        .unwrap_or(false)
    {
        return None;
    }
    (satisfies(RUNNING.as_bytes(), range) == Some(false)).then_some(Mismatch { path, range })
}

/// Formats as the one warning line that every command prints for a mismatch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mismatch<'a> {
    pub path: &'a [u8],
    pub range: &'a [u8],
}

impl fmt::Display for Mismatch<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} expects bun@{}, running {}",
            bstr::BStr::new(self.path),
            bstr::BStr::new(self.range),
            RUNNING
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declared_range() {
        let cases: [(Option<&[u8]>, Option<&[u8]>, Option<&[u8]>); 8] = [
            (Some(b"bun@1.2.0"), None, Some(b"1.2.0")),
            (Some(b"bun@^1.2.0+sha256.abc"), None, Some(b"^1.2.0")),
            (Some(b"bun@1.2.0"), Some(b">=1"), Some(b"1.2.0")),
            (Some(b"npm@10"), Some(b">=1"), Some(b">=1")),
            (Some(b"npm@10"), None, None),
            (Some(b"bun"), Some(b"1.x"), Some(b"1.x")),
            (None, Some(b"~1.2"), Some(b"~1.2")),
            (None, Some(b"bun@1.2.0"), Some(b"bun@1.2.0")),
        ];
        for (package_manager, engines_bun, expected) in cases {
            assert_eq!(
                declared_bun_range(package_manager, engines_bun),
                expected,
                "{package_manager:?} {engines_bun:?}"
            );
        }
    }

    #[test]
    fn satisfies_running() {
        let cases: [(&str, Option<bool>); 14] = [
            ("1.4.3", Some(true)),
            ("1.4.2", Some(false)),
            ("^1.4.0", Some(true)),
            ("^1.5.0", Some(false)),
            ("1.4.x", Some(true)),
            ("1.3.x", Some(false)),
            (">=1.4.3 <2", Some(true)),
            ("1.4.3-canary.1", Some(false)),
            ("*", Some(true)),
            ("latest", None),
            ("canary", None),
            ("bun@1.4.3", None),
            ("", None),
            ("1.2.3.4", None),
        ];
        for (range, expected) in cases {
            assert_eq!(satisfies(b"1.4.3", range.as_bytes()), expected, "{range:?}");
        }
        assert_eq!(satisfies(b"1.4.3", "\u{e9}1".as_bytes()), None);
    }

    #[test]
    fn message() {
        let text = Mismatch {
            path: b"/app/package.json",
            range: b"^1.2.0",
        }
        .to_string();
        assert_eq!(
            text,
            format!("/app/package.json expects bun@^1.2.0, running {RUNNING}")
        );
    }
}
