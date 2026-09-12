use core::cmp::Ordering;

use crate::Version;
use crate::query::{Group, Query};
use crate::range::{Comparator, Op};

#[derive(Clone, Copy)]
struct Bound<'a> {
    version: Version,
    buf: &'a [u8],
    inclusive: bool,
}

#[derive(Clone, Copy, Default)]
struct Interval<'a> {
    lower: Option<Bound<'a>>,
    upper: Option<Bound<'a>>,
}

impl<'a> Interval<'a> {
    fn raise(&mut self, b: &Bound<'a>) {
        let replace = match self.lower {
            None => true,
            Some(cur) => match b.version.order_without_build(cur.version, b.buf, cur.buf) {
                Ordering::Greater => true,
                Ordering::Equal => !b.inclusive,
                Ordering::Less => false,
            },
        };
        if replace {
            self.lower = Some(*b);
        }
    }

    fn cap(&mut self, b: &Bound<'a>) {
        let replace = match self.upper {
            None => true,
            Some(cur) => match b.version.order_without_build(cur.version, b.buf, cur.buf) {
                Ordering::Less => true,
                Ordering::Equal => !b.inclusive,
                Ordering::Greater => false,
            },
        };
        if replace {
            self.upper = Some(*b);
        }
    }

    fn narrow(&mut self, c: Comparator, buf: &'a [u8]) {
        let bound = |inclusive: bool| Bound {
            version: c.version,
            buf,
            inclusive,
        };
        match c.op {
            Op::Unset => {}
            Op::Eql => {
                self.raise(&bound(true));
                self.cap(&bound(true));
            }
            Op::Gt => self.raise(&bound(false)),
            Op::Gte => self.raise(&bound(true)),
            Op::Lt => self.cap(&bound(false)),
            Op::Lte => self.cap(&bound(true)),
        }
    }

    fn and_query(&mut self, query: &Query, buf: &'a [u8]) {
        let mut cur = Some(query);
        while let Some(q) = cur {
            self.narrow(q.range.left, buf);
            self.narrow(q.range.right, buf);
            cur = q.next.as_deref();
        }
    }

    fn is_non_empty(&self) -> bool {
        match (self.lower, self.upper) {
            (Some(l), Some(u)) => match l.version.order_without_build(u.version, l.buf, u.buf) {
                Ordering::Less => true,
                Ordering::Equal => l.inclusive && u.inclusive,
                Ordering::Greater => false,
            },
            _ => true,
        }
    }

    /// Whether a version that satisfies both queries (prereleases included, per `List::satisfies_pre`) lies inside.
    fn has_version(&self, a: &Query, b: &Query) -> bool {
        if !self.is_non_empty() {
            return false;
        }
        let (Some(l), Some(u)) = (self.lower, self.upper) else {
            return true;
        };

        // The smallest version without a prerelease tag that the lower bound admits.
        let release = if l.version.tag.has_pre() {
            Version {
                major: l.version.major,
                minor: l.version.minor,
                patch: l.version.patch,
                ..Default::default()
            }
        } else if l.inclusive {
            return true;
        } else {
            let Some(release) = next_release(l.version) else {
                return false;
            };
            release
        };

        let admitted = match release.order_without_build(u.version, &[], u.buf) {
            Ordering::Less => true,
            Ordering::Equal => u.inclusive,
            Ordering::Greater => false,
        };
        if admitted {
            return true;
        }

        allows_pre_of(a, release) && allows_pre_of(b, release)
    }
}

/// The smallest release above `v`'s major.minor.patch, with a carry (`>3` desugars to `>3.MAX.MAX`).
fn next_release(v: Version) -> Option<Version> {
    let release = |major, minor, patch| Version {
        major,
        minor,
        patch,
        ..Default::default()
    };
    if let Some(patch) = v.patch.checked_add(1) {
        return Some(release(v.major, v.minor, patch));
    }
    if let Some(minor) = v.minor.checked_add(1) {
        return Some(release(v.major, minor, 0));
    }
    v.major.checked_add(1).map(|major| release(major, 0, 0))
}

fn allows_pre_of(query: &Query, release: Version) -> bool {
    let mut cur = Some(query);
    while let Some(q) = cur {
        if q.range.admits_pre_of(release) {
            return true;
        }
        cur = q.next.as_deref();
    }
    false
}

impl Group {
    /// Whether some version satisfies both groups.
    pub fn intersects(&self, self_buf: &[u8], other: &Group, other_buf: &[u8]) -> bool {
        let mut a = Some(&self.head);
        while let Some(list_a) = a {
            a = list_a.next.as_deref();
            let mut base = Interval::default();
            base.and_query(&list_a.head, self_buf);
            if !base.is_non_empty() {
                continue;
            }
            let mut b = Some(&other.head);
            while let Some(list_b) = b {
                b = list_b.next.as_deref();
                let mut i = base;
                i.and_query(&list_b.head, other_buf);
                if i.has_version(&list_a.head, &list_b.head) {
                    return true;
                }
            }
        }
        false
    }
}
