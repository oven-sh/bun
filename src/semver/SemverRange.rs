use core::cmp::Ordering;
use core::fmt;

use crate::Version;
use crate::query::token::Wildcard;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum Op {
    #[default]
    Unset = 0,
    Eql = 1,
    Lt = 3,
    Lte = 4,
    Gt = 5,
    Gte = 6,
}

#[derive(Copy, Clone, Default)]
pub struct Range {
    pub left: Comparator,
    pub right: Comparator,
}

impl Range {
    pub fn init_wildcard(version: Version, wildcard: Wildcard) -> Range {
        match wildcard {
            Wildcard::None => Range {
                left: Comparator {
                    op: Op::Eql,
                    version,
                },
                ..Default::default()
            },

            Wildcard::Major => Range {
                left: Comparator {
                    op: Op::Gte,
                    version: Version {
                        // .raw = version.raw
                        ..Default::default()
                    },
                },
                ..Default::default()
            },

            Wildcard::Minor => Range {
                left: Comparator::lt_next_major(version.major),
                right: Comparator {
                    op: Op::Gte,
                    version: Version {
                        major: version.major,
                        ..Default::default()
                    },
                },
            },

            Wildcard::Patch => Range {
                left: Comparator::lt_next_minor(version.major, version.minor),
                right: Comparator {
                    op: Op::Gte,
                    version: Version {
                        major: version.major,
                        minor: version.minor,
                        ..Default::default()
                    },
                },
            },
        }
    }

    #[inline]
    pub fn has_left(self) -> bool {
        self.left.op != Op::Unset
    }

    #[inline]
    pub fn has_right(self) -> bool {
        self.right.op != Op::Unset
    }

    /// Is the Range equal to another Range
    /// This does not evaluate the range.
    #[inline]
    pub fn eql(self, rhs: &Range) -> bool {
        self.left.eql(rhs.left) && self.right.eql(rhs.right)
    }

    pub fn fmt<'a>(&'a self, buf: &'a [u8]) -> Formatter<'a> {
        Formatter {
            buffer: buf,
            range: self,
        }
    }

    pub fn satisfies(self, version: Version, range_buf: &[u8], version_buf: &[u8]) -> bool {
        let has_left = self.has_left();
        let has_right = self.has_right();

        if !has_left {
            return true;
        }

        if !self.left.satisfies(version, range_buf, version_buf) {
            return false;
        }

        if has_right && !self.right.satisfies(version, range_buf, version_buf) {
            return false;
        }

        true
    }

    pub fn satisfies_pre(
        self,
        version: Version,
        range_buf: &[u8],
        version_buf: &[u8],
        pre_matched: &mut bool,
    ) -> bool {
        debug_assert!(version.tag.has_pre());
        let has_left = self.has_left();
        let has_right = self.has_right();

        if !has_left {
            return true;
        }

        // If left has prerelease check if major,minor,patch matches with left. If
        // not, check the same with right if right exists and has prerelease.
        *pre_matched = *pre_matched
            || (self.left.version.tag.has_pre()
                && version.patch == self.left.version.patch
                && version.minor == self.left.version.minor
                && version.major == self.left.version.major)
            || (has_right
                && self.right.version.tag.has_pre()
                && version.patch == self.right.version.patch
                && version.minor == self.right.version.minor
                && version.major == self.right.version.major);

        if !self.left.satisfies(version, range_buf, version_buf) {
            return false;
        }

        if has_right && !self.right.satisfies(version, range_buf, version_buf) {
            return false;
        }

        true
    }
}

pub struct Formatter<'a> {
    pub buffer: &'a [u8],
    pub range: &'a Range,
}

impl fmt::Display for Formatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.range.left.op == Op::Unset && self.range.right.op == Op::Unset {
            return Ok(());
        }

        if self.range.right.op == Op::Unset {
            write!(f, "{}", self.range.left.fmt(self.buffer))
        } else {
            write!(
                f,
                "{} {}",
                self.range.left.fmt(self.buffer),
                self.range.right.fmt(self.buffer),
            )
        }
    }
}

#[derive(Copy, Clone, Default)]
pub struct Comparator {
    pub op: Op,
    pub version: Version,
}

impl Comparator {
    /// `< {major+1}.0.0`, or `<= u64::MAX.u64::MAX.u64::MAX` when `major+1`
    /// would overflow so the desugared range stays non-empty at the ceiling.
    pub fn lt_next_major(major: u64) -> Comparator {
        match major.checked_add(1) {
            Some(m) => Comparator {
                op: Op::Lt,
                version: Version {
                    major: m,
                    ..Default::default()
                },
            },
            None => Comparator {
                op: Op::Lte,
                version: Version {
                    major: u64::MAX,
                    minor: u64::MAX,
                    patch: u64::MAX,
                    ..Default::default()
                },
            },
        }
    }

    /// `< {major}.{minor+1}.0`, or `<= {major}.u64::MAX.u64::MAX` on overflow.
    pub fn lt_next_minor(major: u64, minor: u64) -> Comparator {
        match minor.checked_add(1) {
            Some(m) => Comparator {
                op: Op::Lt,
                version: Version {
                    major,
                    minor: m,
                    ..Default::default()
                },
            },
            None => Comparator {
                op: Op::Lte,
                version: Version {
                    major,
                    minor: u64::MAX,
                    patch: u64::MAX,
                    ..Default::default()
                },
            },
        }
    }

    /// `< {major}.{minor}.{patch+1}`, or `<= {major}.{minor}.u64::MAX` on overflow.
    pub fn lt_next_patch(major: u64, minor: u64, patch: u64) -> Comparator {
        match patch.checked_add(1) {
            Some(p) => Comparator {
                op: Op::Lt,
                version: Version {
                    major,
                    minor,
                    patch: p,
                    ..Default::default()
                },
            },
            None => Comparator {
                op: Op::Lte,
                version: Version {
                    major,
                    minor,
                    patch: u64::MAX,
                    ..Default::default()
                },
            },
        }
    }

    #[inline]
    pub fn eql(self, rhs: Comparator) -> bool {
        self.op == rhs.op && self.version.eql(rhs.version)
    }

    pub fn fmt<'a>(&'a self, buf: &'a [u8]) -> ComparatorFormatter<'a> {
        ComparatorFormatter {
            buffer: buf,
            comparator: self,
        }
    }

    pub fn satisfies(self, version: Version, comparator_buf: &[u8], version_buf: &[u8]) -> bool {
        let order = version.order_without_build(self.version, version_buf, comparator_buf);

        match order {
            Ordering::Equal => matches!(self.op, Op::Lte | Op::Gte | Op::Eql),
            Ordering::Greater => matches!(self.op, Op::Gt | Op::Gte),
            Ordering::Less => matches!(self.op, Op::Lt | Op::Lte),
        }
    }
}

pub struct ComparatorFormatter<'a> {
    pub buffer: &'a [u8],
    pub comparator: &'a Comparator,
}

impl fmt::Display for ComparatorFormatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.comparator.op == Op::Unset {
            return Ok(());
        }

        match self.comparator.op {
            Op::Unset => unreachable!(), // see above,
            Op::Eql => f.write_str("==")?,
            Op::Lt => f.write_str("<")?,
            Op::Lte => f.write_str("<=")?,
            Op::Gt => f.write_str(">")?,
            Op::Gte => f.write_str(">=")?,
        }

        write!(f, "{}", self.comparator.version.fmt(self.buffer))
    }
}
