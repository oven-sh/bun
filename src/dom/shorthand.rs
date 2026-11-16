//! Splits the value of a shorthand into those of its longhands, and joins them again.

use std::borrow::Cow;
use std::sync::{LazyLock, OnceLock};

use bun_core::strings;

use crate::grammar::{self, Captured, Definition, Term, Writer, definition, split_list};
use crate::hooks::words;
use crate::properties::{Id, Prop};
use crate::values::*;

pub(crate) type Part<'a> = Cow<'a, [u8]>;
/// `None` is the initial value.
type Parts<'a> = Vec<Option<Part<'a>>>;

enum Omitted {
    Initial,
    Text(&'static str),
    Same(usize),
    Special,
}

struct Longhand {
    prop: Prop,
    omitted: Omitted,
    is_list: bool,
}

pub(crate) struct Shorthand {
    definition: &'static Definition,
    longhands: Vec<Longhand>,
    ids: [Box<[Id]>; Flow::COUNT],
}

static ALL: LazyLock<Vec<&'static Definition>> = LazyLock::new(|| {
    grammar::definitions()
        .iter()
        .filter(|it| it.is_shorthand())
        .collect()
});

pub(crate) fn definitions() -> &'static [&'static Definition] {
    &ALL
}

pub(crate) fn get(index: u8) -> &'static Shorthand {
    static COMPILED: LazyLock<Vec<OnceLock<Shorthand>>> =
        LazyLock::new(|| ALL.iter().map(|_| OnceLock::new()).collect());
    COMPILED[usize::from(index)].get_or_init(|| Shorthand::new(ALL[usize::from(index)]))
}

fn named(name: &str) -> Option<&'static Shorthand> {
    if let Prop::Short(index) = Prop::from_name(name.as_bytes())? {
        Some(get(index))
    } else {
        None
    }
}

fn initial_source(prop: Prop) -> &'static [u8] {
    prop.id(Flow::DEFAULT)
        .map_or("", Id::initial_source)
        .as_bytes()
}

fn is_custom_ident(source: &[u8]) -> bool {
    parse_all(source, |p| ident(p).map(|it| !eq(it, "auto"))) == Some(true)
}

/// The one to four values that stand for these.
fn collapsed<'a>(mut all: &'a [&'a [u8]]) -> Out {
    while all.len() > 1 && all[all.len() - 1] == all[(all.len() - 1).saturating_sub(2)] {
        all = &all[..all.len() - 1];
    }
    all.join(&b' ')
}

fn side<T: Clone>(all: &[T], index: usize) -> T {
    all.get(index)
        .unwrap_or_else(|| &all[usize::from(index == 3 && all.len() > 1)])
        .clone()
}

/// The count and the items of `repeat()`.
fn repeated(item: &[u8]) -> Option<(&[u8], Vec<&[u8]>)> {
    let inner = item
        .get(7..item.len().checked_sub(1)?)
        .filter(|_| eq(&item[..7], "repeat("))?;
    let mut items = split_list(inner);
    Some((items.remove(0), items))
}

impl Shorthand {
    fn new(definition: &'static Definition) -> Shorthand {
        let notes: Vec<_> = (definition.notes.split_ascii_whitespace())
            .map(|it| strings::split_once_char(it.as_bytes(), b'=').unwrap_or((it.as_bytes(), b"")))
            .collect();
        let longhands: Vec<_> = (notes.iter())
            .filter_map(|(name, omitted)| {
                Some(Longhand {
                    prop: Prop::from_name(name.strip_suffix(b"!").unwrap_or(name))?,
                    is_list: !name.ends_with(b"!"),
                    omitted: match (*omitted, notes[1..].iter().position(|it| it.0 == *omitted)) {
                        (b"", _) => Omitted::Initial,
                        (b"?", _) => Omitted::Special,
                        (_, Some(index)) => Omitted::Same(index),
                        (value, None) => Omitted::Text(text(value)),
                    },
                })
            })
            .collect();
        let ids = core::array::from_fn(|flow| {
            longhands
                .iter()
                .filter_map(|it| it.prop.id(Flow(flow as u8)))
                .collect()
        });
        Shorthand {
            definition,
            longhands,
            ids,
        }
    }

    pub(crate) fn ids(&self, flow: Flow) -> &[Id] {
        &self.ids[flow.index()]
    }

    pub(crate) fn longhands(&self) -> impl Iterator<Item = Prop> {
        self.longhands.iter().map(|it| it.prop)
    }

    fn index(&self, prop: Prop) -> Option<usize> {
        self.longhands().position(|it| it == prop)
    }

    /// One after the other, or in any order.
    fn each<'a>(&self, source: &'a [u8], is_ordered: bool) -> Option<Parts<'a>> {
        parse_all(source, |p| {
            let mut parts: Parts = vec![None; self.longhands.len()];
            while let Some(found) = (self.ids[0].iter().enumerate())
                .filter(|it| parts[it.0].is_none())
                .take(if is_ordered { 1 } else { usize::MAX })
                .find_map(|(index, id)| {
                    p.skip_whitespace();
                    let start = p.position();
                    id.syntax()
                        .write_from(p, grammar::Mode::Check)
                        .map(|_| (index, start..p.position()))
                })
            {
                parts[found.0] = Some(source[found.1].into());
            }
            parts.iter().any(Option::is_some).then_some(parts)
        })
    }

    pub(crate) fn expand<'a>(&self, source: &'a [u8]) -> Option<Parts<'a>> {
        let (name, syntax, count) = (
            self.definition.name,
            self.definition.source(),
            self.longhands.len(),
        );
        match syntax {
            "any" => return self.each(source, false),
            "all" => {
                return self.ids[0][0]
                    .syntax()
                    .accepts(source)
                    .then(|| vec![Some(source.into()); count]);
            }
            "sides" => {
                let given: Vec<_> = self.each(source, true)?.into_iter().flatten().collect();
                let parts: Parts = (0..count).map(|index| Some(side(&given, index))).collect();
                return (self.ids[0][count - 1]
                    .syntax()
                    .accepts(parts[count - 1].as_ref()?))
                .then_some(parts);
            }
            _ if let Some(half) = syntax.strip_prefix("both ") => {
                return named(half)?
                    .expand(source)
                    .map(|it| [it.clone(), it].concat());
            }
            _ => {}
        }
        let captured = self.definition.capture(source)?;
        if name.ends_with("border-radius") {
            let words = words(source);
            let (x, y) = match words.iter().position(|it| *it == b"/") {
                Some(at) => (&words[..at], &words[at + 1..]),
                None if name.starts_with('-') && words.len() == 2 => words.split_at(1),
                None => (&words[..], &words[..]),
            };
            return Some(
                (0..4)
                    .map(|index| Some([side(x, index), b" ", side(y, index)].concat().into()))
                    .collect(),
            );
        }
        if syntax == "<rules>" {
            let (rule, mut lists) = (named("border-top")?, [const { Vec::new() }; 3]);
            let of = |item, index: usize| {
                Some(
                    rule.expand(item)?[index]
                        .clone()
                        .unwrap_or_else(|| initial_source(self.longhands[index].prop).into()),
                )
            };
            for item in split_list(source) {
                for (index, list) in lists.iter_mut().enumerate() {
                    list.push(match repeated(item) {
                        Some((count, items)) => {
                            let items = items
                                .into_iter()
                                .map(|it| of(it, index))
                                .collect::<Option<Vec<_>>>()?;
                            [b"repeat(", count, b", ", &items.join(&b", "[..]), b")"]
                                .concat()
                                .into()
                        }
                        None => of(item, index)?,
                    });
                }
            }
            return Some(
                lists
                    .into_iter()
                    .map(|it| Some(it.join(&b", "[..]).into()))
                    .collect(),
            );
        }
        let is_layer = |it: &Captured| matches!(it, Captured::Layer);
        let Some(captured) = captured
            .split_first()
            .filter(|it| is_layer(it.0))
            .map(|it| it.1)
        else {
            return self.layer(source, &captured);
        };
        let mut layers: Vec<_> = captured
            .split_inclusive(is_layer)
            .map(|it| self.layer(source, it))
            .collect::<Option<_>>()?;
        let last = layers.pop()?;
        if layers.is_empty() {
            return Some(last);
        }
        let join = |(index, (it, last)): (usize, (&Longhand, Option<Part<'a>>))| {
            if !it.is_list {
                return layers.iter().all(|it| it[index].is_none()).then_some(last);
            }
            let items = layers.iter().map(|it| &it[index]).chain([&last]);
            let list = items
                .map(|item| item.as_deref().unwrap_or_else(|| initial_source(it.prop)))
                .collect::<Vec<_>>()
                .join(&b", "[..]);
            it.prop.accepts(&list).then(|| Some(list.into()))
        };
        self.longhands
            .iter()
            .zip(last)
            .enumerate()
            .map(join)
            .collect()
    }

    fn layer<'a>(&self, source: &'a [u8], captured: &[Captured]) -> Option<Parts<'a>> {
        let mut parts: Parts = vec![None; self.longhands.len()];
        for it in captured {
            let (prop, value) = match it {
                Captured::Source(prop, range) if !range.is_empty() => {
                    (prop, &source[range.clone()])
                }
                Captured::Text(prop, text) => (prop, text.as_bytes()),
                _ => continue,
            };
            match &mut parts[self.index(*prop)?] {
                Some(known) if known.ends_with(b"]") && value.starts_with(b"[") => {
                    *known = [&known[..known.len() - 1], b" ", &value[1..]]
                        .concat()
                        .into()
                }
                Some(known) => {
                    *known = [known, &b" "[..], value].concat().into();
                    (*prop != Prop::Long(Id::FontVariantAlternates) || prop.accepts(known))
                        .then_some(())?;
                }
                missing => *missing = Some(value.into()),
            }
        }
        if let Some(areas) = self
            .index(Prop::Long(Id::GridTemplateAreas))
            .and_then(|it| parts[it].as_mut())
        {
            *areas = Id::GridTemplateAreas
                .syntax()
                .write(areas, grammar::Mode::Specified)?
                .into();
        }
        for (index, it) in self.longhands.iter().enumerate() {
            if parts[index].is_none() {
                parts[index] = match it.omitted {
                    Omitted::Initial => None,
                    Omitted::Text(text) => Some(text.as_bytes().into()),
                    Omitted::Same(other) => parts[other].clone(),
                    Omitted::Special => self.omitted(index, &parts),
                };
            }
        }
        Some(parts)
    }

    fn omitted<'a>(&self, index: usize, parts: &Parts<'a>) -> Option<Part<'a>> {
        let before = || parts[index - 1].clone();
        match self.definition.name {
            "grid-area" => parts[usize::from(index == 3)]
                .clone()
                .filter(|it| is_custom_ident(it)),
            "grid-row" | "grid-column" => before().filter(|it| is_custom_ident(it)),
            "list-style" => before().filter(|it| eq(it, "none")),
            "place-content" if Id::JustifyContent.syntax().accepts(&before()?) => before(),
            "place-content" => Some(b"start".into()),
            name if name.ends_with("rule-inset") && parts[2] == parts[0] => parts[1].clone(),
            name if name.ends_with("rule-inset") => before(),
            _ => Some(words(&before()?)[0].to_vec().into()).filter(|it: &Part| {
                definition("<range-name>").is_some_and(|name| name.accepts(it))
            }),
        }
    }

    /// Empty if it cannot stand for these values. `initial` is `None` if they are as they are specified.
    pub(crate) fn join(&self, values: &[&[u8]], initial: Option<&dyn Fn(Id) -> Out>) -> Out {
        self.try_join(values, initial).unwrap_or_default()
    }

    fn try_join(&self, values: &[&[u8]], initial: Option<&dyn Fn(Id) -> Out>) -> Option<Out> {
        let (name, syntax, is_computed) = (
            self.definition.name,
            self.definition.source(),
            initial.is_some(),
        );
        let initials: Vec<Part> = (self.longhands())
            .map(|prop| {
                initial.zip(prop.id(Flow::DEFAULT)).map_or_else(
                    || initial_source(prop).into(),
                    |(initial, id)| initial(id).into(),
                )
            })
            .collect();
        let slashes = |values: &[&[u8]]| values.join(&b" / "[..]);
        match (name, syntax) {
            (_, "sides") => return Some(collapsed(values)),
            (_, "all") => {
                return values
                    .iter()
                    .all(|it| *it == values[0])
                    .then(|| values[0].to_vec());
            }
            (_, "any") => {
                let kept: Vec<_> = (values.iter().zip(&initials))
                    .filter(|it| {
                        is_computed && self.definition.has_note("cfull") || **it.0 != **it.1
                    })
                    .map(|it| *it.0)
                    .collect();
                return Some(if kept.is_empty() {
                    values[usize::from(name == "outline")].to_vec()
                } else {
                    kept.join(&b' ')
                });
            }
            _ if let Some(half) = syntax.strip_prefix("both ") => {
                let (a, b) = values.split_at(values.len() / 2);
                return (a == b).then(|| named(half)?.try_join(a, initial))?;
            }
            (_, "<rules>") => return self.join_rules(values, is_computed),
            ("border-radius" | "-webkit-border-radius", _) => {
                let radii: Vec<_> = values.iter().map(|it| words(it)).collect();
                let [x, y] = [0, 1].map(|axis| {
                    collapsed(&radii.iter().map(|it| side(it, axis)).collect::<Vec<_>>())
                });
                return Some(if x == y { x } else { slashes(&[&x, &y]) });
            }
            ("border-image" | "-webkit-mask-box-image", _)
                if values[0] == b"none"
                    && (is_computed || values.iter().zip(&initials).all(|it| **it.0 == **it.1)) =>
            {
                return Some(b"none".to_vec());
            }
            ("border-image", _) => {
                return Some([values[0], b" ", &slashes(&values[1..4]), b" ", values[4]].concat());
            }
            ("border" | "border-top" | "border-right" | "border-bottom" | "border-left", _)
                if !is_computed && values.iter().zip(&initials).all(|it| **it.0 == **it.1) =>
            {
                return None;
            }
            ("animation", _) if is_computed && values[0] == b"0s" => {
                return self.try_join(&[&[&b"auto"[..]], &values[1..]].concat(), initial);
            }
            ("grid", _) if is_computed => return Some(slashes(values)),
            ("grid", _) => return join_grid(values),
            ("grid-template", _) => return join_template(values),
            ("offset", _) if is_computed => {
                let start = usize::from(values[0] == b"normal");
                let all = values[start..4].join(&b' ');
                return Some(if values[4] == b"auto" {
                    all
                } else {
                    slashes(&[&all, values[4]])
                });
            }
            _ => {}
        }
        let Term::Repeat {
            term, commas: true, ..
        } = self.definition.term()
        else {
            return self.join_layer(self.definition.term(), values, &initials, is_computed);
        };
        let lists: Vec<_> = values.iter().map(|it| split_list(it)).collect();
        let lengths = || {
            lists
                .iter()
                .zip(&self.longhands)
                .filter(|it| it.1.is_list)
                .map(|it| it.0.len())
        };
        let count = if matches!(name, "background" | "mask") && is_computed {
            lists[0].len()
        } else {
            lengths().max()?
        };
        (is_computed
            || lengths().all(|it| it == count)
            || matches!(
                name,
                "background" | "mask" | "background-position" | "mask-position"
            ))
        .then_some(())?;
        let layers = (0..count).map(|layer| {
            let values: Vec<&[u8]> = (lists.iter().enumerate())
                .map(|(index, list)| match self.longhands[index].is_list {
                    true if is_computed || list.len() > layer => list[layer % list.len()],
                    false if layer + 1 == count => values[index],
                    _ => &initials[index],
                })
                .collect();
            match name {
                "background-position" | "mask-position" => Some(values.join(&b' ')),
                "background" if is_computed => {
                    let color = if layer + 1 == count {
                        [values[8], b" "].concat()
                    } else {
                        Out::new()
                    };
                    Some(
                        [
                            color,
                            [0, 4, 5, 1, 2].map(|it| values[it]).join(&b' '),
                            b" / ".to_vec(),
                            [3, 6, 7].map(|it| values[it]).join(&b' '),
                        ]
                        .concat(),
                    )
                }
                _ => self.join_layer(term, &values, &initials, is_computed),
            }
        });
        Some(layers.collect::<Option<Vec<_>>>()?.join(&b", "[..]))
    }

    /// The shortest value that `expand` makes these values of.
    fn join_layer(
        &self,
        term: &Term,
        values: &[&[u8]],
        initials: &[Part],
        is_computed: bool,
    ) -> Option<Out> {
        let of = |prop| self.index(prop).map(|it| values[it]);
        let value = |prop| match prop {
            Prop::Short(index) => get(index).try_join(
                &get(index).longhands().map(of).collect::<Option<Vec<_>>>()?,
                None,
            ),
            Prop::Long(Id::FontStretch) if is_computed => {
                const NAMES: &str = "50% ultra-condensed 62.5% extra-condensed 75% condensed 87.5% semi-condensed 100% normal \
                    112.5% semi-expanded 125% expanded 150% extra-expanded 200% ultra-expanded";
                NAMES
                    .split_ascii_whitespace()
                    .skip_while(|it| Some(it.as_bytes()) != of(prop))
                    .nth(1)
                    .map(Into::into)
            }
            prop => of(prop).map(<[u8]>::to_vec),
        };
        let (cx, prop_name) = (Ctx::dummy(), |index: usize| {
            self.longhands[index].prop.name()
        });
        let is_same = |index: usize, part: Option<&[u8]>| {
            let part = part.unwrap_or(&initials[index]);
            part == values[index]
                || part == b"normal"
                    && values[index] == b"100%"
                    && prop_name(index).ends_with("range-end")
                || self.ids[0][index]
                    .syntax()
                    .write(
                        part,
                        if is_computed {
                            grammar::Mode::Computed(&cx)
                        } else {
                            grammar::Mode::Specified
                        },
                    )
                    .as_deref()
                    == Some(values[index])
        };
        let errors = |source: &[u8]| match self.expand(source) {
            Some(parts) => parts
                .iter()
                .enumerate()
                .filter(|(index, part)| !is_same(*index, part.as_deref()))
                .count(),
            None => usize::MAX,
        };
        let is_full = self
            .definition
            .has_note(if is_computed { "cfull" } else { "full" });
        let kept = self
            .definition
            .note("keep=")
            .and_then(|it| Prop::from_name(it.as_bytes()));
        let alternatives = if let Term::OneOf(all) = term {
            &all[..]
        } else {
            core::slice::from_ref(term)
        };
        let is_keyword = |it: &&Term| matches!(it, Term::Keywords(_));
        alternatives
            .iter()
            .filter(is_keyword)
            .chain(alternatives.iter().filter(|it| !is_keyword(it)))
            .find_map(|term| {
                let write = |dropped| {
                    let (mut writer, mut out) = (
                        Writer {
                            value: &value,
                            dropped,
                            parts: Vec::new(),
                            seen: Vec::new(),
                        },
                        Out::new(),
                    );
                    writer
                        .write(term, &mut out)
                        .map(|()| (out.trim_ascii().to_vec(), writer.parts))
                };
                if let Term::Keywords(all) = term {
                    return all
                        .iter()
                        .find(|it| errors(it[0].as_bytes()) == 0)
                        .map(|it| it[0].into());
                }
                let (mut best, parts) = write(0)?;
                let (mut dropped, mut fewest) = (0, errors(&best));
                let is_initial = |prop: &Prop| {
                    self.index(*prop)
                        .is_some_and(|it| values[it] == &*initials[it])
                };
                if fewest == usize::MAX {
                    dropped = (parts.iter().enumerate()).fold(0, |all, (index, it)| {
                        all | u32::from(it.iter().all(is_initial)) << index
                    });
                    best = write(dropped)?.0;
                    fewest = errors(&best);
                }
                let is_kept = |index: &usize| kept.is_some_and(|it| parts[*index] == [it]);
                let without_initials = (parts.iter().enumerate()).fold(0, |all, (index, it)| {
                    all | u32::from(it.iter().all(is_initial)) << index
                });
                if let Some((shorter, _)) = write(without_initials)
                    .filter(|it| !is_full && !it.0.is_empty() && errors(&it.0) == 0)
                {
                    (dropped, best, fewest) = (without_initials, shorter, 0);
                }
                let order = (0..parts.len())
                    .rev()
                    .filter(|it| !is_kept(it))
                    .chain((0..parts.len()).filter(is_kept));
                for index in order.filter(|_| !is_full) {
                    let shorter = write(dropped | 1 << index)?.0;
                    let count = errors(&shorter);
                    if count <= fewest && count != usize::MAX {
                        (dropped, best, fewest) = (dropped | 1 << index, shorter, count);
                    }
                }
                (fewest == 0).then_some(best)
            })
    }

    fn join_rules(&self, values: &[&[u8]], is_computed: bool) -> Option<Out> {
        let rule = |parts: [&[u8]; 3]| {
            let kept: Vec<_> = (parts.iter().zip(self.longhands()))
                .filter(|it| *it.0 != initial_source(it.1) || is_computed && *it.0 != b"none")
                .map(|it| *it.0)
                .collect();
            if kept.is_empty() {
                parts[0].to_vec()
            } else {
                kept.join(&b' ')
            }
        };
        let [widths, styles, colors] = [0, 1, 2].map(|it| split_list(values[it]));
        (widths.len() == styles.len() && widths.len() == colors.len()).then_some(())?;
        let items = (0..widths.len()).map(|index| {
            match [&widths, &styles, &colors].map(|it| repeated(it[index])) {
                [None, None, None] => Some(rule([widths[index], styles[index], colors[index]])),
                [Some(a), Some(b), Some(c)]
                    if (a.0, a.1.len()) == (b.0, b.1.len())
                        && (a.0, a.1.len()) == (c.0, c.1.len()) =>
                {
                    let inner: Vec<_> = (0..a.1.len())
                        .map(|it| rule([a.1[it], b.1[it], c.1[it]]))
                        .collect();
                    Some([b"repeat(", a.0, b", ", &inner.join(&b", "[..]), b")"].concat())
                }
                _ => None,
            }
        });
        Some(items.collect::<Option<Vec<_>>>()?.join(&b", "[..]))
    }
}

fn join_grid(values: &[&[u8]]) -> Option<Out> {
    let &[rows, columns, areas, flow, auto_rows, auto_columns] = values else {
        return None;
    };
    if [flow, auto_rows, auto_columns] == [&b"row"[..], b"auto", b"auto"] {
        return join_template(values);
    }
    let axis = usize::from(flow.starts_with(b"column"));
    let (templates, autos) = ([rows, columns], [auto_rows, auto_columns]);
    ([areas, templates[axis], autos[1 - axis]] == [&b"none"[..], b"none", b"auto"]).then_some(())?;
    let words = [
        Some(&b"auto-flow"[..]),
        flow.ends_with(b"dense").then_some(b"dense"),
        Some(autos[axis]).filter(|it| *it != b"auto"),
    ];
    let implicit = words.into_iter().flatten().collect::<Vec<_>>().join(&b' ');
    Some(
        if axis == 0 {
            [&implicit, columns]
        } else {
            [rows, &implicit]
        }
        .join(&b" / "[..]),
    )
}

fn join_template(values: &[&[u8]]) -> Option<Out> {
    if values[2] == b"none" {
        return Some(if values[0] == b"none" && values[1] == b"none" {
            b"none".to_vec()
        } else {
            values[..2].join(&b" / "[..])
        });
    }
    let (mut areas, mut out) = (words(values[2]).into_iter(), Vec::new());
    for row in words(values[0]) {
        if !row.starts_with(b"[") {
            out.push(areas.next()?);
        }
        if row != b"auto" {
            out.push(row);
        }
    }
    if values[1] != b"none" {
        out.extend([b"/", values[1]]);
    }
    let joined = out.join(&b' ');
    (areas.next().is_none() && definition("grid-template")?.accepts(&joined)).then_some(joined)
}
