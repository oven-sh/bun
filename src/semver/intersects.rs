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

    /// The same versions, with one way to write a bound: `parse` makes `>1.MAX.MAX` of `>1`, `<=1.MAX.MAX` of `<=1`
    /// and `>=0.0.0` of `*`, which are `>=2.0.0`, `<2.0.0` and no bound.
    fn canonical(&self) -> Self {
        let mut out = *self;
        if let Some(lower) = &mut out.lower
            && !lower.inclusive
            && is_last_patch(lower.version)
            && let Some(next) = after_last_patch(lower.version)
        {
            lower.version = next;
            lower.inclusive = true;
        }
        if out
            .lower
            .is_some_and(|it| it.inclusive && it.version.is_zero() && !it.version.tag.has_pre())
        {
            out.lower = None;
        }
        if let Some(upper) = out.upper
            && upper.inclusive
            && is_last_patch(upper.version)
        {
            out.upper = after_last_patch(upper.version).map(|version| Bound {
                version,
                inclusive: false,
                ..upper
            });
        }
        out
    }

    /// Whether everything between the bounds of `self` is between those of `other`.
    fn is_within(&self, other: &Interval<'_>) -> bool {
        let lower = match (self.lower, other.lower) {
            (_, None) => true,
            (None, Some(_)) => false,
            (Some(a), Some(b)) => match a.version.order_without_build(b.version, a.buf, b.buf) {
                Ordering::Greater => true,
                Ordering::Equal => b.inclusive || !a.inclusive,
                Ordering::Less => false,
            },
        };
        let upper = match (self.upper, other.upper) {
            (_, None) => true,
            (None, Some(_)) => false,
            (Some(a), Some(b)) => match a.version.order_without_build(b.version, a.buf, b.buf) {
                Ordering::Less => true,
                Ordering::Equal => b.inclusive || !a.inclusive,
                Ordering::Greater => false,
            },
        };
        lower && upper
    }

    /// The only prereleases that satisfy a query are those of the `major.minor.patch` of a comparator that is one:
    /// whether `query` has such a comparator for each bound of `self` that is one.
    fn prereleases_can_satisfy(&self, query: &Query) -> bool {
        let lower = self.lower.filter(|it| it.version.tag.has_pre());
        // Nothing is below `1.2.3-0`.
        let upper = self.upper.filter(|it| {
            it.version.tag.has_pre() && (it.inclusive || it.version.tag.pre.slice(it.buf) != b"0")
        });
        lower.into_iter().chain(upper).all(|bound| {
            let is_prerelease_of_it = |c: Comparator| {
                c.op != Op::Unset
                    && c.version.tag.has_pre()
                    && c.version.major == bound.version.major
                    && c.version.minor == bound.version.minor
                    && c.version.patch == bound.version.patch
            };
            let mut cur = Some(query);
            while let Some(q) = cur {
                if is_prerelease_of_it(q.range.left) || is_prerelease_of_it(q.range.right) {
                    return true;
                }
                cur = q.next.as_deref();
            }
            false
        })
    }
}

fn is_last_patch(version: Version) -> bool {
    version.patch == u64::MAX && !version.tag.has_pre()
}

/// What follows `major.minor.MAX`, if anything does.
fn after_last_patch(version: Version) -> Option<Version> {
    Some(match version.minor.checked_add(1) {
        Some(minor) => Version {
            major: version.major,
            minor,
            ..Default::default()
        },
        None => Version {
            major: version.major.checked_add(1)?,
            ..Default::default()
        },
    })
}

impl Group {
    /// Whether some version satisfies both groups; prerelease-exclusion rules are not modelled, comparators are compared directly.
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
                if i.is_non_empty() {
                    return true;
                }
            }
        }
        false
    }

    /// Whether every version that satisfies `self` satisfies `other`. As for npm's `subset`, each `||` alternative of `self`
    /// has to be within a single alternative of `other`: `>=1` is not a subset of `1 || >=2`.
    pub fn is_subset_of(&self, self_buf: &[u8], other: &Group, other_buf: &[u8]) -> bool {
        let mut a = Some(&self.head);
        'alternatives: while let Some(list_a) = a {
            a = list_a.next.as_deref();
            let mut sub = Interval::default();
            sub.and_query(&list_a.head, self_buf);
            let sub = sub.canonical();
            if !sub.is_non_empty() {
                continue;
            }
            let mut b = Some(&other.head);
            while let Some(list_b) = b {
                b = list_b.next.as_deref();
                let mut dom = Interval::default();
                dom.and_query(&list_b.head, other_buf);
                if sub.is_within(&dom.canonical()) && sub.prereleases_can_satisfy(&list_b.head) {
                    continue 'alternatives;
                }
            }
            return false;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use crate::SlicedString;
    use crate::query::{Group, parse};

    fn group(text: &str) -> Group {
        let bytes = text.as_bytes();
        parse(bytes, SlicedString::init(bytes, bytes)).unwrap()
    }

    #[test]
    fn is_subset_of() {
        // What npm's `subset` says, but where noted: there a check of all versions agrees with this one.
        let cases = [
            (">=16.0.0", ">=16.0.0", true),
            (">=16.0.0", ">=16.0.1", false),
            (">=16.0.1", ">=16.0.0", true),
            (">16.0.0", ">=16.0.0", true),
            (">=16.0.0", ">16.0.0", false),
            ("16.3.1", ">=16.0.0", true),
            ("16.3.1", "^16.4.0", false),
            ("16.3.1", "16.3.1", true),
            ("^16.3.1", "16.3.1", false),
            ("^16", "^16.0.0", true),
            ("^16.3", "^16", true),
            ("^16", "^16.3", false),
            ("~16.3", "^16.3.0", true),
            ("16.x", ">=16 <17", true),
            ("16", "16.x", true),
            ("^18 || ^20", ">=18", true),
            ("^18 || ^20", "^18.0.0 || ^20.0.0 || >=22.0.0", true),
            ("^18 || ^20 || ^21", "^18.0.0 || ^20.0.0 || >=22.0.0", false),
            (">=18", "^18.0.0 || >=19.0.0", false),
            (">=1", "1 || >=2", false),
            (">=18 <20", ">=18", true),
            (">=18", ">=18 <20", false),
            ("<6.0.0", ">=0.10.0", false),
            ("<6.0.0", "<6.0.0", true),
            ("<6.0.0", "<=6.0.0", true),
            ("<=6.0.0", "<6.0.0", false),
            (">16", ">=17.0.0", true),
            (">=17.0.0", ">16", true),
            (">16.3", ">=16.4.0", true),
            ("<=16", "<17.0.0", true),
            ("<17.0.0", "<=16", true), // npm: false
            ("<=16.3", "<16.4.0", true),
            ("<=16", "<=16.99.0", false),
            (">16 <17.0.0", "1.0.0", true),
            ("*", "*", true),
            ("", "*", true),
            ("*", ">=0.0.0", true),
            (">=1", "*", true),
            ("*", ">=1", false),
            ("<5", "*", true), // npm: false
            ("<5", ">=0.0.0 <6", true),
            ("16 - 18", ">=16 <19", true),
            ("16 - 18.2.1", "<=18.2.1", true),
            ("16 - 18.2.1", "<18.2.1", false),
            (">2 <1", ">=16", true),
            (">=16 || >2 <1", ">=16", true), // npm: false
            (">=16", "<0", false),
            ("<0", "<0", true),
            (">=20.19.0 <21.0.0", "^20.10.0", true), // npm: false
            (">=20.19.0 <21", "^20.10.0", true),
            (">=20.19.0 <21.0.0-0", "^20.10.0", true),
            ("^20.10.0", ">=20.10.0 <21.0.0", true),
            (">=22.0.0-rc.1", ">=20.0.0", false),
            (">=22.0.0-rc.1", ">=22.0.0-alpha", true),
            (">=22.0.0-alpha", ">=22.0.0-rc.1", false),
            (">=1.0.0 <2.0.0-rc", "^1.0.0", false),
            (">=1.0.0 <2.0.0-rc", ">=1.0.0 <2.0.0-rc.1", true),
            ("1.2.3-beta", ">=1.2.3-alpha", true),
            ("1.2.3-beta", ">=1.2.3-alpha <2.0.0", true), // npm: false
            ("1.2.3-beta", ">=1.2.0", false),
            (
                ">=1.2.3-a.very.long.prerelease.2",
                ">=1.2.3-a.very.long.prerelease.1",
                true,
            ),
            (
                ">=1.2.3-a.very.long.prerelease.1",
                ">=1.2.3-a.very.long.prerelease.2",
                false,
            ),
        ];
        for (sub, dom, expected) in cases {
            assert_eq!(
                group(sub).is_subset_of(sub.as_bytes(), &group(dom), dom.as_bytes()),
                expected,
                "{sub:?} in {dom:?}"
            );
        }
    }
}
