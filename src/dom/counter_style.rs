//! `@counter-style`

use std::rc::Rc;

use crate::document::Document;
use crate::sheet::{AtKind, Defined, Sheet};
use crate::tree::NodeId;
use crate::values::*;

keywords! {
    System { Cyclic = "cyclic", Numeric = "numeric", Alphabetic = "alphabetic", Symbolic = "symbolic", Additive = "additive",
        Fixed = "fixed", Extends = "extends", Chinese = "-internal-chinese", Ethiopic = "-internal-ethiopic" }
}

#[derive(Clone, PartialEq)]
pub(crate) struct CounterStyle {
    system: System,
    /// Of `fixed`. For `Chinese`, whether it is formal.
    first: i32,
    extends: Str,
    symbols: Rc<[Str]>,
    weights: Rc<[i32]>,
    negative: Option<[Str; 2]>,
    prefix: Option<Str>,
    suffix: Option<Str>,
    pad: Option<(i32, Str)>,
    /// Empty for `auto`.
    range: Option<Rc<[[i32; 2]]>>,
    fallback: Option<Str>,
}

const MAX_LENGTH: usize = 120;

thread_local! {
    static PREDEFINED: Sheet = Sheet::parse(include_bytes!("counter_styles.css"), b"", b"", 0, Default::default());
}

fn symbol(p: &mut P) -> Option<Str> {
    string(p).or_else(|| ident(p)).map(|it| text(it).into())
}

fn symbols(p: &mut P) -> Rc<[Str]> {
    core::iter::from_fn(|| symbol(p)).collect()
}

impl CounterStyle {
    fn new(system: System, symbols: Rc<[Str]>) -> CounterStyle {
        CounterStyle {
            system,
            first: 1,
            extends: Str::default(),
            symbols,
            weights: Rc::default(),
            negative: None,
            prefix: None,
            suffix: None,
            pad: None,
            range: None,
            fallback: None,
        }
    }

    /// What is inside of `symbols()`.
    pub(crate) fn anonymous(p: &mut P, cx: &Ctx) -> CounterStyle {
        let system = System::parse(p, cx).unwrap_or(System::Symbolic);
        CounterStyle {
            suffix: Some(" ".into()),
            ..CounterStyle::new(system, symbols(p))
        }
    }

    pub(crate) fn write_anonymous(&self, out: &mut Out) {
        out.extend_from_slice(b"symbols(");
        out.extend(
            (self.system != System::Symbolic)
                .then(|| self.system.name().bytes().chain([b' ']))
                .into_iter()
                .flatten(),
        );
        write_list(&self.symbols, " ", out, |it, out| {
            write_string(it.as_bytes(), out)
        });
        out.push(b')');
    }

    /// From valid descriptors, as they are serialized.
    pub(crate) fn parse(descriptors: &[(Str, Str)]) -> Option<CounterStyle> {
        let (mut style, mut additive, cx) = (
            CounterStyle::new(System::Symbolic, Rc::default()),
            Vec::new(),
            &Ctx::dummy(),
        );
        let weighted = |p: &mut P| Some((integer(p, cx)?, symbol(p)?));
        let bound = |p: &mut P, infinite| {
            if keyword(p, "infinite") {
                Some(infinite)
            } else {
                integer(p, cx)
            }
        };
        for (name, value) in descriptors {
            with_parser(value.as_bytes(), |p| match &**name {
                "system" => {
                    style.system = System::parse(p, cx).unwrap_or(System::Symbolic);
                    (style.first, style.extends) =
                        (integer(p, cx).unwrap_or(1), symbol(p).unwrap_or_default());
                }
                "symbols" => style.symbols = symbols(p),
                "additive-symbols" => additive = commas(p, weighted).unwrap_or_default(),
                "negative" => {
                    style.negative =
                        Some([symbol(p).unwrap_or_default(), symbol(p).unwrap_or_default()])
                }
                "prefix" => style.prefix = symbol(p),
                "suffix" => style.suffix = symbol(p),
                "pad" => style.pad = weighted(p),
                "range" => {
                    style.range = Some(
                        commas(p, |p| Some([bound(p, i32::MIN)?, bound(p, i32::MAX)?]))
                            .unwrap_or_default()
                            .into(),
                    )
                }
                "fallback" => style.fallback = symbol(p),
                _ => {}
            });
        }
        let is_valid = match style.system {
            System::Extends => style.symbols.is_empty() && additive.is_empty(),
            System::Additive => !additive.is_empty(),
            System::Alphabetic | System::Numeric => style.symbols.len() > 1,
            _ => !style.symbols.is_empty(),
        };
        if style.system == System::Additive {
            (style.weights, style.symbols) = (
                additive.iter().map(|it| it.0).collect(),
                additive.into_iter().map(|it| it.1).collect(),
            );
        }
        is_valid.then_some(style)
    }

    fn extending(&self, base: &CounterStyle) -> CounterStyle {
        let (own, base) = (self.clone(), base.clone());
        CounterStyle {
            negative: own.negative.or(base.negative),
            prefix: own.prefix.or(base.prefix),
            suffix: own.suffix.or(base.suffix),
            pad: own.pad.or(base.pad),
            range: own.range.or(base.range),
            fallback: own.fallback.or(base.fallback),
            ..base
        }
    }

    fn is_in_range(&self, value: i32) -> bool {
        match (self.range.as_deref().unwrap_or_default(), self.system) {
            ([], System::Alphabetic | System::Symbolic | System::Ethiopic) => value > 0,
            ([], System::Additive) => value >= 0,
            ([], _) => true,
            (ranges, _) => ranges
                .iter()
                .any(|[from, to]| (from..=to).contains(&&value)),
        }
    }

    /// Which of the symbols, without a sign.
    fn indexes(&self, value: i32) -> Option<Vec<usize>> {
        let (count, mut rest, mut all) = (
            self.symbols.len(),
            value.unsigned_abs() as usize,
            Vec::new(),
        );
        match self.system {
            System::Alphabetic | System::Numeric if count < 2 => return None,
            System::Cyclic | System::Symbolic if count == 0 => return None,
            System::Cyclic => all.push((i64::from(value) - 1).rem_euclid(count as i64) as usize),
            System::Fixed => all.push(
                usize::try_from(i64::from(value) - i64::from(self.first))
                    .ok()
                    .filter(|it| *it < count)?,
            ),
            System::Symbolic => {
                let times =
                    Some(rest.div_ceil(count)).filter(|it| (1..=MAX_LENGTH).contains(it))?;
                all.resize(times, (rest - 1) % count);
            }
            System::Alphabetic => {
                while rest > 0 {
                    all.insert(0, (rest - 1) % count);
                    rest = (rest - 1) / count;
                }
            }
            System::Additive if rest == 0 => {
                all.push(self.weights.iter().position(|weight| *weight == 0i32)?)
            }
            System::Additive => {
                for (index, weight) in self
                    .weights
                    .iter()
                    .map(|it| *it as usize)
                    .enumerate()
                    .filter(|it| it.1 > 0)
                {
                    all.resize(
                        Some(all.len() + rest / weight).filter(|it| *it <= MAX_LENGTH)?,
                        index,
                    );
                    rest %= weight;
                }
                (rest == 0).then_some(())?;
            }
            System::Chinese if rest > 0 => {
                let (is_informal, is_korean) = (self.first & 1 == 0, self.first & 2 != 0);
                for (index, group) in [
                    (2, rest / 100_000_000),
                    (1, rest / 10_000 % 10_000),
                    (0, rest % 10_000),
                ] {
                    all.extend((is_korean && group > 0 && !all.is_empty()).then_some(15));
                    for (place, unit) in [(3, 1000), (2, 100), (1, 10), (0, 1)] {
                        match group / unit % 10 {
                            0 if is_korean
                                || group > 0 && group % unit == 0
                                || all.last().is_none_or(|it| *it == 0) => {}
                            1 if is_informal && place > 0 && (is_korean || group < 20) => {
                                all.push(9 + place)
                            }
                            1 if is_informal && is_korean && index > 0 => {}
                            digit => all.extend(
                                [digit]
                                    .into_iter()
                                    .chain((digit > 0 && place > 0).then_some(9 + place)),
                            ),
                        }
                    }
                    all.extend((group > 0 && index > 0).then_some(12 + index));
                }
                all.pop_if(|it| *it == 0);
            }
            System::Ethiopic if rest == 1 => all.push(0),
            System::Ethiopic => {
                let groups: Vec<_> =
                    core::iter::successors(Some(rest), |it| Some(it / 100).filter(|it| *it > 0))
                        .map(|it| it % 100)
                        .collect();
                for (index, group) in groups.iter().copied().enumerate().rev() {
                    if group != 1 || index % 2 == 0 && index + 1 < groups.len() {
                        all.extend(
                            [(group / 10, 8), (group % 10, usize::MAX)]
                                .into_iter()
                                .filter(|it| it.0 > 0)
                                .map(|it| it.0.wrapping_add(it.1)),
                        );
                    }
                    all.extend(if index % 2 == 1 {
                        (group > 0).then_some(18)
                    } else {
                        (index > 0).then_some(19)
                    });
                }
            }
            _ => loop {
                all.insert(0, rest % count);
                rest /= count;
                if rest == 0 {
                    break;
                }
            },
        }
        (!all.is_empty()).then_some(all)
    }

    fn represent(&self, value: i32) -> Option<String> {
        let digits: String = self
            .indexes(value)
            .filter(|_| self.is_in_range(value))?
            .into_iter()
            .map(|it| &*self.symbols[it])
            .collect();
        let [before, after] = match &self.negative {
            _ if value >= 0 || matches!(self.system, System::Cyclic | System::Fixed) => ["", ""],
            Some([before, after]) => [&**before, after],
            None => ["-", ""],
        };
        let (least, pad) = self
            .pad
            .as_ref()
            .map_or((0, ""), |it| (it.0 as usize, &it.1));
        (least <= MAX_LENGTH).then_some(())?;
        Some(
            [
                before,
                &pad.repeat(
                    least
                        .saturating_sub([before, &digits, after].map(count_graphemes).iter().sum()),
                ),
                &digits,
                after,
            ]
            .concat(),
        )
    }

    pub(crate) fn around(&self, text: &str) -> String {
        [
            self.prefix.as_deref().unwrap_or_default(),
            text,
            self.suffix.as_deref().unwrap_or(". "),
        ]
        .concat()
    }
}

/// The names of the predefined ones are not case-sensitive.
pub(crate) fn canonical_name(name: &Str) -> Str {
    if !name.bytes().any(|it| it.is_ascii_uppercase()) {
        return Rc::clone(name);
    }
    PREDEFINED.with(|sheet| {
        Rc::clone(
            sheet
                .at_rules
                .iter()
                .map(|it| &it.name)
                .find(|it| it.eq_ignore_ascii_case(name))
                .unwrap_or(name),
        )
    })
}

/// Without the most common marks that combine with what is before them.
fn count_graphemes(text: &str) -> usize {
    text.chars()
        .filter(|it| !crate::characters::extends_cluster(*it))
        .count()
}

fn predefined(name: &str) -> Option<Rc<CounterStyle>> {
    let found = PREDEFINED.with(|sheet| {
        sheet
            .at_rules
            .iter()
            .find(|it| it.name.strip_prefix("-internal-").unwrap_or(&it.name) == name)
            .map(|it| sheet.defined(it))
    });
    let Defined::CounterStyle(mut style) = found? else {
        return None;
    };
    let is_korean = name.starts_with("korean-");
    if is_korean || name.as_bytes().get(4..13) == Some(b"-chinese-") {
        let style = Rc::make_mut(&mut style);
        (style.system, style.first) = (
            System::Chinese,
            i32::from(!name.ends_with("informal")) | i32::from(is_korean) << 1,
        );
    } else if name == "ethiopic-numeric" {
        Rc::make_mut(&mut style).system = System::Ethiopic;
    }
    Some(style)
}

impl Document {
    /// With the tree that defines it.
    fn find_counter_style(&self, scope: NodeId, name: &str) -> Option<(Rc<CounterStyle>, NodeId)> {
        match self.find_defined(scope, AtKind::CounterStyle, name) {
            Some((Defined::CounterStyle(style), scope)) => Some((style, scope)),
            _ => Some((predefined(name)?, 0)),
        }
    }

    /// `decimal` if there is none.
    pub(crate) fn counter_style(
        &self,
        scope: NodeId,
        name: &str,
    ) -> Option<(Rc<CounterStyle>, NodeId)> {
        let mut chain = vec![
            self.find_counter_style(scope, name)
                .or_else(|| self.find_counter_style(0, "decimal"))?,
        ];
        while let Some((last, scope)) = chain.last().filter(|it| it.0.system == System::Extends) {
            let base = self.find_counter_style(*scope, &last.extends);
            match base
                .as_ref()
                .map(|base| chain.iter().position(|it| Rc::ptr_eq(&it.0, &base.0)))
            {
                Some(None) => chain.extend(base),
                cycle => {
                    chain.truncate(cycle.flatten().map_or(chain.len(), |it| it + 1));
                    chain.push(self.find_counter_style(0, "decimal")?);
                }
            }
        }
        chain
            .into_iter()
            .rev()
            .reduce(|base, (style, scope)| (Rc::new(style.extending(&base.0)), scope))
    }

    pub(crate) fn represent_with(&self, style: &CounterStyle, scope: NodeId, value: i32) -> String {
        let fallback =
            |style: &CounterStyle, scope| self.counter_style(scope, style.fallback.as_deref()?);
        let others =
            core::iter::successors(fallback(style, scope), |it| fallback(&it.0, it.1)).take(32);
        style
            .represent(value)
            .or_else(|| others.into_iter().find_map(|it| it.0.represent(value)))
            .unwrap_or_else(|| value.to_string())
    }
}
