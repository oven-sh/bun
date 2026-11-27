//! The subset of RegExp that [`ast`](super::ast) generates, matched backwards on bit sets of positions, without backtracking.

use bun_collections::index_sort;
use bun_collections::smallvec::SmallVec;
use bun_core::strings::{self, CodeUnits};

use super::ast::{QMARK, START_NO_DOT};
use super::budget::{ALLOCATION_OVERHEAD, Abort, Budget, check_stack, cost, try_with_capacity};
use super::{Error, append_ascii};
use crate::scan::{self, BLOCK};
use crate::unicode::{self, Category};
use crate::{CodeUnit, DOT, SLASH, byte_at};

const MAX_LITERAL_LEN: usize = 32;
// `Matcher::shift_back` only carries over from the adjacent block.
const _: () = assert!(MAX_LITERAL_LEN < BLOCK);
/// Matching an expression that nests no deeper than this skips the stack checks.
const UNCHECKED_DEPTH: usize = 12;
const ASCII_LEN: u32 = 128;
/// While the source is built, and again while it is compiled.
pub(super) const BYTES_PER_SOURCE_UNIT: usize = 16;
/// `Option<u32>` would grow [`Node`].
const NONE: u32 = u32::MAX;

/// Common to the nodes that consume characters.
#[derive(Clone, Copy)]
struct Leaf {
    /// The only position that it can start at, or [`NONE`].
    fixed_start: u32,
    /// An index into [`Matcher::carries`].
    carry_index: u32,
    /// If so, only its last match matters.
    follows_star: bool,
}

#[derive(Clone, Copy)]
struct Span {
    start: u32,
    len: u32,
}

impl Span {
    #[inline(always)]
    fn slice<T>(self, items: &[T]) -> &[T] {
        &items[self.start as usize..][..self.len as usize]
    }
}

#[derive(Clone, Copy, PartialEq)]
enum GroupKind {
    Sequence,
    Alternation,
}

#[derive(Clone, Copy)]
struct Group {
    /// Of [`RegExp::nodes`].
    parts: Span,
    kind: GroupKind,
}

impl Group {
    #[inline(always)]
    fn is_sequence(&self) -> bool {
        self.kind == GroupKind::Sequence
    }
}

#[derive(Clone, Copy)]
struct Repeat {
    body: Group,
    /// [`RegExp::cost`] of the body.
    cost: u32,
    at_least_once: bool,
    /// An index into [`Matcher::memo`] if this is inside another `Repeat`, or [`NONE`].
    seen_slot: u32,
}

#[derive(Clone, Copy)]
enum Node {
    Never,
    Start,
    End,
    /// [`START_NO_DOT`] and its fixed position, or [`NONE`].
    NoDot(u32),
    Any(Leaf),
    AnyStar(Leaf),
    /// Of [`RegExp::characters`].
    Literal(Leaf, Span),
    /// An index into [`RegExp::classes`].
    Class(Leaf, u32),
    Group(Group),
    Optional(Group),
    Repeat(Repeat),
    NegativeLookahead {
        body: Group,
        /// The first of two indices into [`Matcher::memo`] if this is inside a `Repeat`, or [`NONE`].
        memo_slot: u32,
    },
}

/// A code unit, or a code point under the flag `u`.
trait Character: Copy + Into<u32> {
    /// As [`scan::either_bits`].
    fn either_bits(block: &[Self], a: u8, b: u8) -> u64;
}

impl Character for u8 {
    #[inline(always)]
    fn either_bits(block: &[u8], a: u8, b: u8) -> u64 {
        scan::either_bits(block, a, b)
    }
}

impl Character for u16 {
    #[inline(always)]
    fn either_bits(block: &[u16], a: u8, b: u8) -> u64 {
        scan::either_bits(block, a, b)
    }
}

impl Character for u32 {
    fn either_bits(block: &[u32], a: u8, b: u8) -> u64 {
        let bit = |(at, &it)| u64::from(it == u32::from(a) || it == u32::from(b)) << at;
        block.iter().enumerate().map(bit).sum()
    }
}

#[derive(Clone, Copy)]
pub(super) struct Flags {
    pub(super) ignore_case: bool,
    pub(super) unicode: bool,
}

struct Class {
    /// [`Class::matches`] of each ASCII character.
    ascii: [u64; 2],
    /// Sorted and disjoint.
    ranges: Vec<(u32, u32)>,
    /// One bit per [`Category`].
    categories: u16,
    is_negated: bool,
}

impl Class {
    fn contains(&self, character: u32) -> bool {
        let after = self.ranges.partition_point(|range| range.0 <= character);
        (after != 0 && character <= self.ranges[after - 1].1)
            || (self.categories != 0
                && self.categories & (1 << unicode::category(character) as u16) != 0)
    }

    fn matches(&self, character: u32, flags: Flags) -> bool {
        let is_member = if flags.ignore_case {
            unicode::case_variants(character, flags.unicode).any(|variant| self.contains(variant))
        } else {
            self.contains(character)
        };
        is_member != self.is_negated
    }

    /// Of [`Class::matches`].
    fn cost(&self, flags: Flags) -> usize {
        let of_ranges = cost::STEP + (self.ranges.len() + 1).ilog2() as usize;
        let of_categories = if self.categories != 0 {
            cost::LOOKUP
        } else {
            0
        };
        of_ranges * (1 + usize::from(flags.ignore_case)) + of_categories
    }

    fn ascii_bitmap(&self, flags: Flags) -> u128 {
        const UPPER_CASE: u128 = ((1 << 26) - 1) << b'A';
        const CASE_DISTANCE: u8 = b'a' - b'A';
        let mut members = 0;
        for &(first, last) in self.ranges.iter().take_while(|range| range.0 < ASCII_LEN) {
            members |= (u128::MAX >> (ASCII_LEN - 1).saturating_sub(last)) & (u128::MAX << first);
        }
        if self.categories != 0 {
            for character in 0..ASCII_LEN {
                members |= u128::from(self.contains(character)) << character;
            }
        }
        if flags.ignore_case {
            if flags.unicode {
                members |= u128::from(self.contains(unicode::KELVIN_SIGN)) << b'K';
                members |= u128::from(self.contains(unicode::LONG_S)) << b'S';
            }
            let letters = (members | members >> CASE_DISTANCE) & UPPER_CASE;
            members |= letters | letters << CASE_DISTANCE;
        }
        if self.is_negated { !members } else { members }
    }
}

#[derive(Clone, Copy)]
enum Step {
    Character(u32),
    /// An index into [`RegExp::classes`].
    Class(u32),
    Any,
}

/// An expression with at most one `*`, so that the position of every step follows from the length of the text.
struct FixedShape {
    steps: Box<[Step]>,
    steps_before_star: Option<u32>,
}

pub(super) struct RegExp {
    /// Without the outer `^` and `$`.
    root: Group,
    /// A leading [`START_NO_DOT`], hoisted out of `root`.
    no_leading_dot: bool,
    nodes: Vec<Node>,
    /// Under the flag `i`, the lowest of their case variants.
    characters: Vec<u32>,
    classes: Vec<Class>,
    flags: Flags,
    memo_slots: u32,
    leaf_count: u32,
    needs_stack_check: bool,
    fixed_shape: Option<FixedShape>,
}

/// What [`RegExp::assign_slots`] knows about the surroundings of a node.
#[derive(Clone, Copy)]
struct Context {
    fixed_start: Option<u32>,
    is_repeated: bool,
    follows_star: bool,
}

impl RegExp {
    pub(super) fn compile(
        source: &[u16],
        flags: Flags,
        budget: &mut Budget<'_>,
    ) -> Result<Self, Error> {
        debug_assert!(byte_at(source, 0) == b'^' && byte_at(source, source.len() - 1) == b'$');
        budget.charge_memory(BYTES_PER_SOURCE_UNIT * source.len())?;
        let mut parser = Parser {
            source,
            at: "^".len(),
            budget,
            regexp: RegExp {
                root: EMPTY_SEQUENCE,
                no_leading_dot: false,
                nodes: Vec::new(),
                characters: Vec::new(),
                classes: Vec::new(),
                flags,
                memo_slots: 0,
                leaf_count: 0,
                needs_stack_check: false,
                fixed_shape: None,
            },
        };
        let root = parser.disjunction(0)?;
        parser.regexp.root = parser.wrap_in_group(root);
        let mut regexp = parser.regexp;
        let context = Context {
            fixed_start: Some(0),
            is_repeated: false,
            follows_star: false,
        };
        regexp.assign_slots_in_group(regexp.root, context)?;
        if regexp.root.is_sequence() {
            regexp.hoist_no_dot();
            regexp.fixed_shape = regexp.to_fixed_shape();
        }
        regexp.nodes.shrink_to_fit();
        regexp.characters.shrink_to_fit();
        regexp.classes.shrink_to_fit();
        Ok(regexp)
    }

    fn hoist_no_dot(&mut self) {
        let Span { start, len } = self.root.parts;
        let mut end = start;
        for part in start..start + len {
            let part = self.nodes[part as usize];
            if let Node::NoDot(0) = part {
                self.no_leading_dot = true;
            } else {
                self.nodes[end as usize] = part;
                end += 1;
            }
        }
        self.root.parts.len = end - start;
    }

    fn to_fixed_shape(&self) -> Option<FixedShape> {
        let mut steps = Vec::new();
        let mut steps_before_star = None;
        for part in self.root.parts.slice(&self.nodes) {
            match *part {
                Node::Any(_) => steps.push(Step::Any),
                Node::Class(_, class) => steps.push(Step::Class(class)),
                Node::Literal(_, literal) => {
                    let characters = literal.slice(&self.characters).iter();
                    steps.extend(characters.map(|&character| Step::Character(character)));
                }
                Node::AnyStar(_) if steps_before_star.is_none() => {
                    steps_before_star = Some(steps.len() as u32);
                }
                _ => return None,
            }
        }
        Some(FixedShape {
            steps: steps.into(),
            steps_before_star,
        })
    }

    /// Of trying every node at one position.
    #[inline(always)]
    fn cost(&self) -> usize {
        self.nodes.len() + self.characters.len()
    }

    /// A suffix of every text that matches.
    pub(super) fn last_literal(&self) -> &[u32] {
        match *self.root.parts.slice(&self.nodes) {
            [.., Node::Literal(_, literal)] if self.root.is_sequence() => {
                literal.slice(&self.characters)
            }
            _ => &[],
        }
    }

    pub(super) fn memory_cost(&self) -> usize {
        let ranges = self.classes.iter().map(|class| class.ranges.capacity());
        size_of::<Self>()
            + size_of_val(&self.nodes[..])
            + size_of_val(&self.characters[..])
            + size_of_val(&self.classes[..])
            + (self.fixed_shape.as_ref()).map_or(0, |shape| size_of_val(&*shape.steps))
            + size_of::<(u32, u32)>() * ranges.sum::<usize>()
    }

    fn assign_slots_in_group(
        &mut self,
        group: Group,
        mut context: Context,
    ) -> Result<Option<u32>, Abort> {
        check_stack()?;
        let Span { start, len } = group.parts;
        context.follows_star = false;
        if group.is_sequence() {
            for part in start..start + len {
                context.fixed_start = self.assign_slots(part, context)?;
                context.follows_star = matches!(self.nodes[part as usize], Node::AnyStar(_));
            }
            return Ok(context.fixed_start);
        }
        let mut fixed_end = None;
        for alternative in start..start + len {
            let end = self.assign_slots(alternative, context)?;
            let agrees = alternative == start || fixed_end == end;
            fixed_end = end.filter(|_| agrees);
        }
        Ok(fixed_end)
    }

    fn alloc_memo(&mut self, count: u32, context: Context) -> u32 {
        if !context.is_repeated {
            return NONE;
        }
        self.memo_slots += count;
        self.memo_slots - count
    }

    /// Fills in the fields that depend on the surroundings. Returns the only position that the node can end at.
    fn assign_slots(&mut self, index: u32, context: Context) -> Result<Option<u32>, Abort> {
        let leaf = Leaf {
            fixed_start: context.fixed_start.unwrap_or(NONE),
            carry_index: self.leaf_count,
            follows_star: context.follows_star,
        };
        let (node, len) = match self.nodes[index as usize] {
            Node::Never => return Ok(None),
            Node::Start => return Ok(Some(0)),
            Node::End => return Ok(context.fixed_start),
            Node::NoDot(_) => {
                self.nodes[index as usize] = Node::NoDot(leaf.fixed_start);
                return Ok(context.fixed_start);
            }
            Node::Any(_) => (Node::Any(leaf), Some(1)),
            Node::AnyStar(_) => (Node::AnyStar(leaf), None),
            Node::Literal(_, text) => (Node::Literal(leaf, text), Some(text.len)),
            Node::Class(_, class) => (Node::Class(leaf, class), Some(1)),
            Node::Group(group) => return self.assign_slots_in_group(group, context),
            Node::Optional(body) => {
                self.assign_slots_in_group(body, context)?;
                return Ok(None);
            }
            Node::Repeat(repeat) => {
                let seen_slot = self.alloc_memo(1, context);
                self.nodes[index as usize] = Node::Repeat(Repeat {
                    seen_slot,
                    ..repeat
                });
                let in_body = Context {
                    fixed_start: None,
                    is_repeated: true,
                    ..context
                };
                self.assign_slots_in_group(repeat.body, in_body)?;
                return Ok(None);
            }
            Node::NegativeLookahead { body, .. } => {
                let memo_slot = self.alloc_memo(2, context);
                self.nodes[index as usize] = Node::NegativeLookahead { body, memo_slot };
                // The body is evaluated once per block.
                let in_body = Context {
                    is_repeated: false,
                    ..context
                };
                self.assign_slots_in_group(body, in_body)?;
                return Ok(context.fixed_start);
            }
        };
        self.nodes[index as usize] = node;
        self.leaf_count += 1;
        let start_and_len = context.fixed_start.zip(len);
        Ok(start_and_len.and_then(|(start, len)| start.checked_add(len)))
    }

    #[inline(always)]
    pub(super) fn test<U: CodeUnit>(
        &self,
        text: &[U],
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        if self.no_leading_dot && byte_at(text, 0) == DOT {
            return Ok(false);
        }
        debug_assert!(scan::index_of(text, SLASH).is_none());
        match U::units(text) {
            CodeUnits::U8(text) => self.test_characters(text, budget),
            CodeUnits::U16(text) if self.flags.unicode => self.test_code_points(text, budget),
            CodeUnits::U16(text) => self.test_characters(text, budget),
        }
    }

    #[inline(never)]
    fn test_code_points(&self, text: &[u16], budget: &mut Budget<'_>) -> Result<bool, Abort> {
        // The fixed start is not longer than the cost.
        if text.len() >= BLOCK.max(2 * self.cost()) {
            budget.spend(cost::build(self.cost()))?;
            let mut start = try_with_capacity(self.cost())?;
            start.extend(unicode::code_points(text).take(self.cost()));
            if !Matcher::new(self, &start, budget).matches_fixed_start() {
                return Ok(false);
            }
        }
        budget.spend(text.len())?;
        if !text.iter().any(|&unit| strings::u16_is_lead(unit)) {
            return self.test_characters(text, budget);
        }
        budget.spend(cost::build(text.len()))?;
        let mut code_points = try_with_capacity(text.len())?;
        code_points.extend(unicode::code_points(text));
        self.test_characters(&code_points, budget)
    }

    #[inline(always)]
    fn test_characters<C: Character>(
        &self,
        text: &[C],
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        budget.spend(self.cost())?;
        if let Some(shape) = &self.fixed_shape {
            return Ok(Matcher::new(self, text, budget).matches_fixed_shape(shape));
        }
        if text.len() >= BLOCK || self.memo_slots != 0 {
            return self.test_block_by_block(text, budget);
        }
        let mut matcher = Matcher::new(self, text, budget);
        let starts =
            matcher.match_starts::<SINGLE_BLOCK>(&self.root, 1 << text.len(), Visit::First);
        matcher.abort.map_or(Ok(starts & 1 != 0), Err)
    }

    #[inline(never)]
    fn test_block_by_block<C: Character>(
        &self,
        text: &[C],
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        let mut memo = SmallVec::<[u64; 8]>::from_elem(0, self.memo_slots as usize);
        let mut carries =
            SmallVec::<[_; 16]>::from_elem(Carry::default(), self.leaf_count as usize);
        let mut matcher = Matcher {
            memo: &mut memo,
            carries: &mut carries,
            ..Matcher::new(self, text, budget)
        };
        if !matcher.matches_fixed_start() {
            return Ok(false);
        }
        loop {
            let ends = matcher.bit_at::<MULTI_BLOCK>(text.len());
            let starts = matcher.match_starts::<MULTI_BLOCK>(&self.root, ends, Visit::First);
            if let Some(abort) = matcher.abort {
                return Err(abort);
            }
            if matcher.base == 0 {
                return Ok(starts & 1 != 0);
            }
            matcher.budget.spend(self.cost())?;
            matcher.base -= BLOCK;
            matcher.valid_mask = u64::MAX;
            matcher.memo.fill(0);
            for carry in &mut *matcher.carries {
                carry.from_later_block = core::mem::take(&mut carry.current);
            }
        }
    }
}

const SINGLE_BLOCK: bool = false;
const MULTI_BLOCK: bool = true;

/// The end positions that were passed to a leaf, whose start may be in the previous block.
#[derive(Clone, Copy, Default)]
struct Carry {
    from_later_block: u64,
    current: u64,
}

/// The first visit of a group in a block has to pick up the carries, even without end positions.
#[derive(Clone, Copy, PartialEq)]
enum Visit {
    First,
    Again,
}

struct Matcher<'m, 'a, C> {
    regexp: &'m RegExp,
    text: &'m [C],
    /// The position of bit 0.
    base: usize,
    /// The positions of this block that are within `0..=text.len()`.
    valid_mask: u64,
    memo: &'m mut [u64],
    carries: &'m mut [Carry],
    budget: &'m mut Budget<'a>,
    /// If set, the result is meaningless.
    abort: Option<Abort>,
}

impl<'m, 'a, C: Character> Matcher<'m, 'a, C> {
    /// Starts at the last block.
    #[inline(always)]
    fn new(regexp: &'m RegExp, text: &'m [C], budget: &'m mut Budget<'a>) -> Self {
        Matcher {
            regexp,
            text,
            base: text.len() / BLOCK * BLOCK,
            valid_mask: u64::MAX >> (BLOCK - 1 - text.len() % BLOCK),
            memo: &mut [],
            carries: &mut [],
            budget,
            abort: None,
        }
    }

    #[inline(always)]
    fn base<const IS_MULTI_BLOCK: bool>(&self) -> usize {
        if IS_MULTI_BLOCK { self.base } else { 0 }
    }

    /// 0 if `position` is in another block.
    #[inline(always)]
    fn bit_at<const IS_MULTI_BLOCK: bool>(&self, position: usize) -> u64 {
        let bit = position.wrapping_sub(self.base::<IS_MULTI_BLOCK>());
        if bit < BLOCK { 1 << bit } else { 0 }
    }

    #[inline(always)]
    fn positions_of(&mut self, a: u8, b: u8) -> u64 {
        let rest = &self.text[self.base..];
        let block = &rest[..rest.len().min(BLOCK)];
        (self.budget).spend_unchecked(cost::vector_scan(size_of_val(block)));
        C::either_bits(block, a, b)
    }

    #[inline(never)]
    fn positions_of_dots(&mut self) -> u64 {
        self.positions_of(DOT, DOT)
    }

    /// Returns whether the match is aborted.
    #[inline(always)]
    fn abort_on_err(&mut self, result: Result<(), Abort>) -> bool {
        if let Err(abort) = result {
            self.abort.get_or_insert(abort);
        }
        self.abort.is_some()
    }

    /// The positions `len` before `ends`. Updates the carry of `leaf`.
    #[inline(always)]
    fn shift_back<const IS_MULTI_BLOCK: bool>(
        &mut self,
        leaf: &Leaf,
        ends: u64,
        len: usize,
    ) -> u64 {
        let mut starts = ends >> len;
        if IS_MULTI_BLOCK {
            let carry = &mut self.carries[leaf.carry_index as usize];
            starts |= core::mem::take(&mut carry.from_later_block) << (BLOCK - len);
            carry.current |= ends;
        }
        if leaf.fixed_start != NONE {
            starts &= self.bit_at::<IS_MULTI_BLOCK>(leaf.fixed_start as usize);
        }
        starts
    }

    #[inline(always)]
    fn filter(
        &mut self,
        leaf: &Leaf,
        mut candidates: u64,
        cost_per_candidate: usize,
        matches: impl Fn(&mut Self, usize) -> bool,
    ) -> u64 {
        let spent = self.budget.spend(0);
        if self.abort_on_err(spent) {
            return 0;
        }
        let mut starts = 0;
        while let Some(bit) = candidates.checked_ilog2() {
            candidates ^= 1 << bit;
            self.budget.spend_unchecked(cost_per_candidate);
            if matches(self, self.base + bit as usize) {
                starts |= 1 << bit;
                if leaf.follows_star {
                    break;
                }
            }
        }
        starts
    }

    #[inline(always)]
    fn literal_matches_at(&mut self, position: usize, literal: &[u32]) -> bool {
        let flags = self.regexp.flags;
        let mut pairs = self.text[position..][..literal.len()].iter().zip(literal);
        if !flags.ignore_case {
            return pairs.all(|(&a, &b)| a.into() == b);
        }
        pairs.all(|(&a, &b)| match u8::try_from(a.into()) {
            Ok(latin1) => u32::from(unicode::fold_latin1(latin1)) == b,
            Err(_) => {
                self.budget.spend_unchecked(cost::STEP);
                unicode::case_variants(a.into(), flags.unicode).any(|variant| variant == b)
            }
        })
    }

    #[inline(always)]
    fn class_matches_at(&mut self, position: usize, class: &Class) -> bool {
        let character = self.text[position].into();
        match class.ascii.get(character as usize / 64) {
            Some(bits) => bits >> (character % 64) & 1 != 0,
            None => {
                self.budget.spend_unchecked(class.cost(self.regexp.flags));
                class.matches(character, self.regexp.flags)
            }
        }
    }

    #[inline(always)]
    fn matches_fixed_shape(&mut self, shape: &FixedShape) -> bool {
        let Some(star_len) = self.text.len().checked_sub(shape.steps.len()) else {
            return false;
        };
        let head_len = match shape.steps_before_star {
            Some(head_len) => head_len as usize,
            None if star_len == 0 => 0,
            None => return false,
        };
        shape.steps.iter().enumerate().all(|(index, &step)| {
            let position = index + if index < head_len { 0 } else { star_len };
            match step {
                Step::Character(character) => self.literal_matches_at(position, &[character]),
                Step::Class(class) => {
                    self.class_matches_at(position, &self.regexp.classes[class as usize])
                }
                Step::Any => true,
            }
        })
    }

    /// Spares going through a long text backwards if its first characters are wrong.
    fn matches_fixed_start(&mut self) -> bool {
        let regexp = self.regexp;
        if !regexp.root.is_sequence() {
            return true;
        }
        let mut position = 0;
        for part in regexp.root.parts.slice(&regexp.nodes) {
            let rest = self.text.len() - position;
            position += match *part {
                Node::Start | Node::End | Node::NoDot(_) | Node::NegativeLookahead { .. } => 0,
                Node::Any(_) if rest != 0 => 1,
                Node::Class(_, class)
                    if rest != 0
                        && self.class_matches_at(position, &regexp.classes[class as usize]) =>
                {
                    1
                }
                Node::Literal(_, literal)
                    if rest >= literal.len as usize
                        && self.literal_matches_at(position, literal.slice(&regexp.characters)) =>
                {
                    literal.len as usize
                }
                Node::Never | Node::Any(_) | Node::Class(..) | Node::Literal(..) => return false,
                Node::AnyStar(_) | Node::Group(_) | Node::Optional(_) | Node::Repeat(_) => break,
            };
        }
        true
    }

    #[inline(never)]
    fn filter_by_literal(&mut self, leaf: &Leaf, mut candidates: u64, literal: &[u32]) -> u64 {
        let flags = self.regexp.flags;
        if !(flags.ignore_case && flags.unicode)
            && let Ok(first @ ..0x80) = u8::try_from(literal[0])
        {
            let lower = first.to_ascii_lowercase();
            candidates &= self.positions_of(first, if flags.ignore_case { lower } else { first });
        }
        self.filter(leaf, candidates, literal.len(), |it, at| {
            it.literal_matches_at(at, literal)
        })
    }

    #[inline(never)]
    fn filter_by_class(&mut self, leaf: &Leaf, candidates: u64, class: &Class) -> u64 {
        self.filter(leaf, candidates, 1, |it, at| it.class_matches_at(at, class))
    }

    /// The positions from which `group` matches up to one of `ends`.
    #[inline(never)]
    fn match_starts<const IS_MULTI_BLOCK: bool>(
        &mut self,
        group: &Group,
        mut ends: u64,
        visit: Visit,
    ) -> u64 {
        let regexp = self.regexp;
        if regexp.needs_stack_check && self.abort_on_err(check_stack()) {
            return 0;
        }
        let mut union = 0;
        for part in group.parts.slice(&regexp.nodes).iter().rev() {
            if ends == 0 && !(IS_MULTI_BLOCK && visit == Visit::First) {
                return 0;
            }
            let starts = self.match_starts_of_node::<IS_MULTI_BLOCK>(part, ends, visit);
            if group.is_sequence() {
                ends = starts;
            } else {
                union |= starts;
            }
        }
        if group.is_sequence() { ends } else { union }
    }

    #[inline(always)]
    fn match_starts_of_node<const IS_MULTI_BLOCK: bool>(
        &mut self,
        part: &Node,
        ends: u64,
        visit: Visit,
    ) -> u64 {
        let regexp = self.regexp;
        let base = self.base::<IS_MULTI_BLOCK>();
        let position_of = |only: u64| base + only.trailing_zeros() as usize;
        match part {
            Node::Never => 0,
            Node::Start => ends & self.bit_at::<IS_MULTI_BLOCK>(0),
            Node::End => ends & self.bit_at::<IS_MULTI_BLOCK>(self.text.len()),
            Node::NoDot(NONE) => ends & !self.positions_of_dots(),
            &Node::NoDot(at) => match self.text.get(at as usize) {
                Some(&character) if character.into() == DOT.into() => 0,
                _ => ends & self.bit_at::<IS_MULTI_BLOCK>(at as usize),
            },
            Node::Any(leaf) => self.shift_back::<IS_MULTI_BLOCK>(leaf, ends, 1),
            Node::AnyStar(leaf) => {
                if IS_MULTI_BLOCK {
                    let carry = &mut self.carries[leaf.carry_index as usize];
                    carry.current |= ends | carry.from_later_block;
                    if carry.from_later_block != 0 {
                        return u64::MAX;
                    }
                }
                u64::MAX.checked_shr(ends.leading_zeros()).unwrap_or(0)
            }
            Node::Literal(leaf, literal) => {
                let literal = literal.slice(&regexp.characters);
                match self.shift_back::<IS_MULTI_BLOCK>(leaf, ends, literal.len()) {
                    0 => 0,
                    many if many & (many - 1) != 0 => self.filter_by_literal(leaf, many, literal),
                    only if self.literal_matches_at(position_of(only), literal) => only,
                    _ => 0,
                }
            }
            Node::Class(leaf, class) => {
                let class = &regexp.classes[*class as usize];
                match self.shift_back::<IS_MULTI_BLOCK>(leaf, ends, 1) {
                    0 => 0,
                    many if many & (many - 1) != 0 => self.filter_by_class(leaf, many, class),
                    only if self.class_matches_at(position_of(only), class) => only,
                    _ => 0,
                }
            }
            Node::Group(group) => self.match_starts::<IS_MULTI_BLOCK>(group, ends, visit),
            Node::Optional(body) => ends | self.match_starts::<IS_MULTI_BLOCK>(body, ends, visit),
            Node::NegativeLookahead {
                body,
                memo_slot: NONE,
            } => ends & !self.match_starts::<IS_MULTI_BLOCK>(body, self.valid_mask, Visit::First),
            Node::NegativeLookahead { body, memo_slot } => {
                ends & !self.memoized_starts::<IS_MULTI_BLOCK>(body, *memo_slot as usize)
            }
            Node::Repeat(repeat) => {
                self.match_starts_of_repeat::<IS_MULTI_BLOCK>(repeat, ends, visit)
            }
        }
    }

    #[inline(never)]
    fn memoized_starts<const IS_MULTI_BLOCK: bool>(
        &mut self,
        body: &Group,
        memo_slot: usize,
    ) -> u64 {
        let (is_known, starts) = (memo_slot, memo_slot + 1);
        if self.memo[is_known] == 0 {
            self.memo[is_known] = 1;
            self.memo[starts] =
                self.match_starts::<IS_MULTI_BLOCK>(body, self.valid_mask, Visit::First);
        }
        self.memo[starts]
    }

    #[inline(never)]
    fn match_starts_of_repeat<const IS_MULTI_BLOCK: bool>(
        &mut self,
        repeat: &Repeat,
        ends: u64,
        mut visit: Visit,
    ) -> u64 {
        // The starts for ends seen earlier in this block were already returned to the enclosing `Repeat`.
        let mut seen = self.memo.get(repeat.seen_slot as usize).map_or(0, |&it| it);
        let mut frontier = ends & !seen;
        let mut starts = if repeat.at_least_once { 0 } else { frontier };
        loop {
            seen |= frontier;
            let found = self.match_starts::<IS_MULTI_BLOCK>(&repeat.body, frontier, visit);
            starts |= found;
            frontier = found & !seen;
            visit = Visit::Again;
            let spent = self.budget.spend(repeat.cost as usize);
            if self.abort_on_err(spent) || frontier == 0 {
                break;
            }
        }
        if let Some(slot) = self.memo.get_mut(repeat.seen_slot as usize) {
            *slot = seen;
        }
        starts
    }
}

struct Parser<'p, 'a> {
    source: &'p [u16],
    at: usize,
    budget: &'p mut Budget<'a>,
    regexp: RegExp,
}

enum ClassAtom {
    Character(u32),
    Categories(u16),
}

const UNASSIGNED: Leaf = Leaf {
    fixed_start: NONE,
    carry_index: NONE,
    follows_star: false,
};

const EMPTY_SEQUENCE: Group = Group {
    parts: Span { start: 0, len: 0 },
    kind: GroupKind::Sequence,
};

impl Parser<'_, '_> {
    /// With V8's message.
    #[cold]
    fn error(&self, reason: &[u8]) -> Error {
        let flags = self.regexp.flags;
        let mut message = Vec::new();
        append_ascii(&mut message, b"Invalid regular expression: /");
        message.extend_from_slice(self.source);
        append_ascii(&mut message, b"/");
        append_ascii(&mut message, if flags.ignore_case { b"i" } else { b"" });
        append_ascii(&mut message, if flags.unicode { b"u" } else { b"" });
        append_ascii(&mut message, b": ");
        append_ascii(&mut message, reason);
        Error::InvalidRegExp { message }
    }

    fn peek(&self) -> u8 {
        byte_at(self.source, self.at)
    }

    fn eat(&mut self, ascii: &'static [u8]) -> bool {
        let rest = self.source.get(self.at..).unwrap_or_default();
        let is_next = strings::has_prefix_comptime_utf16(rest, ascii);
        self.at += if is_next { ascii.len() } else { 0 };
        is_next
    }

    fn next(&mut self) -> u32 {
        let (character, len) = if self.regexp.flags.unicode {
            strings::decode_wtf16_raw(&self.source[self.at..])
        } else {
            (self.source[self.at].into(), 1)
        };
        self.at += usize::from(len);
        character
    }

    fn new_group(&mut self, parts: &[Node], kind: GroupKind) -> Group {
        let start = self.regexp.nodes.len() as u32;
        self.regexp.nodes.extend_from_slice(parts);
        let len = parts.len() as u32;
        Group {
            parts: Span { start, len },
            kind,
        }
    }

    fn wrap_in_group(&mut self, node: Node) -> Group {
        match node {
            Node::Group(group) => group,
            _ => self.new_group(&[node], GroupKind::Sequence),
        }
    }

    fn new_node(&mut self, parts: &[Node], kind: GroupKind) -> Node {
        match *parts {
            [part] => part,
            _ => Node::Group(self.new_group(parts, kind)),
        }
    }

    fn disjunction(&mut self, depth: usize) -> Result<Node, Error> {
        check_stack()?;
        self.regexp.needs_stack_check |= depth > UNCHECKED_DEPTH;
        let mut alternatives = Vec::new();
        loop {
            self.budget.spend(cost::CALL)?;
            match self.alternative(depth)? {
                Node::Never => {}
                alternative => alternatives.push(alternative),
            }
            if !self.eat(b"|") {
                return Ok(self.new_node(&alternatives, GroupKind::Alternation));
            }
        }
    }

    fn alternative(&mut self, depth: usize) -> Result<Node, Error> {
        let mut terms = Vec::new();
        while self.at + 1 < self.source.len() && !matches!(self.peek(), b'|' | b')') {
            if self.eat(b"^") {
                terms.push(Node::Start);
                continue;
            }
            if self.eat(b"$") {
                terms.push(Node::End);
                continue;
            }
            let cost_before = self.regexp.cost();
            let atom = self.atom(depth)?;
            let quantifier = self.peek();
            if !matches!(quantifier, b'*' | b'+' | b'?') {
                self.append(&mut terms, atom)?;
                continue;
            }
            self.at += 1;
            self.eat(b"?");
            match (atom, quantifier) {
                (Node::Any(_), b'*') => terms.push(Node::AnyStar(UNASSIGNED)),
                (Node::Any(_), b'+') => terms.extend([atom, Node::AnyStar(UNASSIGNED)]),
                (_, b'?') => terms.push(Node::Optional(self.wrap_in_group(atom))),
                _ => terms.push(Node::Repeat(Repeat {
                    body: self.wrap_in_group(atom),
                    cost: (self.regexp.cost() - cost_before) as u32,
                    at_least_once: quantifier == b'+',
                    seen_slot: NONE,
                })),
            }
        }
        Ok(self.new_node(&terms, GroupKind::Sequence))
    }

    fn append(&mut self, terms: &mut Vec<Node>, atom: Node) -> Result<(), Abort> {
        match (terms.last_mut(), atom) {
            (_, Node::Group(group)) if group.is_sequence() => {
                let Span { start, len } = group.parts;
                debug_assert_eq!((start + len) as usize, self.regexp.nodes.len());
                self.budget.spend(len as usize)?;
                terms.extend(self.regexp.nodes.drain(start as usize..));
            }
            (Some(Node::Literal(_, previous)), Node::Literal(_, text))
                if previous.start + previous.len == text.start
                    && (previous.len + text.len) as usize <= MAX_LITERAL_LEN =>
            {
                previous.len += text.len;
            }
            _ => terms.push(atom),
        }
        Ok(())
    }

    fn atom(&mut self, depth: usize) -> Result<Node, Error> {
        self.budget.spend(cost::CALL)?;
        if self.eat(QMARK) || self.eat(b".") {
            return Ok(Node::Any(UNASSIGNED));
        }
        if self.eat(b"[") {
            return self.class();
        }
        if self.eat(START_NO_DOT) {
            return Ok(Node::NoDot(NONE));
        }
        if self.eat(b"(") {
            let is_lookahead = self.eat(b"?!");
            if !is_lookahead {
                self.eat(b"?:");
            }
            let body = self.disjunction(depth + 1)?;
            debug_assert_eq!(self.peek(), b')');
            self.at += 1;
            if !is_lookahead {
                return Ok(body);
            }
            return Ok(Node::NegativeLookahead {
                body: self.wrap_in_group(body),
                memo_slot: NONE,
            });
        }
        if matches!(self.peek(), b'*' | b'+' | b'?') {
            return Err(self.error(b"Nothing to repeat"));
        }
        let flags = self.regexp.flags;
        if self.eat(b"\\")
            && flags.unicode
            && !matches!(
                self.peek(),
                b'$' | b'('..=b'+' | b'.' | b'/' | b'?' | b'['..=b'^' | b'{'..=b'}'
            )
        {
            return Err(self.error(b"Invalid escape"));
        }
        let mut character = self.next();
        if character == SLASH.into() {
            return Ok(Node::Never);
        }
        if flags.ignore_case {
            character = unicode::case_variants(character, flags.unicode).fold(character, u32::min);
        }
        let start = self.regexp.characters.len() as u32;
        self.regexp.characters.push(character);
        Ok(Node::Literal(UNASSIGNED, Span { start, len: 1 }))
    }

    fn class_atom(&mut self) -> ClassAtom {
        use Category::*;
        const PROPERTY_ESCAPES: [(&[u8], &[Category]); 11] = [
            (
                b"p{L}",
                &[UppercaseLetter, LowercaseLetter, RemainingLetter],
            ),
            (b"p{Lu}", &[UppercaseLetter]),
            (b"p{Ll}", &[LowercaseLetter]),
            (b"p{Nl}", &[LetterNumber]),
            (b"p{Nd}", &[DecimalNumber]),
            (b"p{Z}", &[SpaceSeparator, RemainingSeparator]),
            (b"p{Zs}", &[SpaceSeparator]),
            (b"p{C}", &[Control, RemainingOther]),
            (b"p{Cc}", &[Control]),
            (b"p{P}", &[ConnectorPunctuation, RemainingPunctuation]),
            (b"p{Pc}", &[ConnectorPunctuation]),
        ];
        const CHARACTER_ESCAPES: [(&[u8], u32); 7] = [
            (b"t", 0x9),
            (b"n", 0xA),
            (b"v", 0xB),
            (b"f", 0xC),
            (b"r", 0xD),
            (b"x00", 0),
            (b"x7f", 0x7F),
        ];
        if !self.eat(b"\\") {
            return ClassAtom::Character(self.next());
        }
        if let Some((_, categories)) = PROPERTY_ESCAPES.iter().find(|it| self.eat(it.0)) {
            let bits = categories.iter().map(|&category| 1 << category as u16);
            return ClassAtom::Categories(bits.sum());
        }
        match CHARACTER_ESCAPES.iter().find(|it| self.eat(it.0)) {
            Some(&(_, character)) => ClassAtom::Character(character),
            None => ClassAtom::Character(self.next()),
        }
    }

    fn class(&mut self) -> Result<Node, Error> {
        let mut class = Class {
            ascii: [0; 2],
            ranges: Vec::new(),
            categories: 0,
            is_negated: self.eat(b"^"),
        };
        while !self.eat(b"]") {
            self.budget.spend(cost::CALL)?;
            let first = match self.class_atom() {
                ClassAtom::Character(first) => first,
                ClassAtom::Categories(categories) => {
                    class.categories |= categories;
                    continue;
                }
            };
            let mut last = first;
            if self.eat(b"-") {
                match self.class_atom() {
                    ClassAtom::Character(end) if end >= first => last = end,
                    _ => return Err(self.error(b"Range out of order in character class")),
                }
            }
            class.ranges.push((first, last));
        }
        index_sort::sort_slice_unstable(&mut class.ranges);
        class.ranges.dedup_by(|next, kept| {
            let touches = next.0 <= kept.1 + 1;
            if touches {
                kept.1 = kept.1.max(next.1);
            }
            touches
        });
        self.budget.spend(if class.categories == 0 {
            cost::ALLOCATION
        } else {
            cost::CALL * ASCII_LEN as usize
        })?;
        self.budget
            .charge_memory(size_of::<Class>() + ALLOCATION_OVERHEAD)?;
        let ascii = class.ascii_bitmap(self.regexp.flags);
        class.ascii = [ascii as u64, (ascii >> 64) as u64];
        self.regexp.classes.push(class);
        Ok(Node::Class(
            UNASSIGNED,
            self.regexp.classes.len() as u32 - 1,
        ))
    }
}
