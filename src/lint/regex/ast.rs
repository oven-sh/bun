//! The syntax tree of a regular expression: the AST of `@eslint-community/regexpp`.
//!
//! | regexpp | Here |
//! | --- | --- |
//! | `new RegExpParser(options).parsePattern(source, 0, source.length, { unicode, unicodeSets })` | [`parse_pattern`](super::parse_pattern) |
//! | `parseRegExpLiteral(source, options)` | [`parse_literal`](super::parse_literal) |
//! | `new RegExpValidator(options).validatePattern(..)`, `validateFlags(..)` | [`validate_pattern`](super::validate_pattern), [`validate_flags`](super::validate_flags) with [`Ignore`](super::Ignore) |
//! | `new RegExpValidator({ onCharacter(start, end, cp) {} })` | the same with a [`Handler`](super::Handler) |
//! | `error.message`, `error.index` | [`SyntaxError`](super::SyntaxError): `message`, `index`, and `offset` in bytes |
//! | `node.type` | [`Node::ty`], or `match node.kind()` |
//! | `node.parent` | [`Node::parent`] |
//! | `node.start`, `node.end` | [`Node::start`], [`Node::end`]: **byte** offsets in the source that was parsed. [`Node::utf16_start`], [`Node::utf16_end`] are regexpp's numbers |
//! | `node.raw` | [`Node::raw`] |
//! | `visitRegExpAST(node, { onXEnter, onXLeave })` | [`Node::visit`] with a [`Visitor`], or a loop over [`Node::descendants`] when only `Enter` handlers are used |
//! | `max: Infinity` | [`INFINITY`] |
//!
//! The nodes are in one vector, a [`Node`] is a reference to the [`Ast`] and an index.
//!
//! Without the `u` or `v` flag a character outside the BMP is two [`Kind::Character`]s, a lead and
//! a trail surrogate, as in regexpp. The first covers the first two of its four bytes and the
//! second the other two.

use super::wtf8;
use smallvec::SmallVec;
use std::cell::OnceCell;

/// The `max` of `*`, `+` and `{n,}`.
pub const INFINITY: u32 = u32::MAX;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct NodeId(pub(super) u32);

impl NodeId {
    pub(super) const NONE: NodeId = NodeId(u32::MAX);

    #[inline]
    fn get(self) -> Option<NodeId> {
        (self != NodeId::NONE).then_some(self)
    }
}

/// A run of `Ast::lists` or of `Ast::text`.
#[derive(Copy, Clone, Default, Debug)]
pub(super) struct Run {
    pub(super) start: u32,
    pub(super) len: u32,
}

impl Run {
    pub(super) const NONE: Run = Run {
        start: u32::MAX,
        len: 0,
    };
}

/// `/pattern/flags`
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct Flags {
    pub global: bool,
    pub ignore_case: bool,
    pub multiline: bool,
    pub unicode: bool,
    pub sticky: bool,
    pub dot_all: bool,
    pub has_indices: bool,
    pub unicode_sets: bool,
}

/// `regex.flags`
impl std::fmt::Display for Flags {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for (flag, letter) in [
            (self.has_indices, "d"),
            (self.global, "g"),
            (self.ignore_case, "i"),
            (self.multiline, "m"),
            (self.dot_all, "s"),
            (self.unicode, "u"),
            (self.unicode_sets, "v"),
            (self.sticky, "y"),
        ] {
            if flag {
                f.write_str(letter)?;
            }
        }
        Ok(())
    }
}

/// The flags in `(?ims-ims:)`
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct ModifierFlags {
    pub ignore_case: bool,
    pub multiline: bool,
    pub dot_all: bool,
}

#[derive(Copy, Clone, Debug)]
pub(super) enum Data {
    RegExpLiteral {
        pattern: NodeId,
        flags: NodeId,
    },
    Pattern {
        alternatives: Run,
    },
    Alternative {
        elements: Run,
    },
    Group {
        modifiers: NodeId,
        alternatives: Run,
    },
    CapturingGroup {
        name: Run,
        alternatives: Run,
        references: Run,
    },
    Lookaround {
        behind: bool,
        negate: bool,
        alternatives: Run,
    },
    Edge {
        end: bool,
    },
    WordBoundary {
        negate: bool,
    },
    Quantifier {
        min: u32,
        max: u32,
        greedy: bool,
        element: NodeId,
    },
    CharacterClass {
        unicode_sets: bool,
        negate: bool,
        elements: Run,
        expression: NodeId,
    },
    CharacterClassRange {
        min: NodeId,
        max: NodeId,
    },
    Any,
    Escape {
        set: EscapeSet,
        negate: bool,
    },
    Property {
        key: Run,
        value: Run,
        negate: bool,
        strings: bool,
    },
    ExpressionCharacterClass {
        negate: bool,
        expression: NodeId,
    },
    ClassIntersection {
        left: NodeId,
        right: NodeId,
    },
    ClassSubtraction {
        left: NodeId,
        right: NodeId,
    },
    ClassStringDisjunction {
        alternatives: Run,
    },
    StringAlternative {
        elements: Run,
    },
    Character {
        value: u32,
    },
    Backreference {
        number: u32,
        name: Run,
        resolved: Run,
    },
    Modifiers {
        add: NodeId,
        remove: NodeId,
    },
    ModifierFlags(ModifierFlags),
    Flags(Flags),
}

#[derive(Copy, Clone, Debug)]
pub(super) struct NodeData {
    pub(super) data: Data,
    pub(super) parent: NodeId,
    pub(super) start: u32,
    pub(super) end: u32,
}

/// `\d`, `\s`, `\w`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EscapeSet {
    Digit,
    Space,
    Word,
}

/// regexpp's `node.type`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum NodeType {
    RegExpLiteral,
    Pattern,
    Alternative,
    Group,
    CapturingGroup,
    Assertion,
    Quantifier,
    CharacterClass,
    CharacterClassRange,
    CharacterSet,
    ExpressionCharacterClass,
    ClassIntersection,
    ClassSubtraction,
    ClassStringDisjunction,
    StringAlternative,
    Character,
    Backreference,
    Modifiers,
    ModifierFlags,
    Flags,
}

impl NodeType {
    pub fn name(self) -> &'static str {
        match self {
            NodeType::RegExpLiteral => "RegExpLiteral",
            NodeType::Pattern => "Pattern",
            NodeType::Alternative => "Alternative",
            NodeType::Group => "Group",
            NodeType::CapturingGroup => "CapturingGroup",
            NodeType::Assertion => "Assertion",
            NodeType::Quantifier => "Quantifier",
            NodeType::CharacterClass => "CharacterClass",
            NodeType::CharacterClassRange => "CharacterClassRange",
            NodeType::CharacterSet => "CharacterSet",
            NodeType::ExpressionCharacterClass => "ExpressionCharacterClass",
            NodeType::ClassIntersection => "ClassIntersection",
            NodeType::ClassSubtraction => "ClassSubtraction",
            NodeType::ClassStringDisjunction => "ClassStringDisjunction",
            NodeType::StringAlternative => "StringAlternative",
            NodeType::Character => "Character",
            NodeType::Backreference => "Backreference",
            NodeType::Modifiers => "Modifiers",
            NodeType::ModifierFlags => "ModifierFlags",
            NodeType::Flags => "Flags",
        }
    }
}

/// A parsed regular expression, or a parsed pattern.
#[derive(Debug)]
pub struct Ast<'s> {
    pub(super) source: &'s [u8],
    pub(super) nodes: Vec<NodeData>,
    /// The children of the nodes that have a list of them.
    pub(super) lists: Vec<NodeId>,
    /// Names that are not written as such in the source.
    pub(super) text: Vec<u8>,
    pub(super) root: NodeId,
    pub(super) utf16: OnceCell<wtf8::Utf16Index>,
}

impl<'s> Ast<'s> {
    /// What was parsed.
    #[inline]
    pub fn source(&self) -> &'s [u8] {
        self.source
    }

    /// [`utf16_index`](super::utf16_index) in the source, in constant time after the first time.
    fn utf16_index(&self, offset: u32) -> u32 {
        let index = self
            .utf16
            .get_or_init(|| wtf8::Utf16Index::new(self.source));
        index.of(self.source, offset as usize) as u32
    }

    /// The `RegExpLiteral` for [`parse_literal`](super::parse_literal), the `Pattern` for
    /// [`parse_pattern`](super::parse_pattern).
    #[inline]
    pub fn root(&self) -> Node<'_> {
        Node {
            ast: self,
            id: self.root,
        }
    }

    /// The `Pattern`.
    pub fn pattern(&self) -> Node<'_> {
        match self.root().kind() {
            Kind::RegExpLiteral { pattern, .. } => pattern,
            _ => self.root(),
        }
    }

    /// The capturing groups, in the order of their `(`.
    pub fn capturing_groups(&self) -> impl Iterator<Item = Node<'_>> {
        self.root()
            .descendants()
            .filter(|node| node.ty() == NodeType::CapturingGroup)
    }
}

/// A node of an [`Ast`].
#[derive(Copy, Clone)]
pub struct Node<'a> {
    ast: &'a Ast<'a>,
    id: NodeId,
}

impl PartialEq for Node<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id && std::ptr::eq(self.ast, other.ast)
    }
}

impl Eq for Node<'_> {}

impl std::fmt::Debug for Node<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}({}..{})", self.ty().name(), self.start(), self.end())
    }
}

/// What a node is, with its fields.
#[derive(Copy, Clone, Debug)]
pub enum Kind<'a> {
    /// `/pattern/flags`
    RegExpLiteral {
        pattern: Node<'a>,
        flags: Node<'a>,
    },
    Pattern {
        alternatives: Nodes<'a>,
    },
    /// What is between two `|`.
    Alternative {
        elements: Nodes<'a>,
    },
    /// `(?:a)`, `(?i-s:a)`
    Group {
        modifiers: Option<Node<'a>>,
        alternatives: Nodes<'a>,
    },
    /// `(a)`, `(?<name>a)`
    CapturingGroup {
        name: Option<&'a [u8]>,
        alternatives: Nodes<'a>,
        references: Nodes<'a>,
    },
    Assertion(Assertion<'a>),
    /// `a*`, `a{1,2}?`. `min` and `max` are at most `INFINITY - 1` when they are written out.
    Quantifier {
        min: u32,
        max: u32,
        greedy: bool,
        element: Node<'a>,
    },
    /// `[ab]`, `[^ab]`
    CharacterClass {
        unicode_sets: bool,
        negate: bool,
        elements: Nodes<'a>,
    },
    /// `a-b` in a class.
    CharacterClassRange {
        min: Node<'a>,
        max: Node<'a>,
    },
    CharacterSet(CharacterSet<'a>),
    /// `[a--b]`, `[a&&b]`
    ExpressionCharacterClass {
        negate: bool,
        expression: Node<'a>,
    },
    /// `a&&b`
    ClassIntersection {
        left: Node<'a>,
        right: Node<'a>,
    },
    /// `a--b`
    ClassSubtraction {
        left: Node<'a>,
        right: Node<'a>,
    },
    /// `\q{a|b}`
    ClassStringDisjunction {
        alternatives: Nodes<'a>,
    },
    /// What is between two `|` in `\q{}`.
    StringAlternative {
        elements: Nodes<'a>,
    },
    /// A code point, or a code unit without the `u` and `v` flags.
    Character {
        value: u32,
    },
    /// `\1`, `\k<name>`. `resolved` has one group unless `ambiguous`.
    Backreference {
        reference: Reference<'a>,
        ambiguous: bool,
        resolved: Nodes<'a>,
    },
    /// `i-s` in `(?i-s:a)`
    Modifiers {
        add: Node<'a>,
        remove: Option<Node<'a>>,
    },
    ModifierFlags(ModifierFlags),
    Flags(Flags),
}

/// regexpp's `kind` of an `Assertion`.
#[derive(Copy, Clone, Debug)]
pub enum Assertion<'a> {
    /// `^`
    Start,
    /// `$`
    End,
    /// `\b`, `\B`
    Word { negate: bool },
    /// `(?=a)`, `(?!a)`
    Lookahead {
        negate: bool,
        alternatives: Nodes<'a>,
    },
    /// `(?<=a)`, `(?<!a)`
    Lookbehind {
        negate: bool,
        alternatives: Nodes<'a>,
    },
}

/// regexpp's `kind` of a `CharacterSet`.
#[derive(Copy, Clone, Debug)]
pub enum CharacterSet<'a> {
    /// `.`
    Any,
    /// `\d`, `\D`
    Digit { negate: bool },
    /// `\s`, `\S`
    Space { negate: bool },
    /// `\w`, `\W`
    Word { negate: bool },
    /// `\p{key=value}`, `\p{key}`, `\P{..}`. `\p{Lu}` has the key `General_Category`.
    Property {
        key: &'a [u8],
        value: Option<&'a [u8]>,
        negate: bool,
        strings: bool,
    },
}

/// regexpp's `ref` of a `Backreference`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Reference<'a> {
    Number(u32),
    Name(&'a [u8]),
}

impl<'a> Node<'a> {
    #[inline]
    fn data(self) -> &'a NodeData {
        const MISSING: NodeData = NodeData {
            data: Data::Any,
            parent: NodeId::NONE,
            start: 0,
            end: 0,
        };
        self.ast.nodes.get(self.id.0 as usize).unwrap_or(&MISSING)
    }

    #[inline]
    fn at(self, id: NodeId) -> Node<'a> {
        Node { ast: self.ast, id }
    }

    #[inline]
    fn list(self, run: Run) -> Nodes<'a> {
        let start = run.start as usize;
        Nodes {
            ast: self.ast,
            ids: self
                .ast
                .lists
                .get(start..start + run.len as usize)
                .unwrap_or_default(),
        }
    }

    fn text(self, run: Run) -> &'a [u8] {
        let start = run.start as usize;
        self.ast
            .text
            .get(start..start + run.len as usize)
            .unwrap_or_default()
    }

    #[inline]
    pub fn id(self) -> NodeId {
        self.id
    }

    #[inline]
    pub fn ast(self) -> &'a Ast<'a> {
        self.ast
    }

    #[inline]
    pub fn parent(self) -> Option<Node<'a>> {
        self.data().parent.get().map(|id| self.at(id))
    }

    /// The parent, its parent, and so on.
    pub fn ancestors(self) -> impl Iterator<Item = Node<'a>> {
        std::iter::successors(self.parent(), |node| node.parent())
    }

    /// The byte offset in [`Ast::source`] of the first character.
    #[inline]
    pub fn start(self) -> u32 {
        self.data().start
    }

    /// The byte offset in [`Ast::source`] after the last character.
    #[inline]
    pub fn end(self) -> u32 {
        self.data().end
    }

    /// regexpp's `start`: an index in the UTF-16 form of the source.
    pub fn utf16_start(self) -> u32 {
        self.ast.utf16_index(self.start())
    }

    /// regexpp's `end`.
    pub fn utf16_end(self) -> u32 {
        self.ast.utf16_index(self.end())
    }

    /// The source text of the node.
    #[inline]
    pub fn raw(self) -> &'a [u8] {
        self.ast
            .source
            .get(self.start() as usize..self.end() as usize)
            .unwrap_or_default()
    }

    pub fn ty(self) -> NodeType {
        match self.data().data {
            Data::RegExpLiteral { .. } => NodeType::RegExpLiteral,
            Data::Pattern { .. } => NodeType::Pattern,
            Data::Alternative { .. } => NodeType::Alternative,
            Data::Group { .. } => NodeType::Group,
            Data::CapturingGroup { .. } => NodeType::CapturingGroup,
            Data::Lookaround { .. } | Data::Edge { .. } | Data::WordBoundary { .. } => {
                NodeType::Assertion
            }
            Data::Quantifier { .. } => NodeType::Quantifier,
            Data::CharacterClass { .. } => NodeType::CharacterClass,
            Data::CharacterClassRange { .. } => NodeType::CharacterClassRange,
            Data::Any | Data::Escape { .. } | Data::Property { .. } => NodeType::CharacterSet,
            Data::ExpressionCharacterClass { .. } => NodeType::ExpressionCharacterClass,
            Data::ClassIntersection { .. } => NodeType::ClassIntersection,
            Data::ClassSubtraction { .. } => NodeType::ClassSubtraction,
            Data::ClassStringDisjunction { .. } => NodeType::ClassStringDisjunction,
            Data::StringAlternative { .. } => NodeType::StringAlternative,
            Data::Character { .. } => NodeType::Character,
            Data::Backreference { .. } => NodeType::Backreference,
            Data::Modifiers { .. } => NodeType::Modifiers,
            Data::ModifierFlags(_) => NodeType::ModifierFlags,
            Data::Flags(_) => NodeType::Flags,
        }
    }

    pub fn kind(self) -> Kind<'a> {
        match self.data().data {
            Data::RegExpLiteral { pattern, flags } => Kind::RegExpLiteral {
                pattern: self.at(pattern),
                flags: self.at(flags),
            },
            Data::Pattern { alternatives } => Kind::Pattern {
                alternatives: self.list(alternatives),
            },
            Data::Alternative { elements } => Kind::Alternative {
                elements: self.list(elements),
            },
            Data::Group {
                modifiers,
                alternatives,
            } => Kind::Group {
                modifiers: modifiers.get().map(|id| self.at(id)),
                alternatives: self.list(alternatives),
            },
            Data::CapturingGroup {
                name,
                alternatives,
                references,
            } => Kind::CapturingGroup {
                name: (name.start != Run::NONE.start).then(|| self.text(name)),
                alternatives: self.list(alternatives),
                references: self.list(references),
            },
            Data::Lookaround {
                behind: false,
                negate,
                alternatives,
            } => Kind::Assertion(Assertion::Lookahead {
                negate,
                alternatives: self.list(alternatives),
            }),
            Data::Lookaround {
                behind: true,
                negate,
                alternatives,
            } => Kind::Assertion(Assertion::Lookbehind {
                negate,
                alternatives: self.list(alternatives),
            }),
            Data::Edge { end: false } => Kind::Assertion(Assertion::Start),
            Data::Edge { end: true } => Kind::Assertion(Assertion::End),
            Data::WordBoundary { negate } => Kind::Assertion(Assertion::Word { negate }),
            Data::Quantifier {
                min,
                max,
                greedy,
                element,
            } => Kind::Quantifier {
                min,
                max,
                greedy,
                element: self.at(element),
            },
            Data::CharacterClass {
                unicode_sets,
                negate,
                elements,
                ..
            } => Kind::CharacterClass {
                unicode_sets,
                negate,
                elements: self.list(elements),
            },
            Data::CharacterClassRange { min, max } => Kind::CharacterClassRange {
                min: self.at(min),
                max: self.at(max),
            },
            Data::Any => Kind::CharacterSet(CharacterSet::Any),
            Data::Escape {
                set: EscapeSet::Digit,
                negate,
            } => Kind::CharacterSet(CharacterSet::Digit { negate }),
            Data::Escape {
                set: EscapeSet::Space,
                negate,
            } => Kind::CharacterSet(CharacterSet::Space { negate }),
            Data::Escape {
                set: EscapeSet::Word,
                negate,
            } => Kind::CharacterSet(CharacterSet::Word { negate }),
            Data::Property {
                key,
                value,
                negate,
                strings,
            } => Kind::CharacterSet(CharacterSet::Property {
                key: self.text(key),
                value: (value.start != Run::NONE.start).then(|| self.text(value)),
                negate,
                strings,
            }),
            Data::ExpressionCharacterClass { negate, expression } => {
                Kind::ExpressionCharacterClass {
                    negate,
                    expression: self.at(expression),
                }
            }
            Data::ClassIntersection { left, right } => Kind::ClassIntersection {
                left: self.at(left),
                right: self.at(right),
            },
            Data::ClassSubtraction { left, right } => Kind::ClassSubtraction {
                left: self.at(left),
                right: self.at(right),
            },
            Data::ClassStringDisjunction { alternatives } => Kind::ClassStringDisjunction {
                alternatives: self.list(alternatives),
            },
            Data::StringAlternative { elements } => Kind::StringAlternative {
                elements: self.list(elements),
            },
            Data::Character { value } => Kind::Character { value },
            Data::Backreference {
                number,
                name,
                resolved,
            } => Kind::Backreference {
                reference: if name.start == Run::NONE.start {
                    Reference::Number(number)
                } else {
                    Reference::Name(self.text(name))
                },
                ambiguous: resolved.len != 1,
                resolved: self.list(resolved),
            },
            Data::Modifiers { add, remove } => Kind::Modifiers {
                add: self.at(add),
                remove: remove.get().map(|id| self.at(id)),
            },
            Data::ModifierFlags(flags) => Kind::ModifierFlags(flags),
            Data::Flags(flags) => Kind::Flags(flags),
        }
    }

    /// The `value` of a `Character`.
    #[inline]
    pub fn character(self) -> Option<u32> {
        match self.data().data {
            Data::Character { value } => Some(value),
            _ => None,
        }
    }

    /// The `alternatives` of a `Pattern`, a `Group`, a `CapturingGroup`, a lookaround `Assertion`
    /// or a `ClassStringDisjunction`. Empty for other nodes.
    pub fn alternatives(self) -> Nodes<'a> {
        match self.data().data {
            Data::Pattern { alternatives }
            | Data::Group { alternatives, .. }
            | Data::CapturingGroup { alternatives, .. }
            | Data::Lookaround { alternatives, .. }
            | Data::ClassStringDisjunction { alternatives } => self.list(alternatives),
            _ => self.list(Run::default()),
        }
    }

    /// The `elements` of an `Alternative`, a `CharacterClass` or a `StringAlternative`. Empty for
    /// other nodes.
    pub fn elements(self) -> Nodes<'a> {
        match self.data().data {
            Data::Alternative { elements }
            | Data::CharacterClass { elements, .. }
            | Data::StringAlternative { elements } => self.list(elements),
            _ => self.list(Run::default()),
        }
    }

    /// Calls `f` with each child, in the order in which `visitRegExpAST` visits them.
    fn each_child(self, mut f: impl FnMut(NodeId)) {
        let list = |run: Run| self.list(run).ids.iter().copied();
        match self.data().data {
            Data::RegExpLiteral {
                pattern: a,
                flags: b,
            }
            | Data::CharacterClassRange { min: a, max: b }
            | Data::ClassIntersection { left: a, right: b }
            | Data::ClassSubtraction { left: a, right: b } => {
                f(a);
                f(b);
            }
            Data::Pattern { alternatives: run }
            | Data::CapturingGroup {
                alternatives: run, ..
            }
            | Data::Lookaround {
                alternatives: run, ..
            }
            | Data::ClassStringDisjunction { alternatives: run }
            | Data::Alternative { elements: run }
            | Data::CharacterClass { elements: run, .. }
            | Data::StringAlternative { elements: run } => list(run).for_each(f),
            Data::Group {
                modifiers,
                alternatives,
            } => {
                if let Some(modifiers) = modifiers.get() {
                    f(modifiers);
                }
                list(alternatives).for_each(f);
            }
            Data::Quantifier { element: a, .. }
            | Data::ExpressionCharacterClass { expression: a, .. } => f(a),
            Data::Modifiers { add, remove } => {
                f(add);
                if let Some(remove) = remove.get() {
                    f(remove);
                }
            }
            Data::Edge { .. }
            | Data::WordBoundary { .. }
            | Data::Any
            | Data::Escape { .. }
            | Data::Property { .. }
            | Data::Character { .. }
            | Data::Backreference { .. }
            | Data::ModifierFlags(_)
            | Data::Flags(_) => {}
        }
    }

    /// `visitRegExpAST(node, handlers)`
    pub fn visit(self, visitor: &mut impl Visitor<'a>) {
        let mut stack: SmallVec<[(NodeId, bool); 32]> = SmallVec::new();
        stack.push((self.id, false));
        while let Some((id, leaving)) = stack.pop() {
            let node = self.at(id);
            if leaving {
                visitor.leave(node);
                continue;
            }
            visitor.enter(node);
            stack.push((id, true));
            let first = stack.len();
            node.each_child(|child| stack.push((child, false)));
            if let Some(children) = stack.get_mut(first..) {
                children.reverse();
            }
        }
    }

    /// This node and all nodes below it, each before its children, in source order.
    pub fn descendants(self) -> Descendants<'a> {
        let mut stack = SmallVec::new();
        stack.push(self.id);
        Descendants {
            ast: self.ast,
            stack,
        }
    }
}

/// The handlers of `visitRegExpAST`. `match node.kind()` to tell the nodes apart.
pub trait Visitor<'a> {
    fn enter(&mut self, _node: Node<'a>) {}
    fn leave(&mut self, _node: Node<'a>) {}
}

/// See [`Node::descendants`].
pub struct Descendants<'a> {
    ast: &'a Ast<'a>,
    stack: SmallVec<[NodeId; 32]>,
}

impl<'a> Iterator for Descendants<'a> {
    type Item = Node<'a>;

    fn next(&mut self) -> Option<Node<'a>> {
        let node = Node {
            ast: self.ast,
            id: self.stack.pop()?,
        };
        let first = self.stack.len();
        node.each_child(|child| self.stack.push(child));
        if let Some(children) = self.stack.get_mut(first..) {
            children.reverse();
        }
        Some(node)
    }
}

/// A list of nodes.
#[derive(Copy, Clone)]
pub struct Nodes<'a> {
    ast: &'a Ast<'a>,
    ids: &'a [NodeId],
}

impl std::fmt::Debug for Nodes<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(*self).finish()
    }
}

impl<'a> Nodes<'a> {
    #[inline]
    pub fn len(self) -> usize {
        self.ids.len()
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.ids.is_empty()
    }

    #[inline]
    pub fn get(self, index: usize) -> Option<Node<'a>> {
        self.ids.get(index).map(|id| Node {
            ast: self.ast,
            id: *id,
        })
    }

    #[inline]
    pub fn first(self) -> Option<Node<'a>> {
        self.get(0)
    }

    #[inline]
    pub fn iter(self) -> NodesIter<'a> {
        NodesIter {
            ast: self.ast,
            ids: self.ids.iter(),
        }
    }
}

impl<'a> IntoIterator for Nodes<'a> {
    type Item = Node<'a>;
    type IntoIter = NodesIter<'a>;

    #[inline]
    fn into_iter(self) -> NodesIter<'a> {
        self.iter()
    }
}

#[derive(Clone)]
pub struct NodesIter<'a> {
    ast: &'a Ast<'a>,
    ids: std::slice::Iter<'a, NodeId>,
}

impl<'a> Iterator for NodesIter<'a> {
    type Item = Node<'a>;

    #[inline]
    fn next(&mut self) -> Option<Node<'a>> {
        self.ids.next().map(|id| Node {
            ast: self.ast,
            id: *id,
        })
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.ids.size_hint()
    }
}

impl DoubleEndedIterator for NodesIter<'_> {
    #[inline]
    fn next_back(&mut self) -> Option<Self::Item> {
        self.ids.next_back().map(|id| Node {
            ast: self.ast,
            id: *id,
        })
    }
}

impl ExactSizeIterator for NodesIter<'_> {}
