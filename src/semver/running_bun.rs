//! The bun version that `packageManager` in package.json pins, checked against the running bun.

use core::fmt;

use bun_core::env_var;

use crate::{PackageManagerSpec, SlicedString, Version};

/// Without `-debug` or `-canary`, so a pin of a canary's base version matches that canary.
const RUNNING: &str = bun_core::env::VERSION_STRING;

/// The version after `bun@`, without the `+<hash>`. A range, a tag or a pre-release is no pin.
pub fn package_manager_pin(value: &[u8]) -> Option<&[u8]> {
    let spec = PackageManagerSpec::parse(value)?;
    if !spec.is_bun() {
        return None;
    }
    let version = spec.exact_version()?;
    (!version.tag.has_pre()).then_some(spec.version_text)
}

/// `Some` when `pin` is an exact version other than the running bun.
pub fn mismatch<'a>(path: &'a [u8], pin: &'a [u8]) -> Option<Mismatch<'a>> {
    let pinned = Version::parse_exact(SlicedString::init(pin, pin))?;
    let running = RUNNING.as_bytes();
    let running = Version::parse_exact(SlicedString::init(running, running))?;
    (!running.eql(pinned)).then_some(Mismatch { path, pin })
}

/// Warns for a mismatch. Returns the marker for `BUN_INTERNAL_BUN_VERSION_CHECKED` when the file
/// pins a version, printed or not: the running version and the path, so only the same bun skips.
pub fn check(path: &[u8], package_manager: &[u8], quiet: bool) -> Option<Vec<u8>> {
    let pin = package_manager_pin(package_manager)?;
    let marker = [RUNNING.as_bytes(), b"\n", path].concat();
    let skip = quiet
        || env_var::BUN_CONFIG_IGNORE_ENGINES.get().unwrap_or(false)
        || env_var::BUN_INTERNAL_BUN_VERSION_CHECKED.get() == Some(marker.as_slice());
    if !skip && let Some(mismatch) = mismatch(path, pin) {
        bun_core::warn!("{}", mismatch);
        bun_core::note!("set BUN_CONFIG_IGNORE_ENGINES=1 to skip this check");
        bun_core::output::flush();
    }
    Some(marker)
}

/// Formats as the one warning line that every command prints for a mismatch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mismatch<'a> {
    pub path: &'a [u8],
    pub pin: &'a [u8],
}

impl fmt::Display for Mismatch<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} pins bun@{}, running {}",
            bun_core::fmt::QuotedFormatter { text: self.path },
            bstr::BStr::new(self.pin),
            RUNNING,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin() {
        let cases: [(&[u8], Option<&[u8]>); 12] = [
            (b"bun@1.2.0", Some(b"1.2.0")),
            (b"bun@1.2.0+sha256.abc", Some(b"1.2.0")),
            (b"bun@1.2.0-canary.1", None),
            (b"bun@^1.2.0", None),
            (b"bun@1.2", None),
            (b"bun@1.x", None),
            (b"bun@latest", None),
            (b"bun@canary", None),
            (b"bun@", None),
            (b"bun", None),
            (b"npm@10.0.0", None),
            ("bun@1.2.0\u{e9}".as_bytes(), None),
        ];
        for (value, expected) in cases {
            assert_eq!(
                package_manager_pin(value),
                expected,
                "{:?}",
                bstr::BStr::new(value)
            );
        }
    }

    #[test]
    fn running() {
        assert_eq!(mismatch(b"/app/package.json", RUNNING.as_bytes()), None);
        assert!(mismatch(b"/app/package.json", b"0.0.1").is_some());
    }

    #[test]
    fn message() {
        let text = Mismatch {
            path: b"/app/package.json",
            pin: b"1.2.0",
        }
        .to_string();
        assert_eq!(
            text,
            format!("\"/app/package.json\" pins bun@1.2.0, running {RUNNING}")
        );
    }
}
