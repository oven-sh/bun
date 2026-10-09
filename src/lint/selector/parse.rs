//! `grammar.pegjs` of `esquery`, one method for each of its rules, written the way PEG.js generates
//! them: every alternative is tried in order, a rule that fails leaves the position where it was,
//! and each terminal that does not match is noted. That is what the message of a syntax error
//! lists, so no alternative is skipped because it cannot match.

use super::Error;
use super::program::{Bound, Id, JsType, Key, Literal, Op, Program, Relation, Run, Test, TypeSet};
use crate::estree::NodeType;
use crate::regex::Regex;
use crate::utils::text;
use bun_core::strings;
use smallvec::SmallVec;

/// A terminal of the grammar, in the order of their descriptions.
#[derive(Copy, Clone)]
#[repr(u8)]
enum Expected {
    Space,
    Bang,
    Hash,
    SingleQuote,
    CloseParen,
    Star,
    Plus,
    Comma,
    Dot,
    Slash,
    Colon,
    FirstChild,
    Has,
    Is,
    LastChild,
    Matches,
    Not,
    NthChild,
    NthLastChild,
    Equals,
    Greater,
    OpenBracket,
    DoubleQuote,
    Backslash,
    CloseBracket,
    Type,
    Tilde,
    Digit,
    GreaterLessBang,
    GreaterLess,
    InType,
    InIdentifier,
    InRegex,
    InDoubleQuotes,
    InSingleQuotes,
    InRegexClass,
    Flag,
    Any,
    End,
}

/// What PEG.js calls them, by `Expected as usize`. Sorted.
const DESCRIPTIONS: [&str; 39] = [
    "\" \"",
    "\"!\"",
    "\"#\"",
    "\"'\"",
    "\")\"",
    "\"*\"",
    "\"+\"",
    "\",\"",
    "\".\"",
    "\"/\"",
    "\":\"",
    "\":first-child\"",
    "\":has(\"",
    "\":is(\"",
    "\":last-child\"",
    "\":matches(\"",
    "\":not(\"",
    "\":nth-child(\"",
    "\":nth-last-child(\"",
    "\"=\"",
    "\">\"",
    "\"[\"",
    "\"\\\"\"",
    "\"\\\\\"",
    "\"]\"",
    "\"type(\"",
    "\"~\"",
    "[0-9]",
    "[><!]",
    "[><]",
    "[^ )]",
    "[^ [\\],():#!=><~+.]",
    "[^/\\\\[]",
    "[^\\\\\"]",
    "[^\\\\']",
    "[^\\]\\\\]",
    "[imsu]",
    "any character",
    "end of input",
];

#[derive(Copy, Clone)]
enum Combinator {
    Child,
    Sibling,
    Adjacent,
    Descendant,
}

/// A position to go back to, with what has been compiled up to there.
#[derive(Copy, Clone)]
struct Mark {
    at: usize,
    ops: usize,
    lists: usize,
    keys: usize,
    tests: usize,
    bytes: usize,
}

type Ids = SmallVec<[Id; 8]>;

struct Parser<'s> {
    text: &'s [u8],
    at: usize,
    /// The furthest position at which a terminal did not match, and which ones did not there.
    max_fail_at: usize,
    expected: u64,
    /// How many selectors the current one is in or to the right of.
    depth: u32,
    /// What `esquery` throws from an action, which ends the parsing.
    error: Option<Error>,
    program: Program,
}

/// How deep selectors can nest and how many combinators can follow each other. Matching recurses as
/// deep.
const MAX_DEPTH: u32 = 200;

/// The types of a class of ESLint's `matchesSelectorClass`, and whether an `Identifier` in a
/// `MetaProperty` is left out.
fn class_named(name: &[u8]) -> Option<(TypeSet, bool)> {
    let ends_with = |suffix: &'static str| move |it: NodeType| it.name().ends_with(suffix);
    let declarations = TypeSet::where_(ends_with("Declaration"));
    let expressions = TypeSet::where_(ends_with("Expression"))
        .union(TypeSet::where_(ends_with("Literal")))
        .union(TypeSet::of(&[NodeType::Identifier, NodeType::MetaProperty]));
    Some(match &name.to_ascii_lowercase()[..] {
        b"statement" => (
            TypeSet::where_(ends_with("Statement")).union(declarations),
            false,
        ),
        b"declaration" => (declarations, false),
        b"pattern" => (
            TypeSet::where_(ends_with("Pattern")).union(expressions),
            true,
        ),
        b"expression" => (expressions, true),
        b"function" => (
            TypeSet::of(&[
                NodeType::FunctionDeclaration,
                NodeType::FunctionExpression,
                NodeType::ArrowFunctionExpression,
            ]),
            false,
        ),
        _ => return None,
    })
}

impl<'s> Parser<'s> {
    // ───────────────────────────── terminals ─────────────────────────────

    /// `peg$fail`
    fn fail(&mut self, expected: Expected) {
        if self.at < self.max_fail_at {
            return;
        }
        if self.at > self.max_fail_at {
            self.max_fail_at = self.at;
            self.expected = 0;
        }
        self.expected |= 1 << expected as u8;
    }

    fn literal(&mut self, token: &[u8], expected: Expected) -> bool {
        let is_next = self
            .text
            .get(self.at..)
            .is_some_and(|it| it.starts_with(token));
        match is_next {
            true => self.at += token.len(),
            false => self.fail(expected),
        }
        is_next
    }

    /// A character that is in `set`, or that is not if it `is_inverted`.
    fn class(&mut self, set: &[u8], is_inverted: bool, expected: Expected) -> bool {
        match self.text.get(self.at) {
            Some(&first) if strings::contains_char(set, first) != is_inverted => {
                self.at += usize::from(strings::wtf8_byte_sequence_length(first));
                true
            }
            _ => {
                self.fail(expected);
                false
            }
        }
    }

    /// `.`
    fn any(&mut self) -> bool {
        self.class(b"", true, Expected::Any)
    }

    fn digit(&mut self) -> bool {
        self.class(b"0123456789", false, Expected::Digit)
    }

    fn since(&self, start: usize) -> &'s [u8] {
        self.text.get(start..self.at).unwrap_or_default()
    }

    // ───────────────────────────── what is compiled ─────────────────────────────

    fn mark(&self) -> Mark {
        Mark {
            at: self.at,
            ops: self.program.ops.len(),
            lists: self.program.lists.len(),
            keys: self.program.keys.len(),
            tests: self.program.tests.len(),
            bytes: self.program.bytes.len(),
        }
    }

    /// Always `None`.
    fn reset<T>(&mut self, mark: Mark) -> Option<T> {
        self.at = mark.at;
        self.program.ops.truncate(mark.ops);
        self.program.lists.truncate(mark.lists);
        self.program.keys.truncate(mark.keys);
        self.program.tests.truncate(mark.tests);
        self.program.bytes.truncate(mark.bytes);
        None
    }

    fn op(&mut self, op: Op) -> Id {
        self.program.ops.push(op);
        self.program.ops.len() as Id - 1
    }

    fn list(&mut self, ids: &[Id]) -> Run {
        let start = self.program.lists.len();
        self.program.lists.extend_from_slice(ids);
        Run::to_end_of(&self.program.lists, start)
    }

    fn attribute(&mut self, path: Run, test: Test) -> Id {
        self.program.tests.push(test);
        self.op(Op::Attribute {
            path,
            test: self.program.tests.len() as u32 - 1,
            first: Bound::No,
        })
    }

    fn combine(&mut self, combinator: Combinator, left: (Id, bool), right: (Id, bool)) -> Id {
        self.op(match combinator {
            Combinator::Child => Op::Child(left.0, right.0),
            Combinator::Descendant => Op::Descendant(left.0, right.0),
            Combinator::Sibling => Op::Sibling {
                left: left.0,
                right: right.0,
                left_is_subject: left.1,
            },
            Combinator::Adjacent => Op::Adjacent {
                left: left.0,
                right: right.0,
                right_is_subject: right.1,
            },
        })
    }

    // ───────────────────────────── the rules ─────────────────────────────

    /// `None`: there is nothing but spaces.
    fn start(&mut self) -> Option<Id> {
        let mark = self.mark();
        self.spaces();
        match self.selectors(false) {
            Some(selectors) => {
                self.spaces();
                Some(match selectors[..] {
                    [only] => only,
                    _ => {
                        let list = self.list(&selectors);
                        self.op(Op::Any(list))
                    }
                })
            }
            None => {
                self.reset::<()>(mark);
                self.spaces();
                None
            }
        }
    }

    /// `_`
    fn spaces(&mut self) {
        while self.literal(b" ", Expected::Space) {}
    }

    fn identifier_name(&mut self) -> Option<&'s [u8]> {
        let start = self.at;
        while self.class(b" [],():#!=><~+.", true, Expected::InIdentifier) {}
        (self.at > start).then(|| self.since(start))
    }

    fn binary_op(&mut self) -> Option<Combinator> {
        let start = self.at;
        let operators: [(&[u8], Expected, Combinator); 3] = [
            (b">", Expected::Greater, Combinator::Child),
            (b"~", Expected::Tilde, Combinator::Sibling),
            (b"+", Expected::Plus, Combinator::Adjacent),
        ];
        for (token, expected, combinator) in operators {
            self.spaces();
            if self.literal(token, expected) {
                self.spaces();
                return Some(combinator);
            }
            self.at = start;
        }
        if self.literal(b" ", Expected::Space) {
            self.spaces();
            return Some(Combinator::Descendant);
        }
        None
    }

    /// `selectors`, `hasSelectors`
    fn selectors(&mut self, is_in_has: bool) -> Option<Ids> {
        let one = |this: &mut Self| match is_in_has {
            true => this.has_selector(),
            false => this.selector().map(|it| it.0),
        };
        self.depth += 1;
        let mut all = Ids::new();
        let mut next = one(self);
        while let Some(selector) = next.take() {
            all.push(selector);
            let mark = self.mark();
            self.spaces();
            if self.literal(b",", Expected::Comma) {
                self.spaces();
                next = one(self);
            }
            if next.is_none() {
                self.reset::<()>(mark);
            }
        }
        self.depth -= 1;
        (!all.is_empty()).then_some(all)
    }

    fn has_selector(&mut self) -> Option<Id> {
        let mark = self.mark();
        let combinator = self.binary_op();
        let Some(right) = self.selector() else {
            return self.reset(mark);
        };
        Some(match combinator {
            Some(combinator) => {
                let exact_node = self.op(Op::ExactNode);
                self.combine(combinator, (exact_node, false), right)
            }
            None => right.0,
        })
    }

    /// With whether it is marked as the subject by a `!`.
    fn selector(&mut self) -> Option<(Id, bool)> {
        let mut memo = self.sequence()?;
        let depth = self.depth;
        loop {
            let mark = self.mark();
            let right = self
                .binary_op()
                .and_then(|combinator| Some((combinator, self.sequence()?)));
            let Some((combinator, right)) = right else {
                self.reset::<()>(mark);
                self.depth = depth;
                return Some(memo);
            };
            memo = (self.combine(combinator, memo, right), false);
            self.depth += 1;
        }
    }

    fn sequence(&mut self) -> Option<(Id, bool)> {
        let mark = self.mark();
        let is_subject = self.literal(b"!", Expected::Bang);
        let mut atoms = Ids::new();
        while let Some(atom) = self.atom() {
            atoms.push(atom);
        }
        let selector = match atoms[..] {
            [] => return self.reset(mark),
            [only] => only,
            _ => {
                let list = self.list(&atoms);
                self.op(Op::All(list))
            }
        };
        Some((selector, is_subject))
    }

    fn atom(&mut self) -> Option<Id> {
        if self.depth > MAX_DEPTH {
            self.error.get_or_insert_with(Error::too_deep);
        }
        if self.error.is_some() {
            return None;
        }
        self.wildcard()
            .or_else(|| self.identifier())
            .or_else(|| self.attr())
            .or_else(|| self.field())
            .or_else(|| self.group(b":not(", Expected::Not))
            .or_else(|| self.group(b":matches(", Expected::Matches))
            .or_else(|| self.group(b":is(", Expected::Is))
            .or_else(|| self.group(b":has(", Expected::Has))
            .or_else(|| {
                self.literal(b":first-child", Expected::FirstChild)
                    .then(|| self.op(Op::NthChild(1)))
            })
            .or_else(|| {
                self.literal(b":last-child", Expected::LastChild)
                    .then(|| self.op(Op::NthChild(-1)))
            })
            .or_else(|| self.nth(b":nth-child(", Expected::NthChild, 1))
            .or_else(|| self.nth(b":nth-last-child(", Expected::NthLastChild, -1))
            .or_else(|| self.class_name())
    }

    fn wildcard(&mut self) -> Option<Id> {
        self.literal(b"*", Expected::Star)
            .then(|| self.op(Op::Wildcard))
    }

    fn identifier(&mut self) -> Option<Id> {
        let mark = self.mark();
        self.literal(b"#", Expected::Hash);
        let Some(name) = self.identifier_name() else {
            return self.reset(mark);
        };
        let mut types = NodeType::ALL.iter().copied();
        let node_type = types.find(|it| it.name().as_bytes().eq_ignore_ascii_case(name));
        Some(self.op(Op::Identifier {
            node_type,
            is_exact: node_type.is_some_and(|it| it.name().as_bytes() == name),
        }))
    }

    fn attr(&mut self) -> Option<Id> {
        let mark = self.mark();
        if !self.literal(b"[", Expected::OpenBracket) {
            return None;
        }
        self.spaces();
        let Some(value) = self.attr_value() else {
            return self.reset(mark);
        };
        self.spaces();
        match self.literal(b"]", Expected::CloseBracket) {
            true => Some(value),
            false => self.reset(mark),
        }
    }

    /// `[><!]? "=" / [><]`
    fn attr_ops(&mut self) -> Option<&'s [u8]> {
        let start = self.at;
        self.class(b"><!", false, Expected::GreaterLessBang);
        if self.literal(b"=", Expected::Equals) {
            return Some(self.since(start));
        }
        self.at = start;
        self.class(b"><", false, Expected::GreaterLess)
            .then(|| self.since(start))
    }

    /// `"!"? "="`: whether there is a `!`.
    fn attr_eq_ops(&mut self) -> Option<bool> {
        let start = self.at;
        let is_negated = self.literal(b"!", Expected::Bang);
        if !self.literal(b"=", Expected::Equals) {
            self.at = start;
            return None;
        }
        Some(is_negated)
    }

    /// `identifierName ("." identifierName)*`: `attrName`, and `field` after its first `.`.
    fn attr_name(&mut self) -> Option<Run> {
        let start = self.program.keys.len();
        let first = self.identifier_name()?;
        self.program.keys.push(Key::named(first));
        loop {
            let before = self.at;
            let next = self
                .literal(b".", Expected::Dot)
                .then(|| self.identifier_name())
                .flatten();
            match next {
                Some(name) => self.program.keys.push(Key::named(name)),
                None => {
                    self.at = before;
                    return Some(Run::to_end_of(&self.program.keys, start));
                }
            }
        }
    }

    fn attr_value(&mut self) -> Option<Id> {
        let mark = self.mark();

        let path = self.attr_name()?;
        self.spaces();
        if let Some(is_negated) = self.attr_eq_ops() {
            self.spaces();
            if let Some(name) = self.type_value() {
                let js_type = JsType::named(name);
                return Some(self.attribute(
                    path,
                    Test::Type {
                        js_type,
                        is_negated,
                    },
                ));
            }
            if let Some(regex) = self.regex() {
                return Some(self.attribute(path, Test::Regex { regex, is_negated }));
            }
        }
        self.reset::<()>(mark);

        let path = self.attr_name()?;
        self.spaces();
        if let Some(operator) = self.attr_ops() {
            self.spaces();
            if let Some(literal) = self
                .string()
                .or_else(|| self.number())
                .or_else(|| self.path())
            {
                let relation = match operator {
                    b"<" => Some(Relation::Less),
                    b"<=" => Some(Relation::LessOrEqual),
                    b">" => Some(Relation::Greater),
                    b">=" => Some(Relation::GreaterOrEqual),
                    _ => None,
                };
                let test = match relation {
                    Some(relation) => Test::Compare { literal, relation },
                    None => Test::Equals {
                        literal,
                        is_negated: operator == b"!=",
                    },
                };
                return Some(self.attribute(path, test));
            }
        }
        self.reset::<()>(mark);

        let path = self.attr_name()?;
        Some(self.attribute(path, Test::Exists))
    }

    fn string(&mut self) -> Option<Literal> {
        self.quoted(
            b"\"",
            Expected::DoubleQuote,
            b"\\\"",
            Expected::InDoubleQuotes,
        )
        .or_else(|| {
            self.quoted(
                b"'",
                Expected::SingleQuote,
                b"\\'",
                Expected::InSingleQuotes,
            )
        })
    }

    /// The value is what `strUnescape` makes of what is between the quotes.
    fn quoted(
        &mut self,
        quote: &[u8],
        open: Expected,
        special: &[u8],
        inside: Expected,
    ) -> Option<Literal> {
        let start = self.at;
        if !self.literal(quote, open) {
            return None;
        }
        let mut value = Vec::new();
        loop {
            let before = self.at;
            if self.class(special, true, inside) {
                value.extend_from_slice(self.since(before));
            } else if self.literal(b"\\", Expected::Backslash) {
                let escaped = self.at;
                if !self.any() {
                    self.at = before;
                    break;
                }
                match self.since(escaped) {
                    b"b" => value.push(0x08),
                    b"f" => value.push(0x0C),
                    b"n" => value.push(b'\n'),
                    b"r" => value.push(b'\r'),
                    b"t" => value.push(b'\t'),
                    b"v" => value.push(0x0B),
                    // The `.` of `/\\(.)/g` does not match a line terminator.
                    b"\n" | b"\r" | b"\xE2\x80\xA8" | b"\xE2\x80\xA9" => {
                        value.extend_from_slice(self.since(before))
                    }
                    other => value.extend_from_slice(other),
                }
            } else {
                break;
            }
        }
        if !self.literal(quote, open) {
            self.at = start;
            return None;
        }
        Some(Literal::new(value.into(), false))
    }

    /// `([0-9]* ".")? [0-9]+`
    fn number(&mut self) -> Option<Literal> {
        let start = self.at;
        while self.digit() {}
        if !self.literal(b".", Expected::Dot) {
            self.at = start;
        }
        let fraction = self.at;
        while self.digit() {}
        if self.at == fraction {
            self.at = start;
            return None;
        }
        // `parseFloat`, of digits and at most one dot.
        let value: f64 = std::str::from_utf8(self.since(start)).ok()?.parse().ok()?;
        Some(Literal::new(text::number_to_string(value).into(), true))
    }

    fn path(&mut self) -> Option<Literal> {
        self.identifier_name()
            .map(|it| Literal::new(it.into(), false))
    }

    /// `type`
    fn type_value(&mut self) -> Option<&'s [u8]> {
        let start = self.at;
        if !self.literal(b"type(", Expected::Type) {
            return None;
        }
        self.spaces();
        let name_start = self.at;
        while self.class(b" )", true, Expected::InType) {}
        let name = self.since(name_start);
        if !name.is_empty() {
            self.spaces();
            if self.literal(b")", Expected::CloseParen) {
                return Some(name);
            }
        }
        self.at = start;
        None
    }

    fn regex(&mut self) -> Option<Box<Regex>> {
        let start = self.at;
        if !self.literal(b"/", Expected::Slash) {
            return None;
        }
        let pattern_start = self.at;
        while self.re_character_class() || self.re_escape() || self.re_chars() {}
        let pattern = self.since(pattern_start);
        if pattern.is_empty() || !self.literal(b"/", Expected::Slash) {
            self.at = start;
            return None;
        }
        let flags_start = self.at;
        while self.class(b"imsu", false, Expected::Flag) {}
        match Regex::from_bytes(pattern, self.since(flags_start)) {
            Ok(regex) => Some(Box::new(regex)),
            Err(error) => {
                self.error
                    .get_or_insert_with(|| Error::new(error.message.into_bytes()));
                None
            }
        }
    }

    fn re_character_class(&mut self) -> bool {
        let start = self.at;
        if !self.literal(b"[", Expected::OpenBracket) {
            return false;
        }
        let inside = self.at;
        while self.class(b"]\\", true, Expected::InRegexClass) || self.re_escape() {}
        if self.at == inside || !self.literal(b"]", Expected::CloseBracket) {
            self.at = start;
            return false;
        }
        true
    }

    fn re_escape(&mut self) -> bool {
        let start = self.at;
        if self.literal(b"\\", Expected::Backslash) && self.any() {
            return true;
        }
        self.at = start;
        false
    }

    fn re_chars(&mut self) -> bool {
        let start = self.at;
        while self.class(b"/\\[", true, Expected::InRegex) {}
        self.at > start
    }

    fn field(&mut self) -> Option<Id> {
        let mark = self.mark();
        if !self.literal(b".", Expected::Dot) {
            return None;
        }
        match self.attr_name() {
            Some(path) => Some(self.op(Op::Field(path))),
            None => self.reset(mark),
        }
    }

    /// `negation`, `matches`, `is`, `has`
    fn group(&mut self, open: &[u8], expected: Expected) -> Option<Id> {
        let mark = self.mark();
        if !self.literal(open, expected) {
            return None;
        }
        let is_has = matches!(expected, Expected::Has);
        self.spaces();
        let Some(selectors) = self.selectors(is_has) else {
            return self.reset(mark);
        };
        self.spaces();
        if !self.literal(b")", Expected::CloseParen) {
            return self.reset(mark);
        }
        let list = self.list(&selectors);
        Some(self.op(match expected {
            Expected::Not => Op::NotAny(list),
            Expected::Has => Op::Has {
                selectors: list,
                is_about_children: false,
            },
            _ => Op::Any(list),
        }))
    }

    /// `nthChild`, `nthLastChild`
    fn nth(&mut self, open: &[u8], expected: Expected, sign: i32) -> Option<Id> {
        let start = self.at;
        if !self.literal(open, expected) {
            return None;
        }
        self.spaces();
        let digits_start = self.at;
        while self.digit() {}
        let digits = self.since(digits_start);
        if !digits.is_empty() {
            self.spaces();
            if self.literal(b")", Expected::CloseParen) {
                // No list is that long.
                let index = std::str::from_utf8(digits)
                    .ok()
                    .and_then(|it| it.parse().ok())
                    .unwrap_or(i32::MAX);
                return Some(self.op(Op::NthChild(sign * index)));
            }
        }
        self.at = start;
        None
    }

    /// `class`
    fn class_name(&mut self) -> Option<Id> {
        let start = self.at;
        if !self.literal(b":", Expected::Colon) {
            return None;
        }
        let Some(name) = self.identifier_name() else {
            self.at = start;
            return None;
        };
        Some(match class_named(name) {
            Some((types, excludes_names_of_meta_properties)) => self.op(Op::Class {
                types,
                excludes_names_of_meta_properties,
                is_written_function: name == b"function",
            }),
            None => {
                let start = self.program.bytes.len();
                self.program.bytes.extend_from_slice(name);
                self.op(Op::UnknownClass(Run::to_end_of(&self.program.bytes, start)))
            }
        })
    }

    // ───────────────────────────── errors ─────────────────────────────

    /// ESLint's message for what `peg$buildStructuredError` makes.
    fn syntax_error(&self) -> Error {
        let mut message = Vec::new();
        message.extend_from_slice(b"Syntax error in selector \"");
        message.extend_from_slice(self.text);
        message.extend_from_slice(b"\" at position ");
        let before = self.text.get(..self.max_fail_at).unwrap_or(self.text);
        message.extend_from_slice(strings::wtf8_len_utf16(before).to_string().as_bytes());
        message.extend_from_slice(b": Expected ");
        let count = self.expected.count_ones();
        let descriptions = DESCRIPTIONS
            .iter()
            .enumerate()
            .filter(|it| self.expected & (1 << it.0) != 0);
        for (i, (_, description)) in descriptions.enumerate() {
            let separator: &[u8] = match (i as u32, count) {
                (0, _) => b"",
                (1, 2) => b" or ",
                (i, count) if i + 1 == count => b", or ",
                _ => b", ",
            };
            message.extend_from_slice(separator);
            message.extend_from_slice(description.as_bytes());
        }
        message.extend_from_slice(b" but ");
        match strings::wtf8_first_codepoint(self.text.get(self.max_fail_at..).unwrap_or_default()) {
            Some(found) => {
                message.push(b'"');
                push_escaped(&mut message, found);
                message.push(b'"');
            }
            None => message.extend_from_slice(b"end of input"),
        }
        message.extend_from_slice(b" found.");
        Error::new(message)
    }
}

/// `literalEscape` of the first UTF-16 code unit of the character `c`.
fn push_escaped(out: &mut Vec<u8>, c: u32) {
    match c {
        0x5C => out.extend_from_slice(b"\\\\"),
        0x22 => out.extend_from_slice(b"\\\""),
        0 => out.extend_from_slice(b"\\0"),
        0x09 => out.extend_from_slice(b"\\t"),
        0x0A => out.extend_from_slice(b"\\n"),
        0x0D => out.extend_from_slice(b"\\r"),
        0x01..=0x08 | 0x0B | 0x0C | 0x0E | 0x0F => {
            out.extend_from_slice(format!("\\x0{c:X}").as_bytes())
        }
        0x10..=0x1F | 0x7F..=0x9F => out.extend_from_slice(format!("\\x{c:X}").as_bytes()),
        0x1_0000.. => {
            // The lead surrogate, in WTF-8.
            let lead = 0xD800 + ((c - 0x1_0000) >> 10);
            out.extend_from_slice(&[
                0xED,
                0x80 | ((lead >> 6) & 0x3F) as u8,
                0x80 | (lead & 0x3F) as u8,
            ]);
        }
        _ => {
            let c = char::from_u32(c).unwrap_or(char::REPLACEMENT_CHARACTER);
            out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
        }
    }
}

/// `esquery.parse`, with the errors of ESLint's `tryParseSelector`. The second is the whole selector.
pub(super) fn parse(source: &[u8]) -> Result<(Program, Id), Error> {
    let mut parser = Parser {
        text: source,
        at: 0,
        max_fail_at: 0,
        expected: 0,
        depth: 0,
        error: None,
        program: Program::default(),
    };
    let root = parser.start();
    if let Some(error) = parser.error {
        return Err(error);
    }
    if parser.at < source.len() {
        parser.fail(Expected::End);
        return Err(parser.syntax_error());
    }
    match root {
        Some(root) => Ok((parser.program, root)),
        None => Err(Error::empty()),
    }
}
