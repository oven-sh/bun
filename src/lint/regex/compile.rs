//! From the syntax tree to a [`Program`].

use super::ast::{Assertion, Ast, CharacterSet, Flags, INFINITY, Kind, Node, Nodes};
use super::charset::CharSet;
use super::program::{Inst, Look, Loop, NONE, Prefilter, Program, Repeat, Set, Single};
use super::validator::SyntaxError;
use super::{unicode, wtf8};

/// The flags that modifiers change, and the direction.
#[derive(Copy, Clone)]
struct Context {
    ignore_case: bool,
    multiline: bool,
    dot_all: bool,
    back: bool,
}

/// What a class matches. A string is not one character long.
#[derive(Default)]
struct ClassValue {
    chars: CharSet,
    strings: Vec<Vec<u32>>,
}

/// A part of an alternative.
enum Item<'a> {
    /// Characters that only match themselves, as bytes in `Program::literals`.
    Literal {
        start: u32,
        len: u32,
    },
    Char(u32),
    Node(Node<'a>),
}

struct Compiler {
    program: Program,
    /// Where each capturing group starts in the source, sorted.
    group_starts: Vec<u32>,
    /// What `Program::sets` was made from.
    charsets: Vec<CharSet>,
    unicode_sets: bool,
}

type Compiled<T = ()> = Result<T, SyntaxError>;

pub(super) fn compile(ast: &Ast<'_>, flags: Flags) -> Compiled<Program> {
    let group_starts: Vec<u32> = ast.capturing_groups().map(Node::start).collect();
    let group_count = group_starts.len() as u32 + 1;
    let mut compiler = Compiler {
        program: Program {
            insts: Vec::new(),
            sets: Vec::new(),
            literals: Vec::new(),
            loops: Vec::new(),
            repeats: Vec::new(),
            looks: Vec::new(),
            groups: Vec::new(),
            group_count,
            slot_count: group_count * 2,
            unicode: flags.unicode || flags.unicode_sets,
            has_backreferences: false,
            prefilter: Prefilter::None,
        },
        group_starts,
        charsets: Vec::new(),
        unicode_sets: flags.unicode_sets,
    };
    let context = Context {
        ignore_case: flags.ignore_case,
        multiline: flags.multiline,
        dot_all: flags.dot_all,
        back: false,
    };
    compiler.alternatives(ast.pattern().alternatives(), context)?;
    compiler.emit(Inst::Match);
    let mut program = compiler.program;
    for (pc, inst) in program.insts.iter().enumerate() {
        if let Inst::Repeat(index) = inst
            && let Some(repeat) = program.repeats.get_mut(*index as usize)
            && !repeat.back
        {
            repeat.then = match program.insts.get(pc + 1) {
                Some(Inst::Char { c, back: false }) => first_byte(*c, program.unicode),
                Some(Inst::Literal {
                    start, back: false, ..
                }) => program.literals.get(*start as usize).copied(),
                _ => None,
            };
        }
    }
    program.prefilter = prefilter(&program);
    Ok(program)
}

impl Compiler {
    #[inline]
    fn pc(&self) -> u32 {
        self.program.insts.len() as u32
    }

    fn emit(&mut self, inst: Inst) -> u32 {
        let pc = self.pc();
        self.program.insts.push(inst);
        pc
    }

    /// Makes the `Jump` or the `Split` at `at` go to `first`, and to `second` if that fails.
    fn patch(&mut self, at: u32, first: u32, second: u32) {
        match self.program.insts.get_mut(at as usize) {
            Some(Inst::Jump(target)) => *target = first,
            Some(Inst::Split {
                first: a,
                second: b,
            }) => (*a, *b) = (first, second),
            _ => {}
        }
    }

    fn slot(&mut self) -> u32 {
        let slot = self.program.slot_count;
        self.program.slot_count += 1;
        slot
    }

    fn set(&mut self, set: CharSet) -> u32 {
        // Only the last few are looked at, so that this takes constant time.
        let recent = self.charsets.len().saturating_sub(32);
        if let Some(index) = self
            .charsets
            .iter()
            .skip(recent)
            .position(|known| *known == set)
        {
            return (recent + index) as u32;
        }
        self.program.sets.push(Set::new(&set));
        self.charsets.push(set);
        self.charsets.len() as u32 - 1
    }

    fn single(&mut self, set: CharSet) -> Single {
        match set.single() {
            Some(c) => Single::Char(c),
            None => Single::Set(self.set(set)),
        }
    }

    fn emit_single(&mut self, single: Single, context: Context) {
        self.emit(match single {
            Single::Char(c) => Inst::Char {
                c,
                back: context.back,
            },
            Single::Set(set) => Inst::Set {
                set,
                back: context.back,
            },
        });
    }

    fn close(&self, set: &mut CharSet, context: Context) {
        if context.ignore_case {
            unicode::close_over_case(set, self.program.unicode);
        }
    }

    fn char(&mut self, c: u32, context: Context) -> Single {
        if !context.ignore_case || (c < 0x80 && !(c as u8).is_ascii_alphabetic()) {
            return Single::Char(c);
        }
        let mut set = CharSet::from_ranges(vec![(c, c)]);
        self.close(&mut set, context);
        self.single(set)
    }

    /// Emits `items` as alternatives, the first of which is tried first.
    fn alternation<T>(
        &mut self,
        items: impl ExactSizeIterator<Item = T>,
        mut emit: impl FnMut(&mut Self, T) -> Compiled,
    ) -> Compiled {
        let mut jumps = Vec::new();
        let count = items.len();
        for (i, item) in items.enumerate() {
            if i + 1 == count {
                emit(self, item)?;
                break;
            }
            let split = self.emit(Inst::Split {
                first: 0,
                second: 0,
            });
            emit(self, item)?;
            jumps.push(self.emit(Inst::Jump(0)));
            self.patch(split, split + 1, self.pc());
        }
        for jump in jumps {
            self.patch(jump, self.pc(), 0);
        }
        Ok(())
    }

    fn alternatives(&mut self, alternatives: Nodes<'_>, context: Context) -> Compiled {
        self.alternation(alternatives.iter(), |this, alternative| {
            this.alternative(alternative, context)
        })
    }

    fn alternative(&mut self, alternative: Node<'_>, context: Context) -> Compiled {
        let mut items: Vec<Item<'_>> = Vec::new();
        // The characters of the literal that is being collected.
        let mut run: Vec<u32> = Vec::new();
        for element in alternative.elements() {
            if let Some(c) = element.character()
                && let Single::Char(c) = self.char(c, context)
            {
                run.push(c);
                continue;
            }
            self.flush(&mut run, &mut items);
            items.push(Item::Node(element));
        }
        self.flush(&mut run, &mut items);
        if context.back {
            items.reverse();
        }
        for item in items {
            match item {
                Item::Literal { start, len } => {
                    self.emit(Inst::Literal {
                        start,
                        len,
                        back: context.back,
                    });
                }
                Item::Char(c) => {
                    self.emit(Inst::Char {
                        c,
                        back: context.back,
                    });
                }
                Item::Node(node) => self.element(node, context)?,
            }
        }
        Ok(())
    }

    /// Moves the characters in `run` to `items`.
    ///
    /// Bytes can be compared for all characters but one: a surrogate without the `u` and `v` flags,
    /// which also matches a half of a character outside the BMP. A lead followed by a trail is
    /// such a character.
    fn flush(&mut self, run: &mut Vec<u32>, items: &mut Vec<Item<'_>>) {
        let is_half = |c: u32| !self.program.unicode && (0xD800..=0xDFFF).contains(&c);
        let mut pieces: Vec<(Vec<u32>, bool)> = Vec::new();
        let mut i = 0;
        while let Some(&c) = run.get(i) {
            i += 1;
            let mut c = c;
            let mut half = is_half(c);
            if half
                && c < 0xDC00
                && let Some(&trail) = run.get(i)
                && (0xDC00..=0xDFFF).contains(&trail)
            {
                c = 0x10000 + ((c - 0xD800) << 10) + (trail - 0xDC00);
                half = false;
                i += 1;
            }
            match pieces.last_mut() {
                Some((chars, false)) if !half => chars.push(c),
                _ => pieces.push((vec![c], half)),
            }
        }
        run.clear();
        for (chars, half) in pieces {
            match chars[..] {
                [c] if half || c <= 0xFFFF || self.program.unicode => items.push(Item::Char(c)),
                _ => {
                    let start = self.program.literals.len() as u32;
                    for c in &chars {
                        wtf8::push_code_point(&mut self.program.literals, *c);
                    }
                    let len = self.program.literals.len() as u32 - start;
                    items.push(Item::Literal { start, len });
                }
            }
        }
    }

    /// The slots of the capturing groups in `node`.
    fn group_slots(&self, node: Node<'_>) -> (u32, u32) {
        let before =
            |offset: u32| self.group_starts.partition_point(|start| *start < offset) as u32;
        ((before(node.start()) + 1) * 2, (before(node.end()) + 1) * 2)
    }

    fn element(&mut self, node: Node<'_>, context: Context) -> Compiled {
        match node.kind() {
            Kind::Group {
                modifiers,
                alternatives,
            } => {
                let mut inner = context;
                if let Some(Kind::Modifiers { add, remove }) = modifiers.map(Node::kind) {
                    if let Kind::ModifierFlags(flags) = add.kind() {
                        inner.ignore_case |= flags.ignore_case;
                        inner.multiline |= flags.multiline;
                        inner.dot_all |= flags.dot_all;
                    }
                    if let Some(Kind::ModifierFlags(flags)) = remove.map(Node::kind) {
                        inner.ignore_case &= !flags.ignore_case;
                        inner.multiline &= !flags.multiline;
                        inner.dot_all &= !flags.dot_all;
                    }
                }
                self.alternatives(alternatives, inner)
            }
            Kind::CapturingGroup { alternatives, .. } => {
                let (start, _) = self.group_slots(node);
                let (first, second) = if context.back {
                    (start + 1, start)
                } else {
                    (start, start + 1)
                };
                self.emit(Inst::Save(first));
                self.alternatives(alternatives, context)?;
                self.emit(Inst::Save(second));
                Ok(())
            }
            Kind::Assertion(Assertion::Start) => {
                self.emit(Inst::Start {
                    multiline: context.multiline,
                });
                Ok(())
            }
            Kind::Assertion(Assertion::End) => {
                self.emit(Inst::End {
                    multiline: context.multiline,
                });
                Ok(())
            }
            Kind::Assertion(Assertion::Word { negate }) => {
                let folded = context.ignore_case && self.program.unicode;
                self.emit(Inst::WordBoundary { negate, folded });
                Ok(())
            }
            Kind::Assertion(Assertion::Lookahead {
                negate,
                alternatives,
            }) => self.look(
                negate,
                alternatives,
                Context {
                    back: false,
                    ..context
                },
            ),
            Kind::Assertion(Assertion::Lookbehind {
                negate,
                alternatives,
            }) => self.look(
                negate,
                alternatives,
                Context {
                    back: true,
                    ..context
                },
            ),
            Kind::Quantifier {
                min,
                max,
                greedy,
                element,
            } => self.quantifier(min, max, greedy, element, context),
            Kind::Backreference { resolved, .. } => {
                let start = self.program.groups.len() as u32;
                for group in resolved {
                    let (slot, _) = self.group_slots(group);
                    self.program.groups.push(slot);
                }
                let len = u16::try_from(resolved.len())
                    .map_err(|_| SyntaxError::unsupported("Regular expression too large"))?;
                self.program.has_backreferences = true;
                self.emit(Inst::Backreference {
                    start,
                    len,
                    ignore_case: context.ignore_case,
                    back: context.back,
                });
                Ok(())
            }
            _ => {
                let value = self.atom(node, context)?;
                self.class(value, context)
            }
        }
    }

    fn look(&mut self, negate: bool, alternatives: Nodes<'_>, context: Context) -> Compiled {
        let index = self.program.looks.len() as u32;
        let height = self.slot();
        self.program.looks.push(Look {
            negate,
            height,
            next: 0,
        });
        self.emit(Inst::Look(index));
        self.alternatives(alternatives, context)?;
        self.emit(Inst::LookEnd(index));
        let next = self.pc();
        if let Some(look) = self.program.looks.get_mut(index as usize) {
            look.next = next;
        }
        Ok(())
    }

    fn quantifier(
        &mut self,
        min: u32,
        max: u32,
        greedy: bool,
        element: Node<'_>,
        context: Context,
    ) -> Compiled {
        if max == 0 {
            return Ok(());
        }
        if is_atom(element) {
            let value = self.atom(element, context)?;
            if value.strings.is_empty() {
                let what = self.single(value.chars);
                let index = self.program.repeats.len() as u32;
                let back = context.back;
                self.program.repeats.push(Repeat {
                    what,
                    min,
                    max,
                    greedy,
                    back,
                    then: None,
                });
                self.emit(Inst::Repeat(index));
                return Ok(());
            }
        }

        let (from, to) = self.group_slots(element);
        let mark = if can_be_empty(element) {
            self.slot()
        } else {
            NONE
        };
        let order = |body: u32, exit: u32| if greedy { (body, exit) } else { (exit, body) };
        // One iteration that may be left out.
        let optional = |this: &mut Self| -> Compiled {
            if mark != NONE {
                this.emit(Inst::Save(mark));
            }
            if from != to {
                this.emit(Inst::Clear { from, to });
            }
            this.element(element, context)?;
            if mark != NONE {
                this.emit(Inst::Progress(mark));
            }
            Ok(())
        };
        match (min, max) {
            (0, 1) => {
                let split = self.emit(Inst::Split {
                    first: 0,
                    second: 0,
                });
                optional(self)?;
                let (first, second) = order(split + 1, self.pc());
                self.patch(split, first, second);
            }
            (0, INFINITY) => {
                let split = self.emit(Inst::Split {
                    first: 0,
                    second: 0,
                });
                optional(self)?;
                self.emit(Inst::Jump(split));
                let (first, second) = order(split + 1, self.pc());
                self.patch(split, first, second);
            }
            (1, INFINITY) if mark == NONE => {
                let body = self.pc();
                if from != to {
                    self.emit(Inst::Clear { from, to });
                }
                self.element(element, context)?;
                let split = self.emit(Inst::Split {
                    first: 0,
                    second: 0,
                });
                let (first, second) = order(body, self.pc());
                self.patch(split, first, second);
            }
            _ => {
                let counter = self.slot();
                let index = self.program.loops.len() as u32;
                self.emit(Inst::Zero(counter));
                let head = self.emit(Inst::LoopHead(index));
                self.program.loops.push(Loop {
                    counter,
                    mark,
                    min,
                    max,
                    greedy,
                    head,
                    exit: 0,
                });
                if mark != NONE {
                    self.emit(Inst::Save(mark));
                }
                if from != to {
                    self.emit(Inst::Clear { from, to });
                }
                self.element(element, context)?;
                self.emit(Inst::LoopTail(index));
                let exit = self.pc();
                if let Some(it) = self.program.loops.get_mut(index as usize) {
                    it.exit = exit;
                }
            }
        }
        Ok(())
    }

    /// Emits what matches `value`: the longest strings first.
    fn class(&mut self, mut value: ClassValue, context: Context) -> Compiled {
        if value.strings.is_empty() {
            let single = self.single(value.chars);
            self.emit_single(single, context);
            return Ok(());
        }
        value
            .strings
            .sort_by_key(|string| std::cmp::Reverse(string.len()));
        let has_empty = value.strings.last().is_some_and(Vec::is_empty);
        if has_empty {
            value.strings.pop();
        }
        let singles = self.single(value.chars);
        let mut items: Vec<Option<Vec<Single>>> = Vec::new();
        for string in &value.strings {
            let mut chars: Vec<Single> = string.iter().map(|c| self.char(*c, context)).collect();
            if context.back {
                chars.reverse();
            }
            items.push(Some(chars));
        }
        items.push(Some(vec![singles]));
        if has_empty {
            items.push(None);
        }
        self.alternation(items.into_iter(), |this, chars| {
            for single in chars.unwrap_or_default() {
                this.emit_single(single, context);
            }
            Ok(())
        })
    }

    /// What a `Character`, a `CharacterSet` or a class matches as an element of an alternative.
    fn atom(&mut self, node: Node<'_>, context: Context) -> Compiled<ClassValue> {
        let (negate, mut value) = match node.kind() {
            Kind::CharacterClass {
                negate, elements, ..
            } => (negate, self.union(elements, context)?),
            Kind::ExpressionCharacterClass { negate, expression } => {
                (negate, self.class_value(expression, context)?)
            }
            _ => (false, self.class_value(node, context)?),
        };
        self.close(&mut value.chars, context);
        if negate {
            value.chars = value.chars.complement();
        }
        Ok(value)
    }

    fn union(&mut self, elements: Nodes<'_>, context: Context) -> Compiled<ClassValue> {
        let mut ranges = Vec::new();
        let mut value = ClassValue::default();
        for element in elements {
            match element.kind() {
                Kind::Character { value } => ranges.push((value, value)),
                Kind::CharacterClassRange { min, max } => {
                    ranges.push((min.character().unwrap_or(0), max.character().unwrap_or(0)));
                }
                _ => {
                    let other = self.class_value(element, context)?;
                    ranges.extend_from_slice(other.chars.ranges());
                    value.strings.extend(other.strings);
                }
            }
        }
        value.chars = CharSet::from_ranges(ranges);
        value.strings.sort_unstable();
        value.strings.dedup();
        Ok(value)
    }

    /// With the `v` and `i` flags, sets have all the characters that are equal when case is ignored
    /// to one that they have, so that the complement of a set has none of them.
    fn fold(&self, set: &mut CharSet, context: Context) {
        if self.unicode_sets {
            self.close(set, context);
        }
    }

    /// The specification's `CompileToCharSet`.
    fn class_value(&mut self, node: Node<'_>, context: Context) -> Compiled<ClassValue> {
        let mut value = ClassValue::default();
        match node.kind() {
            Kind::Character { value: c } => value.chars.add(c, c),
            Kind::CharacterClassRange { min, max } => {
                value
                    .chars
                    .add(min.character().unwrap_or(0), max.character().unwrap_or(0));
            }
            Kind::CharacterSet(CharacterSet::Any) => {
                value.chars = if context.dot_all {
                    CharSet::all()
                } else {
                    unicode::line_terminators().complement()
                };
            }
            Kind::CharacterSet(CharacterSet::Digit { negate }) => {
                value.chars = complement_if(negate, unicode::digit());
            }
            Kind::CharacterSet(CharacterSet::Space { negate }) => {
                value.chars = complement_if(negate, unicode::space());
            }
            Kind::CharacterSet(CharacterSet::Word { negate }) => {
                let mut word = unicode::word();
                if self.program.unicode {
                    self.close(&mut word, context);
                }
                value.chars = complement_if(negate, word);
            }
            Kind::CharacterSet(CharacterSet::Property {
                key, strings: true, ..
            }) => {
                (value.chars, value.strings) = unicode::property_of_strings(key);
                value.strings.sort_unstable();
            }
            Kind::CharacterSet(CharacterSet::Property {
                key,
                value: name,
                negate,
                ..
            }) => {
                let mut set = unicode::property(key, name)
                    .ok_or_else(|| SyntaxError::unsupported("Invalid property name"))?;
                self.fold(&mut set, context);
                value.chars = complement_if(negate, set);
            }
            Kind::CharacterClass {
                negate, elements, ..
            } => {
                value = self.union(elements, context)?;
                self.fold(&mut value.chars, context);
                value.chars = complement_if(negate, value.chars);
            }
            Kind::ExpressionCharacterClass { negate, expression } => {
                value = self.class_value(expression, context)?;
                value.chars = complement_if(negate, value.chars);
            }
            Kind::ClassIntersection { left, right } => {
                let left = self.class_value(left, context)?;
                let right = self.class_value(right, context)?;
                value.chars = left.chars.intersection(&right.chars);
                value.strings = left.strings;
                value
                    .strings
                    .retain(|string| right.strings.binary_search(string).is_ok());
            }
            Kind::ClassSubtraction { left, right } => {
                let left = self.class_value(left, context)?;
                let right = self.class_value(right, context)?;
                value.chars = left.chars.difference(&right.chars);
                value.strings = left.strings;
                value
                    .strings
                    .retain(|string| right.strings.binary_search(string).is_err());
            }
            Kind::ClassStringDisjunction { alternatives } => {
                let mut ranges = Vec::new();
                for alternative in alternatives {
                    let chars = alternative.elements().iter().filter_map(Node::character);
                    let string: Vec<u32> = if context.ignore_case {
                        chars.map(|c| unicode::canonicalize(c, true)).collect()
                    } else {
                        chars.collect()
                    };
                    if let [c] = string[..] {
                        ranges.push((c, c));
                        continue;
                    }
                    value.strings.push(string);
                }
                value.chars = CharSet::from_ranges(ranges);
                value.strings.sort_unstable();
                value.strings.dedup();
            }
            _ => {}
        }
        if matches!(
            node.kind(),
            Kind::Character { .. }
                | Kind::CharacterClassRange { .. }
                | Kind::ClassStringDisjunction { .. }
        ) {
            self.fold(&mut value.chars, context);
        }
        Ok(value)
    }
}

fn complement_if(negate: bool, set: CharSet) -> CharSet {
    if negate { set.complement() } else { set }
}

fn is_atom(node: Node<'_>) -> bool {
    matches!(
        node.kind(),
        Kind::Character { .. }
            | Kind::CharacterSet(_)
            | Kind::CharacterClass { .. }
            | Kind::ExpressionCharacterClass { .. }
    )
}

/// Whether `node` could match the empty string. True when in doubt.
fn can_be_empty(node: Node<'_>) -> bool {
    match node.kind() {
        Kind::Character { .. } => false,
        Kind::CharacterSet(CharacterSet::Property { strings, .. }) => strings,
        Kind::CharacterSet(_) => false,
        Kind::CharacterClass { unicode_sets, .. } => unicode_sets,
        Kind::Quantifier { min, element, .. } => min == 0 || can_be_empty(element),
        Kind::Group { alternatives, .. } | Kind::CapturingGroup { alternatives, .. } => {
            alternatives
                .iter()
                .any(|alternative| alternative.elements().iter().all(can_be_empty))
        }
        _ => true,
    }
}

/// The names of the groups with the groups of each, in the order in which the names first appear.
pub(super) fn group_names(ast: &Ast<'_>) -> Vec<(Box<[u8]>, Vec<u32>)> {
    let mut names: Vec<(Box<[u8]>, Vec<u32>)> = Vec::new();
    for (index, group) in ast.capturing_groups().enumerate() {
        let Kind::CapturingGroup {
            name: Some(name), ..
        } = group.kind()
        else {
            continue;
        };
        let index = index as u32 + 1;
        match names.iter_mut().find(|known| *known.0 == *name) {
            Some(known) => known.1.push(index),
            None => names.push((name.into(), vec![index])),
        }
    }
    names
}

// == where a match can start ==

/// The first byte of `c` in text. `None` for a surrogate without the `u` and `v` flags, which can be a
/// half of a character.
fn first_byte(c: u32, unicode: bool) -> Option<u8> {
    if !unicode && (0xD800..=0xDFFF).contains(&c) {
        return None;
    }
    let mut bytes = Vec::with_capacity(4);
    wtf8::push_code_point(&mut bytes, c);
    bytes.first().copied()
}

#[derive(Default)]
struct FirstBytes {
    bytes: [u64; 4],
    /// Nothing is known.
    any: bool,
}

impl FirstBytes {
    fn add(&mut self, lo: u8, hi: u8) {
        for byte in lo..=hi {
            self.bytes[usize::from(byte >> 6)] |= 1 << (byte & 63);
        }
    }

    /// The first bytes of the characters `lo..=hi`, which are not ASCII.
    fn add_range(&mut self, lo: u32, hi: u32, unicode: bool) {
        if !unicode && hi >= 0xDC00 && lo <= 0xDFFF {
            // A trail surrogate matches in the middle of a character.
            self.any = true;
            return;
        }
        if !unicode && hi >= 0xD800 && lo <= 0xDBFF {
            self.add(0xF0, 0xF4);
        }
        let first = |c: u32| first_byte(c, true).unwrap_or(0);
        self.add(first(lo), first(hi));
    }

    fn add_char(&mut self, c: u32, unicode: bool) {
        if c < 0x80 {
            self.add(c as u8, c as u8);
        } else {
            self.add_range(c, c, unicode);
        }
    }

    fn add_single(&mut self, single: Single, program: &Program) {
        match single {
            Single::Char(c) => self.add_char(c, program.unicode),
            Single::Set(set) => {
                let Some(set) = program.sets.get(set as usize) else {
                    self.any = true;
                    return;
                };
                self.bytes[0] |= set.ascii() as u64;
                self.bytes[1] |= (set.ascii() >> 64) as u64;
                for &(lo, hi) in set.non_ascii() {
                    self.add_range(lo, hi, program.unicode);
                }
            }
        }
    }
}

/// Whether all ways through the program from `pc` start with `^`.
fn is_anchored(program: &Program, pc: u32, fuel: &mut u32) -> bool {
    if *fuel == 0 {
        return false;
    }
    *fuel -= 1;
    match program.insts.get(pc as usize) {
        Some(Inst::Start { multiline: false }) => true,
        Some(Inst::Split { first, second }) => {
            is_anchored(program, *first, fuel) && is_anchored(program, *second, fuel)
        }
        Some(Inst::Jump(target)) if *target > pc => is_anchored(program, *target, fuel),
        Some(Inst::Save(_) | Inst::Clear { .. } | Inst::Zero(_)) => {
            is_anchored(program, pc + 1, fuel)
        }
        _ => false,
    }
}

fn prefilter(program: &Program) -> Prefilter {
    if is_anchored(program, 0, &mut 64) {
        return Prefilter::Anchored;
    }
    match program.insts.first() {
        Some(Inst::Literal {
            start,
            len,
            back: false,
        }) => {
            let (start, len) = (*start as usize, *len as usize);
            if let Some(bytes) = program.literals.get(start..start + len) {
                return Prefilter::Prefix(bytes.into());
            }
        }
        Some(Inst::Char { c, back: false })
            if *c >= 0x80 && (program.unicode || !(0xD800..=0xDFFF).contains(c)) =>
        {
            let mut bytes = Vec::new();
            wtf8::push_code_point(&mut bytes, *c);
            return Prefilter::Prefix(bytes.into());
        }
        _ => {}
    }

    let mut first = FirstBytes::default();
    let mut seen = vec![false; program.insts.len()];
    let mut todo = vec![0u32];
    while let Some(pc) = todo.pop() {
        if first.any {
            return Prefilter::None;
        }
        match seen.get_mut(pc as usize) {
            Some(seen) if !*seen => *seen = true,
            _ => continue,
        }
        let Some(inst) = program.insts.get(pc as usize) else {
            continue;
        };
        match *inst {
            Inst::Match | Inst::Backreference { .. } => first.any = true,
            Inst::Char { back: true, .. }
            | Inst::Set { back: true, .. }
            | Inst::Literal { back: true, .. }
            | Inst::LookEnd(_) => first.any = true,
            Inst::Char { c, .. } => first.add_char(c, program.unicode),
            Inst::Set { set, .. } => first.add_single(Single::Set(set), program),
            Inst::Literal { start, .. } => match program.literals.get(start as usize) {
                Some(byte) => first.add(*byte, *byte),
                None => first.any = true,
            },
            Inst::Jump(target) => todo.push(target),
            Inst::Split {
                first: a,
                second: b,
            } => todo.extend([a, b]),
            Inst::Save(_)
            | Inst::Clear { .. }
            | Inst::Zero(_)
            | Inst::Progress(_)
            | Inst::Start { .. }
            | Inst::End { .. }
            | Inst::WordBoundary { .. } => todo.push(pc + 1),
            Inst::LoopHead(index) => {
                todo.push(pc + 1);
                todo.extend(program.loops.get(index as usize).map(|it| it.exit));
            }
            Inst::LoopTail(index) => {
                todo.extend(program.loops.get(index as usize).map(|it| it.head));
            }
            Inst::Repeat(index) => match program.repeats.get(index as usize) {
                Some(repeat) if !repeat.back => {
                    first.add_single(repeat.what, program);
                    if repeat.min == 0 {
                        todo.push(pc + 1);
                    }
                }
                _ => first.any = true,
            },
            Inst::Look(index) => todo.extend(program.looks.get(index as usize).map(|it| it.next)),
        }
    }
    if first.any {
        return Prefilter::None;
    }
    let count: u32 = first.bytes.iter().map(|word| word.count_ones()).sum();
    if count > 3 {
        return Prefilter::ByteSet(Box::new(first.bytes));
    }
    let bytes =
        (0..=255u8).filter(|byte| first.bytes[usize::from(byte >> 6)] & (1 << (byte & 63)) != 0);
    Prefilter::Bytes(bytes.collect())
}
