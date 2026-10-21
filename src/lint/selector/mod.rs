//! esquery selectors, the language of `no-restricted-syntax`'s options.
//!
//! A selector is compiled once, when the config is loaded, into a matcher on [`crate::ast`]'s handles. No ESTree is
//! built: the ESTree type and field names in the selector are bound to the accessors in `crate::estree`'s table.
//!
//! ```ignore
//! // In `Rule::new`:
//! let selector = Selector::parse(b"CallExpression[callee.name='foo']")?;
//! const ON: On = On::new().nodes(NodeTags::ALL);
//! // Only listen to the node kinds that can produce a match.
//! fn narrow<'a>(&self, _: &'a File<'a>) -> On {
//!     On::new().nodes(self.selector.listens_to())
//! }
//! fn node<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
//!     EsNode::for_each_at(node, |found| match self.selector.test(found) {
//!         Ok(true) => drop(cx.report(found, MESSAGE)),
//!         Ok(false) => {}
//!         Err(error) => cx.throw_for_selector(&error),
//!     });
//! }
//! ```
//!
//! Those calls come in no particular order, so see [`sort_as_called`]. `enter` and `exit` work as well.
//!
//! The grammar is esquery 1.7's, and a selector matches the nodes that ESLint would call a listener with: see
//! [`Selector::parse`]. The nodes are those of the parser set in `languageOptions.parser`, so with ESLint's own parser
//! an `Identifier` has no `[optional]`.
//!
//! A path in `[a.b.c]` can go through node fields, `type`, `parent`, `range`, `loc`, `start` and `end` with ESLint's
//! own parser, the `length` and elements of lists and strings, and the properties of a `RegExp`. It can't go through
//! the `Program`'s `tokens` and `comments`.
//!
//! The cost for a node that's listened for is finding the ESTree nodes it produces, plus one bit test on each one's
//! type. Only nodes whose type can match are examined further, going upwards from the node. `:has()` searches the
//! descendants, and `~`, `+` and `:nth-child()` search the list that contains the node, each until the answer is known.
//! Nothing is allocated, unless a list or a `RegExp` is compared with a string.

mod compile;
mod listen;
mod matcher;
mod parse;
mod program;
mod value;

pub use listen::sort_as_called;

use crate::ast::Node;
use crate::estree::{Dialect, NodeType, VNode};
use crate::rule::NodeTags;
use crate::span::{Span, Spanned};
use matcher::Matcher;
use program::{Id, Op, Program, TypeSet};
use std::cell::Cell;
use std::cmp::Ordering;

/// Why a selector can't be used.
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

    /// `esquery`'s `RangeError`. There too, the depth at which it's thrown depends on the machine.
    fn too_deep() -> Error {
        Error::new(b"Maximum call stack size exceeded".to_vec())
    }

    /// `esquery.parse` returns `undefined`, which ESLint doesn't expect.
    fn empty() -> Error {
        Error::new(b"Cannot read properties of undefined (reading 'type')".to_vec())
    }

    fn unknown_class(name: &[u8]) -> Error {
        Error::new([b"Unknown class name: ", name].concat())
    }

    /// The message of the error that ESLint throws.
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

/// A node of the ESTree that ESLint's parser would produce for the file. No such tree exists: this is a [`crate::ast`]
/// node plus which part of it is meant.
#[derive(Copy, Clone, Debug)]
pub struct EsNode<'a> {
    node: VNode<'a>,
    // Derived from `node`, and stored so that it's computed once.
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
    /// `node_type` must be `node`'s type.
    #[inline]
    pub(crate) fn of(node: VNode<'a>, node_type: NodeType) -> EsNode<'a> {
        EsNode {
            node,
            node_type,
            dialect: node.dialect(),
        }
    }

    /// ESTree's `range`, in bytes.
    #[inline]
    pub fn span(self) -> Span {
        self.node.span()
    }

    /// Calls `visit` with each ESTree node that `node` produces, outer nodes before the ones inside them. Over all of a
    /// file's nodes, that covers every ESTree node exactly once.
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
    /// The types of nodes that can match. `None` means any.
    types: Option<TypeSet>,
    tags: NodeTags,
    /// True if every node with one of `types` matches.
    always_matches: bool,
    attribute_count: u32,
    identifier_count: u32,
}

impl Selector {
    /// Compiles a listener name from an ESLint rule: an esquery selector, followed by `:exit` for a listener that's
    /// called on leaving the node.
    ///
    /// As in ESLint, a type name that determines which nodes can match at all has to be spelled exactly like the type:
    /// `identifier` matches nothing, while `:not(identifier)` excludes every `Identifier`.
    ///
    /// The error has the message that ESLint throws. One difference: a class that doesn't exist, like `:foo`, is an
    /// error here. ESLint only throws when it first has to decide whether a node is of that class.
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
        let looked_up = analysis.analyze(&program, root);
        if analysis.is_too_deep {
            return Err(Error::too_deep());
        }
        let types = match (looked_up, compile::possible_types(&program, root)) {
            (Some(looked_up), Some(possible)) => Some(looked_up.intersection(possible)),
            (looked_up, possible) => looked_up.or(possible),
        };
        compile::optimize(&mut program);
        Ok(Selector {
            source: source.into(),
            is_exit: source.ends_with(b":exit"),
            always_matches: compile::always_matches(&program, root),
            tags: match types {
                Some(types) => types
                    .iter()
                    .fold(NodeTags::EMPTY, |tags, it| tags | it.listens_to()),
                None => NodeTags::ALL,
            },
            program,
            root,
            types,
            attribute_count: analysis.attribute_count,
            identifier_count: analysis.identifier_count,
        })
    }

    /// The text that was passed to [`Selector::parse`].
    #[inline]
    pub fn source(&self) -> &[u8] {
        &self.source
    }

    /// True if it ends with `:exit`.
    #[inline]
    pub fn is_exit(&self) -> bool {
        self.is_exit
    }

    /// The [`crate::ast`] node kinds that can produce a matching node, i.e. what to listen for.
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

    /// ESLint's `compare`: `Less` if this selector's listener is called before `other`'s for the same node. The less
    /// specific one comes first.
    pub fn compare(&self, other: &Selector) -> Ordering {
        (self.attribute_count.cmp(&other.attribute_count))
            .then(self.identifier_count.cmp(&other.identifier_count))
            .then_with(|| bun_core::strings::order_utf16(&self.source, &other.source))
    }

    /// True if ESLint calls the listener with `node`. `Err` if there isn't enough stack left to evaluate the selector.
    #[inline]
    pub fn test(&self, node: EsNode<'_>) -> Result<bool, Error> {
        if !self.types.is_none_or(|it| it.contains(node.node_type)) {
            return Ok(false);
        }
        if self.always_matches {
            return Ok(true);
        }
        self.matches_slowly(node)
    }

    /// [`Selector::test`], with an error treated as `false`.
    #[inline]
    pub fn matches(&self, node: EsNode<'_>) -> bool {
        self.test(node).unwrap_or(false)
    }

    fn matches_slowly(&self, node: EsNode<'_>) -> Result<bool, Error> {
        let is_too_deep = Cell::new(false);
        let matcher = Matcher {
            program: &self.program,
            dialect: node.dialect,
            limit: None,
            stack: bun_core::StackCheck::init(),
            is_too_deep: &is_too_deep,
        };
        let matches = matcher.matches(self.root, node.node, node.node_type);
        match is_too_deep.get() {
            true => Err(Error::too_deep()),
            false => Ok(matches),
        }
    }
}
