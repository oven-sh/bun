//! The `Range` and `subset` of node-semver that eslint-plugin-n uses, on the semver of `bun install`.

use bun_core::{handle_oom, strings};
use bun_semver::query::{self, Group};
use bun_semver::range::{Comparator, Op};
use bun_semver::{SlicedString, Version};

#[derive(Clone)]
pub(crate) struct Range {
    /// As it is written, with single spaces.
    pub(crate) raw: Vec<u8>,
    /// Its prereleases are parts of `raw`.
    group: Group,
}

fn version_of([major, minor, patch]: [u8; 3]) -> Version {
    Version {
        major: u64::from(major),
        minor: u64::from(minor),
        patch: u64::from(patch),
        ..Default::default()
    }
}

/// `>=version`
fn gte(version: Version) -> bun_semver::Range {
    bun_semver::Range {
        left: Comparator {
            op: Op::Gte,
            version,
        },
        ..Default::default()
    }
}

/// `a || b || ..`
fn any_of(ranges: impl Iterator<Item = bun_semver::Range>) -> Group {
    let mut group = Group::default();
    for range in ranges {
        handle_oom(group.or_range(&range));
    }
    group
}

impl Range {
    /// `None` where `new Range(text)` throws.
    pub(crate) fn parse(text: &[u8]) -> Option<Range> {
        let raw = strings::split_any(text, b" \t\n\r\x0B\x0C")
            .filter(|it| !it.is_empty())
            .collect::<Vec<_>>()
            .join(&b" "[..]);
        let mut group = handle_oom(query::parse(&raw, SlicedString::init(&raw, &raw)));
        if group.has_skipped() {
            return None;
        }
        // Nothing reads it, and in a clone it would be the address of the `raw` of the original.
        group.input = std::ptr::from_ref::<[u8]>(b"");
        Some(Range { raw, group })
    }

    /// `>=version`
    pub(crate) fn at_least(version: [u8; 3]) -> Range {
        Range {
            raw: format!(">={}.{}.{}", version[0], version[1], version[2]).into_bytes(),
            group: any_of(std::iter::once(gte(version_of(version)))),
        }
    }

    /// `^a || ^b || >=latest`, for `versions` of which the first is the latest.
    pub(crate) fn since(versions: &[[u8; 3]]) -> Option<Range> {
        let latest = gte(version_of(*versions.first()?));
        let carets = versions
            .iter()
            .map(|it| bun_semver::Range::caret(version_of(*it)));
        Some(Range {
            raw: Vec::new(),
            group: any_of(carets.chain(std::iter::once(latest))),
        })
    }

    /// `subset(self, dom)`: every version that satisfies `self` satisfies `dom`.
    pub(crate) fn is_subset_of(&self, dom: &Range) -> bool {
        self.group.is_subset_of(&self.raw, &dom.group, &dom.raw)
    }
}
