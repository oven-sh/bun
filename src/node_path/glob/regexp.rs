//! As much of JavaScript's regular expressions as [`ast`](super::ast) can make. A match goes from the end to the start with the set of all positions that are possible, 64 at a time, so it never backtracks.

use bun_collections::smallvec::SmallVec;

use super::ast::{NO_DOT, append_ascii};
use super::{Error, Stop, Work, try_vec};
use crate::scan::{self, BLOCK};
use crate::unicode::{self, Category};
use crate::{BACKSLASH, CodeUnits, DOT, SLASH, Unit, byte_at};

const LONGEST_LITERAL: usize = 32;
/// Up to this depth a match does not look how much stack there is.
const SHALLOW: usize = 12;
/// The work to find a character in the tables of [`unicode`].
const WORK_PER_LOOKUP: usize = 32;
const NONE: u32 = u32::MAX;

/// What a node has that takes characters.
#[derive(Clone, Copy)]
struct Leaf {
    /// The only position that it can start at, or [`NONE`].
    at: u32,
    /// An index of `Matcher::carried`.
    carried: u32,
    /// Only the last position at which it matches makes a difference.
    follows_run: bool,
}

#[derive(Clone, Copy)]
struct Span {
    start: u32,
    length: u32,
}

impl Span {
    #[inline(always)]
    fn of<T>(self, all: &[T]) -> &[T] {
        &all[self.start as usize..][..self.length as usize]
    }
}

#[derive(Clone, Copy)]
struct Group {
    /// Of `RegExp::nodes`.
    parts: Span,
    /// They follow each other. Otherwise one of them is taken.
    is_sequence: bool,
}

#[derive(Clone, Copy)]
struct Repeat {
    body: Group,
    /// As [`RegExp::cost`], of the body.
    cost: u32,
    at_least_once: bool,
    /// An index of `Matcher::memory`, if this is in another one.
    seen: u32,
}

#[derive(Clone, Copy)]
enum Node {
    Never,
    Start,
    End,
    /// [`NO_DOT`], and the only position that it can be at, or [`NONE`].
    NoDot(u32),
    Any(Leaf),
    /// Any number of any characters.
    Run(Leaf),
    /// Of `RegExp::characters`.
    Literal(Leaf, Span),
    /// Of `RegExp::classes`.
    Class(Leaf, u32),
    Group(Group),
    Optional(Group),
    Repeat(Repeat),
    Not {
        body: Group,
        /// The first of two indices of `Matcher::memory`, if this is in a `Repeat`.
        known: u32,
    },
}

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
struct Flags {
    ignores_case: bool,
    is_unicode: bool,
}

struct Class {
    /// The answer for each.
    ascii: [u64; 2],
    /// In order, and apart.
    ranges: Vec<(u32, u32)>,
    /// A bit for each [`Category`].
    categories: u16,
    is_negated: bool,
}

impl Class {
    fn has_member(&self, character: u32) -> bool {
        let after = self.ranges.partition_point(|range| range.0 <= character);
        (after != 0 && character <= self.ranges[after - 1].1)
            || (self.categories != 0
                && self.categories & (1 << unicode::category(character) as u16) != 0)
    }

    fn looks_up(&self, character: u32, flags: Flags) -> bool {
        let is_member = if flags.ignores_case {
            unicode::cases(character, flags.is_unicode).any(|case| self.has_member(case))
        } else {
            self.has_member(character)
        };
        is_member != self.is_negated
    }
}

/// The same for all characters that the flag `i` takes for the same.
#[inline(always)]
fn fold(character: u32, is_unicode: bool) -> u32 {
    match u8::try_from(character) {
        Ok(latin1) => unicode::fold_latin1(latin1).into(),
        Err(_) => unicode::cases(character, is_unicode).fold(character, u32::min),
    }
}

/// In [`Plain::steps`], above all characters. The other bits are an index of `RegExp::classes`.
const CLASS: u32 = 1 << 31;
const ANY: u32 = u32::MAX;

/// An expression in which each character has its place, counted from the start or from the end.
struct Plain {
    /// A character, [`CLASS`] or [`ANY`].
    steps: Box<[u32]>,
    /// How many steps are in front of the [`Node::Run`].
    run: Option<u32>,
}

pub(super) struct RegExp {
    /// What is between `^` and `$`.
    root: Group,
    /// For [`NO_DOT`] at the start, which `root` does not have any more.
    refuses_dot: bool,
    nodes: Vec<Node>,
    /// Folded, if case is ignored.
    characters: Vec<u32>,
    classes: Vec<Class>,
    flags: Flags,
    memory: u32,
    leaves: u32,
    is_deep: bool,
    plain: Option<Plain>,
}

impl RegExp {
    /// `source` starts with `^`, ends with `$` and has each `|` in parentheses.
    pub(super) fn compile(
        source: &[u16],
        ignores_case: bool,
        is_unicode: bool,
        work: &mut Work<'_>,
    ) -> Result<Self, Error> {
        work.spend(8 * source.len())?;
        let mut parser = Parser {
            source,
            at: 1,
            work,
            regexp: RegExp {
                root: NOTHING,
                refuses_dot: false,
                nodes: Vec::new(),
                characters: Vec::new(),
                classes: Vec::new(),
                flags: Flags {
                    ignores_case,
                    is_unicode,
                },
                memory: 0,
                leaves: 0,
                is_deep: false,
                plain: None,
            },
        };
        let root = parser.disjunction(0)?;
        parser.regexp.root = parser.as_group(root);
        let mut regexp = parser.regexp;
        regexp.prepare_group(regexp.root, Some(0), false, work)?;
        if regexp.root.is_sequence {
            regexp.take_out_no_dot();
            regexp.plain = regexp.as_plain();
        }
        regexp.nodes.shrink_to_fit();
        regexp.characters.shrink_to_fit();
        regexp.classes.shrink_to_fit();
        Ok(regexp)
    }

    fn take_out_no_dot(&mut self) {
        let Span { start, length } = self.root.parts;
        let mut end = start;
        for part in start..start + length {
            let part = self.nodes[part as usize];
            if let Node::NoDot(0) = part {
                self.refuses_dot = true;
            } else {
                self.nodes[end as usize] = part;
                end += 1;
            }
        }
        self.root.parts.length = end - start;
    }

    fn as_plain(&self) -> Option<Plain> {
        let mut steps = Vec::new();
        let mut run = None;
        for part in self.root.parts.of(&self.nodes) {
            match *part {
                Node::Any(_) => steps.push(ANY),
                Node::Class(_, class) => steps.push(CLASS | class),
                Node::Literal(_, literal) => steps.extend(literal.of(&self.characters)),
                Node::Run(_) if run.is_none() => run = Some(steps.len() as u32),
                _ => return None,
            }
        }
        let steps = steps.into();
        Some(Plain { steps, run })
    }

    /// The work to try each node at one position.
    #[inline(always)]
    fn cost(&self) -> usize {
        self.nodes.len() + self.characters.len()
    }

    /// What each text that matches ends with.
    pub(super) fn last_literal(&self) -> &[u32] {
        match *self.root.parts.of(&self.nodes) {
            [.., Node::Literal(_, literal)] if self.root.is_sequence => {
                literal.of(&self.characters)
            }
            _ => &[],
        }
    }

    pub(super) fn size(&self) -> usize {
        let ranges = self.classes.iter().map(|class| class.ranges.capacity());
        size_of_val(&self.nodes[..])
            + size_of_val(&self.characters[..])
            + size_of_val(&self.classes[..])
            + (self.plain.as_ref()).map_or(0, |plain| size_of_val(&*plain.steps))
            + size_of::<(u32, u32)>() * ranges.sum::<usize>()
    }

    /// Fills in what depends on where a node is. `at` is the only position that it can start at, and the answer the only one that it can end at.
    fn prepare_group(
        &mut self,
        group: Group,
        mut at: Option<u32>,
        is_repeated: bool,
        work: &Work<'_>,
    ) -> Result<Option<u32>, Stop> {
        work.check_stack()?;
        let Span { start, length } = group.parts;
        if group.is_sequence {
            let mut follows_run = false;
            for part in start..start + length {
                at = self.prepare(part, at, is_repeated, follows_run, work)?;
                follows_run = matches!(self.nodes[part as usize], Node::Run(_));
            }
            return Ok(at);
        }
        let mut end = None;
        for option in start..start + length {
            let this_end = self.prepare(option, at, is_repeated, false, work)?;
            let is_alike = option == start || end == this_end;
            end = this_end.filter(|_| is_alike);
        }
        Ok(end)
    }

    fn prepare(
        &mut self,
        index: u32,
        at: Option<u32>,
        is_repeated: bool,
        follows_run: bool,
        work: &Work<'_>,
    ) -> Result<Option<u32>, Stop> {
        let leaf = Leaf {
            at: at.unwrap_or(NONE),
            carried: self.leaves,
            follows_run,
        };
        let mut remember = |count: u32| {
            if !is_repeated {
                return NONE;
            }
            self.memory += count;
            self.memory - count
        };
        let (node, length) = match self.nodes[index as usize] {
            Node::Never => return Ok(None),
            Node::Start => return Ok(Some(0)),
            Node::End => return Ok(at),
            Node::NoDot(_) => {
                self.nodes[index as usize] = Node::NoDot(leaf.at);
                return Ok(at);
            }
            Node::Any(_) => (Node::Any(leaf), Some(1)),
            Node::Run(_) => (Node::Run(leaf), None),
            Node::Literal(_, text) => (Node::Literal(leaf, text), Some(text.length)),
            Node::Class(_, class) => (Node::Class(leaf, class), Some(1)),
            Node::Group(group) => return self.prepare_group(group, at, is_repeated, work),
            Node::Optional(body) => {
                self.prepare_group(body, at, is_repeated, work)?;
                return Ok(None);
            }
            Node::Repeat(repeat) => {
                let seen = remember(1);
                self.nodes[index as usize] = Node::Repeat(Repeat { seen, ..repeat });
                self.prepare_group(repeat.body, None, true, work)?;
                return Ok(None);
            }
            Node::Not { body, .. } => {
                let known = remember(2);
                self.nodes[index as usize] = Node::Not { body, known };
                self.prepare_group(body, at, false, work)?;
                return Ok(at);
            }
        };
        self.nodes[index as usize] = node;
        self.leaves += 1;
        Ok(at
            .zip(length)
            .and_then(|(at, length)| at.checked_add(length)))
    }

    /// `text` has no slash.
    #[inline(always)]
    pub(super) fn test<U: Unit>(&self, text: &[U], work: &mut Work<'_>) -> Result<bool, Stop> {
        if self.refuses_dot && byte_at(text, 0) == DOT {
            return Ok(false);
        }
        match U::units(text) {
            CodeUnits::U8(text) => self.test_characters(text, work),
            CodeUnits::U16(text) if self.flags.is_unicode => self.test_code_points(text, work),
            CodeUnits::U16(text) => self.test_characters(text, work),
        }
    }

    #[inline(never)]
    fn test_code_points(&self, text: &[u16], work: &mut Work<'_>) -> Result<bool, Stop> {
        work.spend(text.len())?;
        if !text.iter().any(|&unit| unicode::is_lead(unit)) {
            return self.test_characters(text, work);
        }
        work.spend(2 * text.len())?;
        let mut characters = try_vec(text.len())?;
        characters.extend(unicode::code_points(text));
        self.test_characters(&characters, work)
    }

    #[inline(always)]
    fn test_characters<C: Character>(&self, text: &[C], work: &mut Work<'_>) -> Result<bool, Stop> {
        work.spend(self.cost())?;
        if let Some(plain) = &self.plain {
            return Ok(Matcher::new(self, text, work).is_like(plain));
        }
        if text.len() >= BLOCK || self.memory != 0 {
            return self.test_block_by_block(text, work);
        }
        let mut matcher = Matcher::new(self, text, work);
        let starts = matcher.starts::<false>(&self.root, 1 << text.len(), false);
        matcher.stop.map_or(Ok(starts & 1 != 0), Err)
    }

    #[inline(never)]
    fn test_block_by_block<C: Character>(
        &self,
        text: &[C],
        work: &mut Work<'_>,
    ) -> Result<bool, Stop> {
        let mut memory = SmallVec::<[u64; 8]>::from_elem(0, self.memory as usize);
        let mut carried = SmallVec::<[_; 16]>::from_elem(Carried::default(), self.leaves as usize);
        let mut matcher = Matcher {
            memory: &mut memory,
            carried: &mut carried,
            ..Matcher::new(self, text, work)
        };
        loop {
            let ends = matcher.only::<true>(text.len());
            let starts = matcher.starts::<true>(&self.root, ends, true);
            if let Some(stop) = matcher.stop {
                return Err(stop);
            }
            if matcher.base == 0 {
                return Ok(starts & 1 != 0);
            }
            matcher.work.spend(self.cost())?;
            matcher.base -= BLOCK;
            matcher.all = u64::MAX;
            matcher.memory.fill(0);
            for carried in &mut *matcher.carried {
                carried.from_behind = core::mem::take(&mut carried.here);
            }
        }
    }
}

/// The positions at which a leaf was to end.
#[derive(Clone, Copy, Default)]
struct Carried {
    /// In the block behind this one, until they have been looked at.
    from_behind: u64,
    here: u64,
}

struct Matcher<'m, 'a, C> {
    regexp: &'m RegExp,
    text: &'m [C],
    /// The position that the lowest bit of a set stands for.
    base: usize,
    /// The positions of this block that `text` has.
    all: u64,
    memory: &'m mut [u64],
    carried: &'m mut [Carried],
    work: &'m mut Work<'a>,
    /// Once this is set, no answer counts.
    stop: Option<Stop>,
}

impl<'m, 'a, C: Character> Matcher<'m, 'a, C> {
    /// At the last block.
    #[inline(always)]
    fn new(regexp: &'m RegExp, text: &'m [C], work: &'m mut Work<'a>) -> Self {
        Matcher {
            regexp,
            text,
            base: text.len() / BLOCK * BLOCK,
            all: u64::MAX >> (BLOCK - 1 - text.len() % BLOCK),
            memory: &mut [],
            carried: &mut [],
            work,
            stop: None,
        }
    }

    #[inline(always)]
    fn base<const LONG: bool>(&self) -> usize {
        if LONG { self.base } else { 0 }
    }

    /// The set of `position`, if that is in this block.
    #[inline(always)]
    fn only<const LONG: bool>(&self, position: usize) -> u64 {
        let bit = position.wrapping_sub(self.base::<LONG>());
        if bit < BLOCK { 1 << bit } else { 0 }
    }

    #[inline(always)]
    fn positions_of(&self, a: u8, b: u8) -> u64 {
        let rest = &self.text[self.base..];
        C::either_bits(&rest[..rest.len().min(BLOCK)], a, b)
    }

    #[inline(never)]
    fn positions_of_dots(&self) -> u64 {
        self.positions_of(DOT, DOT)
    }

    #[inline(always)]
    fn goes_on(&mut self, result: Result<(), Stop>) -> bool {
        if let Err(stop) = result {
            self.stop = Some(stop);
        }
        self.stop.is_none()
    }

    /// The positions that are `length` in front of one of `ends`.
    #[inline(always)]
    fn before<const LONG: bool>(&mut self, leaf: &Leaf, ends: u64, length: usize) -> u64 {
        let mut starts = ends >> length;
        if LONG {
            let carried = &mut self.carried[leaf.carried as usize];
            starts |= core::mem::take(&mut carried.from_behind) << (BLOCK - length);
            carried.here |= ends;
        }
        if leaf.at != NONE {
            starts &= self.only::<LONG>(leaf.at as usize);
        }
        starts
    }

    #[inline(always)]
    fn filter(
        &mut self,
        leaf: &Leaf,
        mut candidates: u64,
        matches: impl Fn(&mut Self, usize) -> bool,
    ) -> u64 {
        let mut starts = 0;
        while let Some(bit) = candidates.checked_ilog2() {
            candidates ^= 1 << bit;
            if matches(self, self.base + bit as usize) {
                starts |= 1 << bit;
                if leaf.follows_run {
                    break;
                }
            }
        }
        starts
    }

    #[inline(always)]
    fn has_literal_at(&mut self, position: usize, literal: &[u32]) -> bool {
        let flags = self.regexp.flags;
        let mut pairs = self.text[position..][..literal.len()].iter().zip(literal);
        if !flags.ignores_case {
            return pairs.all(|(&a, &b)| a.into() == b);
        }
        pairs.all(|(&a, &b)| {
            if a.into() > 0xFF {
                self.work.note(WORK_PER_LOOKUP);
            }
            fold(a.into(), flags.is_unicode) == b
        })
    }

    #[inline(always)]
    fn has_member_at(&mut self, position: usize, class: &Class) -> bool {
        let character = self.text[position].into();
        match class.ascii.get(character as usize / 64) {
            Some(bits) => bits >> (character % 64) & 1 != 0,
            None => {
                self.work.note(WORK_PER_LOOKUP);
                class.looks_up(character, self.regexp.flags)
            }
        }
    }

    #[inline(always)]
    fn is_like(&mut self, plain: &Plain) -> bool {
        let Some(in_run) = self.text.len().checked_sub(plain.steps.len()) else {
            return false;
        };
        let head = match plain.run {
            Some(head) => head as usize,
            None if in_run == 0 => 0,
            None => return false,
        };
        plain.steps.iter().enumerate().all(|(at, &step)| {
            let position = if at < head { at } else { at + in_run };
            if step < CLASS {
                self.has_literal_at(position, &[step])
            } else {
                step == ANY
                    || self.has_member_at(position, &self.regexp.classes[(step ^ CLASS) as usize])
            }
        })
    }

    #[inline(never)]
    fn filter_by_literal(&mut self, leaf: &Leaf, mut candidates: u64, literal: &[u32]) -> u64 {
        let flags = self.regexp.flags;
        if !(flags.ignores_case && flags.is_unicode)
            && let Ok(first @ ..0x80) = u8::try_from(literal[0])
        {
            let lower = first.to_ascii_lowercase();
            candidates &= self.positions_of(first, if flags.ignores_case { lower } else { first });
        }
        self.work
            .note(candidates.count_ones() as usize * literal.len());
        self.filter(leaf, candidates, |it, at| it.has_literal_at(at, literal))
    }

    #[inline(never)]
    fn filter_by_class(&mut self, leaf: &Leaf, candidates: u64, class: &Class) -> u64 {
        self.work.note(candidates.count_ones() as usize);
        self.filter(leaf, candidates, |it, at| it.has_member_at(at, class))
    }

    /// The positions from which `group` matches up to one of `ends`. `LONG`: there may be more than one block. `is_first`: `group` has not been looked at in this one.
    #[inline(never)]
    fn starts<const LONG: bool>(&mut self, group: &Group, mut ends: u64, is_first: bool) -> u64 {
        let regexp = self.regexp;
        if regexp.is_deep && !self.goes_on(self.work.check_stack()) {
            return 0;
        }
        let mut of_options = 0;
        for part in group.parts.of(&regexp.nodes).iter().rev() {
            if ends == 0 && !(LONG && is_first) {
                return 0;
            }
            let starts = self.starts_of_part::<LONG>(part, ends, is_first);
            if group.is_sequence {
                ends = starts;
            } else {
                of_options |= starts;
            }
        }
        if group.is_sequence { ends } else { of_options }
    }

    #[inline(always)]
    fn starts_of_part<const LONG: bool>(&mut self, part: &Node, ends: u64, is_first: bool) -> u64 {
        let regexp = self.regexp;
        let base = self.base::<LONG>();
        let position_of = |only: u64| base + only.trailing_zeros() as usize;
        match part {
            Node::Never => 0,
            Node::Start => ends & self.only::<LONG>(0),
            Node::End => ends & self.only::<LONG>(self.text.len()),
            Node::NoDot(NONE) => ends & !self.positions_of_dots(),
            &Node::NoDot(at) => match self.text.get(at as usize) {
                Some(&character) if character.into() == DOT.into() => 0,
                _ => ends & self.only::<LONG>(at as usize),
            },
            Node::Any(leaf) => self.before::<LONG>(leaf, ends, 1),
            Node::Run(leaf) => {
                if LONG {
                    let carried = &mut self.carried[leaf.carried as usize];
                    carried.here |= ends | carried.from_behind;
                    if carried.from_behind != 0 {
                        return u64::MAX;
                    }
                }
                u64::MAX.checked_shr(ends.leading_zeros()).unwrap_or(0)
            }
            Node::Literal(leaf, literal) => {
                let literal = literal.of(&regexp.characters);
                match self.before::<LONG>(leaf, ends, literal.len()) {
                    0 => 0,
                    many if many & (many - 1) != 0 => self.filter_by_literal(leaf, many, literal),
                    only if self.has_literal_at(position_of(only), literal) => only,
                    _ => 0,
                }
            }
            Node::Class(leaf, class) => {
                let class = &regexp.classes[*class as usize];
                match self.before::<LONG>(leaf, ends, 1) {
                    0 => 0,
                    many if many & (many - 1) != 0 => self.filter_by_class(leaf, many, class),
                    only if self.has_member_at(position_of(only), class) => only,
                    _ => 0,
                }
            }
            Node::Group(group) => self.starts::<LONG>(group, ends, is_first),
            Node::Optional(body) => ends | self.starts::<LONG>(body, ends, is_first),
            Node::Not { body, known: NONE } => ends & !self.starts::<LONG>(body, self.all, true),
            Node::Not { body, known } => ends & !self.remembered_starts::<LONG>(body, *known),
            Node::Repeat(repeat) => self.starts_of_repeat::<LONG>(repeat, ends, is_first),
        }
    }

    #[inline(never)]
    fn remembered_starts<const LONG: bool>(&mut self, body: &Group, known: u32) -> u64 {
        let known = known as usize;
        if self.memory[known] == 0 {
            self.memory[known] = 1;
            self.memory[known + 1] = self.starts::<LONG>(body, self.all, true);
        }
        self.memory[known + 1]
    }

    #[inline(never)]
    fn starts_of_repeat<const LONG: bool>(
        &mut self,
        repeat: &Repeat,
        ends: u64,
        mut is_first: bool,
    ) -> u64 {
        // What has been passed to the body in this block has been answered too.
        let mut seen = self.memory.get(repeat.seen as usize).map_or(0, |&it| it);
        let mut fresh = ends & !seen;
        let mut starts = if repeat.at_least_once { 0 } else { fresh };
        loop {
            seen |= fresh;
            let found = self.starts::<LONG>(&repeat.body, fresh, is_first);
            starts |= found;
            fresh = found & !seen;
            is_first = false;
            let spent = self.work.spend(repeat.cost as usize);
            if !self.goes_on(spent) || fresh == 0 {
                break;
            }
        }
        if let Some(memory) = self.memory.get_mut(repeat.seen as usize) {
            *memory = seen;
        }
        starts
    }
}

struct Parser<'p, 'a> {
    source: &'p [u16],
    at: usize,
    work: &'p mut Work<'a>,
    regexp: RegExp,
}

enum Member {
    Character(u32),
    Categories(u16),
}

const UNPREPARED: Leaf = Leaf {
    at: NONE,
    carried: NONE,
    follows_run: false,
};

const NOTHING: Group = Group {
    parts: Span {
        start: 0,
        length: 0,
    },
    is_sequence: true,
};

impl Parser<'_, '_> {
    #[cold]
    fn error(&self, reason: &[u8]) -> Error {
        let flags = self.regexp.flags;
        let mut message = Vec::new();
        append_ascii(&mut message, b"Invalid regular expression: /");
        message.extend_from_slice(self.source);
        append_ascii(&mut message, b"/");
        append_ascii(&mut message, if flags.ignores_case { b"i" } else { b"" });
        append_ascii(&mut message, if flags.is_unicode { b"u" } else { b"" });
        append_ascii(&mut message, b": ");
        append_ascii(&mut message, reason);
        Error::Syntax(message)
    }

    fn peek(&self) -> u8 {
        byte_at(self.source, self.at)
    }

    fn eat(&mut self, ascii: &[u8]) -> bool {
        let is_next = (0..ascii.len()).all(|it| byte_at(self.source, self.at + it) == ascii[it]);
        self.at += if is_next { ascii.len() } else { 0 };
        is_next
    }

    fn next(&mut self) -> u32 {
        let unit = self.source[self.at];
        self.at += 1;
        match self.source.get(self.at) {
            Some(&trail)
                if self.regexp.flags.is_unicode
                    && unicode::is_lead(unit)
                    && unicode::is_trail(trail) =>
            {
                self.at += 1;
                unicode::from_surrogates(unit, trail)
            }
            _ => unit.into(),
        }
    }

    fn group(&mut self, parts: &[Node], is_sequence: bool) -> Group {
        let start = self.regexp.nodes.len() as u32;
        self.regexp.nodes.extend_from_slice(parts);
        let length = parts.len() as u32;
        Group {
            parts: Span { start, length },
            is_sequence,
        }
    }

    fn as_group(&mut self, node: Node) -> Group {
        match node {
            Node::Group(group) => group,
            _ => self.group(&[node], true),
        }
    }

    fn as_node(&mut self, parts: &[Node], is_sequence: bool) -> Node {
        match *parts {
            [part] => part,
            _ => Node::Group(self.group(parts, is_sequence)),
        }
    }

    fn disjunction(&mut self, depth: usize) -> Result<Node, Error> {
        self.work.check_stack()?;
        self.regexp.is_deep |= depth > SHALLOW;
        let mut options = Vec::new();
        loop {
            match self.alternative(depth)? {
                Node::Never => {}
                option => options.push(option),
            }
            if !self.eat(b"|") {
                return Ok(self.as_node(&options, false));
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
                (Node::Any(_), b'*') => terms.push(Node::Run(UNPREPARED)),
                (Node::Any(_), b'+') => terms.extend([atom, Node::Run(UNPREPARED)]),
                (_, b'?') => terms.push(Node::Optional(self.as_group(atom))),
                _ => terms.push(Node::Repeat(Repeat {
                    body: self.as_group(atom),
                    cost: (self.regexp.cost() - cost_before) as u32,
                    at_least_once: quantifier == b'+',
                    seen: NONE,
                })),
            }
        }
        Ok(self.as_node(&terms, true))
    }

    fn append(&mut self, terms: &mut Vec<Node>, atom: Node) -> Result<(), Stop> {
        match (terms.last_mut(), atom) {
            // Its parts are the last nodes that have been added.
            (_, Node::Group(group)) if group.is_sequence => {
                self.work.spend(group.parts.length as usize)?;
                terms.extend(self.regexp.nodes.drain(group.parts.start as usize..));
            }
            (Some(Node::Literal(_, before)), Node::Literal(_, text))
                if before.start + before.length == text.start
                    && (before.length + text.length) as usize <= LONGEST_LITERAL =>
            {
                before.length += text.length;
            }
            _ => terms.push(atom),
        }
        Ok(())
    }

    fn atom(&mut self, depth: usize) -> Result<Node, Error> {
        if self.eat(b"[^/]") || self.eat(b".") {
            return Ok(Node::Any(UNPREPARED));
        }
        if self.eat(b"[") {
            return self.class();
        }
        if self.eat(NO_DOT) {
            return Ok(Node::NoDot(NONE));
        }
        if self.eat(b"(") {
            let is_negated = self.eat(b"?!");
            if !is_negated {
                self.eat(b"?:");
            }
            let body = self.disjunction(depth + 1)?;
            self.at += 1;
            if !is_negated {
                return Ok(body);
            }
            return Ok(Node::Not {
                body: self.as_group(body),
                known: NONE,
            });
        }
        if matches!(self.peek(), b'*' | b'+' | b'?') {
            return Err(self.error(b"Nothing to repeat"));
        }
        let flags = self.regexp.flags;
        if self.eat(&[BACKSLASH])
            && flags.is_unicode
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
        if flags.ignores_case {
            character = fold(character, flags.is_unicode);
        }
        let start = self.regexp.characters.len() as u32;
        self.regexp.characters.push(character);
        Ok(Node::Literal(UNPREPARED, Span { start, length: 1 }))
    }

    fn member(&mut self) -> Member {
        use Category::*;
        const PROPERTIES: [(&[u8], &[Category]); 11] = [
            (b"p{L}", &[UppercaseLetter, LowercaseLetter, OtherLetter]),
            (b"p{Lu}", &[UppercaseLetter]),
            (b"p{Ll}", &[LowercaseLetter]),
            (b"p{Nl}", &[LetterNumber]),
            (b"p{Nd}", &[DecimalNumber]),
            (b"p{Z}", &[SpaceSeparator, OtherSeparator]),
            (b"p{Zs}", &[SpaceSeparator]),
            (b"p{C}", &[Control, OtherOther]),
            (b"p{Cc}", &[Control]),
            (b"p{P}", &[ConnectorPunctuation, OtherPunctuation]),
            (b"p{Pc}", &[ConnectorPunctuation]),
        ];
        const CHARACTERS: [(&[u8], u32); 7] = [
            (b"t", 0x9),
            (b"n", 0xA),
            (b"v", 0xB),
            (b"f", 0xC),
            (b"r", 0xD),
            (b"x00", 0),
            (b"x7f", 0x7F),
        ];
        if !self.eat(&[BACKSLASH]) {
            return Member::Character(self.next());
        }
        if let Some((_, categories)) = PROPERTIES.iter().find(|it| self.eat(it.0)) {
            let bits = categories.iter().map(|&category| 1 << category as u16);
            return Member::Categories(bits.sum());
        }
        match CHARACTERS.iter().find(|it| self.eat(it.0)) {
            Some(&(_, character)) => Member::Character(character),
            None => Member::Character(self.next()),
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
            let first = match self.member() {
                Member::Character(first) => first,
                Member::Categories(categories) => {
                    class.categories |= categories;
                    continue;
                }
            };
            let mut last = first;
            if self.eat(b"-") {
                match self.member() {
                    Member::Character(end) if end >= first => last = end,
                    _ => return Err(self.error(b"Range out of order in character class")),
                }
            }
            class.ranges.push((first, last));
        }
        class.ranges.sort_unstable();
        class.ranges.dedup_by(|next, kept| {
            let touches = next.0 <= kept.1 + 1;
            if touches {
                kept.1 = kept.1.max(next.1);
            }
            touches
        });
        self.work.spend(1024)?;
        for character in 0..128 {
            let bit = u64::from(class.looks_up(character, self.regexp.flags));
            class.ascii[character as usize / 64] |= bit << (character % 64);
        }
        self.regexp.classes.push(class);
        Ok(Node::Class(
            UNPREPARED,
            self.regexp.classes.len() as u32 - 1,
        ))
    }
}
