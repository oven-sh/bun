use core::fmt;
use core::ptr::NonNull;

use bun_alloc::AllocError;
use bun_collections::IntegerBitSet;
use bun_core::strings;

use crate::range::{Comparator, Op as RangeOp};
use crate::{Range, SlicedString, Version, version};

// Re-export sub-namespace so
// `crate::query::token::Wildcard` resolves for sibling modules.
pub mod token {
    pub use super::{Token, TokenTag, Wildcard};
}

/// Linked-list of AND ranges
/// "^1 ^2"
/// ----|-----
/// That is two Query
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Op {
    None,
    And,
    Or,
}

#[derive(Default)]
pub struct Query {
    pub range: Range,

    // AND
    pub next: Option<Box<Query>>,
}

impl Clone for Query {
    fn clone(&self) -> Self {
        let mut out = Query {
            range: self.range,
            next: None,
        };
        let mut src = &self.next;
        let mut dst = &mut out.next;
        while let Some(node) = src {
            let slot = dst.insert(Box::new(Query {
                range: node.range,
                next: None,
            }));
            src = &node.next;
            dst = &mut slot.next;
        }
        out
    }
}

impl Drop for Query {
    fn drop(&mut self) {
        // Unlink the chain iteratively so the derived recursive drop glue
        // can't overflow the stack on very long AND chains.
        let mut next = self.next.take();
        while let Some(mut node) = next {
            next = node.next.take();
        }
    }
}

pub struct QueryFormatter<'a> {
    query: &'a Query,
    buffer: &'a [u8],
}

impl<'a> fmt::Display for QueryFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let this = self.query;

        if let Some(ptr) = &this.next {
            if ptr.range.has_left() || ptr.range.has_right() {
                return write!(
                    f,
                    "{} && {}",
                    this.range.fmt(self.buffer),
                    ptr.range.fmt(self.buffer)
                );
            }
        }

        write!(f, "{}", this.range.fmt(self.buffer))
    }
}

impl Query {
    pub fn fmt<'a>(&'a self, buf: &'a [u8]) -> QueryFormatter<'a> {
        QueryFormatter {
            query: self,
            buffer: buf,
        }
    }

    pub fn eql(&self, rhs: &Query) -> bool {
        let mut lhs = self;
        let mut rhs = rhs;
        loop {
            if !lhs.range.eql(&rhs.range) {
                return false;
            }

            let lhs_next = match &lhs.next {
                Some(n) => n,
                None => return rhs.next.is_none(),
            };
            let rhs_next = match &rhs.next {
                Some(n) => n,
                None => return false,
            };

            lhs = lhs_next;
            rhs = rhs_next;
        }
    }

    pub fn satisfies(&self, version: Version, query_buf: &[u8], version_buf: &[u8]) -> bool {
        let mut node = self;
        loop {
            if !node.range.satisfies(version, query_buf, version_buf) {
                return false;
            }
            match &node.next {
                Some(next) => node = next,
                None => return true,
            }
        }
    }

    pub fn satisfies_pre(
        &self,
        version: Version,
        query_buf: &[u8],
        version_buf: &[u8],
        pre_matched: &mut bool,
    ) -> bool {
        if cfg!(debug_assertions) {
            debug_assert!(version.tag.has_pre());
        }
        let mut node = self;
        loop {
            if !node
                .range
                .satisfies_pre(version, query_buf, version_buf, pre_matched)
            {
                return false;
            }
            match &node.next {
                Some(next) => node = next,
                None => return true,
            }
        }
    }
}

/// Linked-list of Queries OR'd together
/// "^1 || ^2"
/// ----|-----
/// That is two List
#[derive(Default)]
pub struct List {
    pub head: Query,
    // BACKREF: alias into self.head.next chain
    pub tail: Option<NonNull<Query>>,

    // OR
    pub next: Option<Box<List>>,
}

// SAFETY: `tail` is a self-referential backref into the `head.next` chain owned
// by this `List` (see `and_range`); it never aliases data owned by another
// thread, so the whole structure moves between threads as a unit (the lockfile
// thread pool relies on this). Auto-`!Send` from `NonNull` is overly
// conservative here.
unsafe impl Send for List {}
// SAFETY: `tail` is only dereferenced through `&mut self` (see `and_range`);
// `&List` exposes no unsynchronized interior mutability.
unsafe impl Sync for List {}

impl Drop for List {
    fn drop(&mut self) {
        // Unlink the chain iteratively so the derived recursive drop glue
        // can't overflow the stack on very long OR chains.
        let mut next = self.next.take();
        while let Some(mut node) = next {
            next = node.next.take();
        }
    }
}

impl Clone for List {
    fn clone(&self) -> Self {
        let mut out = List {
            head: self.head.clone(),
            tail: None,
            next: None,
        };
        if out.head.next.is_some() {
            let mut tail = NonNull::from(&mut out.head);
            // SAFETY: `tail` walks `out.head`'s exclusively-owned Box chain.
            while let Some(next) = unsafe { tail.as_mut() }.next.as_deref_mut() {
                tail = NonNull::from(next);
            }
            out.tail = Some(tail);
        }

        let mut src = &self.next;
        let mut dst = &mut out.next;
        while let Some(node) = src {
            let slot = dst.insert(Box::new(List {
                head: node.head.clone(),
                tail: None,
                next: None,
            }));
            if slot.head.next.is_some() {
                let mut tail = NonNull::from(&mut slot.head);
                // SAFETY: `tail` walks `slot.head`'s exclusively-owned Box chain.
                while let Some(next) = unsafe { tail.as_mut() }.next.as_deref_mut() {
                    tail = NonNull::from(next);
                }
                slot.tail = Some(tail);
            }
            src = &node.next;
            dst = &mut slot.next;
        }
        out
    }
}

pub struct ListFormatter<'a> {
    list: &'a List,
    buffer: &'a [u8],
}

impl<'a> fmt::Display for ListFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut this = self.list;

        while let Some(ptr) = &this.next {
            write!(f, "{} || ", this.head.fmt(self.buffer))?;
            this = ptr;
        }

        write!(f, "{}", this.head.fmt(self.buffer))
    }
}

impl List {
    pub fn fmt<'a>(&'a self, buf: &'a [u8]) -> ListFormatter<'a> {
        ListFormatter {
            list: self,
            buffer: buf,
        }
    }

    pub fn satisfies(&self, version: Version, list_buf: &[u8], version_buf: &[u8]) -> bool {
        let mut node = self;
        loop {
            if node.head.satisfies(version, list_buf, version_buf) {
                return true;
            }
            match &node.next {
                Some(next) => node = next,
                None => return false,
            }
        }
    }

    pub fn satisfies_pre(&self, version: Version, list_buf: &[u8], version_buf: &[u8]) -> bool {
        if cfg!(debug_assertions) {
            debug_assert!(version.tag.has_pre());
        }

        // `version` has a prerelease tag:
        // - needs to satisfy each comparator in the query (<comparator> AND <comparator> AND ...) like normal comparison
        // - if it does, also needs to match major, minor, patch with at least one of the other versions
        //   with a prerelease
        // https://github.com/npm/node-semver/blob/ac9b35769ab0ddfefd5a3af4a3ecaf3da2012352/classes/range.js#L505
        let mut node = self;
        loop {
            let mut pre_matched = false;
            if node
                .head
                .satisfies_pre(version, list_buf, version_buf, &mut pre_matched)
                && pre_matched
            {
                return true;
            }
            match &node.next {
                Some(next) => node = next,
                None => return false,
            }
        }
    }

    pub fn eql(&self, rhs: &List) -> bool {
        let mut lhs = self;
        let mut rhs = rhs;
        loop {
            if !lhs.head.eql(&rhs.head) {
                return false;
            }

            let lhs_next = match &lhs.next {
                Some(n) => n,
                None => return rhs.next.is_none(),
            };
            let rhs_next = match &rhs.next {
                Some(n) => n,
                None => return false,
            };

            lhs = lhs_next;
            rhs = rhs_next;
        }
    }

    pub fn and_range(&mut self, range: &Range) -> Result<(), AllocError> {
        if !self.head.range.has_left() && !self.head.range.has_right() {
            self.head.range = *range;
            return Ok(());
        }

        let mut tail = Box::new(Query {
            range: *range,
            next: None,
        });
        tail.range = *range;

        let tail_ptr = NonNull::from(&mut *tail);

        let last_tail: &mut Query = match self.tail {
            // SAFETY: self.tail aliases a Query owned by self.head.next chain; we hold &mut self.
            Some(mut p) => unsafe { p.as_mut() },
            None => &mut self.head,
        };
        last_tail.next = Some(tail);
        self.tail = Some(tail_ptr);
        Ok(())
    }
}

pub(crate) type FlagsBitSet = IntegerBitSet<3>;

pub struct Flags;
impl Flags {
    pub const PRE: usize = 1;
    pub const BUILD: usize = 0;
}

pub struct Group {
    pub head: List,
    // BACKREF: alias into self.head.next chain
    pub tail: Option<NonNull<List>>,
    /// Borrowed view into the caller's source buffer.
    /// Stored as a raw fat pointer
    /// (parser-owned, never freed) so `Group` carries no lifetime parameter and
    /// can be embedded in lockfile types (`NpmInfo`). Only dereferenced in
    /// `json_stringify`; caller must keep the source buffer alive for that call.
    pub input: *const [u8],

    pub flags: FlagsBitSet,
}

// SAFETY: `tail` is a self-referential backref into the `head.next` chain owned
// by this `Group` (see `or_version`); `input` is a lifetime-erased borrow into
// the caller's source buffer and is
// only dereferenced under the same single-thread parse/stringify call. Neither
// pointer aliases data owned by another thread, so the whole structure moves
// between threads as a unit (the lockfile/resolver thread pool relies on this);
// auto-`!Send` from `NonNull`/`*const` is overly conservative here.
unsafe impl Send for Group {}
// SAFETY: `tail` is only dereferenced through `&mut self` and `input` points
// to immutable bytes; `&Group` exposes no unsynchronized interior mutability.
unsafe impl Sync for Group {}

impl Clone for Group {
    fn clone(&self) -> Self {
        let mut out = Group {
            head: self.head.clone(),
            tail: None,
            input: self.input,
            flags: self.flags,
        };
        if out.head.next.is_some() {
            let mut tail = NonNull::from(&mut out.head);
            // SAFETY: `tail` walks `out.head`'s exclusively-owned Box chain.
            while let Some(next) = unsafe { tail.as_mut() }.next.as_deref_mut() {
                tail = NonNull::from(next);
            }
            out.tail = Some(tail);
        }
        out
    }
}

impl Default for Group {
    fn default() -> Self {
        Self {
            head: List::default(),
            tail: None,
            input: std::ptr::from_ref::<[u8]>(b""),
            flags: FlagsBitSet::init_empty(),
        }
    }
}

pub struct GroupFormatter<'a> {
    group: &'a Group,
    buf: &'a [u8],
}

impl<'a> fmt::Display for GroupFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let this = self.group;

        if this.tail.is_none() && this.head.tail.is_none() && !this.head.head.range.has_left() {
            return Ok(());
        }

        if this.tail.is_none() && this.head.tail.is_none() {
            return write!(f, "{}", this.head.fmt(self.buf));
        }

        let mut list = &this.head;
        while let Some(next) = &list.next {
            write!(f, "{} && ", list.fmt(self.buf))?;
            list = next;
        }

        write!(f, "{}", list.fmt(self.buf))
    }
}

impl Group {
    pub fn fmt<'b>(&'b self, buf: &'b [u8]) -> GroupFormatter<'b> {
        GroupFormatter { group: self, buf }
    }

    pub fn json_stringify(&self, writer: &mut impl core::fmt::Write) -> fmt::Result {
        let temp = {
            use std::io::Write as _;
            let mut v: Vec<u8> = Vec::new();
            // SAFETY: `input` points into the parse source buffer which the
            // caller must keep alive for the lifetime of this Group (see the
            // `input` field doc).
            let input = unsafe { &*self.input };
            let _ = write!(&mut v, "{}", self.fmt(input));
            v
        };
        bun_core::fmt::encode_json_string(writer, &temp)
    }

    // `deinit` deleted — `next: Option<Box<..>>` chains are freed by the
    // iterative `Drop` impls on `Query` and `List`.

    pub fn get_exact_version(&self) -> Option<Version> {
        let range = &self.head.head.range;
        if self.head.next.is_none()
            && self.head.head.next.is_none()
            && range.has_left()
            && range.left.op == RangeOp::Eql
            && !range.has_right()
        {
            if cfg!(debug_assertions) {
                debug_assert!(self.tail.is_none());
            }
            return Some(range.left.version);
        }

        None
    }

    pub fn from(version: Version) -> Group {
        Group {
            head: List {
                head: Query {
                    range: Range {
                        left: Comparator {
                            op: RangeOp::Eql,
                            version,
                        },
                        ..Default::default()
                    },
                    next: None,
                },
                tail: None,
                next: None,
            },
            ..Default::default()
        }
    }

    pub fn is_exact(&self) -> bool {
        self.head.next.is_none()
            && self.head.head.next.is_none()
            && !self.head.head.range.has_right()
            && self.head.head.range.left.op == RangeOp::Eql
    }

    pub fn is_star(&self) -> bool {
        let left = &self.head.head.range.left;
        self.head.head.range.right.op == RangeOp::Unset
            && left.op == RangeOp::Gte
            && self.head.next.is_none()
            && self.head.head.next.is_none()
            && left.version.is_zero()
            && !self.flags.is_set(Flags::BUILD)
    }

    #[inline]
    pub fn eql(&self, rhs: &Group) -> bool {
        self.head.eql(&rhs.head)
    }

    pub fn to_version(&self) -> Version {
        debug_assert!(self.is_exact() || self.head.head.range.left.op == RangeOp::Unset);
        self.head.head.range.left.version
    }

    pub fn or_version(&mut self, version: Version) -> Result<(), AllocError> {
        if self.tail.is_none() && !self.head.head.range.has_left() {
            self.head.head.range.left.version = version;
            self.head.head.range.left.op = RangeOp::Eql;
            return Ok(());
        }

        let mut new_tail = Box::new(List::default());
        new_tail.head.range.left.version = version;
        new_tail.head.range.left.op = RangeOp::Eql;

        let new_tail_ptr = NonNull::from(&mut *new_tail);

        let prev_tail: &mut List = match self.tail {
            // SAFETY: self.tail aliases a List owned by self.head.next chain; we hold &mut self.
            Some(mut p) => unsafe { p.as_mut() },
            None => &mut self.head,
        };
        prev_tail.next = Some(new_tail);
        self.tail = Some(new_tail_ptr);
        Ok(())
    }

    pub fn and_range(&mut self, range: &Range) -> Result<(), AllocError> {
        let tail: &mut List = match self.tail {
            // SAFETY: self.tail aliases a List owned by self.head.next chain; we hold &mut self.
            Some(mut p) => unsafe { p.as_mut() },
            None => &mut self.head,
        };
        tail.and_range(range)
    }

    pub fn or_range(&mut self, range: &Range) -> Result<(), AllocError> {
        if self.tail.is_none() && self.head.tail.is_none() && !self.head.head.range.has_left() {
            self.head.head.range = *range;
            return Ok(());
        }

        let mut new_tail = Box::new(List::default());
        new_tail.head.range = *range;

        let new_tail_ptr = NonNull::from(&mut *new_tail);

        let prev_tail: &mut List = match self.tail {
            // SAFETY: self.tail aliases a List owned by self.head.next chain; we hold &mut self.
            Some(mut p) => unsafe { p.as_mut() },
            None => &mut self.head,
        };
        prev_tail.next = Some(new_tail);
        self.tail = Some(new_tail_ptr);
        Ok(())
    }

    #[inline]
    pub fn satisfies(&self, version: Version, group_buf: &[u8], version_buf: &[u8]) -> bool {
        if version.tag.has_pre() {
            self.head.satisfies_pre(version, group_buf, version_buf)
        } else {
            self.head.satisfies(version, group_buf, version_buf)
        }
    }
}

#[derive(Clone, Copy, Default)]
pub struct Token {
    pub tag: TokenTag,
    pub wildcard: Wildcard,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum TokenTag {
    #[default]
    None,
    Gt,
    Gte,
    Lt,
    Lte,
    Version,
    Tilda,
    Caret,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Wildcard {
    #[default]
    None,
    Major,
    Minor,
    Patch,
}

impl Token {
    pub fn to_range(self, version: &version::Partial<u64>) -> Range {
        match self.tag {
            // Allows changes that do not modify the left-most non-zero element in the [major, minor, patch] tuple
            TokenTag::Caret => {
                // https://github.com/npm/node-semver/blob/3a8a4309ae986c1967b3073ba88c9e69433d44cb/classes/range.js#L302-L353
                let mut range = Range::default();
                'done: {
                    let Some(major) = version.major else {
                        break 'done;
                    };
                    range.left = Comparator {
                        op: RangeOp::Gte,
                        version: Version {
                            major,
                            ..Default::default()
                        },
                    };
                    if let Some(minor) = version.minor {
                        range.left.version.minor = minor;
                        if let Some(patch) = version.patch {
                            range.left.version.patch = patch;
                            range.left.version.tag = version.tag;
                            if major == 0 {
                                range.right = if minor == 0 {
                                    Comparator::lt_next_patch(0, 0, patch)
                                } else {
                                    Comparator::lt_next_minor(0, minor)
                                };
                                break 'done;
                            }
                        } else if major == 0 {
                            range.right = Comparator::lt_next_minor(0, minor);
                            break 'done;
                        }
                    }
                    range.right = Comparator::lt_next_major(major);
                }
                return range;
            }
            TokenTag::Tilda => {
                // https://github.com/npm/node-semver/blob/3a8a4309ae986c1967b3073ba88c9e69433d44cb/classes/range.js#L261-L287
                let mut range = Range::default();
                'done: {
                    let Some(major) = version.major else {
                        break 'done;
                    };
                    range.left = Comparator {
                        op: RangeOp::Gte,
                        version: Version {
                            major,
                            ..Default::default()
                        },
                    };
                    if let Some(minor) = version.minor {
                        range.left.version.minor = minor;
                        if let Some(patch) = version.patch {
                            range.left.version.patch = patch;
                            range.left.version.tag = version.tag;
                        }
                        range.right = Comparator::lt_next_minor(major, minor);
                        break 'done;
                    }
                    range.right = Comparator::lt_next_major(major);
                }
                return range;
            }
            TokenTag::None => unreachable!(),
            TokenTag::Version => {
                if self.wildcard != Wildcard::None {
                    return Range::init_wildcard(version.min(), self.wildcard);
                }

                return Range {
                    left: Comparator {
                        op: RangeOp::Eql,
                        version: version.min(),
                    },
                    ..Default::default()
                };
            }
            _ => {}
        }

        match self.wildcard {
            Wildcard::Major => Range {
                left: Comparator {
                    op: RangeOp::Gte,
                    version: version.min(),
                },
                right: Comparator {
                    op: RangeOp::Lte,
                    version: Version {
                        major: u64::MAX,
                        minor: u64::MAX,
                        patch: u64::MAX,
                        ..Default::default()
                    },
                },
            },
            Wildcard::Minor => match self.tag {
                TokenTag::Lte => Range {
                    left: Comparator {
                        op: RangeOp::Lte,
                        version: Version {
                            major: version.major.unwrap_or(0),
                            minor: u64::MAX,
                            patch: u64::MAX,
                            ..Default::default()
                        },
                    },
                    ..Default::default()
                },
                TokenTag::Lt => Range {
                    left: Comparator {
                        op: RangeOp::Lt,
                        version: Version {
                            major: version.major.unwrap_or(0),
                            minor: 0,
                            patch: 0,
                            ..Default::default()
                        },
                    },
                    ..Default::default()
                },
                TokenTag::Gt => Range {
                    left: Comparator {
                        op: RangeOp::Gt,
                        version: Version {
                            major: version.major.unwrap_or(0),
                            minor: u64::MAX,
                            patch: u64::MAX,
                            ..Default::default()
                        },
                    },
                    ..Default::default()
                },
                TokenTag::Gte => Range {
                    left: Comparator {
                        op: RangeOp::Gte,
                        version: Version {
                            major: version.major.unwrap_or(0),
                            minor: 0,
                            patch: 0,
                            ..Default::default()
                        },
                    },
                    ..Default::default()
                },
                _ => unreachable!(),
            },
            Wildcard::Patch => match self.tag {
                TokenTag::Lte => Range {
                    left: Comparator {
                        op: RangeOp::Lte,
                        version: Version {
                            major: version.major.unwrap_or(0),
                            minor: version.minor.unwrap_or(0),
                            patch: u64::MAX,
                            ..Default::default()
                        },
                    },
                    ..Default::default()
                },
                TokenTag::Lt => Range {
                    left: Comparator {
                        op: RangeOp::Lt,
                        version: Version {
                            major: version.major.unwrap_or(0),
                            minor: version.minor.unwrap_or(0),
                            patch: 0,
                            ..Default::default()
                        },
                    },
                    ..Default::default()
                },
                TokenTag::Gt => Range {
                    left: Comparator {
                        op: RangeOp::Gt,
                        version: Version {
                            major: version.major.unwrap_or(0),
                            minor: version.minor.unwrap_or(0),
                            patch: u64::MAX,
                            ..Default::default()
                        },
                    },
                    ..Default::default()
                },
                TokenTag::Gte => Range {
                    left: Comparator {
                        op: RangeOp::Gte,
                        version: Version {
                            major: version.major.unwrap_or(0),
                            minor: version.minor.unwrap_or(0),
                            patch: 0,
                            ..Default::default()
                        },
                    },
                    ..Default::default()
                },
                _ => unreachable!(),
            },
            Wildcard::None => Range {
                left: Comparator {
                    op: match self.tag {
                        TokenTag::Gt => RangeOp::Gt,
                        TokenTag::Gte => RangeOp::Gte,
                        TokenTag::Lt => RangeOp::Lt,
                        TokenTag::Lte => RangeOp::Lte,
                        _ => unreachable!(),
                    },
                    version: version.min(),
                },
                ..Default::default()
            },
        }
    }
}

pub fn parse(input: &[u8], sliced: SlicedString) -> Result<Group, AllocError> {
    let mut i: usize = 0;
    let mut list = Group {
        input: std::ptr::from_ref::<[u8]>(input),
        head: List::default(),
        tail: None,
        flags: FlagsBitSet::init_empty(),
    };

    let mut token = Token::default();

    let mut count: u32 = 0;
    let mut skip_round;
    let mut is_or = false;

    while i < input.len() {
        skip_round = false;

        match input[i] {
            b'>' => {
                if input.len() > i + 1 && input[i + 1] == b'=' {
                    token.tag = TokenTag::Gte;
                    i += 1;
                } else {
                    token.tag = TokenTag::Gt;
                }

                i += 1;
                while i < input.len() && input[i] == b' ' {
                    i += 1;
                }
            }
            b'<' => {
                if input.len() > i + 1 && input[i + 1] == b'=' {
                    token.tag = TokenTag::Lte;
                    i += 1;
                } else {
                    token.tag = TokenTag::Lt;
                }

                i += 1;
                while i < input.len() && input[i] == b' ' {
                    i += 1;
                }
            }
            b'=' | b'v' => {
                token.tag = TokenTag::Version;
                is_or = true;
                i += 1;
                while i < input.len() && input[i] == b' ' {
                    i += 1;
                }
            }
            b'~' => {
                token.tag = TokenTag::Tilda;
                i += 1;

                if i < input.len() && input[i] == b'>' {
                    i += 1;
                }

                while i < input.len() && input[i] == b' ' {
                    i += 1;
                }
            }
            b'^' => {
                token.tag = TokenTag::Caret;
                i += 1;
                while i < input.len() && input[i] == b' ' {
                    i += 1;
                }
            }
            b'0'..=b'9' | b'X' | b'x' | b'*' => {
                token.tag = TokenTag::Version;
                is_or = true;
            }
            b'|' => {
                i += 1;

                while i < input.len() && input[i] == b'|' {
                    i += 1;
                }
                while i < input.len() && input[i] == b' ' {
                    i += 1;
                }
                is_or = true;
                token.tag = TokenTag::None;
                skip_round = true;
            }
            b'-' => {
                i += 1;
                while i < input.len() && input[i] == b' ' {
                    i += 1;
                }
            }
            b' ' => {
                i += 1;
                while i < input.len() && input[i] == b' ' {
                    i += 1;
                }
                skip_round = true;
            }
            _ => {
                i += 1;
                token.tag = TokenTag::None;

                // skip tagged versions
                // we are assuming this is the beginning of a tagged version like "boop"
                // "1.0.0 || boop"
                while i < input.len() && input[i] != b' ' && input[i] != b'|' {
                    i += 1;
                }
                skip_round = true;
            }
        }

        if !skip_round {
            let parse_result = Version::parse(sliced.sub(&input[i..]));
            let version = parse_result.version.min();
            if version.tag.has_build() {
                list.flags.set_value(Flags::BUILD, true);
            }
            if version.tag.has_pre() {
                list.flags.set_value(Flags::PRE, true);
            }

            token.wildcard = parse_result.wildcard;

            i += parse_result.len as usize;
            let rollback = i;

            let maybe_hyphenate = i < input.len() && (input[i] == b' ' || input[i] == b'-');

            // TODO: can we do this without rolling back?
            let hyphenate: bool = maybe_hyphenate
                && 'possibly_hyphenate: {
                    i += strings::length_of_leading_whitespace_ascii(&input[i..]);
                    if !(i < input.len() && input[i] == b'-') {
                        break 'possibly_hyphenate false;
                    }
                    i += 1;
                    i += strings::length_of_leading_whitespace_ascii(&input[i..]);
                    if i == input.len() {
                        break 'possibly_hyphenate false;
                    }
                    if input[i] == b'v' || input[i] == b'=' {
                        i += 1;
                    }
                    if i == input.len() {
                        break 'possibly_hyphenate false;
                    }
                    i += strings::length_of_leading_whitespace_ascii(&input[i..]);
                    if i == input.len() {
                        break 'possibly_hyphenate false;
                    }

                    if !(i < input.len() && matches!(input[i], b'0'..=b'9' | b'X' | b'x' | b'*')) {
                        break 'possibly_hyphenate false;
                    }

                    true
                };

            if !hyphenate {
                i = rollback;
            }
            i += (!hyphenate) as usize;

            if hyphenate {
                let second_parsed = Version::parse(sliced.sub(&input[i..]));
                let mut second_version = second_parsed.version.min();
                if second_version.tag.has_build() {
                    list.flags.set_value(Flags::BUILD, true);
                }
                if second_version.tag.has_pre() {
                    list.flags.set_value(Flags::PRE, true);
                }
                let range: Range = match second_parsed.wildcard {
                    Wildcard::Major => {
                        // "1.0.0 - x" --> ">=1.0.0"
                        Range {
                            left: Comparator {
                                op: RangeOp::Gte,
                                version,
                            },
                            ..Default::default()
                        }
                    }
                    Wildcard::Minor => {
                        // "1.0.0 - 1.x" --> ">=1.0.0 < 2.0.0"
                        let right = match second_version.major.checked_add(1) {
                            Some(m) => {
                                second_version.major = m;
                                second_version.minor = 0;
                                second_version.patch = 0;
                                Comparator {
                                    op: RangeOp::Lt,
                                    version: second_version,
                                }
                            }
                            None => Comparator::lt_next_major(second_version.major),
                        };

                        Range {
                            left: Comparator {
                                op: RangeOp::Gte,
                                version,
                            },
                            right,
                        }
                    }
                    Wildcard::Patch => {
                        // "1.0.0 - 1.0.x" --> ">=1.0.0 <1.1.0"
                        let right = match second_version.minor.checked_add(1) {
                            Some(m) => {
                                second_version.minor = m;
                                second_version.patch = 0;
                                Comparator {
                                    op: RangeOp::Lt,
                                    version: second_version,
                                }
                            }
                            None => Comparator::lt_next_minor(
                                second_version.major,
                                second_version.minor,
                            ),
                        };

                        Range {
                            left: Comparator {
                                op: RangeOp::Gte,
                                version,
                            },
                            right,
                        }
                    }
                    Wildcard::None => Range {
                        left: Comparator {
                            op: RangeOp::Gte,
                            version,
                        },
                        right: Comparator {
                            op: RangeOp::Lte,
                            version: second_version,
                        },
                    },
                };

                if is_or {
                    list.or_range(&range)?;
                } else {
                    list.and_range(&range)?;
                }

                i += second_parsed.len as usize + 1;
            } else if token.tag == TokenTag::None {
                // No pending comparator token for this chunk, so skip it instead of
                // emitting a comparator, the same way skipped tags like "boop" in
                // "1.0.0 || boop" are ignored (any pending "||" is preserved). This
                // covers a leading "--foo" (treat "--foo" the same as "-foo", example:
                // foo/bar@1.2.3@--canary.24) as well as a dangling "-" after a skipped
                // tag, like "1 || - foo".
                token.wildcard = Wildcard::None;
                continue;
            } else if count == 0 && token.tag == TokenTag::Version {
                match parse_result.wildcard {
                    Wildcard::None => {
                        list.or_version(version)?;
                    }
                    _ => {
                        list.or_range(&token.to_range(&parse_result.version))?;
                    }
                }
            } else if count == 0 {
                list.and_range(&token.to_range(&parse_result.version))?;
            } else if is_or {
                list.or_range(&token.to_range(&parse_result.version))?;
            } else {
                list.and_range(&token.to_range(&parse_result.version))?;
            }

            is_or = false;
            count += 1;
            token.wildcard = Wildcard::None;
        }
    }

    Ok(list)
}
