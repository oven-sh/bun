//! node-semver's `Range` and `subset`, which eslint-plugin-n uses, built on `bun install`'s semver implementation.

use bun_core::handle_oom;
use bun_semver::Version;
use bun_semver::query::{self, Group, NpmRange};
use bun_semver::range::{Comparator, Op};

#[derive(Clone)]
pub(crate) struct Range {
    /// The source text, with runs of whitespace collapsed to single spaces.
    pub(crate) raw: Vec<u8>,
    /// Its prerelease tags are slices of `raw`.
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
        let NpmRange { raw, group } = handle_oom(query::parse_npm(text))?;
        Some(Range {
            raw: raw.into_owned(),
            group,
        })
    }

    /// `^a || ^b || >=latest`. The first of `versions` must be the latest.
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
