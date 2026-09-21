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
}
