//! esquery selectors, which some options of ESLint's rules are written in (`no-restricted-syntax`, `ignoredNodes` of `indent`).
//!
//! A selector is compiled once, when the configuration is loaded, into a matcher on the handles of [`crate::ast`]. No ESTree is
//! built: the names of ESTree's types and fields in the selector are bound to the accessors in the table of `crate::estree`.
//!
//! ```ignore
//! // In `Rule::new`:
//! let selector = Selector::parse(b"CallExpression[callee.name='foo']")?;
//! // In `Rule::register`: only the kinds of nodes that a match can be made of.
//! selector::listen(on, self.selector.listens_to());
//!
//! impl selector::OnNode for MyRule {
//!     fn on_node<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
//!         self.selector.for_each_match(node, |found| {
//!             cx.report(found, MESSAGE);
//!         });
//!     }
//! }
//! ```
//!
//! [`listen`] calls in no particular order. `on.enter(selector.listens_to(), ..)` and `on.exit(..)` work as well.
//!
//! The grammar is that of esquery 1.7, and what matches is what ESLint calls a listener with: see [`Selector::parse`]. The nodes are
//! those of the parser that `languageOptions.parser` says, so with ESLint's own there is no `[optional]` in an `Identifier`.
//!
//! What a path in `[a.b.c]` can go through: the fields of nodes, `type`, `parent`, `range`, `loc`, with ESLint's own parser `start`
//! and `end`, the `length` and the elements of lists and strings, the properties of a `RegExp`. Not `tokens` and `comments` of the
//! `Program`.
//!
//! The cost of a node that is listened for: finding the ESTree nodes that are made of it, and a test of a bit for the type of each.
//! Only for those of a type that can match is anything else looked at, upwards from the node. `:has()` goes through the descendants,
//! `~`, `+` and `:nth-child()` through the list that the node is in, each until the answer is known. Nothing is allocated, unless a
//! list or a `RegExp` is compared with a string.

mod compile;
mod listen;
mod matcher;
mod parse;
mod program;
mod value;

pub use listen::{OnNode, listen, sort_as_called};

use crate::ast::Node;
use crate::estree::{Dialect, NodeType, VNode};
use crate::rule::NodeTags;
use crate::span::{Span, Spanned};
use crate::utils::text;
use matcher::Matcher;
use program::{Id, Op, Program, TypeSet};
use std::cmp::Ordering;

/// Why a selector cannot be used.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Error {
    message: Box<[u8]>,
}

impl Error {
    fn new(message: Vec<u8>) -> Error {
        Error {
            message: message.into(),
        }
    }

    fn too_deep() -> Error {
        Error::new(b"The selector is nested too deeply.".to_vec())
    }

    /// `esquery.parse` returns `undefined`, which ESLint does not expect.
    fn empty() -> Error {
        Error::new(b"Cannot read properties of undefined (reading 'type')".to_vec())
    }

    fn unknown_class(name: &[u8]) -> Error {
        Error::new([b"Unknown class name: ", name].concat())
    }

    /// The message of what ESLint throws.
    #[inline]
    pub fn message(&self) -> &[u8] {
        &self.message
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(bstr::BStr::new(&self.message), f)
    }
}

impl std::error::Error for Error {}

/// A node of the ESTree that ESLint's parser would make of the file. There is no such tree: this is a node of [`crate::ast`] and
/// which part of it is meant.
#[derive(Copy, Clone, Debug)]
pub struct EsNode<'a> {
    node: VNode<'a>,
    // What follows from `node`, to compute it once.
    node_type: NodeType,
    dialect: Dialect,
}

impl PartialEq for EsNode<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.node == other.node
    }
}
impl Eq for EsNode<'_> {}
impl std::hash::Hash for EsNode<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.node.hash(state);
    }
}

impl<'a> EsNode<'a> {
    /// `node_type`: that of `node`.
    #[inline]
    pub(crate) fn of(node: VNode<'a>, node_type: NodeType) -> EsNode<'a> {
        EsNode {
            node,
            node_type,
            dialect: node.dialect(),
        }
    }

    /// ESTree's `type`.
    #[inline]
    pub fn type_name(self) -> &'static str {
        self.node_type.name()
    }

    /// ESTree's `range`, in bytes.
    #[inline]
    pub fn span(self) -> Span {
        self.node.span()
    }

    /// The node of [`crate::ast`] that it is, or that it is a part of.
    #[inline]
    pub fn base(self) -> Node<'a> {
        self.node.base()
    }

    /// Calls `visit` with each node of the ESTree that is made of `node`, an outer one before what is in it. Over all the nodes
    /// of a file, these are all the nodes of the ESTree, each once.
    pub fn for_each_at(node: Node<'a>, mut visit: impl FnMut(EsNode<'a>)) {
        let dialect = Dialect::of(node.file());
        VNode::for_each_with_type_at(node, &mut |node, node_type| {
            visit(EsNode {
                node,
                node_type,
                dialect,
            });
        });
    }
}

impl Spanned for EsNode<'_> {
    #[inline]
    fn span(&self) -> Span {
        EsNode::span(*self)
    }
}

/// A compiled selector: ESLint's `ESQueryParsedSelector`.
pub struct Selector {
    source: Box<[u8]>,
    is_exit: bool,
    program: Program,
    root: Id,
    /// The types of the nodes that can match. `None`: any.
    types: Option<TypeSet>,
    tags: NodeTags,
    /// Every node of one of `types` matches.
    always_matches: bool,
    attribute_count: u32,
    identifier_count: u32,
}

impl Selector {
    /// Compiles what is the name of a listener in a rule of ESLint: a selector of esquery, and `:exit` after it for a listener that
    /// is called on leaving the node.
    ///
    /// As in ESLint, the name of a type that decides which nodes can match at all has to be written like the type: `identifier`
    /// matches nothing, while `:not(identifier)` leaves out every `Identifier`.
    ///
    /// The error has the message of what ESLint throws. One difference: a class that does not exist, like `:foo`, is an error here.
    /// ESLint throws when it first has to decide whether a node is of that class.
    pub fn parse(source: &[u8]) -> Result<Selector, Error> {
        let (mut program, root) = parse::parse(source.strip_suffix(b":exit").unwrap_or(source))?;
        let unknown_class = program.ops.iter().find_map(|it| match it {
            Op::UnknownClass(name) => Some(*name),
            _ => None,
        });
        if let Some(name) = unknown_class {
            return Err(Error::unknown_class(name.of(&program.bytes)));
        }
        let mut analysis = compile::Analysis::default();
        let types = match (analysis.analyze(&program, root), compile::possible_types(&program, root)) {
            (Some(looked_up), Some(possible)) => Some(looked_up.intersection(possible)),
            (looked_up, possible) => looked_up.or(possible),
        };
        compile::optimize(&mut program);
        Ok(Selector {
            source: source.into(),
            is_exit: source.ends_with(b":exit"),
            always_matches: compile::always_matches(&program, root),
            tags: match types {
                Some(types) => types.iter().fold(NodeTags::EMPTY, |tags, it| tags | it.listens_to()),
                None => NodeTags::ALL,
            },
            program,
            root,
            types,
            attribute_count: analysis.attribute_count,
            identifier_count: analysis.identifier_count,
        })
    }

    /// As it was given to [`Selector::parse`].
    #[inline]
    pub fn source(&self) -> &[u8] {
        &self.source
    }

    /// It ends with `:exit`.
    #[inline]
    pub fn is_exit(&self) -> bool {
        self.is_exit
    }

    /// The kinds of nodes of [`crate::ast`] that a node which matches can be made of: what to listen for.
    #[inline]
    pub fn listens_to(&self) -> NodeTags {
        self.tags
    }

    /// ESLint's `attributeCount`.
    #[inline]
    pub(crate) fn attribute_count(&self) -> u32 {
        self.attribute_count
    }

    /// ESLint's `identifierCount`.
    #[inline]
    pub(crate) fn identifier_count(&self) -> u32 {
        self.identifier_count
    }

    /// ESLint's `compare`: `Less` if the listener of this selector is called before that of `other` for the same node. The less
    /// specific one comes first.
    pub fn compare(&self, other: &Selector) -> Ordering {
        (self.attribute_count.cmp(&other.attribute_count))
            .then(self.identifier_count.cmp(&other.identifier_count))
            .then_with(|| text::compare(&self.source, &other.source))
    }

    /// Whether ESLint calls the listener with `node`.
    #[inline]
    pub fn matches(&self, node: EsNode<'_>) -> bool {
        if !self.types.is_none_or(|it| it.contains(node.node_type)) {
            return false;
        }
        self.always_matches || self.matches_slowly(node)
    }

    fn matches_slowly(&self, node: EsNode<'_>) -> bool {
        let matcher = Matcher {
            program: &self.program,
            dialect: node.dialect,
            limit: None,
        };
        matcher.matches(self.root, node.node, node.node_type)
    }

    /// Calls `visit` with each node of the ESTree that is made of `node` and matches, an outer one before what is in it. `node`
    /// is what a listener for [`Selector::listens_to`] is called with.
    ///
    /// With several selectors, [`EsNode::for_each_at`] and [`Selector::matches`] for each do the same with less work.
    pub fn for_each_match<'a>(&self, node: Node<'a>, mut visit: impl FnMut(EsNode<'a>)) {
        EsNode::for_each_at(node, |it| {
            if self.matches(it) {
                visit(it);
            }
        });
    }
}
