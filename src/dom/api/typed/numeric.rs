//! <https://drafts.css-houdini.org/css-typed-om/#numeric-objects>, on `calc::Node`

use crate::calc::{Function, Kind, Modifier, Node, Unit};
use crate::values::{Out, P, eq, function, parse_all, write_double, write_list};

const PERCENT: usize = Kind::Percentage as usize;

/// <https://drafts.css-houdini.org/css-typed-om/#cssnumericvalue-type>
#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Type {
    /// By `Kind`.
    pub(crate) powers: [i32; 7],
    pub(crate) percent_hint: Option<usize>,
}

impl Type {
    pub(crate) fn of_unit(unit: Unit) -> Type {
        Type {
            powers: core::array::from_fn(|it| i32::from(it == unit.kind() as usize)),
            percent_hint: None,
        }
    }

    /// `None` if the types of the operands are not compatible.
    pub(crate) fn of(node: &Node) -> Option<Type> {
        let fold = |all: &[Node], combine: fn(Type, Type) -> Option<Type>| {
            all.iter().map(Type::of).reduce(|a, b| combine(a?, b?))?
        };
        match node {
            Node::Value(_, unit) => Some(Type::of_unit(*unit)),
            Node::Product(all) => fold(all, Type::multiply),
            Node::Sum(all) | Node::Call(.., all) => fold(all, Type::add),
            Node::Negate(it) => Type::of(it),
            Node::Invert(it) => Type::of(it).map(Type::inverted),
            _ => None,
        }
    }

    pub(super) fn inverted(self) -> Type {
        Type {
            powers: self.powers.map(i32::saturating_neg),
            ..self
        }
    }

    fn hinted(mut self, hint: Option<usize>) -> Type {
        self.percent_hint = hint;
        if let Some(hint) = hint {
            self.powers[hint] += core::mem::take(&mut self.powers[PERCENT]);
        }
        self
    }

    fn aligned(self, other: Type) -> Option<[Type; 2]> {
        let (a, b) = (self.percent_hint, other.percent_hint);
        (a.is_none() || b.is_none() || a == b).then(|| [self, other].map(|it| it.hinted(a.or(b))))
    }

    pub(super) fn add(self, other: Type) -> Option<Type> {
        let [a, b] = self.aligned(other)?;
        if a.powers == b.powers {
            return Some(a);
        }
        (a.powers[PERCENT] != 0 || b.powers[PERCENT] != 0).then_some(())?;
        let hints = (0..PERCENT).filter(|it| a.powers[*it] != 0 || b.powers[*it] != 0);
        hints
            .map(|it| (a.hinted(Some(it)), b.hinted(Some(it))))
            .find(|it| it.0 == it.1)
            .map(|it| it.0)
    }

    pub(super) fn multiply(self, other: Type) -> Option<Type> {
        let [a, b] = self.aligned(other)?;
        Some(Type {
            powers: core::array::from_fn(|it| a.powers[it].saturating_add(b.powers[it])),
            ..a
        })
    }

    fn is_only(self, kind: Kind) -> bool {
        self.powers == Type::of_unit(kind.unit()).powers
    }

    pub(crate) fn matches(self, kind: Kind) -> bool {
        self.is_only(kind) && self.percent_hint.is_none()
    }

    pub(crate) fn matches_or_percentage(self, kind: Kind) -> bool {
        self.is_only(kind) || self.is_only(Kind::Percentage)
    }
}

pub(crate) fn unit_named(name: &[u8]) -> Option<Unit> {
    match () {
        () if eq(name, "number") => Some(Unit::Number),
        () if eq(name, "percent") || name == b"%" => Some(Unit::Percent),
        () => Unit::from_name(name),
    }
}

pub(crate) fn name_of(unit: Unit) -> &'static str {
    match unit {
        Unit::Number => "number",
        Unit::Percent => "percent",
        unit => unit.name(),
    }
}

fn canonical(value: f64, unit: Unit) -> (f64, Unit) {
    unit.canonical(value, None)
        .map_or((value, unit), |it| (it, unit.kind().unit()))
}

pub(crate) fn convert(value: f64, from: Unit, to: Unit) -> Option<f64> {
    let (value, ratio) = (canonical(value, from), canonical(1.0, to));
    (value.1 == ratio.1).then_some(value.0 / ratio.0)
}

/// A number, and the power of each of its units, sorted.
type Term = (f64, Vec<(Unit, i32)>);

const MAX_TERMS: usize = 1 << 12;

/// <https://drafts.css-houdini.org/css-typed-om/#create-a-sum-value>
fn sum_value(node: &Node) -> Option<Vec<Term>> {
    let parts = |all: &[Node]| all.iter().map(sum_value).collect::<Option<Vec<_>>>();
    match node {
        Node::Value(value, unit) => {
            let (value, unit) = canonical(*value, *unit);
            Some(vec![(
                value,
                (unit != Unit::Number)
                    .then_some((unit, 1))
                    .into_iter()
                    .collect(),
            )])
        }
        Node::Negate(it) => Some(sum_value(it)?.into_iter().map(|it| (-it.0, it.1)).collect()),
        Node::Invert(it) => match &sum_value(it)?[..] {
            [(value, units)] => Some(vec![(
                1.0 / value,
                units.iter().map(|it| (it.0, -it.1)).collect(),
            )]),
            _ => None,
        },
        Node::Sum(all) => {
            let mut terms: Vec<Term> = Vec::new();
            for term in parts(all)?.into_iter().flatten() {
                match terms.iter_mut().find(|it| it.1 == term.1) {
                    Some(known) => known.0 += term.0,
                    None => terms.push(term),
                }
            }
            let type_of = |term: &Term| {
                let mut found = Type::default();
                term.1
                    .iter()
                    .for_each(|(unit, power)| found.powers[unit.kind() as usize] += power);
                Some(found)
            };
            terms
                .iter()
                .map(type_of)
                .reduce(|a, b| a?.add(b?))?
                .map(|_| terms)
        }
        Node::Product(all) => {
            parts(all)?
                .into_iter()
                .try_fold(vec![(1.0, Vec::new())], |left, right| {
                    (left.len() * right.len() <= MAX_TERMS).then(|| {
                        left.iter()
                            .flat_map(|a| right.iter().map(move |b| times(a, b)))
                            .collect()
                    })
                })
        }
        Node::Call(function, _, all) => {
            let parts = parts(all)?;
            let units = &parts.first()?.first()?.1;
            let numbers: Vec<_> = parts
                .iter()
                .map(|it| {
                    if let [(value, own)] = &it[..] {
                        (own == units).then_some(*value)
                    } else {
                        None
                    }
                })
                .collect::<Option<_>>()?;
            Some(vec![(choose(*function, &numbers)?, units.clone())])
        }
        _ => None,
    }
}

fn times(a: &Term, b: &Term) -> Term {
    let mut units = a.1.clone();
    for (unit, power) in &b.1 {
        match units.binary_search_by_key(&(*unit as u8), |it| it.0 as u8) {
            Ok(at) => units[at].1 = units[at].1.saturating_add(*power),
            Err(at) => units.insert(at, (*unit, *power)),
        }
    }
    units.retain(|it| it.1 != 0);
    (a.0 * b.0, units)
}

pub(crate) fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a.total_cmp(&b).is_le() {
        a
    } else {
        b
    }
}

pub(crate) fn max(a: f64, b: f64) -> f64 {
    -min(-a, -b)
}

fn choose(function: Function, numbers: &[f64]) -> Option<f64> {
    match (function, numbers) {
        (Function::Clamp, [lower, value, upper]) => Some(max(*lower, min(*value, *upper))),
        (Function::Min, _) => numbers.iter().copied().reduce(min),
        _ => numbers.iter().copied().reduce(max),
    }
}

fn unit_value((value, units): &Term) -> Option<(f64, Unit)> {
    match units[..] {
        [] => Some((*value, Unit::Number)),
        [(unit, 1)] => Some((*value, unit)),
        _ => None,
    }
}

/// <https://drafts.css-houdini.org/css-typed-om/#dom-cssnumericvalue-to>
pub(crate) fn amount(node: &Node, unit: Unit) -> Option<f64> {
    let (value, from) = match node {
        Node::Value(value, from) => (*value, *from),
        _ => {
            if let [only] = &sum_value(node)?[..] {
                unit_value(only)?
            } else {
                return None;
            }
        }
    };
    convert(value, from, unit)
}

/// <https://drafts.css-houdini.org/css-typed-om/#dom-cssnumericvalue-tosum>
pub(crate) fn to_sum(node: &Node, units: &[Unit]) -> Option<Node> {
    let mut values: Vec<_> = sum_value(node)?
        .iter()
        .map(unit_value)
        .collect::<Option<_>>()?;
    if units.is_empty() {
        bun_collections::index_sort::sort_slice_by_key(&mut values, |it| name_of(it.1));
        return Some(Node::Sum(
            values
                .into_iter()
                .map(|it| Node::Value(it.0, it.1))
                .collect(),
        ));
    }
    let mut total = |unit: &Unit| {
        let converted = values
            .extract_if(.., |it| convert(it.0, it.1, *unit).is_some())
            .filter_map(|it| convert(it.0, it.1, *unit));
        Node::Value(converted.fold(0.0, |a, b| a + b), *unit)
    };
    let terms = units.iter().map(&mut total).collect();
    values.is_empty().then_some(Node::Sum(terms))
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Reader {
    Script,
    /// It gets all the digits, and what it can parse.
    Engine,
}

pub(crate) fn write_number(value: f64, reader: Reader, out: &mut Out) {
    match reader == Reader::Engine || value == value.trunc() && value.abs() < 2_147_483_648.0 {
        true => out.extend_from_slice(bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], value)),
        false => write_double(value, out),
    }
}

/// <https://drafts.css-houdini.org/css-typed-om/#numericvalue-serialization>
pub(crate) fn write(node: &Node, reader: Reader, out: &mut Out) {
    write_within(node, reader, ["calc(", ")"], out);
}

fn write_within(node: &Node, reader: Reader, [open, close]: [&str; 2], out: &mut Out) {
    let nested = |it: &Node, out: &mut Out| write_within(it, reader, ["(", ")"], out);
    match node {
        Node::Value(value, unit) if value.is_finite() => {
            write_number(*value, reader, out);
            return out.extend_from_slice(unit.name().as_bytes());
        }
        Node::Call(function, _, all) => {
            out.extend([function.name(), "("].concat().bytes());
            write_list(all, ", ", out, |it, out| {
                write_within(it, reader, ["", ""], out)
            });
            return out.push(b')');
        }
        _ => out.extend_from_slice(open.as_bytes()),
    }
    match node {
        Node::Value(value, unit) => {
            out.extend(
                if value.is_nan() {
                    "NaN"
                } else if *value > 0.0 {
                    "infinity"
                } else {
                    "-infinity"
                }
                .bytes(),
            );
            out.extend(
                if *unit == Unit::Number {
                    String::new()
                } else {
                    format!(" * 1{}", unit.name())
                }
                .bytes(),
            );
        }
        Node::Negate(it) | Node::Invert(it) => {
            out.extend(
                if let Node::Invert(_) = node {
                    "1 / "
                } else if reader == Reader::Engine {
                    "-1 * "
                } else {
                    "-"
                }
                .bytes(),
            );
            nested(it, out);
        }
        Node::Sum(all) | Node::Product(all) if let [only @ Node::Value(..)] = &all[..] => {
            write_within(only, reader, ["", ""], out)
        }
        Node::Sum(all) | Node::Product(all) => {
            for (index, it) in all.iter().enumerate() {
                let (operator, operand) = match (node, it) {
                    _ if index == 0 => ("", it),
                    (Node::Sum(_), Node::Negate(inner)) => (" - ", &**inner),
                    (Node::Sum(_), _) => (" + ", it),
                    (_, Node::Invert(inner)) => (" / ", &**inner),
                    _ => (" * ", it),
                };
                out.extend_from_slice(operator.as_bytes());
                nested(operand, out);
            }
        }
        _ => {}
    }
    out.extend_from_slice(close.as_bytes());
}

fn terms(node: Node) -> Vec<Node> {
    if let Node::Sum(all) = node {
        all
    } else {
        vec![node]
    }
}

fn scaled(node: &Node, by: f64) -> Option<Node> {
    match node {
        Node::Value(value, unit) => Some(Node::Value(value * by, *unit)),
        Node::Negate(it) => scaled(it, -by),
        Node::Sum(all) => all
            .iter()
            .map(|it| scaled(it, by))
            .collect::<Option<_>>()
            .map(Node::Sum),
        _ => None,
    }
}

fn signed(node: &Node) -> Option<(f64, Unit)> {
    match node {
        Node::Value(value, unit) => Some((*value, *unit)),
        Node::Negate(it) => {
            if let Node::Value(value, unit) = **it {
                Some((-value, unit))
            } else {
                None
            }
        }
        _ => None,
    }
}

fn plus(left: Node, right: Node, subtracts: bool) -> Node {
    let mut all = terms(left);
    for term in terms(right) {
        let same = signed(&term).and_then(|(value, unit)| {
            Some((
                value,
                all.iter_mut()
                    .find_map(|it| Some((signed(it).filter(|it| it.1 == unit)?, it)))?,
            ))
        });
        match (same, term) {
            (Some((value, ((known, unit), same))), _) => {
                *same = Node::Value(known + if subtracts { -value } else { value }, unit)
            }
            (_, Node::Negate(inner)) if subtracts => all.push(*inner),
            (_, term) => all.push(if subtracts {
                Node::Negate(Box::new(term))
            } else {
                term
            }),
        }
    }
    if all.len() == 1 {
        all.swap_remove(0)
    } else {
        Node::Sum(all)
    }
}

fn product(mut left: Node, mut right: Node, divides: bool) -> Node {
    if !divides && matches!(left, Node::Value(_, Unit::Number)) {
        core::mem::swap(&mut left, &mut right);
    }
    let factor = match right {
        Node::Value(value, Unit::Number) => {
            let by = if divides { 1.0 / value } else { value };
            if let Some(scaled) = scaled(&left, by) {
                return scaled;
            }
            Node::Value(by, Unit::Number)
        }
        right => {
            if divides {
                Node::Invert(Box::new(right))
            } else {
                right
            }
        }
    };
    let mut factors = if let Node::Product(all) = left {
        all
    } else {
        vec![left]
    };
    factors.push(factor);
    Node::Product(factors)
}

fn has_class(function: Function) -> bool {
    matches!(function, Function::Min | Function::Max | Function::Clamp)
}

/// What can be worked out from left to right is.
fn reified(node: &Node) -> Option<Node> {
    Some(match node {
        Node::Value(value, unit) => {
            let (value, unit) = canonical(*value, *unit);
            Node::Value(value, unit)
        }
        Node::Sum(all) => all[1..]
            .iter()
            .try_fold(reified(&all[0])?, |sum, it| match it {
                Node::Negate(it) => Some(plus(sum, reified(it)?, true)),
                it => Some(plus(sum, reified(it)?, false)),
            })?,
        Node::Product(all) => all[1..]
            .iter()
            .try_fold(reified(&all[0])?, |all, it| match it {
                Node::Invert(it) => Some(product(all, reified(it)?, true)),
                it => Some(product(all, reified(it)?, false)),
            })?,
        Node::Negate(it) => Node::Negate(Box::new(reified(it)?)),
        Node::Invert(it) => Node::Invert(Box::new(reified(it)?)),
        Node::Call(function, _, all) if has_class(*function) => {
            let call = Node::Call(
                *function,
                Modifier::Nearest,
                all.iter().map(reified).collect::<Option<_>>()?,
            );
            match &call {
                Node::Call(.., all)
                    if let Node::Value(_, unit) = all[0]
                        && unit != Unit::Percent
                        && all
                            .iter()
                            .all(|it| matches!(it, Node::Value(_, it) if *it == unit)) =>
                {
                    Node::Value(amount(&call, unit)?, unit)
                }
                _ => call,
            }
        }
        _ => return None,
    })
}

/// Of what `Node::parse` returns.
pub(crate) fn reify(node: &Node, is_calc: bool) -> Option<Node> {
    if node.is_literal() {
        return matches!(node, Node::Value(..)).then(|| node.clone());
    }
    let needs_help =
        node.any(&|it| matches!(it, Node::Call(function, ..) if !has_class(*function)));
    let result = match needs_help {
        true => reified(
            &Some(node.simplified(None, false))
                .filter(|it| !it.any(&|it| matches!(it, Node::Call(..))))?,
        )?,
        false => reified(node)?,
    };
    Type::of(&result)?;
    Some(
        if matches!(result, Node::Value(..)) && (is_calc || needs_help) {
            Node::Sum(vec![result])
        } else {
            result
        },
    )
}

/// <https://drafts.css-houdini.org/css-typed-om/#dom-cssnumericvalue-parse>
pub(crate) fn parse(source: &[u8]) -> Option<Node> {
    parse_all(source, parse_from)
}

pub(crate) fn parse_from(p: &mut P) -> Option<Node> {
    let state = p.state();
    let name = function(p);
    p.reset(&state);
    let node = Node::parse_untyped(p)?;
    match (name, &node) {
        (Some(name), _) => reify(&node, eq(name, "calc")),
        (None, Node::Sum(all)) => p
            .slice_from(state.position)
            .trim_ascii_start()
            .first()
            .is_some_and(|it| it.is_ascii_digit() || matches!(it, b'+' | b'-' | b'.'))
            .then(|| all[0].clone()),
        _ => None,
    }
}
