//! What a selector is compiled to: flat vectors, in which an operation refers to its operands by
//! index. Every name in the selector is resolved here, so that matching compares numbers.

use crate::estree::{Field, FieldEntry, NodeType};
use crate::regex::Regex;
use crate::utils::text;

/// The index of an [`Op`] in [`Program::ops`].
pub(super) type Id = u32;

/// Some consecutive elements of one of the vectors of a [`Program`].
#[derive(Copy, Clone, Default)]
pub(super) struct Run {
    pub(super) start: u32,
    pub(super) len: u32,
}

impl Run {
    /// From `start` to the end of `all`.
    pub(super) fn to_end_of<T>(all: &[T], start: usize) -> Run {
        Run {
            start: start as u32,
            len: all.len().saturating_sub(start) as u32,
        }
    }

    #[inline]
    pub(super) fn of<T>(self, all: &[T]) -> &[T] {
        all.get(self.start as usize..(self.start + self.len) as usize).unwrap_or_default()
    }

    #[inline]
    pub(super) fn of_mut<T>(self, all: &mut [T]) -> &mut [T] {
        all.get_mut(self.start as usize..(self.start + self.len) as usize).unwrap_or_default()
    }
}

/// A set of types of nodes.
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub(super) struct TypeSet([u64; 3]);

const _: () = assert!(NodeType::ALL.len() <= 3 * 64);

impl TypeSet {
    pub(super) fn of(types: &[NodeType]) -> TypeSet {
        TypeSet::where_(|it| types.contains(&it))
    }

    /// The types for which `holds`.
    pub(super) fn where_(holds: impl Fn(NodeType) -> bool) -> TypeSet {
        let mut set = TypeSet::default();
        for &node_type in NodeType::ALL.iter().filter(|it| holds(**it)) {
            set.0[node_type as usize / 64] |= 1 << (node_type as usize % 64);
        }
        set
    }

    #[inline]
    pub(super) fn contains(self, node_type: NodeType) -> bool {
        self.0[node_type as usize / 64] & (1 << (node_type as usize % 64)) != 0
    }

    pub(super) fn union(self, other: TypeSet) -> TypeSet {
        TypeSet(std::array::from_fn(|i| self.0[i] | other.0[i]))
    }

    pub(super) fn intersection(self, other: TypeSet) -> TypeSet {
        TypeSet(std::array::from_fn(|i| self.0[i] & other.0[i]))
    }

    pub(super) fn iter(self) -> impl Iterator<Item = NodeType> {
        NodeType::ALL.iter().copied().filter(move |it| self.contains(*it))
    }
}

#[derive(Copy, Clone)]
pub(super) enum Op {
    /// `*`
    Wildcard,
    /// `Name`, `#Name`
    Identifier {
        /// The type of that name, whatever the case: `esquery` ignores it. `None`: there is none.
        node_type: Option<NodeType>,
        /// The name is written like that of the type. ESLint looks selectors up by the name.
        is_exact: bool,
    },
    /// `:statement`, `:expression`, ..
    Class {
        types: TypeSet,
        /// The `new` and the `target` of `new.target` are not expressions.
        excludes_names_of_meta_properties: bool,
        /// It is written `:function`, which is the one class that ESLint knows the types of.
        is_written_function: bool,
    },
    /// In [`Program::bytes`].
    UnknownClass(Run),
    /// The node that a `:has()` is asked about.
    ExactNode,
    /// `.a.b`, in [`Program::keys`].
    Field(Run),
    /// `:matches()`, `:is()`, `a, b`. These four are in [`Program::lists`].
    Any(Run),
    /// `a[b].c`
    All(Run),
    /// `:not()`
    NotAny(Run),
    /// `:has()`
    Has {
        selectors: Run,
        /// Each starts with `>`.
        is_about_children: bool,
    },
    /// `left > right`
    Child(Id, Id),
    /// `left right`
    Descendant(Id, Id),
    /// `left ~ right`
    Sibling {
        left: Id,
        right: Id,
        left_is_subject: bool,
    },
    /// `left + right`
    Adjacent {
        left: Id,
        right: Id,
        right_is_subject: bool,
    },
    /// `[a.b]`, `[a.b=c]`
    Attribute {
        /// In [`Program::keys`].
        path: Run,
        /// In [`Program::tests`].
        test: u32,
        first: Bound,
    },
    /// `:nth-child()`. Negative for `:nth-last-child()`.
    NthChild(i32),
}

/// What is known about the first key of the path of an attribute from a type beside it: in
/// `CallExpression[callee.name="a"]` the `callee` is that of a `CallExpression`.
#[derive(Copy, Clone)]
pub(super) enum Bound {
    /// It is a property that nodes have besides their fields.
    No,
    /// It is this field, of whatever type the node is.
    Field(Field),
    Entry(&'static FieldEntry),
    /// No node, or none of that type, has such a field.
    Missing,
}

/// A name in a path.
#[derive(Copy, Clone)]
pub(super) struct Key {
    /// The field of nodes that has this name.
    pub(super) field: Option<Field>,
    /// What else has this name.
    pub(super) property: Property,
}

/// A property of a node that is not a field, or of a value that is not a node.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Property {
    None,
    Type,
    Parent,
    Range,
    Loc,
    /// Of a `loc`, and of a node of espree.
    Start,
    End,
    Line,
    Column,
    Length,
    Index(u32),
    /// Of the `value` of a `TemplateElement`.
    Cooked,
    Raw,
    /// Of the `regex` of a `Literal`.
    Pattern,
    /// The same, and of a `RegExp`.
    Flags,
    Source,
    LastIndex,
    /// `global`, `ignoreCase`, ..: whether a `RegExp` has this flag.
    HasFlag(u8),
}

impl Property {
    /// Nodes have it, besides their fields.
    #[inline]
    pub(super) fn is_of_nodes(self) -> bool {
        use Property::*;
        matches!(self, Type | Parent | Range | Loc | Start | End)
    }
}

impl Key {
    pub(super) fn named(name: &[u8]) -> Key {
        let property = match name {
            b"type" => Property::Type,
            b"parent" => Property::Parent,
            b"range" => Property::Range,
            b"loc" => Property::Loc,
            b"start" => Property::Start,
            b"end" => Property::End,
            b"line" => Property::Line,
            b"column" => Property::Column,
            b"length" => Property::Length,
            b"cooked" => Property::Cooked,
            b"raw" => Property::Raw,
            b"pattern" => Property::Pattern,
            b"flags" => Property::Flags,
            b"source" => Property::Source,
            b"lastIndex" => Property::LastIndex,
            b"hasIndices" => Property::HasFlag(b'd'),
            b"global" => Property::HasFlag(b'g'),
            b"ignoreCase" => Property::HasFlag(b'i'),
            b"multiline" => Property::HasFlag(b'm'),
            b"dotAll" => Property::HasFlag(b's'),
            b"unicode" => Property::HasFlag(b'u'),
            b"unicodeSets" => Property::HasFlag(b'v'),
            b"sticky" => Property::HasFlag(b'y'),
            _ => array_index(name).map_or(Property::None, Property::Index),
        };
        Key {
            field: Field::from_name(name),
            property,
        }
    }
}

/// The index that the property name `name` is for an array.
fn array_index(name: &[u8]) -> Option<u32> {
    let is_canonical = name.iter().all(u8::is_ascii_digit) && (name.len() == 1 || !name.starts_with(b"0"));
    if is_canonical { std::str::from_utf8(name).ok()?.parse().ok() } else { None }
}

/// What `typeof` says.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum JsType {
    Undefined,
    Object,
    Boolean,
    Number,
    String,
    BigInt,
}

impl JsType {
    /// `None`: no value in an ESTree is of that type.
    pub(super) fn named(name: &[u8]) -> Option<JsType> {
        Some(match name {
            b"undefined" => JsType::Undefined,
            b"object" => JsType::Object,
            b"boolean" => JsType::Boolean,
            b"number" => JsType::Number,
            b"string" => JsType::String,
            b"bigint" => JsType::BigInt,
            _ => return None,
        })
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Relation {
    Less,
    LessOrEqual,
    Greater,
    GreaterOrEqual,
}

/// What the value at the end of the path of an attribute is tested for.
pub(super) enum Test {
    /// `[a]`
    Exists,
    /// `[a=/b/]`, `[a!=/b/]`
    Regex { regex: Box<Regex>, is_negated: bool },
    /// `[a=type(b)]`, `[a!=type(b)]`
    Type { js_type: Option<JsType>, is_negated: bool },
    /// `[a=b]`, `[a!=b]`
    Equals { literal: Literal, is_negated: bool },
    /// `[a<b]`, ..
    Compare { literal: Literal, relation: Relation },
}

/// `"a"`, `'a'`, `1`, `a`
pub(super) struct Literal {
    /// `String(value)`
    pub(super) text: Box<[u8]>,
    /// It is written as a number.
    pub(super) is_number: bool,
    /// `Number(value)`
    pub(super) number: f64,
    /// The value that is not a string of which `text` is the string.
    pub(super) names: Names,
}

/// See [`Literal::names`].
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Names {
    Nothing,
    Undefined,
    Null,
    Bool(bool),
    /// [`Literal::number`]
    Number,
    /// `[object Object]`
    Object,
}

impl Literal {
    pub(super) fn new(text: Box<[u8]>, is_number: bool) -> Literal {
        let number = text::string_to_number(&text);
        let names = match &*text {
            b"undefined" => Names::Undefined,
            b"null" => Names::Null,
            b"true" => Names::Bool(true),
            b"false" => Names::Bool(false),
            b"[object Object]" => Names::Object,
            text if text::number_to_string(number) == text => Names::Number,
            _ => Names::Nothing,
        };
        Literal {
            text,
            is_number,
            number,
            names,
        }
    }
}

#[derive(Default)]
pub(super) struct Program {
    pub(super) ops: Vec<Op>,
    pub(super) lists: Vec<Id>,
    pub(super) keys: Vec<Key>,
    pub(super) tests: Vec<Test>,
    pub(super) bytes: Vec<u8>,
}
