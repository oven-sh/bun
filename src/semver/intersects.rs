use core::cmp::Ordering;

use crate::Version;
use crate::query::{Group, Query};
use crate::range::{Comparator, Op};
use crate::version::Tag;

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
        let Some(u) = self.upper else {
            return true;
        };
        // `0.0.0-0` is the lowest version, so a missing lower bound starts there and `<0.0.0-0` alone is empty.
        let l = self.lower.unwrap_or(Bound {
            version: Comparator::null_set().version,
            buf: b"",
            inclusive: true,
        });
        match l.version.order_without_build(u.version, l.buf, u.buf) {
            Ordering::Less => true,
            Ordering::Equal => l.inclusive && u.inclusive,
            Ordering::Greater => false,
        }
    }
}

impl Query {
    /// `*` (a lone `>=0.0.0`). `>=0.0.0-0` is not `*`.
    fn is_star(&self) -> bool {
        let range = &self.range;
        self.next.is_none()
            && range.left.op == Op::Gte
            && range.left.version.is_zero()
            && !range.left.version.tag.has_pre()
            && !range.has_right()
    }
}

impl Group {
    /// The AND chains that are OR'd together.
    fn alternatives(&self) -> impl Iterator<Item = &Query> {
        core::iter::successors(Some(&self.head), |list| list.next.as_deref()).map(|list| &list.head)
    }

    /// `satisfies`, except that `*` admits a prerelease too.
    fn admits(&self, self_buf: &[u8], version: Version, version_buf: &[u8]) -> bool {
        self.satisfies(version, self_buf, version_buf)
            || (version.tag.has_pre() && self.alternatives().any(Query::is_star))
    }

    fn admits_an_exact_version_of(&self, self_buf: &[u8], other: &Group, other_buf: &[u8]) -> bool {
        other
            .alternatives()
            .filter_map(Query::exact_version)
            .any(|version| self.admits(self_buf, version, other_buf))
    }

    /// Whether some version satisfies both groups; an exact version goes through `satisfies`, two ranges compare bounds only.
    pub fn intersects(&self, self_buf: &[u8], other: &Group, other_buf: &[u8]) -> bool {
        if self.admits_an_exact_version_of(self_buf, other, other_buf)
            || other.admits_an_exact_version_of(other_buf, self, self_buf)
        {
            return true;
        }
        let is_range = |query: &&Query| query.exact_version().is_none();
        for a in self.alternatives().filter(is_range) {
            let mut base = Interval::default();
            base.and_query(a, self_buf);
            if !base.is_non_empty() {
                continue;
            }
            for b in other.alternatives().filter(is_range) {
                let mut i = base;
                i.and_query(b, other_buf);
                if i.is_non_empty() {
                    return true;
                }
            }
        }
        false
    }

    /// Whether `self` is satisfied by a version that a comparator of `other` names. An exclusive bound counts
    /// (`2.0.0` for `^1.0.0`, which is `<2.0.0-0`), and so does the `0.0.0` of an unset comparator.
    pub fn is_satisfied_by_a_bound_of(
        &self,
        self_buf: &[u8],
        other: &Group,
        other_buf: &[u8],
    ) -> bool {
        other
            .alternatives()
            .flat_map(|head| core::iter::successors(Some(head), |query| query.next.as_deref()))
            .flat_map(|query| [query.range.left, query.range.right])
            .any(|comparator| {
                let mut version = comparator.version;
                if comparator.op == Op::Lt && version.tag.eql(Tag::ZERO_PRE) {
                    version.tag = Tag::default();
                }
                self.satisfies(version, self_buf, other_buf)
            })
    }
}
