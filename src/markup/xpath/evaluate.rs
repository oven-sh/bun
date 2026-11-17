use std::borrow::Cow;

use bun_collections::hashbrown::HashSet;

use super::{
    Axis, Expression, Function, Kind, NodeKind, NodeTest, Operator, Start, Step, Tree, is_space,
    number_len, parse_number,
};
use crate::{Chars, Text};

/// Longer lists are put in order by walking the tree.
const MAX_COMPARED: usize = 32;

pub enum Value<'a, N> {
    /// In document order.
    Nodes(Vec<N>),
    Text(Cow<'a, Text>),
    Number(f64),
    Boolean(bool),
}

/// A node-set was needed.
pub struct NotNodes;

fn number_of(text: Chars<'_>) -> f64 {
    let text = text.skip(text.units().take_while(|it| is_space(*it)).count());
    let text =
        text.slice(0..text.len() - text.units().rev().take_while(|it| is_space(*it)).count());
    let digits = text.skip(usize::from(text.starts_with(b"-")));
    if !digits.is_empty() && number_len(digits) == digits.len() {
        parse_number(text)
    } else {
        f64::NAN
    }
}

fn text_of(number: f64) -> Text {
    let text = match number {
        0.0 => "0".to_owned(),
        f64::INFINITY => "Infinity".to_owned(),
        f64::NEG_INFINITY => "-Infinity".to_owned(),
        _ => number.to_string(),
    };
    Chars::from(text.as_str()).into()
}

fn round(number: f64) -> f64 {
    let floor = number.floor();
    (if number - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    })
    .copysign(number)
}

fn index_of(text: Chars<'_>, part: Chars<'_>) -> Option<usize> {
    (0..=text.len().checked_sub(part.len())?).find(|at| text.slice(*at..at + part.len()) == part)
}

fn words(mut text: Chars<'_>) -> impl Iterator<Item = Chars<'_>> {
    core::iter::from_fn(move || {
        text = text.skip(text.units().take_while(|it| is_space(*it)).count());
        let word = text.slice(0..text.units().take_while(|it| !is_space(*it)).count());
        text = text.skip(word.len());
        (!word.is_empty()).then_some(word)
    })
}

fn string_value<T: Tree>(tree: &T, node: T::Node) -> Text {
    let mut text = Text::default();
    tree.push_string_value(node, &mut text);
    text
}

impl<'a, N: Copy> Value<'a, N> {
    pub fn into_text(self, tree: &impl Tree<Node = N>) -> Cow<'a, Text> {
        Cow::Owned(match self {
            Value::Text(text) => return text,
            Value::Nodes(nodes) => nodes
                .first()
                .map(|it| string_value(tree, *it))
                .unwrap_or_default(),
            Value::Number(number) => text_of(number),
            Value::Boolean(boolean) => Chars::from(if boolean { "true" } else { "false" }).into(),
        })
    }

    pub fn to_number(&self, tree: &impl Tree<Node = N>) -> f64 {
        match self {
            Value::Nodes(nodes) => nodes
                .first()
                .map_or(f64::NAN, |it| number_of(string_value(tree, *it).chars())),
            Value::Text(text) => number_of(text.chars()),
            Value::Number(number) => *number,
            Value::Boolean(boolean) => f64::from(u8::from(*boolean)),
        }
    }

    pub fn to_boolean(&self) -> bool {
        match self {
            Value::Nodes(nodes) => !nodes.is_empty(),
            Value::Text(text) => !text.is_empty(),
            Value::Number(number) => *number != 0.0 && !number.is_nan(),
            Value::Boolean(boolean) => *boolean,
        }
    }

    pub fn into_nodes(self) -> Result<Vec<N>, NotNodes> {
        match self {
            Value::Nodes(nodes) => Ok(nodes),
            _ => Err(NotNodes),
        }
    }

    fn owned(text: impl Into<Text>) -> Self {
        Value::Text(Cow::Owned(text.into()))
    }
}

#[derive(Clone, Copy)]
struct Context<N> {
    node: N,
    position: usize,
    size: usize,
}

struct Evaluator<'t, T>(&'t T);

type Evaluated<'a, T> = Result<Value<'a, <T as Tree>::Node>, NotNodes>;

impl<T: Tree> Evaluator<'_, T> {
    fn root(&self, mut node: T::Node) -> T::Node {
        while let Some(parent) = self.0.parent(node) {
            node = parent;
        }
        node
    }

    fn following_skipping(&self, mut node: T::Node, root: Option<T::Node>) -> Option<T::Node> {
        while Some(node) != root {
            if let Some(next) = self.0.next_sibling(node) {
                return Some(next);
            }
            node = self.0.parent(node)?;
        }
        None
    }

    fn following(&self, node: T::Node, root: Option<T::Node>) -> Option<T::Node> {
        self.0
            .first_child(node)
            .or_else(|| self.following_skipping(node, root))
    }

    /// In the order of the axis.
    fn walk(&self, axis: Axis, node: T::Node, mut visit: impl FnMut(T::Node)) {
        use core::iter::successors;
        let tree = self.0;
        let is_attribute = tree.kind(node) == NodeKind::Attribute;
        match axis {
            Axis::Ancestor => successors(tree.parent(node), |it| tree.parent(*it)).for_each(visit),
            Axis::AncestorOrSelf => successors(Some(node), |it| tree.parent(*it)).for_each(visit),
            Axis::Attribute => tree.attributes(node).for_each(visit),
            Axis::Child => {
                successors(tree.first_child(node), |it| tree.next_sibling(*it)).for_each(visit)
            }
            Axis::Descendant => {
                successors(tree.first_child(node), |it| self.following(*it, Some(node)))
                    .for_each(visit)
            }
            Axis::DescendantOrSelf => {
                successors(Some(node), |it| self.following(*it, Some(node))).for_each(visit)
            }
            Axis::Following => {
                let first = match is_attribute {
                    true => tree.parent(node).and_then(|it| self.following(it, None)),
                    false => self.following_skipping(node, None),
                };
                successors(first, |it| self.following(*it, None)).for_each(visit);
            }
            Axis::FollowingSibling => {
                successors(tree.next_sibling(node), |it| tree.next_sibling(*it)).for_each(visit)
            }
            Axis::Namespace => {}
            Axis::Parent => tree.parent(node).into_iter().for_each(visit),
            Axis::Preceding => {
                let (mut at, mut ancestor) = (node, tree.parent(node));
                loop {
                    if let Some(previous) = tree.previous_sibling(at) {
                        at = successors(Some(previous), |it| tree.last_child(*it))
                            .last()
                            .unwrap_or(previous);
                    } else {
                        let Some(parent) = tree.parent(at) else {
                            return;
                        };
                        at = parent;
                        if Some(at) == ancestor {
                            ancestor = tree.parent(at);
                            continue;
                        }
                    }
                    visit(at);
                }
            }
            Axis::PrecedingSibling => {
                successors(tree.previous_sibling(node), |it| tree.previous_sibling(*it))
                    .for_each(visit);
            }
            Axis::Itself => visit(node),
        }
    }

    /// Also drops the duplicates.
    fn sort(&self, nodes: &mut Vec<T::Node>) {
        if nodes.len() <= MAX_COMPARED {
            bun_collections::index_sort::sort_slice_by(nodes, |a, b| self.0.compare_order(*a, *b));
            return nodes.dedup();
        }
        let has_attributes = nodes
            .iter()
            .any(|it| self.0.kind(*it) == NodeKind::Attribute);
        let root = self.root(nodes[0]);
        let wanted: HashSet<T::Node, std::hash::RandomState> = nodes.drain(..).collect();
        self.walk(Axis::DescendantOrSelf, root, |node| {
            if wanted.contains(&node) {
                nodes.push(node);
            }
            if has_attributes {
                nodes.extend(self.0.attributes(node).filter(|it| wanted.contains(it)));
            }
        });
    }

    fn passes(&self, step: &Step<T::Name>, node: T::Node) -> bool {
        let kind = self.0.kind(node);
        match &step.test {
            NodeTest::Any => true,
            NodeTest::Kind(wanted) => kind == *wanted,
            NodeTest::Instruction(target) => {
                let mut name = Text::default();
                self.0.push_local_name(node, &mut name);
                kind == NodeKind::Instruction && name.chars() == target.chars()
            }
            NodeTest::Name(test) => {
                let principal = if step.axis == Axis::Attribute {
                    NodeKind::Attribute
                } else {
                    NodeKind::Element
                };
                kind == principal && self.0.matches(node, test)
            }
        }
    }

    /// Those from `start` on.
    fn filter(
        &self,
        nodes: &mut Vec<T::Node>,
        start: usize,
        predicates: &[Expression<T::Name>],
    ) -> Result<(), NotNodes> {
        for predicate in predicates {
            let (size, mut kept) = (nodes.len() - start, start);
            for position in 1..=size {
                let node = nodes[start + position - 1];
                let keeps = match self.evaluate(
                    predicate,
                    Context {
                        node,
                        position,
                        size,
                    },
                )? {
                    Value::Number(number) => number == position as f64,
                    value => value.to_boolean(),
                };
                if keeps {
                    nodes[kept] = node;
                    kept += 1;
                }
            }
            nodes.truncate(kept);
        }
        Ok(())
    }

    fn follow(
        &self,
        mut nodes: Vec<T::Node>,
        steps: &[Step<T::Name>],
    ) -> Result<Vec<T::Node>, NotNodes> {
        // None of the nodes is below another.
        let mut are_apart = false;
        for step in steps {
            are_apart |= nodes.len() <= 1;
            let mut found = Vec::new();
            for &node in &nodes {
                let start = found.len();
                self.walk(step.axis, node, |it| {
                    if self.passes(step, it) {
                        found.push(it);
                    }
                });
                self.filter(&mut found, start, &step.predicates)?;
            }
            match step.axis {
                Axis::Attribute | Axis::Itself | Axis::Namespace => {}
                Axis::Child if are_apart => {}
                Axis::Descendant | Axis::DescendantOrSelf if are_apart => are_apart = false,
                axis => {
                    use Axis::{Ancestor, AncestorOrSelf, Preceding, PrecedingSibling};
                    if nodes.len() > 1 {
                        self.sort(&mut found);
                    } else if matches!(
                        axis,
                        Ancestor | AncestorOrSelf | Preceding | PrecedingSibling
                    ) {
                        found.reverse();
                    }
                    are_apart = false;
                }
            }
            nodes = found;
        }
        Ok(nodes)
    }

    fn compare(&self, operator: Operator, a: &Value<'_, T::Node>, b: &Value<'_, T::Node>) -> bool {
        let text = |node: &T::Node| Value::owned(string_value(self.0, *node));
        let is_equality = matches!(operator, Operator::Equal | Operator::NotEqual);
        let (a, b) = match (a, b) {
            (Value::Nodes(_), Value::Boolean(_)) | (Value::Boolean(_), Value::Nodes(_)) => (
                f64::from(u8::from(a.to_boolean())),
                f64::from(u8::from(b.to_boolean())),
            ),
            (Value::Nodes(a), Value::Nodes(b)) => {
                let b: Vec<_> = b.iter().map(text).collect();
                return a
                    .iter()
                    .map(text)
                    .any(|a| b.iter().any(|b| self.compare(operator, &a, b)));
            }
            (Value::Nodes(a), _) => return a.iter().any(|it| self.compare(operator, &text(it), b)),
            (_, Value::Nodes(b)) => return b.iter().any(|it| self.compare(operator, a, &text(it))),
            (Value::Boolean(_), _) | (_, Value::Boolean(_)) if is_equality => {
                return (a.to_boolean() == b.to_boolean()) == (operator == Operator::Equal);
            }
            (Value::Text(a), Value::Text(b)) if is_equality => {
                return (a.chars() == b.chars()) == (operator == Operator::Equal);
            }
            _ => (a.to_number(self.0), b.to_number(self.0)),
        };
        match operator {
            Operator::Equal => a == b,
            Operator::NotEqual => a != b,
            Operator::Less => a < b,
            Operator::LessOrEqual => a <= b,
            Operator::Greater => a > b,
            _ => a >= b,
        }
    }

    fn apply<'a>(
        &self,
        left: &Value<'a, T::Node>,
        operator: Operator,
        right: &'a Expression<T::Name>,
        context: Context<T::Node>,
    ) -> Evaluated<'a, T> {
        match operator {
            Operator::Or if left.to_boolean() => return Ok(Value::Boolean(true)),
            Operator::And if !left.to_boolean() => return Ok(Value::Boolean(false)),
            _ => {}
        }
        let right = self.evaluate(right, context)?;
        let arithmetic: fn(f64, f64) -> f64 = match operator {
            Operator::Or | Operator::And => return Ok(Value::Boolean(right.to_boolean())),
            Operator::Add => |a, b| a + b,
            Operator::Subtract => |a, b| a - b,
            Operator::Multiply => |a, b| a * b,
            Operator::Divide => |a, b| a / b,
            Operator::Modulo => |a, b| a % b,
            _ => return Ok(Value::Boolean(self.compare(operator, left, &right))),
        };
        Ok(Value::Number(arithmetic(
            left.to_number(self.0),
            right.to_number(self.0),
        )))
    }

    fn evaluate<'a>(
        &self,
        expression: &'a Expression<T::Name>,
        context: Context<T::Node>,
    ) -> Evaluated<'a, T> {
        Ok(match &expression.0 {
            Kind::Number(number) => Value::Number(*number),
            Kind::Literal(text) => Value::Text(Cow::Borrowed(text)),
            Kind::Chain(first, rest) => {
                let mut value = self.evaluate(first, context)?;
                for (operator, right) in rest {
                    value = self.apply(&value, *operator, right, context)?;
                }
                value
            }
            Kind::Signed(value, is_negated) => {
                let number = self.evaluate(value, context)?.to_number(self.0);
                Value::Number(if *is_negated { -number } else { number })
            }
            Kind::Union(parts) => {
                let mut nodes = Vec::new();
                for part in parts {
                    nodes.extend(self.evaluate(part, context)?.into_nodes()?);
                }
                self.sort(&mut nodes);
                Value::Nodes(nodes)
            }
            Kind::Call(function, arguments) => self.call(*function, arguments, context)?,
            Kind::Path(start, steps) => {
                let nodes = match start {
                    Start::Context => vec![context.node],
                    Start::Root => vec![self.root(context.node)],
                    Start::Filter(value, predicates) => {
                        let mut nodes = self.evaluate(value, context)?.into_nodes()?;
                        self.filter(&mut nodes, 0, predicates)?;
                        nodes
                    }
                };
                Value::Nodes(self.follow(nodes, steps)?)
            }
        })
    }

    fn call<'a>(
        &self,
        function: Function,
        arguments: &'a [Expression<T::Name>],
        context: Context<T::Node>,
    ) -> Evaluated<'a, T> {
        let tree = self.0;
        let value = |index: usize| match arguments.get(index) {
            Some(argument) => self.evaluate(argument, context),
            None => Ok(Value::Nodes(vec![context.node])),
        };
        let text = |index: usize| value(index).map(|it| it.into_text(tree));
        let number = |index: usize| value(index).map(|it| it.to_number(tree));
        let name = |push: fn(&T, T::Node, &mut Text)| -> Evaluated<'a, T> {
            let mut out = Text::default();
            if let Some(node) = value(0)?.into_nodes()?.first() {
                push(tree, *node, &mut out);
            }
            Ok(Value::owned(out))
        };
        Ok(match function {
            Function::Boolean => Value::Boolean(value(0)?.to_boolean()),
            Function::Ceiling => Value::Number(number(0)?.ceil()),
            Function::Concat => {
                let mut out = Text::default();
                for index in 0..arguments.len() {
                    out.push(text(index)?.chars());
                }
                Value::owned(out)
            }
            Function::Contains => {
                Value::Boolean(index_of(text(0)?.chars(), text(1)?.chars()).is_some())
            }
            Function::Count => Value::Number(value(0)?.into_nodes()?.len() as f64),
            Function::False => Value::Boolean(false),
            Function::Floor => Value::Number(number(0)?.floor()),
            Function::Id => {
                let ids = match value(0)? {
                    Value::Nodes(nodes) => {
                        let mut joined = Text::default();
                        for node in nodes {
                            tree.push_string_value(node, &mut joined);
                            joined.push_byte(b' ');
                        }
                        Cow::Owned(joined)
                    }
                    other => other.into_text(tree),
                };
                let root = self.root(context.node);
                let mut nodes = words(ids.chars())
                    .filter_map(|it| tree.element_by_id(root, it))
                    .collect();
                self.sort(&mut nodes);
                Value::Nodes(nodes)
            }
            Function::Lang => {
                let wanted = text(0)?;
                let language = core::iter::successors(Some(context.node), |it| tree.parent(*it))
                    .find_map(|it| tree.language(it));
                let lower = |it: u16| {
                    if (0x41..=0x5a).contains(&it) {
                        it | 0x20
                    } else {
                        it
                    }
                };
                Value::Boolean(language.is_some_and(|language| {
                    let (language, wanted) = (language.chars(), wanted.chars());
                    language
                        .units()
                        .take(wanted.len())
                        .map(lower)
                        .eq(wanted.units().map(lower))
                        && language
                            .get(wanted.len())
                            .is_none_or(|it| it == b'-'.into())
                }))
            }
            Function::Last => Value::Number(context.size as f64),
            Function::LocalName => name(T::push_local_name)?,
            Function::Name => name(T::push_qualified_name)?,
            Function::NamespaceUri => name(T::push_namespace)?,
            Function::NormalizeSpace => {
                let mut out = Text::default();
                for word in words(text(0)?.chars()) {
                    if !out.is_empty() {
                        out.push_byte(b' ');
                    }
                    out.push(word);
                }
                Value::owned(out)
            }
            Function::Not => Value::Boolean(!value(0)?.to_boolean()),
            Function::Number => Value::Number(number(0)?),
            Function::Position => Value::Number(context.position as f64),
            Function::Round => Value::Number(round(number(0)?)),
            Function::StartsWith => {
                let (text, prefix) = (text(0)?, text(1)?);
                Value::Boolean(
                    text.len() >= prefix.len()
                        && text.chars().slice(0..prefix.len()) == prefix.chars(),
                )
            }
            Function::String => Value::Text(text(0)?),
            Function::StringLength => Value::Number(text(0)?.len() as f64),
            Function::Substring => {
                let (text, start) = (text(0)?, round(number(1)?));
                let end = if arguments.len() > 2 {
                    start + round(number(2)?)
                } else {
                    f64::INFINITY
                };
                let index = |position: f64| ((position - 1.0) as usize).min(text.len());
                Value::owned(if start < end {
                    text.chars().slice(index(start)..index(end))
                } else {
                    Chars::EMPTY
                })
            }
            Function::SubstringAfter => {
                let (text, part) = (text(0)?, text(1)?);
                let found = index_of(text.chars(), part.chars());
                Value::owned(found.map_or(Chars::EMPTY, |at| text.chars().skip(at + part.len())))
            }
            Function::SubstringBefore => {
                let (text, part) = (text(0)?, text(1)?);
                Value::owned(
                    text.chars()
                        .slice(0..index_of(text.chars(), part.chars()).unwrap_or(0)),
                )
            }
            Function::Sum => Value::Number(value(0)?.into_nodes()?.iter().fold(0.0, |sum, it| {
                sum + number_of(string_value(tree, *it).chars())
            })),
            Function::Translate => {
                let (text, from, to, mut out) = (text(0)?, text(1)?, text(2)?, Text::default());
                for unit in text.chars().units() {
                    let index = from.chars().units().position(|it| it == unit);
                    if let Some(unit) = index.map_or(Some(unit), |it| to.chars().get(it)) {
                        out.push_unit(unit);
                    }
                }
                Value::owned(out)
            }
            Function::True => Value::Boolean(true),
        })
    }
}

pub fn evaluate<'a, T: Tree>(
    tree: &T,
    expression: &'a Expression<T::Name>,
    node: T::Node,
) -> Evaluated<'a, T> {
    Evaluator(tree).evaluate(
        expression,
        Context {
            node,
            position: 1,
            size: 1,
        },
    )
}
