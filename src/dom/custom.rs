//! Custom properties, and the functions that are substituted before a value is parsed.

use core::cell::RefCell;
use core::cmp::Ordering;
use core::ops::Range;
use std::collections::VecDeque;
use std::rc::Rc;

use bun_css::Token;
use bun_css::css_parser::Delimiters;
use smallvec::SmallVec;

use crate::calc::{Kind, Node, Options, Unit};
use crate::condition::{self, Actual, Condition, Feature, Subject};
use crate::grammar::{Mode, definition, is_reserved, split_list};
use crate::hooks::words;
use crate::name::{Map, Name, Set};
use crate::order::Order as _;
use crate::scan::{self, Next};
use crate::sheet::{ContainerQuery, Declared, Wide};
use crate::tree::NodeId;
use crate::types::Transforms;
use crate::values::*;

pub(crate) type Text = Rc<[u8]>;
/// Sorted. `None` is the guaranteed-invalid value.
pub(crate) type Entries = Vec<Entry>;
type Entry = (Name, Option<Text>);

thread_local! {
    static SPELLINGS: RefCell<Box<Map<Name, Str>>> = RefCell::default();
}

pub(crate) fn remember(source: &[u8]) -> Name {
    let name = Name::new(source);
    SPELLINGS.with_borrow_mut(|it| _ = it.entry(name).or_insert_with(|| text(source).into()));
    name
}

/// Of a property that has been declared or registered.
pub(crate) fn spelling(name: Name) -> Str {
    SPELLINGS.with_borrow(|it| it.get(&name).cloned().unwrap_or_default())
}

fn find(entries: &[Entry], name: Name) -> Option<&Option<Text>> {
    // The names are hashes, so they are spread evenly.
    let mut index = ((u128::from(name.bits()) * entries.len() as u128) >> 64) as usize;
    let mut range = 0..entries.len();
    let mut step = 4;
    while range.len() > 8 {
        match entries[index].0.cmp(&name) {
            Ordering::Equal => return Some(&entries[index].1),
            Ordering::Less => {
                range.start = index + 1;
                index = (index + step).min(range.start.midpoint(range.end));
            }
            Ordering::Greater => {
                range.end = index;
                index = index
                    .saturating_sub(step)
                    .max(range.start.midpoint(range.end));
            }
        }
        step *= 2;
    }
    entries[range]
        .iter()
        .find(|it| it.0 == name)
        .map(|it| &it.1)
}

#[derive(Default)]
pub(crate) struct Inherited {
    entries: Rc<[Entry]>,
    parent: Option<Rc<Inherited>>,
    depth: u8,
    /// A bit for each of the names.
    filter: [u64; 2],
    /// Of the parent and some of the entries.
    hash: u64,
}

fn filter_bit(name: Name) -> (usize, u64) {
    (
        (name.bits() >> 4 & 1) as usize,
        1 << (name.bits() >> 5 & 63),
    )
}

impl Inherited {
    fn layers(&self) -> impl Iterator<Item = &Inherited> {
        core::iter::successors(Some(self), |layer| layer.parent.as_deref())
    }

    pub(crate) fn get(&self, name: Name) -> Option<&Option<Text>> {
        let (word, bit) = filter_bit(name);
        self.layers()
            .filter(|it| it.filter[word] & bit != 0)
            .find_map(|layer| find(&layer.entries, name))
    }

    fn extend(
        parent: &Rc<Inherited>,
        own: &Rc<[Entry]>,
        recent: &Recent<Inherited>,
    ) -> Rc<Inherited> {
        let differs = |(name, value): &Entry| parent.get(*name).unwrap_or(&None) != value;
        let Some(first) = own.iter().position(differs) else {
            return Rc::clone(parent);
        };
        let same = if first == 0 {
            own.iter()
                .skip(1)
                .position(|it| !differs(it))
                .map(|it| it + 1)
        } else {
            Some(0)
        };
        let mut entries = match same {
            Some(same) => own[..same]
                .iter()
                .chain(own[first.max(same + 1)..].iter().filter(|it| differs(it)))
                .cloned()
                .collect(),
            None => Rc::clone(own),
        };
        let mut parent = Some(parent);
        if parent.is_some_and(|parent| parent.depth >= 8) {
            let mut all = entries.to_vec();
            while let Some(layer) = parent.filter(|it| it.entries.len() < 128 || it.depth > 4) {
                all.extend(layer.entries.iter().cloned());
                parent = layer.parent.as_ref();
            }
            all.order_by_key(|entry| entry.0);
            all.dedup_by_key(|entry| entry.0);
            entries = all.into();
        }
        let hash = bun_wyhash::hash_with_seed(
            parent.map_or(0, |it| Rc::as_ptr(it).addr()) as u64 ^ entries[0].0.bits(),
            entries[0].1.as_deref().unwrap_or_default(),
        );
        let is_same = |it: &Inherited| {
            it.hash == hash
                && it.parent.as_ref().map(Rc::as_ptr) == parent.map(Rc::as_ptr)
                && it.entries == entries
        };
        if let Some(found) = recent.find(is_same) {
            return found;
        }
        let mut filter = [0; 2];
        entries
            .iter()
            .map(|it| filter_bit(it.0))
            .for_each(|(word, bit)| filter[word] |= bit);
        let depth = parent.map_or(0, |parent| parent.depth + 1);
        recent.add(Rc::new(Inherited {
            entries,
            depth,
            parent: parent.cloned(),
            filter,
            hash,
        }))
    }
}

/// What was made last, to share with what turns out to be equal.
pub(crate) struct Recent<T>(RefCell<VecDeque<Rc<T>>>);

impl<T> Default for Recent<T> {
    fn default() -> Self {
        Recent(RefCell::default())
    }
}

impl<T> Recent<T> {
    fn find(&self, is_same: impl Fn(&T) -> bool) -> Option<Rc<T>> {
        self.0.borrow().iter().find(|it| is_same(it)).cloned()
    }

    fn add(&self, new: Rc<T>) -> Rc<T> {
        let mut all = self.0.borrow_mut();
        all.truncate(23);
        all.push_front(Rc::clone(&new));
        new
    }

    pub(crate) fn share(&self, value: &mut Rc<T>)
    where
        T: PartialEq,
    {
        *value = self
            .find(|it| *it == **value)
            .unwrap_or_else(|| self.add(Rc::clone(value)));
    }
}

#[derive(Clone, Default)]
#[repr(C)]
pub(crate) struct Customs {
    pub(crate) inherited: Rc<Inherited>,
    /// What this element sets of `inherited`.
    own: Option<Rc<[Entry]>>,
    /// The registered properties that are not inherited.
    local: Option<Rc<[Entry]>>,
}

impl Customs {
    pub(crate) fn get<'a>(&'a self, name: Name, registry: &'a Registry) -> Option<&'a Text> {
        let local = self.local.as_ref().and_then(|local| find(local, name));
        match local.or_else(|| self.inherited.get(name)) {
            Some(value) => value.as_ref(),
            None => registry.get(&name)?.initial.as_ref(),
        }
    }

    /// Some more than once, and some without a value.
    pub(crate) fn names(&self) -> Vec<Name> {
        let lists = self
            .inherited
            .layers()
            .map(|it| &*it.entries)
            .chain(self.local.as_deref());
        lists.flatten().map(|it| it.0).collect()
    }

    pub(crate) fn inheriting(parent: &Customs) -> Customs {
        Customs {
            inherited: Rc::clone(&parent.inherited),
            own: None,
            local: None,
        }
    }

    /// Both are sorted.
    pub(crate) fn new(
        parent: &Customs,
        own: Entries,
        local: Entries,
        recent: &Recent<Inherited>,
    ) -> Customs {
        let [own, local] = [own, local].map(|it| (!it.is_empty()).then(|| it.into()));
        Customs {
            inherited: Rc::clone(&parent.inherited),
            own,
            local,
        }
        .reparented(parent, recent)
    }

    pub(crate) fn share_with(&mut self, other: &Customs) {
        self.inherited = Rc::clone(&other.inherited);
    }

    pub(crate) fn is_same(&self, other: &Customs) -> bool {
        Rc::ptr_eq(&self.inherited, &other.inherited) && self.local == other.local
    }

    pub(crate) fn has_same_locals(&self, other: &Customs) -> bool {
        self.local == other.local
    }

    /// The same declarations, under another parent.
    pub(crate) fn reparented(&self, parent: &Customs, recent: &Recent<Inherited>) -> Customs {
        let extend = |own: &Rc<[Entry]>| Inherited::extend(&parent.inherited, own, recent);
        Customs {
            inherited: self
                .own
                .as_ref()
                .map_or_else(|| Rc::clone(&parent.inherited), extend),
            own: self.own.clone(),
            local: self.local.clone(),
        }
    }

    /// With other values for some of those that it sets and that are inherited.
    pub(crate) fn amended(
        &self,
        parent: &Customs,
        values: &[(Name, Text)],
        recent: &Recent<Inherited>,
    ) -> Option<Customs> {
        let own = self
            .own
            .as_ref()
            .filter(|own| values.iter().all(|it| find(own, it.0).is_some()))?;
        let own: Rc<[Entry]> = own
            .iter()
            .map(|it| {
                values
                    .iter()
                    .find(|new| new.0 == it.0)
                    .map_or_else(|| it.clone(), |new| (it.0, Some(Rc::clone(&new.1))))
            })
            .collect();
        Some(Customs {
            inherited: Inherited::extend(&parent.inherited, &own, recent),
            own: Some(own),
            local: self.local.clone(),
        })
    }

    pub(crate) fn inherited_differences(&self, other: &Customs) -> Set<Name> {
        let (a, b) = (&self.inherited, &other.inherited);
        let names = a
            .layers()
            .chain(b.layers())
            .take_while(|_| !Rc::ptr_eq(a, b))
            .flat_map(|it| it.entries.iter());
        names
            .map(|it| it.0)
            .filter(|it| a.get(*it).unwrap_or(&None) != b.get(*it).unwrap_or(&None))
            .collect()
    }

    /// The names that either of them sets, and whose values differ.
    pub(crate) fn differences(&self, other: &Customs) -> Vec<Name> {
        let (mut a, mut b) = (
            self.own.as_deref().unwrap_or_default(),
            other.own.as_deref().unwrap_or_default(),
        );
        let mut names = Vec::new();
        if core::ptr::eq(a, b) {
            return names;
        }
        loop {
            let (name, differs) = match (a, b) {
                ([x, ..], [y, ..]) if x.0 == y.0 => {
                    (a, b) = (&a[1..], &b[1..]);
                    (x.0, x.1 != y.1)
                }
                ([x, rest @ ..], b) if b.first().is_none_or(|y| x.0 < y.0) => {
                    a = rest;
                    (x.0, other.inherited.get(x.0).unwrap_or(&None) != &x.1)
                }
                (_, [y, rest @ ..]) => {
                    b = rest;
                    (y.0, self.inherited.get(y.0).unwrap_or(&None) != &y.1)
                }
                _ => return names,
            };
            names.extend(differs.then_some(name));
        }
    }
}

/// The names of the inherited values that may have changed.
pub(crate) struct Changed<'a> {
    few: SmallVec<[Name; 4]>,
    many: Set<Name>,
    outer: Option<&'a Changed<'a>>,
    /// The `mark` of each.
    pub(crate) marks: u64,
}

pub(crate) fn mark(name: Name) -> u64 {
    1 << (name.bits() >> 5 & 63)
}

impl<'a> Changed<'a> {
    /// `None` if that adds nothing to `outer`.
    pub(crate) fn new(
        names: impl IntoIterator<Item = Name>,
        outer: Option<&'a Changed<'a>>,
    ) -> Option<Changed<'a>> {
        let mut names = names.into_iter();
        Changed::of(names.by_ref().take(4).collect(), names.collect(), outer)
    }

    fn of(
        few: SmallVec<[Name; 4]>,
        many: Set<Name>,
        outer: Option<&'a Changed<'a>>,
    ) -> Option<Changed<'a>> {
        let marks = few
            .iter()
            .chain(&many)
            .fold(outer.map_or(0, |it| it.marks), |all, it| all | mark(*it));
        (!few.is_empty()).then_some(Changed {
            few,
            many,
            outer,
            marks,
        })
    }

    fn all(&self) -> impl Iterator<Item = &Changed<'a>> {
        core::iter::successors(Some(self), |it| it.outer)
    }

    pub(crate) fn names(&self) -> impl Iterator<Item = Name> {
        self.all()
            .flat_map(|it| it.few.iter().chain(&it.many))
            .copied()
    }

    pub(crate) fn contains(&self, name: Name) -> bool {
        self.marks & mark(name) != 0
            && self
                .all()
                .any(|it| it.few.contains(&name) || it.many.contains(&name))
    }
}

pub(crate) fn has_unit(source: &[u8], units: &[Unit]) -> bool {
    fn find(p: &mut P, units: &[Unit], depth: u8) -> bool {
        let mut found = false;
        while let Ok(token) = p.next().copied() {
            found |= match token {
                Token::Dimension(it) => {
                    Unit::from_name(it.unit).is_some_and(|it| units.contains(&it))
                }
                Token::Function(_) | Token::OpenParen if depth < 128 => {
                    nested(p, |p| Some(find(p, units, depth + 1))) == Some(true)
                }
                _ => false,
            };
        }
        found
    }
    with_parser(source, |p| find(p, units, 0))
}

/// Whether it is valid, and stands for itself.
pub(crate) fn is_plain(source: &[u8]) -> bool {
    matches!(source, [b'0'..=b'9' | b'.' | b'#' | b'-' | b'+', ..])
        && source.iter().all(|it| {
            it.is_ascii_alphanumeric()
                || matches!(it, b'.' | b'#' | b'-' | b'+' | b'%' | b',' | b' ')
        })
}

// ───────────────────────────── registered properties ─────────────────────────────

pub(crate) type Registry = Map<Name, Rc<Registered>>;

#[derive(Clone, PartialEq)]
enum Component {
    /// The name of the definition.
    Type(&'static str),
    Literal(Box<[u8]>),
}

/// Each component has its multiplier, or 0. Empty for `*`.
#[derive(Clone, Default, PartialEq)]
pub(crate) struct Syntax(Vec<(Component, u8)>);

impl Syntax {
    fn component(p: &mut P) -> Option<(Component, u8)> {
        let component = if delim(p, b'<') {
            let start = p.position();
            let Token::Ident(name) = *p.next_including_whitespace_and_comments().ok()? else {
                return None;
            };
            (p.slice_from(start) == name
                && matches!(
                    p.next_including_whitespace_and_comments().ok()?,
                    Token::Delim(0x3e)
                ))
            .then_some(())?;
            Component::Type(definition(text(&[b"<@", name, b">"].concat()))?.name)
        } else {
            Component::Literal(ident(p).filter(|it| !is_reserved(it))?.into())
        };
        let multiplier = attempt(p, |p| {
            match *p.next_including_whitespace_and_comments().ok()? {
                Token::Delim(it @ (0x2b | 0x23)) => Some(it as u8),
                _ => None,
            }
        });
        (multiplier.is_none() || component != Component::Type("<@transform-list>"))
            .then(|| (component, multiplier.unwrap_or(0)))
    }

    fn parse(p: &mut P) -> Option<Syntax> {
        if delim(p, b'*') {
            return Some(Syntax::default());
        }
        let mut all = vec![Syntax::component(p)?];
        while delim(p, b'|') {
            all.push(Syntax::component(p)?);
        }
        Some(Syntax(all))
    }

    /// As in the prelude of `@function`.
    fn parse_type(p: &mut P) -> Option<Syntax> {
        match attempt(p, |p| p.expect_function_matching(b"type").ok()) {
            Some(()) => nested(p, Syntax::parse),
            None => attempt(p, Syntax::component).map(|it| Syntax(vec![it])),
        }
    }

    pub(crate) fn write(&self, out: &mut Out) {
        if self.0.is_empty() {
            out.push(b'*');
        }
        write_list(&self.0, " | ", out, |(component, multiplier), out| {
            match component {
                Component::Type(name) => out.extend(name.bytes().filter(|it| *it != b'@')),
                Component::Literal(name) => write_ident(name, out),
            }
            out.extend(Some(*multiplier).filter(|it| *it != 0));
        });
    }

    fn write_type(&self, out: &mut Out) {
        out.extend_from_slice(if self.0.len() > 1 { b"type(" } else { b"" });
        self.write(out);
        out.extend_from_slice(if self.0.len() > 1 { b")" } else { b"" });
    }

    /// The component that matches, and the value.
    fn matching(&self, value: &[u8], mode: Mode) -> Option<(&(Component, u8), Out)> {
        self.0.iter().find_map(|it| {
            let one = |p: &mut P| match &it.0 {
                Component::Type(name) => definition(name)?.write_from(p, mode),
                Component::Literal(name) => ident(p).filter(|it| **it == **name).map(|it| {
                    let mut out = Out::new();
                    write_ident(it, &mut out);
                    out
                }),
            };
            let written = parse_all(value, |p| match it.1 {
                b'#' => Some(commas(p, one)?.join(&b", "[..])),
                b'+' => (!value.is_empty()).then_some(
                    core::iter::from_fn(|| one(p))
                        .collect::<Vec<_>>()
                        .join(&b' '),
                ),
                _ => one(p),
            });
            written.map(|written| (it, written))
        })
    }

    pub(crate) fn component_for(&self, value: &[u8]) -> Out {
        self.matching(value, Mode::Check).map_or(Out::new(), |it| {
            let mut out = Out::new();
            Syntax(vec![it.0.clone()]).write(&mut out);
            out
        })
    }

    pub(crate) fn compute(&self, value: &Text, cx: &Ctx) -> Option<Text> {
        if self.0.is_empty() {
            return Some(Rc::clone(value));
        }
        let (computed, is_tainted) = (
            self.matching(value, Mode::Computed(cx))?.1,
            value.ends_with(TAINT),
        );
        (!is_tainted || !has_tainted_url(&computed, core::slice::from_ref(&(0..computed.len()))))
            .then(|| tainted_if(is_tainted, &computed))
    }
}

#[derive(PartialEq)]
pub(crate) struct Registered {
    pub(crate) syntax: Syntax,
    pub(crate) inherits: bool,
    pub(crate) initial: Option<Text>,
    /// The initial value, if it depends on that.
    of_viewport: Option<Text>,
}

impl Registered {
    pub(crate) fn parse(
        syntax: &[u8],
        inherits: bool,
        initial: Option<&[u8]>,
        base_url: &[u8],
    ) -> Option<Registered> {
        (!bun_core::strings::contains(syntax, b"/*")).then_some(())?;
        let (syntax, cx) = (
            parse_all(syntax, Syntax::parse)?,
            Ctx {
                base_url,
                ..Ctx::dummy()
            },
        );
        let (source, initial) = (
            initial,
            initial.map(|it| Declared::custom(crate::scan::trim(it))),
        );
        let initial = match initial {
            Some(Some(Declared::Text(initial))) => Some(syntax.compute(&initial, &cx)?),
            Some(_) => return None,
            None => syntax.0.is_empty().then_some(None)?,
        };
        let is_independent = !cx
            .deps
            .get()
            .intersects(Deps::ROOT | Deps::FONT_UNITS | Deps::CONTAINER | Deps::SIBLINGS);
        let of_viewport = source
            .filter(|_| cx.deps.get().contains(Deps::VIEWPORT))
            .map(Into::into);
        is_independent.then_some(Registered {
            syntax,
            inherits,
            initial,
            of_viewport,
        })
    }

    pub(crate) fn in_viewport(self: Rc<Self>, viewport: [f32; 2]) -> Rc<Registered> {
        let Some(source) = &self.of_viewport else {
            return self;
        };
        let initial = self.syntax.compute(
            source,
            &Ctx {
                viewport,
                ..Ctx::dummy()
            },
        );
        Rc::new(Registered {
            syntax: self.syntax.clone(),
            initial,
            of_viewport: Some(Rc::clone(source)),
            ..*self
        })
    }

    pub(crate) fn depends_on_viewport(&self) -> bool {
        self.of_viewport.is_some()
    }

    /// From the block of `@property`.
    pub(crate) fn from_rule(body: &[u8], base_url: &[u8]) -> Option<Registered> {
        let (mut syntax, mut inherits, mut initial) = (None, None, None);
        crate::sheet::visit_declarations(body, |name, value, important| match () {
            () if important => {}
            () if eq(name, "syntax") => {
                let valid = parse_all(value, |p| {
                    string(p)
                        .filter(|it| parse_all(it, Syntax::parse).is_some())
                        .map(<[u8]>::to_vec)
                });
                syntax = valid.or_else(|| syntax.take());
            }
            () if eq(name, "inherits") && (eq(value, "true") || eq(value, "false")) => {
                inherits = Some(eq(value, "true"))
            }
            () if eq(name, "initial-value") => initial = Some(value.to_vec()),
            () => {}
        });
        Registered::parse(&syntax?, inherits?, initial.as_deref(), base_url)
    }

    pub(crate) fn interpolates(&self) -> bool {
        !self.syntax.0.is_empty()
    }

    /// Of two computed values.
    pub(crate) fn lerp(&self, from: &[u8], to: &[u8], t: Mixing) -> Option<Text> {
        if from.ends_with(TAINT) || to.ends_with(TAINT) {
            return Some(tainted_if(
                true,
                &self.lerp(untainted(from), untainted(to), t)?,
            ));
        }
        let (kind, other) = (
            self.syntax.matching(from, Mode::Check)?.0,
            self.syntax.matching(to, Mode::Check)?.0,
        );
        let (Component::Type(name), multiplier) = (kind == other).then_some(kind)? else {
            return None;
        };
        let one = |from: &[u8], to: &[u8]| {
            if !name.starts_with("<@transform") {
                return definition(name)?.lerp(from, to, t);
            }
            let (parse, mut out) = (
                |source| parse_all(source, |p| Transforms::parse(p, &Ctx::dummy())),
                Out::new(),
            );
            let how = if *name == "<@transform-function>" && t == Mixing::Add {
                Mixing::Accumulate
            } else {
                t
            };
            parse(from)?.lerp(&parse(to)?, how)?.write(&mut out);
            Some(out)
        };
        let (split, separator): (fn(&[u8]) -> Vec<&[u8]>, &[u8]) = match multiplier {
            0 => return one(from, to).map(Into::into),
            b'#' => (split_list, b", "),
            _ => (words, b" "),
        };
        let (from, to) = (split(from), split(to));
        (from.len() == to.len()).then_some(())?;
        Some(
            from.iter()
                .zip(to)
                .map(|(a, b)| one(a, b))
                .collect::<Option<Vec<_>>>()?
                .join(separator)
                .into(),
        )
    }
}

// ───────────────────────────── functions ─────────────────────────────

pub(crate) struct Parameter {
    pub(crate) name: Box<[u8]>,
    pub(crate) syntax: Syntax,
    pub(crate) default: Option<(Text, Declared)>,
}

pub(crate) struct Signature {
    pub(crate) parameters: Vec<Parameter>,
    pub(crate) returns: Syntax,
}

impl Signature {
    pub(crate) fn parse(prelude: &[u8]) -> Option<Signature> {
        let parameter = |source: &[u8]| {
            let (name, syntax, rest) = with_parser(source, |p| {
                let name = ident(p).filter(|it| it.starts_with(b"--"))?.into();
                let before = p.position();
                let syntax = Syntax::parse_type(p)
                    .or_else(|| (p.position() == before).then(Syntax::default))?;
                Some((
                    name,
                    syntax,
                    if p.is_exhausted() {
                        None
                    } else {
                        Some(p.expect_colon().ok().map(|()| p.position())?)
                    },
                ))
            })?;
            let default = match rest.map(|at| crate::scan::trim(&source[at..])) {
                Some(value) => Some((Text::from(value), Declared::custom(value)?)),
                None => None,
            };
            let is_valid = !matches!(&default, Some((value, Declared::Text(_))) if syntax.compute(value, &Ctx::dummy()).is_none());
            is_valid.then_some(Parameter {
                name,
                syntax,
                default,
            })
        };
        parse_all(prelude, |p| {
            function(p)?;
            let list = nested(p, |p| Some(Raw::parse(p, &Ctx::dummy())))?;
            let parameters = list
                .iter()
                .flat_map(|it| split_list(it.0.as_bytes()))
                .map(parameter)
                .collect::<Option<_>>()?;
            Some(Signature {
                parameters,
                returns: if keyword(p, "returns") {
                    Syntax::parse_type(p)?
                } else {
                    Syntax::default()
                },
            })
        })
    }

    /// What follows the name.
    pub(crate) fn write(&self, out: &mut Out) {
        out.push(b'(');
        write_list(&self.parameters, ", ", out, |it, out| {
            write_ident(&it.name, out);
            if !it.syntax.0.is_empty() {
                out.push(b' ');
                it.syntax.write_type(out);
            }
            out.extend(it.default.iter().flat_map(|it| [b": ", &it.0[..]].concat()));
        });
        out.push(b')');
        if !self.returns.0.is_empty() {
            out.extend_from_slice(b" returns ");
            self.returns.write_type(out);
        }
    }
}

enum Guard {
    Media(Condition),
    Container(ContainerQuery),
}

pub(crate) struct Function {
    signature: Signature,
    /// The local variables, and `result` as `Name::NONE`, with the rules that they are in.
    body: Vec<(Name, Declared, Vec<Rc<Guard>>)>,
    base_url: Rc<[u8]>,
}

impl Function {
    pub(crate) fn parse(prelude: &[u8], body: &[u8], base_url: &Rc<[u8]>) -> Option<Function> {
        let mut function = Function {
            signature: Signature::parse(prelude)?,
            body: Vec::new(),
            base_url: Rc::clone(base_url),
        };
        function.add(body, &[]);
        Some(function)
    }

    fn add(&mut self, source: &[u8], guards: &[Rc<Guard>]) {
        let mut at = 0;
        loop {
            match scan::next_item(source, at) {
                Next::End(_) => return,
                Next::Statement { start, end } => {
                    at = end;
                    crate::sheet::visit_declarations(
                        &source[start..end],
                        |name, value, important| {
                            let name = if eq(name, "result") {
                                Some(Name::NONE)
                            } else {
                                name.starts_with(b"--").then(|| Name::new(name))
                            };
                            let declared = name.zip(Declared::custom(value)).filter(|_| !important);
                            self.body.extend(
                                declared.map(|(name, value)| (name, value, guards.to_vec())),
                            );
                        },
                    );
                }
                Next::Block { start, brace } => {
                    let end = scan::end_of_block(source, brace).0;
                    at = end + 1;
                    let guard = match crate::sheet::at_rule(&source[start..brace]) {
                        (name, rest) if name == b"media" => {
                            Some(Guard::Media(condition::media_list(rest).0))
                        }
                        (name, rest) if name == b"supports" => Some(Guard::Media(
                            Condition::Constant(condition::supports(rest, Default::default())),
                        )),
                        (name, rest) if name == b"container" => condition::container_list(rest)
                            .map(|it| Guard::Container(ContainerQuery::new(it, None))),
                        _ => None,
                    };
                    if let Some(guard) = guard.filter(|_| guards.len() < 32) {
                        self.add(
                            &source[brace + 1..end],
                            &[guards, &[Rc::new(guard)]].concat(),
                        );
                    }
                }
            }
        }
    }
}

/// A call that is being evaluated.
struct Frame<'a> {
    caller: &'a mut dyn Lookup,
    function: &'a Rc<Function>,
    scope: NodeId,
    arguments: Vec<(Name, Option<Text>)>,
    /// `None` until it is known.
    locals: Vec<(Name, &'a Declared, Option<Option<Text>>)>,
}

impl Frame<'_> {
    fn argument(&self, name: Name) -> Option<Option<Text>> {
        self.arguments
            .iter()
            .rfind(|it| it.0 == name)
            .map(|it| it.1.clone())
    }

    fn resolve(&mut self, name: Name, value: &Declared) -> Option<Text> {
        let value = match value {
            Declared::Wide(wide) => Err(*wide),
            Declared::Text(text) => Ok(Rc::clone(text)),
            Declared::Template(template) => template
                .value(self)
                .map(|it| Wide::of(&it).map_or(Ok(it), Err))?,
        };
        match value {
            Ok(value) => Some(value),
            Err(wide) if name == Name::NONE => Some(wide.name().as_bytes().into()),
            Err(Wide::Initial) => self.argument(name)?,
            Err(Wide::Inherit) => self.caller.var(name),
            Err(_) => None,
        }
    }

    fn compute(&self, syntax: &Syntax, value: &Text) -> Option<Text> {
        self.caller.compute(syntax, value, &self.function.base_url)
    }
}

impl Lookup for Frame<'_> {
    fn var(&mut self, name: Name) -> Option<Text> {
        let Some(index) = self.locals.iter().position(|it| it.0 == name) else {
            return self.argument(name).unwrap_or_else(|| self.caller.var(name));
        };
        if let Some(known) = &self.locals[index].2 {
            return known.clone();
        }
        let (declared, key) = (
            self.locals[index].1,
            name.paired(Name::new(&self.depth().to_le_bytes())),
        );
        let value = guarded(self, key, |this| this.resolve(name, declared));
        let typed = self
            .function
            .signature
            .parameters
            .iter()
            .find(|it| Name::new(&it.name) == name);
        let value = value.and_then(|it| {
            typed.map_or_else(
                || Some(Rc::clone(&it)),
                |typed| self.compute(&typed.syntax, &it),
            )
        });
        self.locals[index].2 = Some(value.clone());
        value
    }
    fn env(&self, name: Name, indices: &[i32]) -> Option<Out> {
        self.caller.env(name, indices)
    }
    fn attr(&self, name: &[u8]) -> Option<Str> {
        self.caller.attr(name)
    }
    fn stack(&mut self) -> &mut Stack {
        self.caller.stack()
    }
    fn compute(&self, syntax: &Syntax, value: &Text, base_url: &[u8]) -> Option<Text> {
        self.caller.compute(syntax, value, base_url)
    }
    fn syntax_of(&self, name: Name) -> Option<Syntax> {
        match self
            .function
            .signature
            .parameters
            .iter()
            .find(|it| Name::new(&it.name) == name)
        {
            Some(parameter) => Some(parameter.syntax.clone()),
            None if self.locals.iter().any(|it| it.0 == name) => None,
            None => self.caller.syntax_of(name),
        }
    }
    fn wide(&mut self, name: Name, wide: Wide) -> Option<Text> {
        self.resolve(name, &Declared::Wide(wide))
    }
    fn initial(&mut self, name: Name) -> Option<Text> {
        if self.argument(name).is_some() || self.locals.iter().any(|it| it.0 == name) {
            None
        } else {
            self.caller.initial(name)
        }
    }
    fn matches_media(&self, condition: &Condition) -> bool {
        self.caller.matches_media(condition)
    }
    fn matches_container(&self, query: &ContainerQuery) -> bool {
        self.caller.matches_container(query)
    }
    fn function(&self, name: &str, scope: Option<NodeId>) -> Option<(Rc<Function>, NodeId)> {
        self.caller.function(name, scope.or(Some(self.scope)))
    }
    fn number(&self, value: &Node) -> f64 {
        self.caller.number(value)
    }
    fn depth(&self) -> usize {
        self.caller.depth() + 1
    }
}

fn call(lookup: &mut dyn Lookup, name: &str, arguments: &[Template]) -> Option<Text> {
    let (function, scope) = lookup.function(name, None)?;
    let parameters = &function.signature.parameters;
    let given: Vec<_> = arguments.iter().map(|it| it.value(lookup)).collect();
    (given.len() <= parameters.len()
        && parameters[given.len()..]
            .iter()
            .all(|it| it.default.is_some()))
    .then_some(())?;
    let key = Name::new(&Rc::as_ptr(&function).addr().to_le_bytes()).salted(10);
    guarded(lookup, key, |caller| {
        let arguments = parameters
            .iter()
            .map(|it| (Name::new(&it.name), None))
            .collect();
        let mut frame = Frame {
            caller,
            function: &function,
            scope,
            arguments,
            locals: Vec::new(),
        };
        for (index, it) in parameters.iter().enumerate() {
            let name = Name::new(&it.name);
            let value = given
                .get(index)
                .cloned()
                .flatten()
                .and_then(|value| frame.compute(&it.syntax, &value));
            let value = value.or_else(|| {
                frame
                    .resolve(name, &it.default.as_ref()?.1)
                    .and_then(|value| frame.compute(&it.syntax, &value))
            });
            frame.arguments[index].1 = value;
        }
        for (name, value, guards) in function.body.iter().rev() {
            let holds = |guard: &Rc<Guard>| match &**guard {
                Guard::Media(condition) => frame.caller.matches_media(condition),
                Guard::Container(query) => frame.caller.matches_container(query),
            };
            if guards.iter().filter(|it| !holds(it)).count() == 0
                && !frame.locals.iter().any(|it| it.0 == *name)
            {
                frame.locals.push((*name, value, None));
            }
        }
        let names: Vec<_> = frame.locals.iter().map(|it| it.0).collect();
        for name in names {
            drop(frame.var(name));
        }
        let result = frame
            .locals
            .iter()
            .find(|it| it.0 == Name::NONE)?
            .2
            .clone()??;
        frame.compute(&function.signature.returns, &result)
    })
}

// ───────────────────────────── substitution ─────────────────────────────

enum AttrType {
    String,
    Unit(Box<[u8]>),
    Syntax(Syntax),
}

enum Part {
    Text(Box<[u8]>),
    Var(Name, Option<Template>),
    Env(Name, Vec<i32>, Option<Template>),
    /// Whether it has a type.
    Attr(Box<[u8]>, AttrType, bool, Option<Template>),
    If(Vec<(Condition, Template)>),
    Call(Str, Vec<Template>),
}

pub(crate) struct Template(Vec<Part>);

/// What is being resolved, and from where on it is in a cycle.
#[derive(Default)]
pub(crate) struct Stack {
    keys: smallvec::SmallVec<[Name; 8]>,
    cycle: Option<usize>,
    /// Where the cycle starts that what has last been resolved is in, if that is still being resolved.
    pub(crate) open_cycle: Option<Name>,
    has_queried_tainted: bool,
    /// Since the first of `keys`.
    resolved: u32,
}

impl Stack {
    pub(crate) fn keys(&self) -> &[Name] {
        &self.keys
    }

    /// Whether `key` is being resolved, which makes a cycle.
    pub(crate) fn reaches(&mut self, key: Name) -> bool {
        let at = self.keys.iter().position(|it| *it == key);
        self.cycle = self.cycle.into_iter().chain(at).min();
        at.is_some()
    }
}

/// `None` if what `key` stands for depends on itself.
pub(crate) fn guarded<L: Lookup + ?Sized>(
    lookup: &mut L,
    key: Name,
    resolve: impl FnOnce(&mut L) -> Option<Text>,
) -> Option<Text> {
    let outer = enter(lookup.stack(), key)?;
    let value = resolve(lookup);
    let is_in_cycle = leave(lookup.stack(), outer.0);
    value.filter(|_| !is_in_cycle)
}

struct OuterCycle(Option<usize>);

fn enter(stack: &mut Stack, key: Name) -> Option<OuterCycle> {
    let depth = stack.keys.len();
    stack.resolved = if depth == 0 {
        0
    } else {
        stack.resolved.saturating_add(1)
    };
    if let Some(at) = stack
        .keys
        .iter()
        .position(|it| *it == key)
        .or_else(|| (depth > 256 || stack.resolved > 1 << 14).then_some(0))
    {
        (stack.cycle, stack.open_cycle) = (
            Some(stack.cycle.map_or(at, |it| it.min(at))),
            stack.keys.get(at).copied(),
        );
        return None;
    }
    stack.keys.push(key);
    Some(OuterCycle(stack.cycle.take()))
}

/// Whether the key that is left depends on itself.
fn leave(stack: &mut Stack, outer: Option<usize>) -> bool {
    stack.keys.pop();
    let depth = stack.keys.len();
    let cycle = stack.cycle.filter(|it| *it <= depth);
    stack.open_cycle = cycle.and_then(|it| stack.keys.get(it).copied());
    stack.cycle = outer
        .into_iter()
        .chain(cycle.filter(|it| *it < depth))
        .min();
    cycle.is_some()
}

pub(crate) trait Lookup {
    fn var(&mut self, name: Name) -> Option<Text>;
    fn env(&self, name: Name, indices: &[i32]) -> Option<Out>;
    fn attr(&self, name: &[u8]) -> Option<Str>;
    fn stack(&mut self) -> &mut Stack;
    fn compute(&self, syntax: &Syntax, value: &Text, base_url: &[u8]) -> Option<Text>;
    fn syntax_of(&self, name: Name) -> Option<Syntax>;
    /// What the variable would be if it were set to that.
    fn wide(&mut self, name: Name, wide: Wide) -> Option<Text>;
    /// What it is if nothing sets it.
    fn initial(&mut self, name: Name) -> Option<Text> {
        self.wide(name, Wide::Initial)
    }
    fn matches_media(&self, condition: &Condition) -> bool;
    fn matches_container(&self, query: &ContainerQuery) -> bool;
    /// With the tree that defines it. It is searched for from `scope` outwards.
    fn function(&self, name: &str, scope: Option<NodeId>) -> Option<(Rc<Function>, NodeId)>;
    fn number(&self, value: &Node) -> f64;
    fn depth(&self) -> usize {
        0
    }
}

struct Queried<'a>(RefCell<&'a mut dyn Lookup>);

impl Subject for Queried<'_> {
    fn feature(&self, _: Feature) -> Option<Actual> {
        None
    }
    fn compute(&self, _: &Node) -> f64 {
        0.0
    }
    fn other(&self, condition: &Condition) -> Option<bool> {
        style_query(condition, &mut **self.0.borrow_mut(), false)
    }
}

pub(crate) fn style_query(
    condition: &Condition,
    lookup: &mut dyn Lookup,
    is_of_container: bool,
) -> Option<bool> {
    let value = |declared: &Declared, lookup: &mut dyn Lookup| match declared {
        Declared::Wide(wide) => Some(wide.name().as_bytes().into()),
        Declared::Text(text) => Some(Rc::clone(text)),
        Declared::Template(template) => template.value(lookup),
    };
    let clean = |value: Option<Text>, lookup: &mut dyn Lookup| match value {
        Some(value) if value.ends_with(TAINT) => {
            lookup.stack().has_queried_tainted = true;
            Some(untainted(&value).into())
        }
        value => value,
    };
    match condition {
        Condition::Media(query) => Some(lookup.matches_media(query)),
        Condition::Style(name, None) => {
            Some(clean(lookup.var(*name), lookup) != lookup.initial(*name))
        }
        Condition::Style(name, Some(declared)) => {
            let [actual, expected] =
                [lookup.var(*name), value(declared, lookup)].map(|it| clean(it, lookup));
            Some(
                match (
                    expected.as_deref().and_then(Wide::of),
                    lookup.syntax_of(*name),
                ) {
                    (Some(wide @ (Wide::Initial | Wide::Inherit | Wide::Unset)), _) => {
                        actual == clean(lookup.wide(*name, wide), lookup)
                    }
                    (Some(_), _) => false,
                    (None, Some(syntax)) => expected
                        .and_then(|it| lookup.compute(&syntax, &it, b""))
                        .is_some_and(|it| Some(it) == actual),
                    (None, None) => (is_of_container || expected.is_some()) && expected == actual,
                },
            )
        }
        Condition::StyleRange(operands, comparisons) => {
            const KINDS: [Kind; 7] = [
                Kind::Number,
                Kind::Length,
                Kind::Percentage,
                Kind::Angle,
                Kind::Time,
                Kind::Frequency,
                Kind::Resolution,
            ];
            let source = |it: &Result<Name, Declared>| match it {
                Ok(name) => clean(lookup.var(*name), lookup),
                Err(declared) => clean(value(declared, lookup), lookup),
            };
            let sources: Vec<_> = operands.iter().map(source).collect();
            let numbers = KINDS.iter().find_map(|kind| {
                let number = |it: &Option<Text>| {
                    parse_all(it.as_ref()?, |p| Node::parse(p, &Options::new(*kind)))
                        .map(|it| lookup.number(&it))
                };
                sources.iter().map(number).collect::<Option<Vec<_>>>()
            });
            Some(numbers.is_some_and(|it| {
                comparisons
                    .iter()
                    .enumerate()
                    .all(|(at, comparison)| comparison.holds(it[at], it[at + 1], 0.0))
            }))
        }
        _ => None,
    }
}

const MAX_SUBSTITUTED: usize = 1 << 21;

/// At the end of a value that depends on `attr()`. https://drafts.csswg.org/css-values-5/#attr-security
const TAINT: &[u8] = b"/*\0*/";

pub(crate) fn untainted(value: &[u8]) -> &[u8] {
    value.strip_suffix(TAINT).unwrap_or(value)
}

fn tainted_if(is_tainted: bool, value: &[u8]) -> Text {
    if is_tainted {
        [value, TAINT].concat().into()
    } else {
        value.into()
    }
}

pub(crate) fn has_tainted_url(source: &[u8], tainted: &[Range<usize>]) -> bool {
    fn find(p: &mut P, tainted: &[Range<usize>], takes_strings: bool, depth: u8) -> bool {
        let mut found = false;
        loop {
            p.skip_whitespace();
            let start = p.position();
            let Ok(token) = p.next().copied() else {
                return found;
            };
            let is_url = match token {
                Token::Function(name) if depth < 64 => {
                    let takes_strings = ["url", "src", "image", "image-set", "-webkit-image-set"]
                        .iter()
                        .any(|it| eq(name, it));
                    found |= nested(p, |p| Some(find(p, tainted, takes_strings, depth + 1)))
                        .unwrap_or(true);
                    false
                }
                Token::QuotedString(_) => takes_strings,
                token => matches!(token, Token::UnquotedUrl(_)),
            };
            found |= is_url
                && tainted
                    .iter()
                    .any(|it| it.start < p.position() && start < it.end);
        }
    }
    with_parser(source, |p| find(p, tainted, false, 0))
}

/// Up to one of the delimiters.
fn template(p: &mut P, depth: u8, until: Delimiters) -> Option<Template> {
    let parsed = p.parse_until_before(until, |p| {
        p.skip_whitespace();
        let (mut parts, mut start) = (Vec::new(), p.position());
        match scan(p, &mut parts, &mut start, depth, true) {
            Some(()) => {
                parts.push(Part::Text(p.slice_from(start).trim_ascii_end().into()));
                Ok(Template(parts))
            }
            None => Err(p.new_error_for_next_token()),
        }
    });
    parsed.ok()
}

fn fallback(p: &mut P, depth: u8) -> Option<Option<Template>> {
    if p.is_exhausted() {
        Some(None)
    } else {
        comma(p).then(|| template(p, depth, Delimiters::NONE).map(Some))?
    }
}

fn attr(p: &mut P, depth: u8) -> Option<Part> {
    let name = ident(p)?.into();
    let kind = if attempt(p, |p| p.expect_function_matching(b"type").ok()).is_some() {
        Some(AttrType::Syntax(nested(p, Syntax::parse).filter(|it| {
            !it.0.iter().any(|it| it.0 == Component::Type("<@url>"))
        })?))
    } else if delim(p, b'%') {
        Some(AttrType::Unit(b"%"[..].into()))
    } else {
        ident(p).map(|unit| match () {
            () if eq(unit, "raw-string") => AttrType::String,
            () => AttrType::Unit(if eq(unit, "number") {
                Box::default()
            } else {
                unit.into()
            }),
        })
    };
    let has_type = kind.is_some();
    Some(Part::Attr(
        name,
        kind.unwrap_or(AttrType::String),
        has_type,
        fallback(p, depth)?,
    ))
}

fn branches(p: &mut P, depth: u8) -> Option<Part> {
    let mut all = Vec::new();
    loop {
        let condition = condition::if_condition(p)?;
        p.expect_colon().ok()?;
        all.push((condition, template(p, depth, Delimiters::SEMICOLON)?));
        if p.next().is_err() || p.is_exhausted() {
            return Some(Part::If(all));
        }
    }
}

fn arguments(p: &mut P, depth: u8) -> Option<Vec<Template>> {
    if p.is_exhausted() {
        return Some(Vec::new());
    }
    commas(p, |p| {
        match attempt(p, |p| {
            matches!(p.next().ok()?, Token::OpenCurly).then_some(())
        }) {
            Some(()) => nested(p, |p| {
                (!p.is_exhausted()).then(|| template(p, depth, Delimiters::NONE))?
            }),
            None => {
                let state = p.state();
                let is_valid = match p.next().copied() {
                    Ok(Token::Comma) | Err(_) => false,
                    Ok(Token::Ident(name)) if name.starts_with(b"--") => p.expect_colon().is_err(),
                    Ok(_) => true,
                };
                p.reset(&state);
                template(p, depth, Delimiters::COMMA | Delimiters::CURLY_BRACKET)
                    .filter(|_| is_valid)
            }
        }
    })
}

/// `start` is where the text that is not in `parts` yet starts.
fn scan(
    p: &mut P,
    parts: &mut Vec<Part>,
    start: &mut usize,
    depth: u8,
    is_top: bool,
) -> Option<()> {
    let depth = depth.checked_add(1).filter(|it| *it < 128)?;
    loop {
        let before = p.slice_from(*start);
        let Ok(token) = p.next_including_whitespace_and_comments().copied() else {
            return Some(());
        };
        let part = match token {
            Token::Function(name) if eq(name, "var") => nested(p, |p| {
                let name = ident(p).filter(|name| name.starts_with(b"--") && name.len() > 2)?;
                Some(Part::Var(Name::new(name), fallback(p, depth)?))
            })?,
            Token::Function(name) if eq(name, "env") => nested(p, |p| {
                let name = Name::new(ident(p)?);
                let indices = core::iter::from_fn(|| {
                    attempt(p, |p| p.expect_integer().ok().filter(|it| *it >= 0))
                })
                .collect();
                Some(Part::Env(name, indices, fallback(p, depth)?))
            })?,
            Token::Function(name) if eq(name, "attr") => nested(p, |p| attr(p, depth))?,
            Token::Function(name) if eq(name, "if") => nested(p, |p| branches(p, depth))?,
            Token::Function(name) if name.starts_with(b"--") => {
                Part::Call(text(name).into(), nested(p, |p| arguments(p, depth))?)
            }
            Token::Function(_) | Token::OpenParen | Token::OpenSquare | Token::OpenCurly => {
                nested(p, |p| scan(p, parts, start, depth, false))?;
                continue;
            }
            Token::Semicolon | Token::Delim(0x21) if is_top => return None,
            token if token.is_parse_error() => return None,
            _ => continue,
        };
        if !before.is_empty() {
            parts.push(Part::Text(before.into()));
        }
        parts.push(part);
        *start = p.position();
    }
}

/// Keeps the tokens on either side apart.
fn append(out: &mut Out, text: &[u8]) {
    let is_word =
        |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | 0x80..);
    if let (Some(last), Some(first)) = (out.last(), text.first())
        && ((is_word(*last) || matches!(last, b'#' | b'@' | b'+'))
            && (is_word(*first) || matches!(first, b'%' | b'(' | b'\\'))
            || (*last, *first) == (b'/', b'*'))
    {
        out.extend_from_slice(b"/**/");
    }
    out.extend_from_slice(text);
}

impl AttrType {
    fn parse(&self, name: &[u8], value: &str, lookup: &mut dyn Lookup) -> Option<Text> {
        let mut out = Out::new();
        match self {
            AttrType::String => write_string(value.as_bytes(), &mut out),
            AttrType::Unit(unit) => {
                parse_all(value.as_bytes(), |p| p.expect_number().ok())?;
                (unit.is_empty() || **unit == *b"%" || Unit::from_name(unit).is_some())
                    .then_some(())?;
                out = [value.trim_ascii().as_bytes(), unit].concat();
            }
            AttrType::Syntax(syntax) => {
                let value =
                    guarded(
                        lookup,
                        Name::new(name).salted(9),
                        |lookup| match Template::parse(value.as_bytes(), true).ok()? {
                            Some(template) => template.value(lookup),
                            None => Some(scan::trim(value.as_bytes()).into()),
                        },
                    )?;
                return if syntax.0.is_empty() {
                    Some(value)
                } else {
                    Some(syntax.matching(&value, Mode::Specified)?.1.into())
                };
            }
        }
        Some(out.into())
    }
}

impl Template {
    /// `Ok(None)` if there is nothing to substitute.
    pub(crate) fn parse(source: &[u8], is_custom: bool) -> Result<Option<Template>, ()> {
        if bun_core::strings::index_of_any(source, if is_custom { b"()[]{}!;\"'" } else { b"(" })
            .is_none()
        {
            return Ok(None);
        }
        let (mut parts, mut start) = (Vec::new(), 0);
        with_parser(source, |p| scan(p, &mut parts, &mut start, 0, true)).ok_or(())?;
        if parts.is_empty() {
            return Ok(None);
        }
        if !is_custom
            && bun_core::strings::contains_char(source, b'{')
            && words(source)
                .iter()
                .any(|it| it.starts_with(b"{") && *it != source)
        {
            return Err(());
        }
        if start < source.len() {
            parts.push(Part::Text(source[start..].into()));
        }
        Ok(Some(Template(parts)))
    }

    /// If it is nothing but `var()` without a fallback.
    pub(crate) fn alias(&self) -> Option<Name> {
        match self.0[..] {
            [Part::Var(name, None)] => Some(name),
            _ => None,
        }
    }

    /// Whether it may read others, too.
    pub(crate) fn references(&self, names: &mut Vec<Name>) -> bool {
        self.0.iter().fold(false, |reads_any, part| {
            if let Part::Var(name, _) = part {
                names.push(*name);
            }
            let in_fallback = match part {
                Part::Var(_, Some(it)) | Part::Env(.., Some(it)) | Part::Attr(.., Some(it)) => {
                    it.references(names)
                }
                _ => false,
            };
            reads_any
                || in_fallback
                || matches!(
                    part,
                    Part::If(_) | Part::Call(..) | Part::Attr(_, AttrType::Syntax(_), ..)
                )
        })
    }

    pub(crate) fn value(&self, lookup: &mut dyn Lookup) -> Option<Text> {
        if let Some(name) = self.alias() {
            return lookup.var(name);
        }
        let mut out = Out::with_capacity(64);
        let mut tainted = Vec::new();
        self.substitute(lookup, &mut out, &mut tainted)
            .map(|()| tainted_if(!tainted.is_empty(), out.trim_ascii()))
    }

    /// `None` if the result is invalid.
    pub(crate) fn substitute(
        &self,
        lookup: &mut dyn Lookup,
        out: &mut Out,
        tainted: &mut Vec<Range<usize>>,
    ) -> Option<()> {
        let mut is_valid = true;
        for part in &self.0 {
            let (start, known, mut is_tainted) = (out.len(), tainted.len(), false);
            let (value, fallback) = match part {
                Part::Text(text) => {
                    append(out, text);
                    continue;
                }
                Part::Var(name, fallback) => (lookup.var(*name), fallback.as_ref()),
                Part::Env(name, indices, fallback) => (
                    lookup.env(*name, indices).map(Into::into),
                    fallback.as_ref(),
                ),
                Part::Attr(name, kind, has_type, fallback) => match lookup.attr(name) {
                    Some(value) => (
                        kind.parse(name, &value, lookup)
                            .inspect(|_| is_tainted = true),
                        fallback.as_ref(),
                    ),
                    None => (
                        (!has_type && fallback.is_none()).then(|| b"\"\""[..].into()),
                        fallback.as_ref(),
                    ),
                },
                Part::Call(name, arguments) => (call(lookup, name, arguments), None),
                Part::If(branches) => {
                    let outer = core::mem::take(&mut lookup.stack().has_queried_tainted);
                    let found = branches.iter().find(|it| {
                        it.0.evaluate(&Queried(RefCell::new(&mut *lookup))) == Some(true)
                    });
                    is_tainted = core::mem::replace(&mut lookup.stack().has_queried_tainted, outer);
                    (found.is_none().then(Text::default), found.map(|it| &it.1))
                }
            };
            match value {
                Some(value) => {
                    is_tainted |= value.ends_with(TAINT);
                    append(out, untainted(&value));
                }
                None => {
                    is_valid &= lookup.stack().cycle.is_none()
                        && fallback.is_some_and(|it| it.substitute(lookup, out, tainted).is_some())
                }
            }
            if is_tainted || tainted.len() > known {
                tainted.push(start..out.len());
            }
            (out.len() <= MAX_SUBSTITUTED).then_some(())?;
        }
        is_valid.then_some(())
    }
}
