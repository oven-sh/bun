//! Parses selectors, and writes them as the CSSOM serializes them.

use core::cell::Cell;
use std::rc::Rc;

use bun_css::Token;
use bun_css::css_parser::{Delimiters, nth::parse_nth};
use smallvec::{SmallVec, smallvec};

use crate::grammar::is_reserved;
use crate::name::{Name, name};
use crate::selector::*;
use crate::tree::{Flags, State};
use crate::values::*;

const ID: u32 = 1 << 20;
const CLASS: u32 = 1 << 10;
const TYPE: u32 = 1;

thread_local! {
    static NEXT_HAS: Cell<u32> = const { Cell::new(0) };
}

/// Of `@namespace`. The default one has no prefix.
pub(crate) type Namespaces = Vec<(Box<[u8]>, Str)>;

#[derive(Clone, Copy, Default)]
pub(crate) struct Parser<'a> {
    /// What `&` stands for.
    pub(crate) parent: Option<&'a List>,
    pub(crate) in_scope_rule: bool,
    pub(crate) namespaces: &'a [(Box<[u8]>, Str)],
    /// For `@supports`.
    pub(crate) is_strict: bool,
    pub(crate) is_quirky: bool,
}

/// What can follow a pseudo-element.
#[derive(Clone, Copy, PartialEq)]
enum After {
    Nothing,
    /// The pseudo-classes and the pseudo-elements.
    Only(&'static str, &'static str),
    /// It stands for an element.
    Element,
}

#[derive(Clone, Copy)]
struct Within {
    depth: u8,
    has: bool,
    only_compounds: bool,
    pseudo_elements: bool,
    /// In the argument of a pseudo-class that follows a pseudo-element.
    after: After,
    /// The default namespace does not apply to a subject that has no type selector.
    is_logical: bool,
}

const USER_ACTIONS: &str = "active focus focus-visible focus-within hover";
const OF_SCROLLBARS: &str = "corner-present decrement double-button end horizontal increment no-button single-button start vertical";

fn is_in(names: &str, name: &[u8]) -> bool {
    names
        .split_ascii_whitespace()
        .any(|it| it.as_bytes() == name)
}

impl After {
    fn pseudo_element(name: &[u8]) -> After {
        match name {
            b"part" | b"details-content" | b"picker" | b"permission-icon" | b"select-listbox" => {
                After::Element
            }
            b"before" | b"after" => After::Only("", "marker"),
            b"column" => After::Only("", "scroll-marker"),
            b"scroll-marker" => After::Only(
                "active focus focus-visible focus-within hover target-after target-before target-current",
                "",
            ),
            b"scroll-marker-group" => After::Only("focus-within hover", ""),
            b"scroll-button" => After::Only(
                "active focus focus-visible focus-within hover enabled disabled",
                "",
            ),
            b"search-text" => After::Only("current", ""),
            b"selection" => After::Only("window-inactive", ""),
            b"slotted" => After::Only(
                "",
                "after backdrop before checkmark details-content file-selector-button interest-button marker permission-icon \
                picker-icon placeholder view-transition picker view-transition-group view-transition-old view-transition-new \
                view-transition-image-pair view-transition-group-children select-listbox",
            ),
            _ if name.starts_with(b"view-transition-") => After::Only("only-child", ""),
            _ if name.starts_with(b"-webkit-scrollbar") || name == b"-webkit-resizer" => {
                After::Only(
                    "active corner-present decrement disabled double-button enabled end horizontal hover increment no-button \
                single-button start vertical window-inactive",
                    "",
                )
            }
            _ if name.starts_with(b"-") || name == b"file-selector-button" => {
                After::Only(USER_ACTIONS, "")
            }
            _ => After::Only("", ""),
        }
    }

    fn allows_class(self, name: &[u8]) -> bool {
        const STRUCTURAL: &str = "current empty first-child first-of-type last-child last-of-type only-child only-of-type root scope host \
            host-context has nth-child nth-last-child nth-of-type nth-last-of-type -webkit-any";
        match self {
            After::Nothing => true,
            After::Only(classes, _) => {
                is_in(classes, name) || is_in("is where not -internal-native", name)
            }
            After::Element => !is_in(STRUCTURAL, name) && !is_in(OF_SCROLLBARS, name),
        }
    }

    fn allows_element(self, name: &[u8]) -> bool {
        match self {
            After::Nothing => true,
            After::Only(_, elements) => is_in(elements, name),
            After::Element => !matches!(name, b"part" | b"slotted"),
        }
    }
}

fn pseudo_class(name: &[u8]) -> Option<Simple> {
    const STATES: [(&str, State); 26] = [
        ("hover", State::HOVER),
        ("active", State::ACTIVE),
        ("focus", State::FOCUS),
        ("focus-visible", State::FOCUS_VISIBLE),
        ("focus-within", State::FOCUS_WITHIN),
        ("disabled", State::DISABLED),
        ("enabled", State::ENABLED),
        ("checked", State::CHECKED),
        ("open", State::OPEN),
        ("popover-open", State::POPOVER_OPEN),
        ("link any-link -webkit-any-link", State::LINK),
        ("target", State::TARGET),
        ("default", State::DEFAULT),
        ("indeterminate", State::INDETERMINATE),
        ("valid", State::VALID),
        ("invalid", State::INVALID),
        ("in-range", State::IN_RANGE),
        ("out-of-range", State::OUT_OF_RANGE),
        ("required", State::REQUIRED),
        ("optional", State::OPTIONAL),
        ("user-valid", State::USER_VALID),
        ("user-invalid", State::USER_INVALID),
        ("fullscreen -webkit-full-screen", State::FULLSCREEN),
        ("read-write", State::READ_WRITE),
        ("placeholder-shown", State::PLACEHOLDER_SHOWN),
        ("vertical", State::VERTICAL),
    ];
    const RARE: &str = "active-view-transition autofill current future past granted interest-source interest-target picture-in-picture \
        target-after target-before target-current window-inactive xr-overlay unbounded -webkit-drag -webkit-full-page-media \
        -webkit-full-screen-ancestor";
    let edge = |kind| Simple::Nth(Nth { kind, a: 0, b: 1 }, None);
    Some(match name {
        b"root" => Simple::Root,
        b"empty" => Simple::Empty,
        b"scope" => Simple::Scope,
        b"host" => Simple::Host(None),
        b"first-child" => edge(NthKind::Child),
        b"last-child" => edge(NthKind::LastChild),
        b"only-child" => edge(NthKind::OnlyChild),
        b"first-of-type" => edge(NthKind::OfType),
        b"last-of-type" => edge(NthKind::LastOfType),
        b"only-of-type" => edge(NthKind::OnlyOfType),
        b"modal" => Simple::Is(
            [State::MODAL, State::FULLSCREEN]
                .into_iter()
                .map(|it| lone(Simple::State(it)))
                .collect(),
        ),
        b"defined" => Simple::NotState(State::UNDEFINED),
        b"read-only" => Simple::NotState(State::READ_WRITE),
        b"horizontal" => Simple::State(State::HORIZONTAL),
        b"-internal-native" => Simple::Native,
        b"-internal-base" => Simple::Base(Flags::BASE_SELECT),
        b"-internal-base-options" => Simple::Base(Flags::BASE_OPTIONS),
        b"-internal-html" => Simple::Html,
        b"-internal-in-html" => Simple::InHtml,
        b"-internal-in-base" => Simple::InBase,
        b"-internal-has-legend" => Simple::CustomState(internal_state(b"legend")),
        b"-internal-math" => Simple::Math,
        b"-webkit-autofill" => Simple::CustomState(internal_state(b"autofill")),
        _ => match STATES.iter().find(|it| is_in(it.0, name)) {
            Some(found) => Simple::State(found.1),
            None if is_in(RARE, name) => Simple::CustomState(internal_state(name)),
            None => (name == b"visited" || is_in(OF_SCROLLBARS, name)).then_some(Simple::Never)?,
        },
    })
}

/// The custom state that stands for a pseudo-class that few elements are in.
fn internal_state(name: &[u8]) -> Name {
    Name::new(&[b":", name].concat())
}

fn lone(simple: Simple) -> Selector {
    Selector {
        compounds: smallvec![compound(smallvec![simple], Combinator::None)],
        specificity: 0,
        pseudo: Pseudo::None,
        pseudo_state: State::empty(),
    }
}

fn max_specificity(list: &[Selector]) -> u32 {
    list.iter()
        .map(|selector| selector.specificity)
        .max()
        .unwrap_or(0)
}

fn compound(simples: SmallVec<[Simple; 1]>, combinator: Combinator) -> Compound {
    Compound {
        simples,
        combinator,
        required: 0,
        filter: 0,
    }
}

fn combinator(token: &Token) -> Option<(Combinator, &'static str)> {
    match token {
        Token::Delim(0x3e) => Some((Combinator::Child, "> ")),
        Token::Delim(0x2b) => Some((Combinator::Next, "+ ")),
        Token::Delim(0x7e) => Some((Combinator::Later, "~ ")),
        _ => None,
    }
}

fn is_nesting(source: &[u8]) -> bool {
    fn find(p: &mut P) -> bool {
        while let Ok(token) = p.next().copied() {
            let is_it = match token {
                Token::Function(_) | Token::OpenParen | Token::OpenSquare => {
                    nested(p, |p| Some(find(p))).unwrap_or(false)
                }
                Token::Colon => keyword(p, "scope"),
                token => matches!(token, Token::Delim(0x26)),
            };
            if is_it {
                while p.next().is_ok() {}
                return true;
            }
        }
        false
    }
    source.len() < 4096 && with_parser(source, find)
}

struct Reader<'a> {
    parser: Parser<'a>,
    out: Option<Out>,
    /// Whether the selector has `&`, or `:scope` in `@scope`.
    is_anchored: bool,
}

impl Parser<'_> {
    const TOP: Within = Within {
        depth: 0,
        has: false,
        only_compounds: false,
        pseudo_elements: true,
        after: After::Nothing,
        is_logical: false,
    };

    fn read(self, source: &[u8], out: Option<Out>, within: Within) -> Option<(List, Option<Out>)> {
        let is_declaration = source.starts_with(b"--")
            && with_parser(source, |p| ident(p).is_some() && p.expect_colon().is_ok());
        (!is_declaration).then_some(())?;
        let mut reader = Reader {
            parser: self,
            out,
            is_anchored: false,
        };
        let list = parse_all(source, |p| reader.list(p, within, false))?;
        Some((list, reader.out))
    }

    pub(crate) fn parse(self, source: &[u8]) -> Option<List> {
        self.read(source, None, Parser::TOP).map(|it| it.0)
    }

    pub(crate) fn serialize(self, source: &[u8]) -> Option<Out> {
        self.read(source, Some(Out::new()), Parser::TOP)?.1
    }

    /// In the prelude of `@scope`.
    pub(crate) fn boundary(self, source: &[u8]) -> Option<(List, Out)> {
        let (list, out) = self.read(
            source,
            Some(Out::new()),
            Within {
                pseudo_elements: false,
                ..Parser::TOP
            },
        )?;
        Some((list, out?))
    }
}

impl Reader<'_> {
    fn write(&mut self, write: impl FnOnce(&mut Out)) {
        self.out.as_mut().map(write);
    }

    fn text(&mut self, parts: &[&[u8]]) {
        self.write(|out| parts.iter().for_each(|it| out.extend_from_slice(it)));
    }

    fn written(&self) -> usize {
        self.out.as_ref().map_or(0, Vec::len)
    }

    fn each<T>(
        &mut self,
        p: &mut P,
        forgives: bool,
        mut item: impl FnMut(&mut Self, &mut P) -> Option<T>,
    ) -> Option<Vec<T>> {
        let (mut all, first) = (Vec::new(), self.written());
        loop {
            let start = self.written();
            if start > first {
                self.text(&[b", "]);
            }
            p.skip_whitespace();
            let (position, comma) = (p.position(), self.written());
            let parsed = p.parse_until_before(Delimiters::COMMA, |p| {
                item(self, p).ok_or_else(|| p.new_error_for_next_token())
            });
            match parsed {
                Ok(parsed) => all.push(parsed),
                Err(_) if forgives && !self.parser.is_strict => {
                    let source = p.slice_from(position).trim_ascii();
                    let is_kept = is_nesting(source);
                    self.is_anchored |= is_kept;
                    self.write(|out| out.truncate(if is_kept { comma } else { start }));
                    self.text(&[if is_kept { source } else { b"" }]);
                }
                Err(_) => return None,
            }
            if p.next().is_err() {
                return Some(all);
            }
        }
    }

    fn list(&mut self, p: &mut P, within: Within, forgives: bool) -> Option<List> {
        let all = self.each(p, forgives, |this, p| {
            let mut selector = if within.depth == 0 {
                this.top(p, within)?
            } else {
                this.complex(p, within)?
            };
            selector.flatten();
            Some(selector)
        });
        all.map(Into::into)
    }

    fn nesting(&self, within: Within) -> (u32, Simple) {
        let is_allowed = |it: &&Selector| {
            let mut has = false;
            it.visit_has(&mut |_| has = true);
            it.pseudo == Pseudo::None && !(has && within.has)
        };
        match self.parser.parent {
            Some(parent) if parent.iter().all(|it| it.pseudo == Pseudo::None) && !within.has => {
                (max_specificity(parent), Simple::Is(Rc::clone(parent)))
            }
            Some(parent) => {
                let allowed: List = parent.iter().filter(is_allowed).cloned().collect();
                (max_specificity(&allowed), Simple::Is(allowed))
            }
            None => (0, Simple::Scope),
        }
    }

    /// It is relative to the rule that it is in.
    fn top(&mut self, p: &mut P, within: Within) -> Option<Selector> {
        if self.parser.parent.is_none() && !self.parser.in_scope_rule {
            return self.complex(p, within);
        }
        let (start, leading) = (self.written(), attempt(p, |p| combinator(p.next().ok()?)));
        self.text(&[leading.map_or("", |it| it.1).as_bytes()]);
        self.is_anchored = false;
        let mut selector = self.complex(p, within)?;
        if leading.is_some() || !self.is_anchored {
            let (specificity, simple) = self.nesting(within);
            selector.specificity += specificity;
            selector.compounds.last_mut()?.combinator =
                leading.map_or(Combinator::Descendant, |it| it.0);
            selector
                .compounds
                .push(compound(smallvec![simple], Combinator::None));
            if self.parser.parent.is_some() {
                self.write(|out| drop(out.splice(start..start, *b"& ")));
            }
        }
        Some(selector)
    }

    fn complex(&mut self, p: &mut P, within: Within) -> Option<Selector> {
        let mut selector = Selector {
            compounds: SmallVec::new(),
            specificity: 0,
            pseudo: Pseudo::None,
            pseudo_state: State::empty(),
        };
        let mut left = Combinator::None;
        p.skip_whitespace();
        loop {
            let state = p.state();
            let implied = self
                .namespace(b"")
                .filter(|_| within.is_logical && Self::qualified_name(p).is_none())
                .cloned();
            p.reset(&state);
            let after = self.compound(p, within, left, &mut selector)?;
            p.skip_whitespace();
            if p.is_exhausted() {
                selector.compounds.reverse();
                return Some(selector);
            }
            (after == After::Nothing && !within.only_compounds && selector.compounds.len() < 128)
                .then_some(())?;
            selector
                .compounds
                .last_mut()?
                .simples
                .extend(implied.map(Simple::Namespace));
            let (next, written) =
                attempt(p, |p| combinator(p.next().ok()?)).unwrap_or((Combinator::Descendant, ""));
            self.text(&[b" ", written.as_bytes()]);
            p.skip_whitespace();
            left = next;
        }
    }

    fn namespace(&self, prefix: &[u8]) -> Option<&Str> {
        self.parser
            .namespaces
            .iter()
            .rfind(|it| *it.0 == *prefix)
            .map(|it| &it.1)
    }

    /// The prefix, if there is one, and the name. `*` is `None`.
    fn qualified_name<'b>(
        p: &mut P<'_, 'b>,
    ) -> Option<(Option<Option<&'b [u8]>>, Option<&'b [u8]>)> {
        let name = |p: &mut P<'_, 'b>| {
            attempt(p, |p| match *p.next_including_whitespace().ok()? {
                Token::Ident(name) => Some(Some(name)),
                Token::Delim(0x2a) => Some(None),
                _ => None,
            })
        };
        let first = name(p);
        match attempt(p, |p| {
            matches!(p.next_including_whitespace().ok()?, Token::Delim(0x7c)).then_some(())
        }) {
            Some(()) => Some((
                Some(first.unwrap_or(Some(b""))),
                name(p).or(Some(Some(b"")))?,
            )),
            None => Some((None, first?)),
        }
    }

    fn type_selector(
        &mut self,
        p: &mut P,
        within: Within,
        simples: &mut SmallVec<[Simple; 1]>,
    ) -> Option<u32> {
        let default = self.namespace(b"").cloned();
        let Some((prefix, local)) = Self::qualified_name(p) else {
            simples.extend(
                default
                    .filter(|_| !within.is_logical)
                    .map(Simple::Namespace),
            );
            return Some(0);
        };
        (local != Some(b"") && within.after == After::Nothing).then_some(())?;
        let namespace = match prefix {
            None => default.clone(),
            Some(None) => None,
            Some(Some(b"")) => Some("".into()),
            Some(Some(prefix)) => Some(Rc::clone(self.namespace(prefix)?)),
        };
        if let Some(prefix) = prefix.filter(|_| namespace != default) {
            self.write(|out| {
                if let Some(it) = prefix {
                    write_ident(it, out)
                } else {
                    out.push(b'*')
                }
            });
            self.text(&[b"|"]);
        }
        simples.extend(namespace.map(Simple::Namespace));
        let Some(local) = local else {
            self.text(&[b"*"]);
            let state = p.state();
            let is_host = p.expect_colon().is_ok()
                && matches!(p.next(), Ok(Token::Ident(it) | Token::Function(it)) if it.len() >= 4 && eq(&it[..4], "host"));
            p.reset(&state);
            simples.extend(is_host.then_some(Simple::Never));
            return Some(0);
        };
        self.write(|out| write_ident(&local.to_ascii_lowercase(), out));
        simples.push(Simple::Tag(Name::new(local), Name::lowercase(local)));
        Some(TYPE)
    }

    fn attribute(&mut self, p: &mut P) -> Option<Simple> {
        const IGNORE_CASE: &str = "accept accept-charset align alink axis bgcolor charset checked clear codetype color compact declare \
            defer dir direction disabled enctype face frame hreflang http-equiv lang language link media method multiple nohref \
            noresize noshade nowrap readonly rel rev rules scope scrolling selected shape target text type valign valuetype vlink";
        p.skip_whitespace();
        let (prefix, local) = Self::qualified_name(p)?;
        let (local, lower) = local
            .filter(|it| !it.is_empty())
            .map(|it| (it, it.to_ascii_lowercase()))?;
        self.text(&[b"["]);
        if let Some(prefix) = prefix.filter(|it| *it != Some(b"")) {
            self.write(|out| {
                if let Some(it) = prefix {
                    write_ident(it, out)
                } else {
                    out.push(b'*')
                }
            });
            self.text(&[b"|"]);
        }
        self.write(|out| write_ident(&lower, out));
        let names = match prefix {
            Some(Some(prefix)) if !prefix.is_empty() && !self.namespace(prefix)?.is_empty() => {
                let name = key::namespaced(self.namespace(prefix)?.as_bytes(), local);
                (name, name)
            }
            _ => (Name::new(local), Name::new(&lower)),
        };
        let test = if let Ok(token) = p.next().copied() {
            let (operator, written) = match token {
                Token::Delim(0x3d) => (Operator::Equal, "="),
                Token::IncludeMatch => (Operator::Includes, "~="),
                Token::DashMatch => (Operator::DashMatch, "|="),
                Token::PrefixMatch => (Operator::Prefix, "^="),
                Token::SuffixMatch => (Operator::Suffix, "$="),
                Token::SubstringMatch => (Operator::Substring, "*="),
                _ => return None,
            };
            let value = string(p).or_else(|| ident(p))?;
            let flag = ident(p);
            let case = match flag {
                Some(flag) => eq(flag, "i").then_some(Case::Ignored)?,
                None if prefix.is_none_or(|it| it == Some(b"")) && is_in(IGNORE_CASE, &lower) => {
                    Case::IgnoredInHtml
                }
                None => Case::Matters,
            };
            self.text(&[written.as_bytes()]);
            self.write(|out| write_string(value, out));
            self.text(&[if flag.is_some() { b" i" } else { b"" }]);
            let has_key = operator == Operator::Equal
                && case == Case::Matters
                && prefix.is_none()
                && *local == *lower;
            Some(AttributeTest {
                names,
                operator,
                value: value.into(),
                case,
                key: if has_key {
                    key::value(local, value)
                } else {
                    Name::NONE
                },
            })
        } else {
            None
        };
        self.text(&[b"]"]);
        Some(match test {
            test if prefix == Some(None) => {
                Simple::AnyNamespace(Rc::new((local.into(), names.1, test)))
            }
            Some(test) => Simple::Attribute(Rc::new(test)),
            None => Simple::Exists(names.0, names.1),
        })
    }

    fn compound(
        &mut self,
        p: &mut P,
        within: Within,
        mut left: Combinator,
        selector: &mut Selector,
    ) -> Option<After> {
        let (start, written, mut simples, mut after) =
            (p.position(), self.written(), SmallVec::new(), within.after);
        selector.specificity += self.type_selector(p, within, &mut simples)?;
        let (is_universal, mut count) = (
            self.out.as_ref().is_some_and(|it| it[written..] == *b"*"),
            0,
        );
        loop {
            let state = p.state();
            let (specificity, simple) = match p.next_including_whitespace().copied() {
                Ok(Token::IdHash(name)) if after == After::Nothing => {
                    self.text(&[b"#"]);
                    self.write(|out| write_ident(name, out));
                    match self.parser.is_quirky {
                        true => (
                            ID,
                            Simple::Attribute(Rc::new(AttributeTest {
                                names: (name!("id"), name!("id")),
                                operator: Operator::Equal,
                                value: name.into(),
                                case: Case::Ignored,
                                key: Name::NONE,
                            })),
                        ),
                        false => (ID, Simple::Id(Name::new(name))),
                    }
                }
                Ok(Token::Delim(0x2e)) if after == After::Nothing => {
                    let Token::Ident(name) = *p.next_including_whitespace().ok()? else {
                        return None;
                    };
                    self.text(&[b"."]);
                    self.write(|out| write_ident(name, out));
                    (
                        CLASS,
                        Simple::Class(if self.parser.is_quirky {
                            Name::lowercase(name)
                        } else {
                            Name::new(name)
                        }),
                    )
                }
                Ok(Token::OpenSquare) if after == After::Nothing => {
                    (CLASS, nested(p, |p| self.attribute(p))?)
                }
                Ok(Token::Delim(0x26)) if after == After::Nothing => {
                    self.text(&[b"&"]);
                    self.is_anchored = true;
                    self.nesting(within)
                }
                Ok(Token::Colon) => {
                    let mut token = *p.next_including_whitespace().ok()?;
                    let mut is_element = matches!(token, Token::Colon);
                    if is_element {
                        token = *p.next_including_whitespace().ok()?;
                    }
                    let (Token::Ident(name) | Token::Function(name)) = token else {
                        return None;
                    };
                    let (name, is_function) = (
                        name.to_ascii_lowercase(),
                        matches!(token, Token::Function(_)),
                    );
                    is_element |=
                        !is_function && is_in("before after first-line first-letter", &name);
                    self.text(&[
                        if is_element { b"::" } else { b":" },
                        &name,
                        if is_function { b"(" } else { b"" },
                    ]);
                    (within.depth < 32).then_some(())?;
                    let inner = Within {
                        depth: within.depth + 1,
                        pseudo_elements: false,
                        ..within
                    };
                    count += 1;
                    if is_element {
                        (within.pseudo_elements && after.allows_element(&name)).then_some(())?;
                        selector.specificity += TYPE;
                        let pseudo = match is_function {
                            true if name.starts_with(b"view-transition-") => {
                                let (pseudo, known) = (
                                    nested(p, |p| self.transition_part(&name, p, &mut simples))?,
                                    simples.last(),
                                );
                                if matches!(pseudo, Pseudo::Transition(_, Name::NONE))
                                    && !matches!(known, Some(Simple::TransitionClass(_)))
                                {
                                    selector.specificity -= TYPE;
                                }
                                Ok(pseudo)
                            }
                            true => nested(p, |p| {
                                self.functional_element(
                                    &name,
                                    p,
                                    Within {
                                        after: After::Nothing,
                                        ..inner
                                    },
                                )
                            })?,
                            false => Ok(self.plain_element(&name)?),
                        };
                        self.text(&[if is_function { b")" } else { b"" }]);
                        after = if name == b"cue" && !is_function {
                            After::Only(USER_ACTIONS, "")
                        } else {
                            After::pseudo_element(&name)
                        };
                        match pseudo {
                            Ok(pseudo) if selector.pseudo == Pseudo::None => {
                                selector.pseudo = pseudo
                            }
                            Ok(pseudo) => selector.pseudo = selector.pseudo.nested(pseudo),
                            Err((specificity, simple, combinator)) => {
                                simples.extend(
                                    (selector.pseudo != Pseudo::None).then_some(Simple::Never),
                                );
                                selector.specificity += specificity;
                                selector.compounds.push(compound(
                                    core::mem::replace(&mut simples, smallvec![simple]),
                                    left,
                                ));
                                left = combinator;
                            }
                        }
                        continue;
                    }
                    (after.allows_class(&name)
                        && (selector.pseudo != Pseudo::Scroll(ScrollPart::Column)))
                    .then_some(())?;
                    (after != After::pseudo_element(b"slotted")).then_some(())?;
                    self.is_anchored |= name == b"scope" && self.parser.parent.is_none();
                    let found = match is_function {
                        true => nested(p, |p| {
                            self.functional_class(&name, p, Within { after, ..inner })
                        })?,
                        false => (CLASS, pseudo_class(&name)?),
                    };
                    self.text(&[if is_function { b")" } else { b"" }]);
                    found
                }
                Ok(Token::Whitespace(_) | Token::Delim(0x3e | 0x2b | 0x7e)) | Err(_) => {
                    p.reset(&state);
                    break;
                }
                _ => return None,
            };
            count += 1;
            selector.specificity += specificity;
            match simple {
                simple if selector.pseudo == Pseudo::None => simples.push(simple),
                Simple::State(state) => selector.pseudo_state |= state,
                Simple::CustomState(name)
                    if let Some(found) = crate::carousel::TARGET_STATES
                        .iter()
                        .find(|it| it.0 == name) =>
                {
                    selector.pseudo_state |= found.1
                }
                Simple::Nth(
                    Nth {
                        kind: NthKind::OnlyChild,
                        ..
                    },
                    _,
                ) => selector.pseudo_state |= State::DEFAULT,
                _ => simples.push(Simple::Never),
            }
        }
        (p.position() > start).then_some(())?;
        if is_universal && count > 0 {
            self.write(|out| _ = out.remove(written));
        }
        selector.compounds.push(compound(simples, left));
        Some(after)
    }

    fn plain_element(&self, name: &[u8]) -> Option<Pseudo> {
        const KNOWN: &str = "after backdrop before checkmark column cue details-content file-selector-button first-letter first-line \
            grammar-error interest-button marker permission-icon picker-icon placeholder scroll-marker scroll-marker-group \
            search-text select-listbox selection spelling-error target-text view-transition";
        let is_prefixed =
            name.starts_with(b"-webkit-") && !(self.parser.is_strict && !is_known_prefixed(name));
        (is_in(KNOWN, name) || is_prefixed || name.starts_with(b"-internal-"))
            .then(|| Pseudo::from_name(name))
    }

    /// `Err` if it is an element in another tree.
    fn functional_element(
        &mut self,
        name: &[u8],
        p: &mut P,
        inner: Within,
    ) -> Option<Result<Pseudo, (u32, Simple, Combinator)>> {
        let compounds = Within {
            only_compounds: true,
            ..inner
        };
        Some(Ok(match name {
            b"slotted" => {
                let mut selector = self.complex(p, compounds)?;
                selector.flatten();
                return Some(Err((
                    selector.specificity,
                    Simple::Is(Rc::new([selector])),
                    Combinator::Slot,
                )));
            }
            b"part" => {
                let names: Vec<_> = core::iter::from_fn(|| ident(p)).collect();
                self.write(|out| write_list(&names, " ", out, |it, out| write_ident(it, out)));
                (!names.is_empty()).then_some(())?;
                return Some(Err((
                    0,
                    Simple::Part(names.into_iter().map(Name::new).collect()),
                    Combinator::Part,
                )));
            }
            b"cue" => self
                .list(p, compounds, false)
                .map(|_| Pseudo::Part(Name::NONE))?,
            b"highlight" => {
                let name = ident(p)?;
                self.write(|out| write_ident(name, out));
                Pseudo::Highlight(Name::new(name))
            }
            b"picker" | b"scroll-button" => {
                let argument = ident(p).or_else(|| delim(p, b'*').then_some(b"*"))?;
                let known = if name == b"picker" {
                    "select"
                } else {
                    "* up down left right block-start block-end inline-start inline-end"
                };
                is_in(known, &argument.to_ascii_lowercase()).then_some(())?;
                self.text(&[argument]);
                Pseudo::from_name(&[name, b"(", argument, b")"].concat())
            }
            _ => return None,
        }))
    }

    fn transition_part(
        &mut self,
        function: &[u8],
        p: &mut P,
        simples: &mut SmallVec<[Simple; 1]>,
    ) -> Option<Pseudo> {
        let Pseudo::Transition(part, _) = Pseudo::from_name(function) else {
            return None;
        };
        let is_any = delim(p, b'*');
        let name = if is_any { None } else { ident(p) };
        (!name.is_some_and(is_reserved) && (is_any || name.is_some() || !p.is_exhausted()))
            .then_some(())?;
        self.write(|out| {
            if let Some(it) = name {
                write_ident(it, out)
            } else {
                out.push(b'*')
            }
        });
        while delim(p, b'.') {
            let Token::Ident(class) = *p.next_including_whitespace().ok()? else {
                return None;
            };
            (!is_reserved(class)).then_some(())?;
            self.text(&[b"."]);
            self.write(|out| write_ident(class, out));
            simples.push(Simple::TransitionClass(Name::new(class)));
        }
        Some(Pseudo::Transition(part, name.map_or(Name::NONE, Name::new)))
    }

    fn functional_class(&mut self, name: &[u8], p: &mut P, inner: Within) -> Option<(u32, Simple)> {
        let logical = Within {
            is_logical: true,
            ..inner
        };
        let compounds = Within {
            only_compounds: true,
            ..inner
        };
        let mut word = |this: &mut Self, p: &mut P| {
            let word = ident(p)?.to_vec();
            this.write(|out| write_ident(&word, out));
            Some(word)
        };
        Some(match name {
            b"is" | b"where" => {
                let list = self.list(p, logical, true)?;
                (
                    if name == b"is" {
                        max_specificity(&list)
                    } else {
                        0
                    },
                    Simple::Is(list),
                )
            }
            b"not" => self
                .list(p, logical, false)
                .map(|list| (max_specificity(&list), Simple::Not(list)))?,
            b"-webkit-any" => (CLASS, Simple::Is(self.list(p, compounds, false)?)),
            b"has" if !inner.has && !inner.only_compounds => self.has(
                p,
                Within {
                    has: true,
                    ..logical
                },
            )?,
            b"host" | b"host-context" => {
                let mut selector = self.complex(p, compounds)?;
                selector.flatten();
                let (specificity, list): (_, List) =
                    (CLASS + selector.specificity, Rc::new([selector]));
                (
                    specificity,
                    if name == b"host" {
                        Simple::Host(Some(list))
                    } else {
                        Simple::HostContext(list)
                    },
                )
            }
            b"nth-child" | b"nth-last-child" | b"nth-of-type" | b"nth-last-of-type" => {
                let (a, b) = parse_nth(p).ok()?;
                self.write(|out| {
                    out.extend(
                        match (a, b) {
                            (0, b) => format!("{b}"),
                            (a, 0) => format!("{a}n"),
                            (a, b) => format!("{a}n{b:+}"),
                        }
                        .bytes()
                        .enumerate()
                        .filter(|(at, it)| a.abs() != 1 || *it != b'1' || *at != usize::from(a < 0))
                        .map(|it| it.1),
                    );
                });
                let kind = match name {
                    b"nth-child" => NthKind::Child,
                    b"nth-last-child" => NthKind::LastChild,
                    b"nth-of-type" => NthKind::OfType,
                    _ => NthKind::LastOfType,
                };
                let of = match name.ends_with(b"child")
                    && attempt(p, |p| ident(p).filter(|it| eq(it, "of"))).is_some()
                {
                    true => {
                        self.text(&[b" of "]);
                        Some(self.list(
                            p,
                            Within {
                                only_compounds: false,
                                pseudo_elements: inner.depth == 1,
                                ..inner
                            },
                            false,
                        )?)
                    }
                    false => None,
                };
                (
                    CLASS + of.as_deref().map_or(0, max_specificity),
                    Simple::Nth(Nth { kind, a, b }, of),
                )
            }
            b"lang" => (CLASS, Simple::Lang(Rc::new([word(self, p)?.into()]))),
            b"state" => (CLASS, Simple::CustomState(Name::new(&word(self, p)?))),
            b"dir" => (
                CLASS,
                match word(self, p)? {
                    direction if eq(&direction, "rtl") => Simple::State(State::RTL),
                    direction if eq(&direction, "ltr") => Simple::NotState(State::RTL),
                    _ => Simple::Never,
                },
            ),
            b"active-view-transition-type" => {
                let types = self.each(p, false, &mut word)?;
                let one = |name: Out| {
                    lone(Simple::CustomState(internal_state(
                        &[b"type ", &name[..]].concat(),
                    )))
                };
                (CLASS, Simple::Is(types.into_iter().map(one).collect()))
            }
            _ => return None,
        })
    }

    fn has(&mut self, p: &mut P, inner: Within) -> Option<(u32, Simple)> {
        let id = NEXT_HAS.replace(NEXT_HAS.get().wrapping_add(1));
        let mut has = Has {
            id,
            relatives: Vec::new(),
            keys: Vec::new(),
            outer_keys: Vec::new(),
            looks_at_siblings: false,
        };
        has.relatives = self.each(p, false, |this, p| {
            let (leading, written) =
                attempt(p, |p| combinator(p.next().ok()?)).unwrap_or((Combinator::Descendant, ""));
            this.text(&[written.as_bytes()]);
            let mut selector = this.complex(p, inner)?;
            selector.compounds.last_mut()?.combinator = leading;
            has.looks_at_siblings |= matches!(leading, Combinator::Next | Combinator::Later);
            selector
                .compounds
                .push(compound(smallvec![Simple::Anchor], Combinator::None));
            selector.flatten();
            if selector.compounds[0].key().is_none() || has.looks_at_siblings {
                has.keys.push(key::STRUCTURE);
            }
            selector.features(Relation::empty(), &mut |key, _, _| has.keys.push(key), true);
            selector.outer_features(&mut |key, _, _| has.outer_keys.push(key));
            Some(selector)
        })?;
        has.keys.sort_unstable();
        has.keys.dedup();
        Some((max_specificity(&has.relatives), Simple::Has(Rc::new(has))))
    }
}

fn is_known_prefixed(name: &[u8]) -> bool {
    const PREFIXES: &str = "scrollbar resizer input-placeholder file-upload-button slider- progress- meter- datetime-edit color-swatch \
        search-cancel-button inner-spin-button calendar-picker-indicator media- textfield-decoration-container details-marker";
    PREFIXES
        .split_ascii_whitespace()
        .any(|it| name[8..].starts_with(it.as_bytes()))
}
