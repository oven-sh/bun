//! Matches values against `syntax.txt`, which has the value definition syntax of every property, with these additions:
//!
//! - `a>b` is written as `b`, and `a>>b` is when it is computed. `_` stands for a space.
//! - `term~text` is left out if it is written as `text`, and `term~~text` is when it is computed.
//! - `term=text` is written as `text` if everything in it is left out.
//! - `+text` matches nothing and is written as `text`, and `++text` is when it is computed.
//! - `{1,2}s` and `{1,4}s` leave out the values that repeat the opposite side.
//! - `<custom-ident -a -b>` excludes keywords.
//! - `^hook term` passes what is written through one of `hooks::HOOKS`.
//! - In a shorthand, `<'a'>` and `@a,b term` are the values of longhands, and `@a=text` sets one.

use core::ops::Range;
use std::sync::{LazyLock, OnceLock};

use bun_core::strings;
use bun_css::Token;

use crate::calc::{Kind, Node, Options, Unit};
use crate::color::Specified;
use crate::hooks::{HOOKS, Hook, LEAVES, Leaf};
use crate::name::Map;
use crate::properties::Prop;
use crate::values::*;

type Text = &'static str;

#[derive(Clone, Copy)]
pub(crate) struct Numeric {
    options: Options,
    range: [f64; 2],
    is_integer: bool,
}

pub(crate) enum Term {
    /// The name, and how it is written as it is specified and as it is computed.
    Keywords(Vec<[Text; 3]>),
    Numeric(Numeric),
    Color,
    Ident {
        is_dashed: bool,
        except: Vec<Text>,
    },
    Leaf(Leaf),
    Literal(u8),
    Function(Text, Box<Term>),
    Brackets(Box<Term>),
    Sequence(Vec<Term>),
    OneOf(Vec<Term>),
    AllOf(Vec<Term>),
    AnyOf(Vec<Term>),
    Repeat {
        term: Box<Term>,
        min: usize,
        max: usize,
        commas: bool,
        sides: bool,
    },
    /// Interpolated as a whole.
    Whole(Box<Term>),
    NotEmpty(Box<Term>),
    Omit {
        term: Box<Term>,
        text: Text,
        if_computed: bool,
    },
    Otherwise(Box<Term>, Text),
    Emit {
        text: Text,
        if_computed: bool,
    },
    Hook(Hook, Box<Term>),
    Named(&'static Definition),
    Capture(Vec<Prop>, Box<Term>),
    Set(Prop, Text),
}

pub(crate) struct Definition {
    pub(crate) name: Text,
    /// What is between the name and the syntax.
    pub(crate) notes: Text,
    source: Text,
    term: OnceLock<Term>,
}

static SOURCE: &[u8] = include_bytes!("syntax.txt");

static DEFINITIONS: LazyLock<Vec<Definition>> = LazyLock::new(|| {
    let lines = strings::tokenize(SOURCE, b"\n").filter_map(|line| {
        let at = strings::index_of(line, b" = ")?;
        let (name, notes) =
            strings::split_once_char(&line[..at], b' ').unwrap_or((&line[..at], b""));
        Some(Definition {
            name: text(name),
            notes: text(notes),
            source: text(&line[at + 3..]),
            term: OnceLock::new(),
        })
    });
    lines.collect()
});

pub(crate) fn definitions() -> &'static [Definition] {
    &DEFINITIONS
}

pub(crate) fn definition(name: &str) -> Option<&'static Definition> {
    static BY_NAME: LazyLock<Map<Text, &'static Definition>> =
        LazyLock::new(|| DEFINITIONS.iter().map(|it| (it.name, it)).collect());
    BY_NAME.get(name).copied()
}

impl Definition {
    pub(crate) fn is_shorthand(&self) -> bool {
        self.notes.starts_with(':')
    }

    pub(crate) fn has_note(&self, note: &str) -> bool {
        self.notes.split_ascii_whitespace().any(|it| it == note)
    }

    pub(crate) fn note(&self, prefix: &str) -> Option<Text> {
        self.notes
            .split_ascii_whitespace()
            .find_map(|it| it.strip_prefix(prefix))
            .map(spaced)
    }

    pub(crate) fn source(&self) -> Text {
        self.source
    }

    pub(crate) fn term(&self) -> &Term {
        self.term.get_or_init(|| {
            Compiler {
                rest: self.source,
                captures: self.is_shorthand(),
            }
            .one_of()
        })
    }
}

struct Compiler {
    rest: Text,
    captures: bool,
}

/// Of a part of `SOURCE`.
fn spaced(source: Text) -> Text {
    static SPACED: LazyLock<Vec<u8>> = LazyLock::new(|| strings::replace_owned(SOURCE, b"_", b" "));
    match strings::contains_char(source.as_bytes(), b'_') {
        true => text(&SPACED[source.as_ptr().addr() - SOURCE.as_ptr().addr()..][..source.len()])
            .trim_ascii(),
        false => source,
    }
}

impl Compiler {
    fn eat(&mut self, prefix: &str) -> bool {
        self.rest
            .strip_prefix(prefix)
            .map(|rest| self.rest = rest)
            .is_some()
    }

    fn until(&mut self, ends: &[u8]) -> Text {
        let (taken, rest) = self
            .rest
            .split_at(strings::index_of_any(self.rest.as_bytes(), ends).unwrap_or(self.rest.len()));
        self.rest = rest;
        taken
    }

    fn text(&mut self) -> Text {
        spaced(self.until(b" "))
    }

    fn joined(
        &mut self,
        separator: &str,
        part: fn(&mut Self) -> Term,
        join: fn(Vec<Term>) -> Term,
    ) -> Term {
        let mut all = vec![part(self)];
        while self.eat(separator) {
            all.push(part(self));
        }
        if all.len() == 1 {
            all.swap_remove(0)
        } else {
            join(all)
        }
    }

    fn one_of(&mut self) -> Term {
        self.joined("| ", Self::any_of, |all| {
            let mut merged = Vec::with_capacity(all.len());
            for term in all {
                match (merged.last_mut(), term) {
                    (Some(Term::Keywords(known)), Term::Keywords(more)) => known.extend(more),
                    (_, term) => merged.push(term),
                }
            }
            if merged.len() == 1 {
                merged.swap_remove(0)
            } else {
                Term::OneOf(merged)
            }
        })
    }

    fn any_of(&mut self) -> Term {
        self.joined(
            "|| ",
            |this| this.joined("&& ", Self::sequence, Term::AllOf),
            Term::AnyOf,
        )
    }

    fn sequence(&mut self) -> Term {
        let mut all = Vec::new();
        while !self.rest.is_empty()
            && !self.rest.starts_with(['|', '&', ']', ')'])
            && !self.rest.starts_with("']'")
        {
            all.push(self.term());
            self.eat(" ");
        }
        if all.len() == 1 {
            all.swap_remove(0)
        } else {
            Term::Sequence(all)
        }
    }

    fn named(name: &str) -> Term {
        definition(name).map_or(Term::OneOf(Vec::new()), Term::Named)
    }

    fn data_type(&mut self) -> Term {
        let name = self.until(b" >");
        let arguments = self.until(b">").trim_ascii();
        self.eat(">");
        if let Some(name) = name.strip_prefix('\'').and_then(|it| it.strip_suffix('\'')) {
            let prop = Prop::from_name(name.as_bytes()).filter(|_| self.captures);
            return prop.into_iter().fold(Self::named(name), |term, prop| {
                Term::Capture(vec![prop], Box::new(term))
            });
        }
        let of = |kind, percentages| Options {
            percentages,
            ..Options::new(kind)
        };
        let options = match name {
            "number" | "integer" => of(Kind::Number, false),
            "percentage" => of(Kind::Percentage, false),
            "length" => of(Kind::Length, false),
            "length-percentage" => of(Kind::Length, true),
            "anchored-size" => Options {
                anchor_size: true,
                ..of(Kind::Length, true)
            },
            "anchored-inset" => Options {
                anchor: true,
                anchor_size: true,
                ..of(Kind::Length, true)
            },
            "angle" => of(Kind::Angle, false),
            "angle-percentage" => of(Kind::Angle, true),
            "time" => of(Kind::Time, false),
            "resolution" => of(Kind::Resolution, false),
            "flex" => of(Kind::Flex, false),
            "color" => return Term::Color,
            "custom-ident" | "dashed-ident" => {
                let except = arguments
                    .split_ascii_whitespace()
                    .map(|it| &it[1..])
                    .collect();
                return Term::Ident {
                    is_dashed: name == "dashed-ident",
                    except,
                };
            }
            _ => match LEAVES.iter().find(|it| it.0 == name) {
                Some(leaf) => return Term::Leaf(leaf.1),
                None => return Self::named(text(&[b"<", name.as_bytes(), b">"].concat())),
            },
        };
        let mut limits =
            strings::tokenize_any(arguments.as_bytes(), b"[,]").map(|it| text(it).parse().ok());
        let range =
            [f64::NEG_INFINITY, f64::INFINITY].map(|none| limits.next().flatten().unwrap_or(none));
        Term::Numeric(Numeric {
            options,
            range,
            is_integer: name == "integer",
        })
    }

    fn term(&mut self) -> Term {
        let mut term = if self.eat("[ ") {
            let inner = self.one_of();
            self.eat("]");
            inner
        } else if self.eat("'[' ") {
            let inner = self.one_of();
            self.eat("']'");
            Term::Brackets(Box::new(inner))
        } else if self.eat("<") {
            self.data_type()
        } else if self.eat("+") {
            return Term::Emit {
                if_computed: self.eat("+"),
                text: self.text(),
            };
        } else if self.eat("%") {
            return Term::Whole(Box::new(self.term()));
        } else if self.eat("^") {
            let name = self.text();
            self.eat(" ");
            let term = self.term();
            return HOOKS
                .iter()
                .filter(|it| it.0 == name)
                .fold(term, |term, hook| Term::Hook(hook.1, Box::new(term)));
        } else if self.eat("@") {
            let names = strings::split(self.until(b" =").as_bytes(), b",");
            let props: Vec<_> = names.filter_map(Prop::from_name).collect();
            if self.eat("=") {
                return Term::Set(props[0], self.text());
            }
            self.eat(" ");
            return Term::Capture(props, Box::new(self.term()));
        } else if self.rest.starts_with([',', '/', ':', ';']) {
            return Term::Literal(self.text().as_bytes()[0]);
        } else {
            let name = self.until(b" (>?~=");
            if self.eat("( ") {
                let inner = self.one_of();
                self.eat(")");
                Term::Function(name, Box::new(inner))
            } else if self.eat(">>") {
                Term::Keywords(vec![[name, name, self.text()]])
            } else {
                let written = if self.eat(">") { self.text() } else { name };
                Term::Keywords(vec![[name, written, written]])
            }
        };
        loop {
            let repeat = |term, min, max, commas, sides| Term::Repeat {
                term: Box::new(term),
                min,
                max,
                commas,
                sides,
            };
            let commas = self.eat("#");
            term = if self.eat("{") {
                let mut limits = strings::split(self.until(b"}").as_bytes(), b",")
                    .map(|it| text(it).parse().unwrap_or(usize::MAX));
                let min = limits.next().unwrap_or(1);
                let max = limits.next().unwrap_or(min);
                self.eat("}");
                repeat(term, min, max, commas, self.eat("s"))
            } else if commas || self.eat("+") {
                repeat(term, 1, usize::MAX, commas, false)
            } else if self.eat("?") {
                repeat(term, 0, 1, false, false)
            } else if self.eat("*") {
                repeat(term, 0, usize::MAX, false, false)
            } else if self.eat("!") {
                Term::NotEmpty(Box::new(term))
            } else if self.eat("~") {
                return Term::Omit {
                    term: Box::new(term),
                    if_computed: self.eat("~"),
                    text: self.text(),
                };
            } else if self.eat("=") {
                return Term::Otherwise(Box::new(term), self.text());
            } else {
                return term;
            };
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Mode<'a> {
    Check,
    Specified,
    Computed(&'a Ctx<'a>),
    /// Of a computed value, with nothing left out.
    Expanded,
}

pub(crate) enum Captured {
    Source(Prop, Range<usize>),
    Text(Prop, Text),
    /// The end of an item of the list.
    Layer,
}

pub(crate) struct Matcher<'a> {
    pub(crate) mode: Mode<'a>,
    /// Every component starts with a space.
    pub(crate) out: Out,
    /// Where the arguments of the function start.
    group: usize,
    captured: Vec<Captured>,
    /// Where the numbers and the colors are in the source, if that is asked for.
    leaves: Option<Vec<(Range<usize>, Option<Numeric>)>>,
    depth: u8,
}

impl<'a> Matcher<'a> {
    fn new(mode: Mode<'a>) -> Self {
        Matcher {
            mode,
            out: Out::new(),
            group: 0,
            captured: Vec::new(),
            leaves: None,
            depth: 0,
        }
    }

    pub(crate) fn writes(&self) -> bool {
        !matches!(self.mode, Mode::Check)
    }

    pub(crate) fn is_computed(&self) -> bool {
        matches!(self.mode, Mode::Computed(_) | Mode::Expanded)
    }

    pub(crate) fn write(&mut self, write: impl FnOnce(&mut Out)) {
        if self.writes() {
            self.out.push(b' ');
            write(&mut self.out);
        }
    }

    fn emit(&mut self, text: &str) {
        if !text.is_empty() {
            self.write(|out| out.extend_from_slice(text.as_bytes()));
        }
    }

    pub(crate) fn named(&mut self, name: &str, p: &mut P) -> bool {
        definition(name).is_some_and(|it| self.matches(it.term(), p))
    }

    /// Leaves everything as it is if it does not.
    pub(crate) fn matches(&mut self, term: &Term, p: &mut P) -> bool {
        let before = (
            p.state(),
            self.out.len(),
            self.captured.len(),
            self.leaves.as_ref().map_or(0, Vec::len),
        );
        let does = self.consume(term, p).is_some();
        if !does {
            p.reset(&before.0);
            self.out.truncate(before.1);
            self.captured.truncate(before.2);
            self.leaves.iter_mut().for_each(|it| it.truncate(before.3));
        }
        does
    }

    fn inside(&mut self, p: &mut P, open: &str, term: &Term, close: u8) -> Option<()> {
        (self.depth < 32).then_some(())?;
        self.emit(open);
        let outer = core::mem::replace(&mut self.group, self.out.len());
        self.depth += 1;
        let result = nested(p, |p| self.consume(term, p));
        self.depth -= 1;
        let start = core::mem::replace(&mut self.group, outer);
        if self.writes() {
            if self.out.get(start) == Some(&b' ') {
                self.out.remove(start);
            }
            if self.out.last() == Some(&b',') {
                self.out.pop();
            }
            self.out.push(close);
        }
        result
    }

    fn leaf(
        &mut self,
        p: &mut P,
        numeric: Option<Numeric>,
        consume: impl FnOnce(&mut Self, &mut P) -> Option<()>,
    ) -> Option<()> {
        p.skip_whitespace();
        let start = p.position();
        consume(self, p)?;
        self.leaves
            .iter_mut()
            .for_each(|it| it.push((start..p.position(), numeric)));
        Some(())
    }

    fn numeric(&mut self, it: &Numeric, p: &mut P) -> Option<()> {
        let state = p.state();
        let is_fraction =
            matches!(p.next().ok()?, Token::Number(number) if number.int_value.is_none());
        (!(it.is_integer && is_fraction)).then_some(())?;
        p.reset(&state);
        let node = Node::parse(p, &it.options)?;
        if let Node::Value(value, unit) = node {
            (it.range[0]..=it.range[1])
                .contains(&unit.canonical(value, None).unwrap_or(value))
                .then_some(())?;
        }
        match self.mode {
            Mode::Check => {}
            Mode::Computed(cx) => {
                let node = node.simplified(Some(cx), !it.options.percentages);
                self.write(|out| with_zoom(cx.zoom, || it.write(&node, out)));
            }
            _ if node.is_literal() && it.is_integer => self.write(|out| it.write(&node, out)),
            _ => self.write(|out| {
                node.as_specified(!it.options.percentages)
                    .write_specified(out)
            }),
        }
        Some(())
    }

    /// `done` has the components that have matched, and where what they have written starts.
    fn unordered(
        &mut self,
        terms: &[Term],
        needs_all: bool,
        done: &mut Vec<(usize, usize)>,
        p: &mut P,
    ) -> bool {
        let (mut longest, known) = ((0, terms.len()), done.len());
        for turn in 0..=terms.len() {
            let (index, is_final) = if turn == terms.len() {
                (longest.1, true)
            } else {
                (turn, false)
            };
            let Some(term) = terms
                .get(index)
                .filter(|_| !done.iter().any(|it| it.0 == index))
            else {
                continue;
            };
            let before = (
                p.state(),
                self.out.len(),
                self.captured.len(),
                self.leaves.as_ref().map_or(0, Vec::len),
            );
            let is_last = done.len() + 1 == terms.len();
            p.skip_whitespace();
            let position = p.position();
            if self.matches(term, p) && p.position() > position {
                done.push((index, before.1));
                let is_complete = is_last || self.unordered(terms, needs_all, done, p);
                if needs_all && is_complete
                    || !needs_all && (is_final || done.len() == terms.len() || p.is_exhausted())
                {
                    return true;
                }
                if !needs_all && p.position() > longest.0 {
                    longest = (p.position(), index);
                }
                done.truncate(known);
            }
            p.reset(&before.0);
            self.out.truncate(before.1);
            self.captured.truncate(before.2);
            self.leaves.iter_mut().for_each(|it| it.truncate(before.3));
        }
        let position = p.position();
        for (index, term) in terms.iter().enumerate().filter(|_| needs_all) {
            let start = self.out.len();
            if !done.iter().any(|it| it.0 == index)
                && self.matches(term, p)
                && p.position() == position
            {
                done.push((index, start));
            }
        }
        let is_complete = done.len() == terms.len();
        done.truncate(if is_complete { terms.len() } else { known });
        is_complete
    }

    fn consume(&mut self, term: &Term, p: &mut P) -> Option<()> {
        let start = self.out.len();
        match term {
            Term::Keywords(all) => {
                let name = p.expect_ident().ok()?;
                let found = all.iter().find(|it| eq(name, it[0]))?;
                self.emit(found[1 + usize::from(self.is_computed())]);
            }
            Term::Numeric(it) => self.leaf(p, Some(*it), |this, p| this.numeric(it, p))?,
            Term::Color => self.leaf(p, None, |this, p| {
                let color = Specified::parse(p)?;
                match this.mode {
                    Mode::Computed(cx) => this.write(|out| color.compute(cx).write(out)),
                    _ => this.write(|out| color.write(out)),
                }
                Some(())
            })?,
            Term::Ident { is_dashed, except } => {
                let name = p.expect_ident().ok()?;
                let is_allowed = match is_dashed {
                    true => name.starts_with(b"--") && name.len() > 2,
                    false => !is_reserved(name) && !except.iter().any(|it| eq(name, it)),
                };
                is_allowed.then_some(())?;
                self.write(|out| write_ident(name, out));
            }
            Term::Leaf(leaf) => leaf(self, p)?,
            Term::Literal(b',') => {
                p.expect_comma().ok()?;
                if self.out.len() > self.group && self.out.last() != Some(&b',') {
                    self.out.push(b',');
                }
            }
            Term::Literal(literal) => {
                p.expect_delim(*literal).ok()?;
                self.write(|out| out.push(*literal));
            }
            Term::Function(name, inner) => {
                p.expect_function_matching(name.as_bytes()).ok()?;
                self.emit(name);
                if self.writes() {
                    self.out.push(b'(');
                }
                self.inside(p, "", inner, b')')?;
            }
            Term::Brackets(inner) => {
                matches!(p.next().ok()?, Token::OpenSquare).then_some(())?;
                self.inside(p, "[", inner, b']')?;
            }
            Term::Sequence(all) => all.iter().try_for_each(|it| self.consume(it, p))?,
            Term::OneOf(all) => all.iter().any(|it| self.matches(it, p)).then_some(())?,
            Term::AllOf(all) | Term::AnyOf(all) => {
                let mut done = Vec::with_capacity(all.len());
                self.unordered(all, matches!(term, Term::AllOf(_)), &mut done, p)
                    .then_some(())?;
                let fills = matches!(self.mode, Mode::Expanded);
                if self.writes() && (fills || !done.is_sorted()) {
                    let written = self.out.split_off(start);
                    for (index, term) in all.iter().enumerate() {
                        match (done.iter().position(|it| it.0 == index), term) {
                            (Some(at), _) => {
                                let end = done.get(at + 1).map_or(written.len(), |it| it.1 - start);
                                self.out
                                    .extend_from_slice(&written[done[at].1 - start..end]);
                            }
                            (None, Term::Omit { text, .. }) if fills => self.emit(text),
                            _ => {}
                        }
                    }
                }
            }
            Term::Repeat {
                term,
                min,
                max,
                commas,
                sides,
            } => {
                let (mut count, mut starts, is_layered) = (0, [0; 5], *commas && self.depth == 0);
                while count < *max {
                    let (state, written) = (p.state(), self.out.len());
                    if *commas && count > 0 && !self.matches(&Term::Literal(b','), p) {
                        break;
                    }
                    let position = p.position();
                    if !self.matches(term, p) || p.position() == position && !commas {
                        p.reset(&state);
                        self.out.truncate(written);
                        break;
                    }
                    if is_layered && !self.captured.is_empty() {
                        self.captured.push(Captured::Layer);
                    }
                    starts[count.min(4)] = written;
                    count += 1;
                }
                (count >= *min).then_some(())?;
                if *sides && self.writes() {
                    starts[count] = self.out.len();
                    let part =
                        |out: &Out, index: usize| out[starts[index]..starts[index + 1]].to_vec();
                    if let Mode::Expanded = self.mode {
                        for index in count..*max {
                            let same = part(&self.out, if index == 3 && count > 1 { 1 } else { 0 });
                            self.out.extend(same);
                        }
                    } else {
                        while count > 1
                            && part(&self.out, count - 1)
                                == part(&self.out, (count - 1).saturating_sub(2))
                        {
                            count -= 1;
                        }
                        self.out.truncate(starts[count]);
                    }
                }
            }
            Term::Whole(inner) => self.leaf(p, None, |this, p| {
                let leaves = this.leaves.take();
                let result = this.consume(inner, p);
                this.leaves = leaves;
                result
            })?,
            Term::NotEmpty(inner) => {
                let position = p.position();
                self.consume(inner, p)?;
                (p.position() > position).then_some(())?;
            }
            Term::Omit {
                term,
                text,
                if_computed,
            } => {
                self.consume(term, p)?;
                match self.mode {
                    Mode::Expanded if self.out.len() == start => self.emit(text),
                    Mode::Expanded => {}
                    Mode::Specified if *if_computed => {}
                    _ if self.out[start..].trim_ascii_start() == text.as_bytes() => {
                        self.out.truncate(start)
                    }
                    _ => {}
                }
            }
            Term::Otherwise(inner, text) => {
                self.consume(inner, p)?;
                if self.out.len() == start {
                    self.emit(text);
                }
            }
            Term::Emit { text, if_computed } => {
                if !if_computed || self.is_computed() {
                    self.emit(text);
                }
            }
            Term::Hook(hook, inner) => {
                p.skip_whitespace();
                let position = p.position();
                self.consume(inner, p)?;
                hook(self, start, p.slice_from(position))?;
            }
            Term::Named(definition) => self.consume(definition.term(), p)?,
            Term::Capture(props, inner) => {
                let inner = match &**inner {
                    Term::Named(definition)
                        if let Term::Repeat {
                            term, commas: true, ..
                        } = definition.term()
                            && self.group == usize::MAX =>
                    {
                        term
                    }
                    inner => inner,
                };
                if let [Prop::Short(_)] = props[..] {
                    return self.consume(inner, p);
                }
                p.skip_whitespace();
                let position = p.position();
                self.consume(inner, p)?;
                self.captured.extend(
                    props
                        .iter()
                        .map(|it| Captured::Source(*it, position..p.position())),
                );
            }
            Term::Set(prop, text) => self.captured.push(Captured::Text(*prop, text)),
        }
        Some(())
    }
}

pub(crate) fn is_reserved(name: &[u8]) -> bool {
    [
        "initial",
        "inherit",
        "unset",
        "revert",
        "revert-layer",
        "revert-rule",
        "default",
    ]
    .iter()
    .any(|it| eq(name, it))
}

impl Numeric {
    fn write(&self, node: &Node, out: &mut Out) {
        let Node::Value(value, unit) = *node else {
            return node.write(out);
        };
        let limit = if unit == Unit::Px {
            f64::from(MAX_LENGTH)
        } else {
            f32::MAX.into()
        };
        let value = if value.is_nan() {
            0.0
        } else {
            value
                .min(self.range[1].min(limit))
                .max(self.range[0].max(-limit))
        };
        match self.is_integer {
            true => (((value + 0.5).floor()) as i32).write(out),
            false => Node::Value(value, unit).write(out),
        }
    }
}

impl Definition {
    pub(crate) fn accepts(&self, source: &[u8]) -> bool {
        parse_all(source, |p| {
            Matcher::new(Mode::Check).consume(self.term(), p)
        })
        .is_some()
    }

    /// Consumes what matches.
    pub(crate) fn write_from(&self, p: &mut P, mode: Mode) -> Option<Out> {
        let mut matcher = Matcher::new(mode);
        matcher.matches(self.term(), p).then_some(())?;
        if matcher.out.first() == Some(&b' ') {
            matcher.out.remove(0);
        }
        Some(matcher.out)
    }

    pub(crate) fn write(&self, source: &[u8], mode: Mode) -> Option<Out> {
        parse_all(source, |p| self.write_from(p, mode))
    }

    /// Of a shorthand. If it is a list, the longhands get an item at a time.
    pub(crate) fn capture(&self, source: &[u8]) -> Option<Vec<Captured>> {
        let mut matcher = Matcher::new(Mode::Check);
        if let Term::Repeat { commas: true, .. } = self.term() {
            matcher.group = usize::MAX;
            matcher.captured.push(Captured::Layer);
        }
        parse_all(source, |p| matcher.consume(self.term(), p))?;
        Some(matcher.captured)
    }

    /// Of computed values that only differ by their numbers and colors.
    pub(crate) fn lerp(&self, from: &[u8], to: &[u8], t: Mixing) -> Option<Out> {
        let [from, to] = [(from, to), (to, from)].map(|(source, other)| {
            let source = self.write(
                &crate::path::as_shape(source, other).unwrap_or_else(|| source.to_vec()),
                Mode::Expanded,
            )?;
            let (source, mut matcher) = (
                self.write(&source, Mode::Expanded)?,
                Matcher::new(Mode::Check),
            );
            let is_round = source.starts_with(b"circle(") || source.starts_with(b"ellipse(");
            (!is_round || !strings::contains(&source, b"-side")).then_some(())?;
            matcher.leaves = Some(Vec::new());
            parse_all(&source, |p| matcher.consume(self.term(), p))?;
            Some((source, matcher.leaves?))
        });
        let ((from, a), (to, b), cx) = (from?, to?, Ctx::dummy());
        (a.len() == b.len() && (!a.is_empty() || from == to)).then_some(())?;
        let (mut out, mut at) = (Out::new(), [0, 0]);
        for ((a, numeric), (b, other)) in a.into_iter().zip(b) {
            (from[at[0]..a.start] == to[at[1]..b.start]).then_some(())?;
            out.extend_from_slice(&from[at[0]..a.start]);
            at = [a.end, b.end];
            let Some(numeric) = numeric else {
                out.extend(crate::hooks::lerp_whole(&from[a], &to[b], t)?);
                continue;
            };
            (other?.options.kind == numeric.options.kind).then_some(())?;
            let node = |source| {
                Some(
                    parse_all(source, |p| Node::parse(p, &numeric.options))?
                        .simplified(None, false),
                )
            };
            match node(&from[a])?.lerp(node(&to[b])?, t) {
                sum @ Node::Sum(_) if numeric.options.kind == Kind::Length => {
                    Lp::new(sum).write(&mut out)
                }
                node => numeric.write(&node, &mut out),
            }
        }
        (from[at[0]..] == to[at[1]..]).then_some(())?;
        out.extend_from_slice(&from[at[0]..]);
        self.write(&out, Mode::Computed(&cx))
    }
}

/// The items of a list.
pub(crate) fn split_list(source: &[u8]) -> Vec<&[u8]> {
    if !strings::contains_char(source, b',') {
        return vec![source];
    }
    with_parser(source, |p| {
        let (mut items, mut start) = (Vec::new(), 0);
        while let Ok(token) = p.next() {
            if let Token::Comma = token {
                items.push(source[start..p.position() - 1].trim_ascii());
                start = p.position();
            }
        }
        items.push(source[start..].trim_ascii());
        items
    })
}

/// Writes a shorthand from the values of its longhands.
pub(crate) struct Writer<'a> {
    pub(crate) value: &'a dyn Fn(Prop) -> Option<Out>,
    /// The optional parts to leave out, in the order of the syntax.
    pub(crate) dropped: u32,
    /// For each optional part, the properties in it.
    pub(crate) parts: Vec<Vec<Prop>>,
    pub(crate) seen: Vec<Prop>,
}

impl Writer<'_> {
    fn optional(&mut self, term: &Term, out: &mut Out) -> Option<()> {
        let (index, start, seen) = (self.parts.len(), out.len(), self.seen.len());
        self.parts.push(Vec::new());
        self.write(term, out)?;
        self.parts[index] = self.seen[seen..].to_vec();
        if self.dropped >> index & 1 != 0 || self.seen.len() == seen {
            out.truncate(start);
        }
        Some(())
    }

    pub(crate) fn write(&mut self, term: &Term, out: &mut Out) -> Option<()> {
        match term {
            Term::Keywords(all) => out.extend([b" ", all[0][0].as_bytes()].concat()),
            Term::Literal(literal) => out.extend([b' ', *literal]),
            Term::Sequence(all) | Term::AllOf(all) => {
                all.iter().try_for_each(|it| self.write(it, out))?
            }
            Term::AnyOf(all) => all.iter().try_for_each(|it| self.optional(it, out))?,
            Term::OneOf(all) => self.write(all.first()?, out)?,
            Term::Repeat { term, min: 0, .. } if matches!(**term, Term::AnyOf(_)) => {
                self.write(term, out)?
            }
            Term::Repeat { term, min: 0, .. } => self.optional(term, out)?,
            Term::Repeat { term, .. } | Term::NotEmpty(term) | Term::Hook(_, term) => {
                self.write(term, out)?
            }
            Term::Set(prop, _) if *prop != Prop::Long(crate::properties::Id::GridAutoFlow) => {
                self.seen.push(*prop)
            }
            Term::Capture(props, _) if !self.seen.contains(&props[0]) => {
                let value = (self.value)(props[0])?;
                out.extend((!value.is_empty()).then_some(b' ').into_iter().chain(value));
                match props[0] {
                    Prop::Short(index) => {
                        self.seen.extend(crate::shorthand::get(index).longhands())
                    }
                    _ => self.seen.extend(props),
                }
            }
            _ => {}
        }
        Some(())
    }
}
