//! <https://www.w3.org/TR/1999/REC-xpath-19991116/>

mod evaluate;
mod parse;
#[cfg(test)]
mod tests;

pub use evaluate::{NotNodes, Value, evaluate};
pub use parse::{Names, ParseError, parse};

use crate::{Chars, Text};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    Element,
    Attribute,
    Text,
    Comment,
    Instruction,
    Other,
}

pub enum NameTest<N> {
    Any,
    Unprefixed {
        local: N,
        lowercase: N,
    },
    /// `None` is `*`.
    InNamespace {
        namespace: N,
        local: Option<N>,
    },
}

pub trait Tree {
    type Node: Copy + Eq + core::hash::Hash;
    type Name;

    fn kind(&self, node: Self::Node) -> NodeKind;
    /// That of an attribute is its element.
    fn parent(&self, node: Self::Node) -> Option<Self::Node>;
    fn first_child(&self, node: Self::Node) -> Option<Self::Node>;
    fn last_child(&self, node: Self::Node) -> Option<Self::Node>;
    fn next_sibling(&self, node: Self::Node) -> Option<Self::Node>;
    fn previous_sibling(&self, node: Self::Node) -> Option<Self::Node>;
    /// Without the declarations of namespaces.
    fn attributes(&self, node: Self::Node) -> impl Iterator<Item = Self::Node>;
    fn compare_order(&self, a: Self::Node, b: Self::Node) -> core::cmp::Ordering;
    /// The node is an element or an attribute.
    fn matches(&self, node: Self::Node, test: &NameTest<Self::Name>) -> bool;
    fn element_by_id(&self, root: Self::Node, id: Chars<'_>) -> Option<Self::Node>;
    /// Its own `xml:lang`.
    fn language(&self, node: Self::Node) -> Option<Text>;
    fn push_string_value(&self, node: Self::Node, out: &mut Text);
    fn push_local_name(&self, node: Self::Node, out: &mut Text);
    fn push_qualified_name(&self, node: Self::Node, out: &mut Text);
    fn push_namespace(&self, node: Self::Node, out: &mut Text);
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Axis {
    Ancestor,
    AncestorOrSelf,
    Attribute,
    Child,
    Descendant,
    DescendantOrSelf,
    Following,
    FollowingSibling,
    Namespace,
    Parent,
    Preceding,
    PrecedingSibling,
    Itself,
}

enum NodeTest<N> {
    Any,
    Kind(NodeKind),
    Instruction(Text),
    Name(NameTest<N>),
}

struct Step<N> {
    axis: Axis,
    test: NodeTest<N>,
    predicates: Vec<Expression<N>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Operator {
    Or,
    And,
    Equal,
    NotEqual,
    Less,
    LessOrEqual,
    Greater,
    GreaterOrEqual,
    Add,
    Subtract,
    Multiply,
    Divide,
    Modulo,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Function {
    Boolean,
    Ceiling,
    Concat,
    Contains,
    Count,
    False,
    Floor,
    Id,
    Lang,
    Last,
    LocalName,
    Name,
    NamespaceUri,
    NormalizeSpace,
    Not,
    Number,
    Position,
    Round,
    StartsWith,
    String,
    StringLength,
    Substring,
    SubstringAfter,
    SubstringBefore,
    Sum,
    Translate,
    True,
}

enum Start<N> {
    Context,
    Root,
    Filter(Box<Expression<N>>, Vec<Expression<N>>),
}

enum Kind<N> {
    Number(f64),
    Literal(Text),
    /// Operators of one precedence, from left to right.
    Chain(Box<Expression<N>>, Vec<(Operator, Expression<N>)>),
    /// With whether the number of signs is odd.
    Signed(Box<Expression<N>>, bool),
    Union(Vec<Expression<N>>),
    Call(Function, Vec<Expression<N>>),
    Path(Start<N>, Vec<Step<N>>),
}

pub struct Expression<N>(Kind<N>);

fn is_space(unit: u16) -> bool {
    matches!(unit, 9 | 10 | 13 | 32)
}

/// How many code units of `text` are a `Number`.
fn number_len(text: Chars<'_>) -> usize {
    let digits = |from: usize| {
        text.skip(from)
            .units()
            .take_while(|it| (0x30..=0x39).contains(it))
            .count()
    };
    let whole = digits(0);
    if text.get(whole) != Some(b'.'.into()) {
        return whole;
    }
    let fraction = digits(whole + 1);
    if whole + fraction == 0 {
        0
    } else {
        whole + 1 + fraction
    }
}

fn parse_number(digits: Chars<'_>) -> f64 {
    digits
        .units()
        .map(|it| char::from(it as u8))
        .collect::<String>()
        .parse()
        .unwrap_or(f64::NAN)
}
