//! The package.json `packageManager` field in Corepack's grammar: `<name>@<version>[+<hash>]`.

use bun_core::strings;

use crate::{SlicedString, Version};

#[derive(Clone, Copy)]
pub struct PackageManagerSpec<'a> {
    pub name: &'a [u8],
    /// The version as written, without the `+<hash>` suffix. A range is kept so that a caller can report it.
    pub version_text: &'a [u8],
}

impl<'a> PackageManagerSpec<'a> {
    /// `None` when the field has no `@`, an empty name, or nothing after the `@`.
    pub fn parse(raw: &'a [u8]) -> Option<Self> {
        let raw = strings::trim(raw, &strings::WHITESPACE_CHARS);
        // Split at the last `@` so that a scoped name keeps its leading `@`.
        let at = strings::last_index_of_char(raw, b'@')?;
        let (name, spec) = (&raw[..at], &raw[at + 1..]);
        if name.is_empty() || spec.is_empty() {
            return None;
        }
        let version_text = match strings::index_of_char_usize(spec, b'+') {
            Some(plus) => &spec[..plus],
            None => spec,
        };
        Some(Self { name, version_text })
    }

    #[inline]
    pub fn is_bun(&self) -> bool {
        self.name == b"bun"
    }

    /// `None` for a range or a tag such as `canary`. The tag offsets of the result point into `version_text`.
    pub fn exact_version(&self) -> Option<Version> {
        Version::parse_exact(SlicedString::init(self.version_text, self.version_text))
    }
}

#[cfg(test)]
mod tests {
    use super::PackageManagerSpec;

    fn parse(raw: &[u8]) -> Option<PackageManagerSpec<'_>> {
        PackageManagerSpec::parse(raw)
    }

    #[test]
    fn exact_bun_pin() {
        let spec = parse(b"bun@1.2.0").unwrap();
        assert!(spec.is_bun());
        assert_eq!(spec.version_text, b"1.2.0");
        let version = spec.exact_version().unwrap();
        assert_eq!((version.major, version.minor, version.patch), (1, 2, 0));
    }

    #[test]
    fn hash_suffix_is_split_off() {
        let spec = parse(b"bun@1.2.0+sha256.abcd").unwrap();
        assert!(spec.is_bun());
        assert_eq!(spec.version_text, b"1.2.0");
        assert!(!spec.exact_version().unwrap().tag.has_build());
    }

    #[test]
    fn other_package_managers_parse_but_are_not_bun() {
        let spec = parse(b"pnpm@9.1.0").unwrap();
        assert!(!spec.is_bun());
        assert_eq!(spec.name, b"pnpm");
        let scoped = parse(b"@scope/tool@2.0.0").unwrap();
        assert_eq!(scoped.name, b"@scope/tool");
    }

    #[test]
    fn prerelease_version_is_exact() {
        let spec = parse(b"bun@1.4.4-debug").unwrap();
        assert_eq!(spec.version_text, b"1.4.4-debug");
        assert!(spec.exact_version().unwrap().tag.has_pre());
    }

    #[test]
    fn surrounding_whitespace_is_ignored() {
        let spec = parse(b" bun@1.2.0 ").unwrap();
        assert!(spec.is_bun());
        assert_eq!(spec.version_text, b"1.2.0");
    }

    #[test]
    fn ranges_and_tags_parse_but_have_no_exact_version() {
        for raw in [
            &b"npm@10"[..],
            b"bun@^1.2",
            b"bun@1.2",
            b"bun@canary",
            b"bun@latest",
            b"bun@1.2.0 extra",
        ] {
            let spec = parse(raw).unwrap();
            assert!(
                spec.exact_version().is_none(),
                "{:?} must not be an exact version",
                bstr::BStr::new(raw)
            );
        }
    }

    #[test]
    fn rejects_missing_name_or_version() {
        for raw in [&b"bun@"[..], b"@1.2.0", b"bun", b"", b"@"] {
            assert!(
                parse(raw).is_none(),
                "{:?} must not parse",
                bstr::BStr::new(raw)
            );
        }
    }
}
