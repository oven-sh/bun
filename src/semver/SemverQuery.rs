use core::fmt;
use core::ptr::NonNull;

use bun_alloc::AllocError;
use bun_collections::IntegerBitSet;
use bun_str::strings;

use crate::range::{self, Comparator, Op as RangeOp};
use crate::{version, Range, SlicedString, Version};

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
        QueryFormatter { query: self, buffer: buf }
    }

    pub fn eql(&self, rhs: &Query) -> bool {
        if !self.range.eql(&rhs.range) {
            return false;
        }

        let lhs_next = match &self.next {
            Some(n) => n,
            None => return rhs.next.is_none(),
        };
        let rhs_next = match &rhs.next {
            Some(n) => n,
            None => return false,
        };

        lhs_next.eql(rhs_next)
    }

    pub fn satisfies(&self, version: Version, query_buf: &[u8], version_buf: &[u8]) -> bool {
        self.range.satisfies(version, query_buf, version_buf)
            && match &self.next {
                Some(next) => next.satisfies(version, query_buf, version_buf),
                None => return true,
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
        self.range
            .satisfies_pre(version, query_buf, version_buf, pre_matched)
            && match &self.next {
                Some(next) => next.satisfies_pre(version, query_buf, version_buf, pre_matched),
                None => return true,
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

pub struct ListFormatter<'a> {
    list: &'a List,
    buffer: &'a [u8],
}

impl<'a> fmt::Display for ListFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let this = self.list;

        if let Some(ptr) = &this.next {
            write!(
                f,
                "{} || {}",
                this.head.fmt(self.buffer),
                ptr.fmt(self.buffer)
            )
        } else {
            write!(f, "{}", this.head.fmt(self.buffer))
        }
    }
}

impl List {
    pub fn fmt<'a>(&'a self, buf: &'a [u8]) -> ListFormatter<'a> {
        ListFormatter { list: self, buffer: buf }
    }

    pub fn satisfies(&self, version: Version, list_buf: &[u8], version_buf: &[u8]) -> bool {
        self.head.satisfies(version, list_buf, version_buf)
            || match &self.next {
                Some(next) => next.satisfies(version, list_buf, version_buf),
                None => return false,
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
        let mut pre_matched = false;
        (self
            .head
            .satisfies_pre(version, list_buf, version_buf, &mut pre_matched)
            && pre_matched)
            || match &self.next {
                Some(next) => next.satisfies_pre(version, list_buf, version_buf),
                None => return false,
            }
    }

    pub fn eql(&self, rhs: &List) -> bool {
        if !self.head.eql(&rhs.head) {
            return false;
        }

        let lhs_next = match &self.next {
            Some(n) => n,
            None => return rhs.next.is_none(),
        };
        let rhs_next = match &rhs.next {
            Some(n) => n,
            None => return false,
        };

        lhs_next.eql(rhs_next)
    }

    pub fn and_range(&mut self, range: Range) -> Result<(), AllocError> {
        if !self.head.range.has_left() && !self.head.range.has_right() {
            self.head.range = range;
            return Ok(());
        }

        let mut tail = Box::new(Query { range, next: None });
        tail.range = range;

        let tail_ptr = NonNull::from(&mut *tail);

        // SAFETY: self.tail aliases a Query owned by self.head.next chain; we hold &mut self.
        let last_tail: &mut Query = match self.tail {
            Some(mut p) => unsafe { p.as_mut() },
            None => &mut self.head,
        };
        last_tail.next = Some(tail);
        self.tail = Some(tail_ptr);
        Ok(())
    }
}

pub type FlagsBitSet = IntegerBitSet<3>;

pub struct Flags;
impl Flags {
    pub const PRE: usize = 1;
    pub const BUILD: usize = 0;
}

pub struct Group {
    pub head: List,
    // BACKREF: alias into self.head.next chain
    pub tail: Option<NonNull<List>>,
    // TODO(port): lifetime — `input` borrows the caller's buffer; Zig stored a slice into it.
    pub input: &'static [u8],

    pub flags: FlagsBitSet,
}

impl Default for Group {
    fn default() -> Self {
        Self {
            head: List::default(),
            tail: None,
            input: b"",
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
    pub fn fmt<'a>(&'a self, buf: &'a [u8]) -> GroupFormatter<'a> {
        GroupFormatter { group: self, buf }
    }

    pub fn json_stringify(&self, writer: &mut impl core::fmt::Write) -> fmt::Result {
        // TODO(port): Zig called `this.fmt()` with no buf arg (looks like a latent bug upstream).
        // TODO(port): std.json.encodeJsonString — needs a JSON string encoder in bun_core/serde.
        let temp = {
            use std::io::Write as _;
            let mut v: Vec<u8> = Vec::new();
            let _ = write!(&mut v, "{}", self.fmt(self.input));
            v
        };
        // Placeholder: write raw; Phase B must JSON-escape.
        writer.write_str("\"")?;
        write!(writer, "{}", bstr::BStr::new(&temp))?;
        writer.write_str("\"")
    }

    // PORT NOTE: `deinit` deleted — `next: Option<Box<..>>` chains are freed by Drop.
    // PERF(port): recursive Box drop could overflow stack on very long chains — profile in Phase B.

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
                ..Default::default()
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

    /// Zig name: `@"is *"`
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

        // SAFETY: self.tail aliases a List owned by self.head.next chain; we hold &mut self.
        let prev_tail: &mut List = match self.tail {
            Some(mut p) => unsafe { p.as_mut() },
            None => &mut self.head,
        };
        prev_tail.next = Some(new_tail);
        self.tail = Some(new_tail_ptr);
        Ok(())
    }

    pub fn and_range(&mut self, range: Range) -> Result<(), AllocError> {
        // SAFETY: self.tail aliases a List owned by self.head.next chain; we hold &mut self.
        let tail: &mut List = match self.tail {
            Some(mut p) => unsafe { p.as_mut() },
            None => &mut self.head,
        };
        tail.and_range(range)
    }

    pub fn or_range(&mut self, range: Range) -> Result<(), AllocError> {
        if self.tail.is_none() && self.head.tail.is_none() && !self.head.head.range.has_left() {
            self.head.head.range = range;
            return Ok(());
        }

        let mut new_tail = Box::new(List::default());
        new_tail.head.range = range;

        let new_tail_ptr = NonNull::from(&mut *new_tail);

        // SAFETY: self.tail aliases a List owned by self.head.next chain; we hold &mut self.
        let prev_tail: &mut List = match self.tail {
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
    pub fn to_range(self, version: version::Partial) -> Range {
        match self.tag {
            // Allows changes that do not modify the left-most non-zero element in the [major, minor, patch] tuple
            TokenTag::Caret => {
                // https://github.com/npm/node-semver/blob/3a8a4309ae986c1967b3073ba88c9e69433d44cb/classes/range.js#L302-L353
                let mut range = Range::default();
                'done: {
                    let Some(major) = version.major else { break 'done };
                    range.left = Comparator {
                        op: RangeOp::Gte,
                        version: Version {
                            major,
                            ..Default::default()
                        },
                    };
                    range.right = Comparator {
                        op: RangeOp::Lt,
                        ..Default::default()
                    };
                    if let Some(minor) = version.minor {
                        range.left.version.minor = minor;
                        if let Some(patch) = version.patch {
                            range.left.version.patch = patch;
                            range.left.version.tag = version.tag;
                            if major == 0 {
                                if minor == 0 {
                                    range.right.version.patch = patch.saturating_add(1);
                                } else {
                                    range.right.version.minor = minor.saturating_add(1);
                                }
                                break 'done;
                            }
                        } else if major == 0 {
                            range.right.version.minor = minor.saturating_add(1);
                            break 'done;
                        }
                    }
                    range.right.version.major = major.saturating_add(1);
                }
                return range;
            }
            TokenTag::Tilda => {
                // https://github.com/npm/node-semver/blob/3a8a4309ae986c1967b3073ba88c9e69433d44cb/classes/range.js#L261-L287
                let mut range = Range::default();
                'done: {
                    let Some(major) = version.major else { break 'done };
                    range.left = Comparator {
                        op: RangeOp::Gte,
                        version: Version {
                            major,
                            ..Default::default()
                        },
                    };
                    range.right = Comparator {
                        op: RangeOp::Lt,
                        ..Default::default()
                    };
                    if let Some(minor) = version.minor {
                        range.left.version.minor = minor;
                        if let Some(patch) = version.patch {
                            range.left.version.patch = patch;
                            range.left.version.tag = version.tag;
                        }
                        range.right.version.major = major;
                        range.right.version.minor = minor.saturating_add(1);
                        break 'done;
                    }
                    range.right.version.major = major.saturating_add(1);
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
        // TODO(port): lifetime — see Group.input field note above.
        // SAFETY: Group.input borrows `input` for the lifetime of the returned Group; faked as
        // 'static pending Phase B lifetime threading (see TODO above). Callers must not outlive `input`.
        input: unsafe { core::mem::transmute::<&[u8], &'static [u8]>(input) },
        ..Default::default()
    };

    let mut token = Token::default();
    let mut prev_token = Token::default();

    let mut count: u8 = 0;
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

            i += parse_result.len;
            let rollback = i;

            let maybe_hyphenate = i < input.len() && (input[i] == b' ' || input[i] == b'-');

            // TODO: can we do this without rolling back?
            let hyphenate: bool = maybe_hyphenate && 'possibly_hyphenate: {
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

                if !(i < input.len()
                    && matches!(input[i], b'0'..=b'9' | b'X' | b'x' | b'*'))
                {
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
                        second_version.major = second_version.major.saturating_add(1);
                        second_version.minor = 0;
                        second_version.patch = 0;

                        Range {
                            left: Comparator {
                                op: RangeOp::Gte,
                                version,
                            },
                            right: Comparator {
                                op: RangeOp::Lt,
                                version: second_version,
                            },
                        }
                    }
                    Wildcard::Patch => {
                        // "1.0.0 - 1.0.x" --> ">=1.0.0 <1.1.0"
                        second_version.minor = second_version.minor.saturating_add(1);
                        second_version.patch = 0;

                        Range {
                            left: Comparator {
                                op: RangeOp::Gte,
                                version,
                            },
                            right: Comparator {
                                op: RangeOp::Lt,
                                version: second_version,
                            },
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
                    list.or_range(range)?;
                } else {
                    list.and_range(range)?;
                }

                i += second_parsed.len + 1;
            } else if count == 0 && token.tag == TokenTag::Version {
                match parse_result.wildcard {
                    Wildcard::None => {
                        list.or_version(version)?;
                    }
                    _ => {
                        list.or_range(token.to_range(parse_result.version))?;
                    }
                }
            } else if count == 0 {
                // From a semver perspective, treat "--foo" the same as "-foo"
                // example: foo/bar@1.2.3@--canary.24
                //                         ^
                if token.tag == TokenTag::None {
                    is_or = false;
                    token.wildcard = Wildcard::None;
                    prev_token.tag = TokenTag::None;
                    continue;
                }
                list.and_range(token.to_range(parse_result.version))?;
            } else if is_or {
                list.or_range(token.to_range(parse_result.version))?;
            } else {
                list.and_range(token.to_range(parse_result.version))?;
            }

            is_or = false;
            count += 1;
            token.wildcard = Wildcard::None;
            prev_token.tag = token.tag;
        }
    }

    Ok(list)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/semver/SemverQuery.zig (793 lines)
//   confidence: medium
//   todos:      4
//   notes:      Group.input lifetime faked as 'static; json_stringify needs real JSON escaper; tail NonNull aliases into Box chain (self-referential — moving Group/List invalidates &head fallback path but not the boxed nodes).
// ──────────────────────────────────────────────────────────────────────────
