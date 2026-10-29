use core::fmt;

use bun_alloc::AllocError;
use bun_collections::IntegerBitSet;
use bun_core::strings;

use crate::range::{Comparator, Op as RangeOp};
use crate::version::Tag;
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
    pub(crate) fn fmt<'a>(&'a self, buf: &'a [u8]) -> QueryFormatter<'a> {
        QueryFormatter {
            query: self,
            buffer: buf,
        }
    }

    /// The version when this AND chain is one `=version` comparator.
    pub(crate) fn exact_version(&self) -> Option<Version> {
        let range = &self.range;
        (self.next.is_none() && range.left.op == RangeOp::Eql && !range.has_right())
            .then_some(range.left.version)
    }

    pub(crate) fn eql(&self, rhs: &Query) -> bool {
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

    pub(crate) fn satisfies(&self, version: Version, query_buf: &[u8], version_buf: &[u8]) -> bool {
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

    pub(crate) fn satisfies_pre(
        &self,
        version: Version,
        query_buf: &[u8],
        version_buf: &[u8],
        pre_matched: &mut bool,
    ) -> bool {
        debug_assert!(version.tag.has_pre());
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

    // OR
    pub next: Option<Box<List>>,
}

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
            next: None,
        };

        let mut src = &self.next;
        let mut dst = &mut out.next;
        while let Some(node) = src {
            let slot = dst.insert(Box::new(List {
                head: node.head.clone(),
                next: None,
            }));
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
    pub(crate) fn fmt<'a>(&'a self, buf: &'a [u8]) -> ListFormatter<'a> {
        ListFormatter {
            list: self,
            buffer: buf,
        }
    }

    pub(crate) fn satisfies(&self, version: Version, list_buf: &[u8], version_buf: &[u8]) -> bool {
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

    pub(crate) fn satisfies_pre(
        &self,
        version: Version,
        list_buf: &[u8],
        version_buf: &[u8],
    ) -> bool {
        debug_assert!(version.tag.has_pre());

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

    pub(crate) fn eql(&self, rhs: &List) -> bool {
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
}

pub(crate) type FlagsBitSet = IntegerBitSet<3>;

pub struct Flags;
impl Flags {
    pub const PRE: usize = 1;
    pub(crate) const BUILD: usize = 0;
    pub(crate) const SKIPPED: usize = 2;
}

#[derive(Clone)]
pub struct Group {
    pub head: List,

    pub flags: FlagsBitSet,
}

impl Default for Group {
    fn default() -> Self {
        Self {
            head: List::default(),
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

        if this.is_empty() {
            return Ok(());
        }

        if this.head.next.is_none() && this.head.head.next.is_none() {
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

    // `deinit` deleted — `next: Option<Box<..>>` chains are freed by the
    // iterative `Drop` impls on `Query` and `List`.

    pub fn get_exact_version(&self) -> Option<Version> {
        if self.head.next.is_some() {
            return None;
        }
        self.head.head.exact_version()
    }

    fn from_comparator(left: Comparator) -> Group {
        Group {
            head: List {
                head: Query {
                    range: Range {
                        left,
                        ..Default::default()
                    },
                    next: None,
                },
                next: None,
            },
            ..Default::default()
        }
    }

    pub fn from(version: Version) -> Group {
        Self::from_comparator(Comparator {
            op: RangeOp::Eql,
            version,
        })
    }

    /// A group that no version satisfies.
    fn null_set() -> Group {
        Self::from_comparator(Comparator::null_set())
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

    /// `a || b || ..`
    pub fn any_of(ranges: impl Iterator<Item = Range>) -> Group {
        let mut group = Group::default();
        let mut tail = Tail::of(&mut group.head, false);
        for range in ranges {
            tail = tail.or_range(&range);
        }
        group
    }

    #[inline]
    pub fn satisfies(&self, version: Version, group_buf: &[u8], version_buf: &[u8]) -> bool {
        if version.tag.has_pre() {
            self.head.satisfies_pre(version, group_buf, version_buf)
        } else {
            self.head.satisfies(version, group_buf, version_buf)
        }
    }

    /// True when `parse` found no comparator at all (e.g. the input was only unrecognised words).
    pub fn is_empty(&self) -> bool {
        self.head.next.is_none()
            && self.head.head.next.is_none()
            && !self.head.head.range.has_left()
    }

    /// True when `parse` passed over a part of the input that is not a comparator (`>=1 && <2`, `1.2.3.4`, `latest`).
    /// npm refuses such a range.
    pub fn has_skipped(&self) -> bool {
        self.flags.is_set(Flags::SKIPPED)
    }

    /// npm's `includePrerelease`: a prerelease only has to satisfy the comparators.
    #[inline]
    pub fn satisfies_including_prerelease(
        &self,
        version: Version,
        group_buf: &[u8],
        version_buf: &[u8],
    ) -> bool {
        self.head.satisfies(version, group_buf, version_buf)
    }
}

/// Where the next range goes in a `Group` that is being built.
struct Tail<'a> {
    /// The first range of the last `List`.
    first: &'a mut Range,
    and: &'a mut Option<Box<Query>>,
    or: &'a mut Option<Box<List>>,
    /// The `Group` has more than its first `Query`.
    grown: bool,
}

impl<'a> Tail<'a> {
    fn of(list: &'a mut List, grown: bool) -> Self {
        Tail {
            first: &mut list.head.range,
            and: &mut list.head.next,
            or: &mut list.next,
            grown,
        }
    }

    fn and_range(self, range: &Range) -> Self {
        if !self.first.has_left() && !self.first.has_right() {
            *self.first = *range;
            return self;
        }

        let query = self.and.insert(Box::new(Query {
            range: *range,
            next: None,
        }));
        Tail {
            and: &mut query.next,
            grown: true,
            ..self
        }
    }

    fn or_range(self, range: &Range) -> Self {
        if !self.grown && !self.first.has_left() {
            *self.first = *range;
            return self;
        }

        let mut list = Box::new(List::default());
        list.head.range = *range;
        Tail::of(self.or.insert(list), true)
    }
}

#[derive(Clone, Copy, Default)]
pub struct Token {
    pub(crate) tag: TokenTag,
    pub(crate) wildcard: Wildcard,
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
    /// `floor` is the tag of a lower bound that's derived instead of written. It's empty, or `-0`
    /// with `includePrerelease`.
    pub(crate) fn to_range(self, parsed: &version::ParseResult<u64>, floor: Tag) -> Range {
        let version = &parsed.version;
        // Only read for `Wildcard::Major`, which is valid only when it is a written `x`, `X` or `*`.
        let wildcard_is_written = parsed.valid;
        match self.tag {
            // Allows changes that do not modify the left-most non-zero element in the [major, minor, patch] tuple
            TokenTag::Caret => {
                // https://github.com/npm/node-semver/blob/3a8a4309ae986c1967b3073ba88c9e69433d44cb/classes/range.js#L302-L353
                let mut range = Range::default();
                'done: {
                    let Some(major) = version.major else {
                        if wildcard_is_written {
                            range = Range::init_wildcard(version.min(), Wildcard::Major, floor);
                        }
                        break 'done;
                    };
                    range.left = Comparator {
                        op: RangeOp::Gte,
                        version: Version {
                            major,
                            tag: floor,
                            ..Default::default()
                        },
                    };
                    if let Some(minor) = version.minor {
                        range.left.version.minor = minor;
                        if let Some(patch) = version.patch {
                            range.left.version.patch = patch;
                            range.left.version.tag = version.tag;
                            if major == 0 {
                                if !version.tag.has_pre() {
                                    range.left.version.tag.pre = floor.pre;
                                }
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
                        if wildcard_is_written {
                            range = Range::init_wildcard(version.min(), Wildcard::Major, floor);
                        }
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
                    return Range::init_wildcard(version.min(), self.wildcard, floor);
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

        // node-semver's `replaceXRange`
        let op = match self.tag {
            TokenTag::Gt => RangeOp::Gt,
            TokenTag::Gte => RangeOp::Gte,
            TokenTag::Lt => RangeOp::Lt,
            TokenTag::Lte => RangeOp::Lte,
            _ => unreachable!(),
        };
        let (major, minor) = (version.major.unwrap_or(0), version.minor.unwrap_or(0));
        let first_of_partial = |tag: Tag| Comparator {
            op,
            version: Version {
                major,
                minor,
                tag,
                ..Default::default()
            },
        };
        let left = match (op, self.wildcard) {
            (_, Wildcard::None) => Comparator {
                op,
                version: version.min(),
            },
            (RangeOp::Gt | RangeOp::Lt, Wildcard::Major) if wildcard_is_written => {
                Comparator::null_set()
            }
            // An operator before text that is not a version (`>latest`, `>xenial`) also gets here.
            (_, Wildcard::Major) => {
                return Range::init_wildcard(version.min(), Wildcard::Major, floor);
            }
            (RangeOp::Gte, _) => first_of_partial(floor),
            (RangeOp::Lt, _) => first_of_partial(Tag::ZERO_PRE),
            (RangeOp::Gt, Wildcard::Minor) => Comparator::gte_next_major(major, floor),
            (RangeOp::Gt, Wildcard::Patch) => Comparator::gte_next_minor(major, minor, floor),
            (_, Wildcard::Minor) => Comparator::lt_next_major(major),
            (_, Wildcard::Patch) => Comparator::lt_next_minor(major, minor),
        };
        Range {
            left,
            ..Default::default()
        }
    }
}

impl Range {
    /// `^version`
    pub fn caret(version: Version) -> Range {
        Token {
            tag: TokenTag::Caret,
            wildcard: Wildcard::None,
        }
        .to_range(
            &version::ParseResult {
                version: version::Partial {
                    major: Some(version.major),
                    minor: Some(version.minor),
                    patch: Some(version.patch),
                    tag: version.tag,
                },
                ..Default::default()
            },
            Tag::default(),
        )
    }
}

pub fn parse(input: &[u8], sliced: SlicedString) -> Result<Group, AllocError> {
    parse_with(input, sliced, Tag::default())
}

/// Like `parse`, but with node-semver's `includePrerelease`, for `satisfies_including_prerelease`.
/// `1.x` starts at `1.0.0-0`, and `>1` at `2.0.0-0`.
pub fn parse_including_prerelease(input: &[u8], sliced: SlicedString) -> Result<Group, AllocError> {
    parse_with(input, sliced, Tag::ZERO_PRE)
}

fn parse_with(input: &[u8], sliced: SlicedString, floor: Tag) -> Result<Group, AllocError> {
    let mut i: usize = 0;
    let mut list = Group {
        head: List::default(),
        flags: FlagsBitSet::init_empty(),
    };
    let mut tail = Tail::of(&mut list.head, false);

    let mut token = Token::default();

    let mut skip_round;
    let mut is_or = false;
    // Only spaces lie between the cursor and the last comparator, and that comparator is valid.
    let mut after_comparator = false;

    while i < input.len() {
        skip_round = false;
        let mut no_operator = false;

        match input[i] {
            c @ (b'>' | b'<') => {
                i += 1;
                // "< =1" is "<=1"
                while i < input.len() && input[i] == b' ' {
                    i += 1;
                }
                let or_equal = i < input.len() && input[i] == b'=';
                i += or_equal as usize;
                token.tag = match (c, or_equal) {
                    (b'>', false) => TokenTag::Gt,
                    (b'>', true) => TokenTag::Gte,
                    (_, false) => TokenTag::Lt,
                    (_, true) => TokenTag::Lte,
                };

                while i < input.len() && input[i] == b' ' {
                    i += 1;
                }
            }
            b'=' | b'v' => {
                token.tag = TokenTag::Version;
                no_operator = true;
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
                no_operator = true;
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
                after_comparator = false;

                // skip tagged versions
                // we are assuming this is the beginning of a tagged version like "boop"
                // "1.0.0 || boop"
                while i < input.len() && input[i] != b' ' && input[i] != b'|' {
                    i += 1;
                }
                skip_round = true;
                list.flags.set(Flags::SKIPPED);
            }
        }

        if !skip_round {
            let parse_result = Version::parse(sliced.sub(&input[i..]));
            // node-semver rejects the whole range for a number it cannot hold.
            if parse_result.overflow {
                return Ok(Group::null_set());
            }
            if !parse_result.valid {
                list.flags.set(Flags::SKIPPED);
            }
            let version = parse_result.version.min();
            if version.tag.has_build() {
                list.flags.set(Flags::BUILD);
            }
            if version.tag.has_pre() {
                list.flags.set(Flags::PRE);
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

                    if !matches!(input[i], b'0'..=b'9' | b'X' | b'x' | b'*') {
                        break 'possibly_hyphenate false;
                    }

                    true
                };

            if !hyphenate {
                i = rollback;
            }
            i += (!hyphenate) as usize;

            let valid = parse_result.valid && !hyphenate;
            // Malformed text ("=>16.0.0", "1.2.3.4") starts an alternative so that it cannot narrow the range.
            if no_operator && !(after_comparator && valid) {
                is_or = true;
            }

            let range: Range = if hyphenate {
                let second_parsed = Version::parse(sliced.sub(&input[i..]));
                if second_parsed.overflow {
                    return Ok(Group::null_set());
                }
                if !second_parsed.valid {
                    list.flags.set(Flags::SKIPPED);
                }
                let second_version = second_parsed.version.min();
                if second_version.tag.has_build() {
                    list.flags.set(Flags::BUILD);
                }
                if second_version.tag.has_pre() {
                    list.flags.set(Flags::PRE);
                }
                i += second_parsed.len as usize + 1;

                let mut first_version = version;
                if !version.tag.has_pre() {
                    first_version.tag.pre = floor.pre;
                }
                Range {
                    left: Comparator {
                        op: RangeOp::Gte,
                        version: first_version,
                    },
                    right: match second_parsed.wildcard {
                        // "1.0.0 - x" --> ">=1.0.0"
                        Wildcard::Major => Comparator::default(),
                        // "1.0.0 - 1.x" --> ">=1.0.0 <2.0.0-0"
                        Wildcard::Minor => Comparator::lt_next_major(second_version.major),
                        // "1.0.0 - 1.0.x" --> ">=1.0.0 <1.1.0-0"
                        Wildcard::Patch => {
                            Comparator::lt_next_minor(second_version.major, second_version.minor)
                        }
                        Wildcard::None if floor.has_pre() && !second_version.tag.has_pre() => {
                            Comparator::lt_next_patch(
                                second_version.major,
                                second_version.minor,
                                second_version.patch,
                            )
                        }
                        Wildcard::None => Comparator {
                            op: RangeOp::Lte,
                            version: second_version,
                        },
                    },
                }
            } else if token.tag == TokenTag::None {
                // No pending comparator token for this chunk, so skip it instead of
                // emitting a comparator, the same way skipped tags like "boop" in
                // "1.0.0 || boop" are ignored (any pending "||" is preserved). This
                // covers a leading "--foo" (treat "--foo" the same as "-foo", example:
                // foo/bar@1.2.3@--canary.24) as well as a dangling "-" after a skipped
                // tag, like "1 || - foo".
                token.wildcard = Wildcard::None;
                list.flags.set(Flags::SKIPPED);
                continue;
            } else {
                token.to_range(&parse_result, floor)
            };

            tail = if is_or {
                tail.or_range(&range)
            } else {
                tail.and_range(&range)
            };

            is_or = false;
            token.wildcard = Wildcard::None;
            after_comparator = valid && input.get(rollback) == Some(&b' ');
        }
    }

    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::parse;
    use crate::SlicedString;

    #[test]
    fn has_skipped() {
        let cases = [
            ("", false),
            ("*", false),
            (">=16", false),
            (">= 16.x", false),
            ("^18 || >=20", false),
            ("16 - 18", false),
            ("v16", false),
            (">=v16.0.0", false),
            ("~>16", false),
            ("1.2.3-rc.1+build", false),
            ("16+build", false),
            ("foo-bar", true),
            ("latest", true),
            ("lts/*", true),
            (">=14 && <17", true),
            (">=16, <18", true),
            (">=16 npm", true),
            ("16.0.0.0", true),
            ("16-18", true),
            (">=", true),
            (">=1.2.3<2.0.0", true),
            ("-18", true),
            ("-x", true),
            ("16 || -18", true),
            ("16 || - 18.0.0", true),
            ("01.2.3", false),    // npm refuses it
            ("1.0.0rc1", false),  // npm refuses it
            ("^16 | ^18", false), // npm refuses it
        ];
        for (text, expected) in cases {
            let bytes = text.as_bytes();
            let group = parse(bytes, SlicedString::init(bytes, bytes)).unwrap();
            assert_eq!(group.has_skipped(), expected, "{text:?}");
        }
    }
}
