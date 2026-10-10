#![allow(dead_code)] // until every rule of the plugin is written
//! refa's `ast/nodes`, `ast/visit`, `ast/transform` and `ast/set-source`. A node owns its children
//! and does not know its parent (upstream's `NoParent<..>`); `a === b` is `std::ptr::eq`.

use crate::regexp_char_set::{Char, CharSet};
use std::any::Any;

/// Byte offsets in the pattern.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct SourceLocation {
    pub(crate) start: u32,
    pub(crate) end: u32,
}

#[derive(Clone, Debug)]
pub(crate) enum Element {
    CharacterClass(CharacterClass),
    Alternation(Alternation),
    Quantifier(Quantifier),
    Assertion(Assertion),
    Unknown(Unknown),
}

/// upstream's `Parent`, to be changed.
pub(crate) enum ParentMut<'n> {
    Expression(&'n mut Expression),
    Alternation(&'n mut Alternation),
    Quantifier(&'n mut Quantifier),
    Assertion(&'n mut Assertion),
}

/// upstream's `Node`, to be read.
#[derive(Copy, Clone, Debug)]
pub(crate) enum NodeRef<'n> {
    Expression(&'n Expression),
    Concatenation(&'n Concatenation),
    Alternation(&'n Alternation),
    Assertion(&'n Assertion),
    Quantifier(&'n Quantifier),
    CharacterClass(&'n CharacterClass),
    Unknown(&'n Unknown),
}

/// upstream's `Node`, to be changed.
pub(crate) enum NodeMut<'n> {
    Expression(&'n mut Expression),
    Concatenation(&'n mut Concatenation),
    Alternation(&'n mut Alternation),
    Assertion(&'n mut Assertion),
    Quantifier(&'n mut Quantifier),
    CharacterClass(&'n mut CharacterClass),
    Unknown(&'n mut Unknown),
}

#[derive(Clone, Debug)]
pub(crate) struct Alternation {
    pub(crate) alternatives: Vec<Concatenation>,
    pub(crate) source: Option<SourceLocation>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum AssertionKind {
    Ahead,
    Behind,
}

#[derive(Clone, Debug)]
pub(crate) struct Assertion {
    pub(crate) alternatives: Vec<Concatenation>,
    pub(crate) kind: AssertionKind,
    pub(crate) negate: bool,
    pub(crate) source: Option<SourceLocation>,
}

#[derive(Clone, Debug)]
pub(crate) struct Quantifier {
    pub(crate) alternatives: Vec<Concatenation>,
    pub(crate) lazy: bool,
    pub(crate) min: u32,
    /// `Infinity` is `re::INFINITY`.
    pub(crate) max: u32,
    pub(crate) source: Option<SourceLocation>,
}

#[derive(Clone, Debug)]
pub(crate) struct CharacterClass {
    pub(crate) characters: CharSet,
    pub(crate) source: Option<SourceLocation>,
}

#[derive(Clone, Debug)]
pub(crate) struct Unknown {
    pub(crate) id: Vec<u8>,
    pub(crate) source: Option<SourceLocation>,
}

#[derive(Clone, Debug)]
pub(crate) struct Expression {
    pub(crate) alternatives: Vec<Concatenation>,
    pub(crate) source: Option<SourceLocation>,
}

#[derive(Clone, Debug)]
pub(crate) struct Concatenation {
    pub(crate) elements: Vec<Element>,
    pub(crate) source: Option<SourceLocation>,
}

macro_rules! from_node {
    ($($node:ident)*) => {$(
        impl<'n> From<&'n $node> for NodeRef<'n> {
            fn from(node: &'n $node) -> Self {
                NodeRef::$node(node)
            }
        }

        impl<'n> From<&'n mut $node> for NodeMut<'n> {
            fn from(node: &'n mut $node) -> Self {
                NodeMut::$node(node)
            }
        }
    )*};
}
from_node!(Expression Concatenation Alternation Assertion Quantifier CharacterClass Unknown);

impl<'n> From<&'n Element> for NodeRef<'n> {
    fn from(element: &'n Element) -> Self {
        match element {
            Element::CharacterClass(node) => NodeRef::CharacterClass(node),
            Element::Alternation(node) => NodeRef::Alternation(node),
            Element::Quantifier(node) => NodeRef::Quantifier(node),
            Element::Assertion(node) => NodeRef::Assertion(node),
            Element::Unknown(node) => NodeRef::Unknown(node),
        }
    }
}

impl<'n> From<&'n mut Element> for NodeMut<'n> {
    fn from(element: &'n mut Element) -> Self {
        match element {
            Element::CharacterClass(node) => NodeMut::CharacterClass(node),
            Element::Alternation(node) => NodeMut::Alternation(node),
            Element::Quantifier(node) => NodeMut::Quantifier(node),
            Element::Assertion(node) => NodeMut::Assertion(node),
            Element::Unknown(node) => NodeMut::Unknown(node),
        }
    }
}

impl ParentMut<'_> {
    pub(crate) fn alternatives(&mut self) -> &mut Vec<Concatenation> {
        match self {
            ParentMut::Expression(Expression { alternatives, .. })
            | ParentMut::Alternation(Alternation { alternatives, .. })
            | ParentMut::Quantifier(Quantifier { alternatives, .. })
            | ParentMut::Assertion(Assertion { alternatives, .. }) => alternatives,
        }
    }

    pub(crate) fn source(&self) -> Option<SourceLocation> {
        match self {
            ParentMut::Expression(Expression { source, .. })
            | ParentMut::Alternation(Alternation { source, .. })
            | ParentMut::Quantifier(Quantifier { source, .. })
            | ParentMut::Assertion(Assertion { source, .. }) => *source,
        }
    }
}

impl<'n> NodeRef<'n> {
    /// `None`: the node is no `Parent`.
    pub(crate) fn alternatives(self) -> Option<&'n [Concatenation]> {
        match self {
            NodeRef::Expression(Expression { alternatives, .. })
            | NodeRef::Alternation(Alternation { alternatives, .. })
            | NodeRef::Assertion(Assertion { alternatives, .. })
            | NodeRef::Quantifier(Quantifier { alternatives, .. }) => Some(alternatives.as_slice()),
            NodeRef::Concatenation(_) | NodeRef::CharacterClass(_) | NodeRef::Unknown(_) => None,
        }
    }

    pub(crate) fn source(self) -> Option<SourceLocation> {
        match self {
            NodeRef::Expression(Expression { source, .. })
            | NodeRef::Concatenation(Concatenation { source, .. })
            | NodeRef::Alternation(Alternation { source, .. })
            | NodeRef::Assertion(Assertion { source, .. })
            | NodeRef::Quantifier(Quantifier { source, .. })
            | NodeRef::CharacterClass(CharacterClass { source, .. })
            | NodeRef::Unknown(Unknown { source, .. }) => *source,
        }
    }
}

impl NodeMut<'_> {
    fn source(&mut self) -> &mut Option<SourceLocation> {
        match self {
            NodeMut::Expression(Expression { source, .. })
            | NodeMut::Concatenation(Concatenation { source, .. })
            | NodeMut::Alternation(Alternation { source, .. })
            | NodeMut::Assertion(Assertion { source, .. })
            | NodeMut::Quantifier(Quantifier { source, .. })
            | NodeMut::CharacterClass(CharacterClass { source, .. })
            | NodeMut::Unknown(Unknown { source, .. }) => source,
        }
    }
}

/// Which of `on..Enter` and `on..Leave` is called.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Visit {
    Enter,
    Leave,
}

/// upstream's `visitAst`: `visitor` is all fourteen of `VisitAstHandler`. It cannot stop the walk.
pub(crate) fn visit_ast<'n>(node: NodeRef<'n>, visitor: &mut dyn FnMut(NodeRef<'n>, Visit)) {
    visitor(node, Visit::Enter);

    if let Some(alternatives) = node.alternatives() {
        for concat in alternatives {
            visit_ast(concat.into(), visitor);
        }
    } else if let NodeRef::Concatenation(node) = node {
        for element in &node.elements {
            visit_ast(element.into(), visitor);
        }
    }

    visitor(node, Visit::Leave);
}

/// It sees and changes nothing but the subtree that it is given. Always applied bottom-up.
pub(crate) trait Transformer: Any + Send + Sync {
    fn on_alternation(&self, _node: &mut Alternation, _context: &mut TransformContext) {}
    fn on_assertion(&self, _node: &mut Assertion, _context: &mut TransformContext) {}
    fn on_character_class(&self, _node: &mut CharacterClass, _context: &mut TransformContext) {}
    fn on_concatenation(&self, _node: &mut Concatenation, _context: &mut TransformContext) {}
    fn on_expression(&self, _node: &mut Expression, _context: &mut TransformContext) {}
    fn on_quantifier(&self, _node: &mut Quantifier, _context: &mut TransformContext) {}
    fn on_unknown(&self, _node: &mut Unknown, _context: &mut TransformContext) {}
}

pub(crate) struct TransformContext {
    /// The maximum of all sets in the tree; 0 if it had none when the transformation began.
    pub(crate) max_character: Char,
    changed: bool,
}

impl TransformContext {
    pub(crate) fn new(max_character: Char) -> TransformContext {
        TransformContext {
            max_character,
            changed: false,
        }
    }

    /// The transformer has changed the tree.
    pub(crate) fn signal_mutation(&mut self) {
        self.changed = true;
    }
}

/// Runs all its transformers in order.
pub(crate) struct CombinedTransformer {
    transformers: Vec<Box<dyn Transformer>>,
}

impl CombinedTransformer {
    /// In place of a `CombinedTransformer` in the list stand its transformers.
    pub(crate) fn new(transformers: Vec<Box<dyn Transformer>>) -> CombinedTransformer {
        let mut list: Vec<Box<dyn Transformer>> = Vec::with_capacity(transformers.len());
        for t in transformers {
            let any: &dyn Any = &*t;
            if any.is::<CombinedTransformer>() {
                let any: Box<dyn Any> = t;
                if let Ok(combined) = any.downcast::<CombinedTransformer>() {
                    list.extend(combined.transformers);
                }
            } else {
                list.push(t);
            }
        }
        CombinedTransformer { transformers: list }
    }
}

impl Transformer for CombinedTransformer {
    fn on_alternation(&self, node: &mut Alternation, context: &mut TransformContext) {
        for t in &self.transformers {
            t.on_alternation(node, context);
        }
    }

    fn on_assertion(&self, node: &mut Assertion, context: &mut TransformContext) {
        for t in &self.transformers {
            t.on_assertion(node, context);
        }
    }

    fn on_character_class(&self, node: &mut CharacterClass, context: &mut TransformContext) {
        for t in &self.transformers {
            t.on_character_class(node, context);
        }
    }

    fn on_concatenation(&self, node: &mut Concatenation, context: &mut TransformContext) {
        for t in &self.transformers {
            t.on_concatenation(node, context);
        }
    }

    fn on_expression(&self, node: &mut Expression, context: &mut TransformContext) {
        for t in &self.transformers {
            t.on_expression(node, context);
        }
    }

    fn on_quantifier(&self, node: &mut Quantifier, context: &mut TransformContext) {
        for t in &self.transformers {
            t.on_quantifier(node, context);
        }
    }

    fn on_unknown(&self, node: &mut Unknown, context: &mut TransformContext) {
        for t in &self.transformers {
            t.on_unknown(node, context);
        }
    }
}

/// upstream's `transform`. `max_passes`: `None` is upstream's default.
pub(crate) fn transform(
    transformer: &dyn Transformer,
    mut ast: Expression,
    max_passes: Option<u32>,
) -> Expression {
    let max_character = determine_max_character(&ast);

    for _ in 0..max_passes.unwrap_or(10) {
        if !transform_pass(transformer, &mut ast, max_character) {
            break;
        }
    }

    ast
}

/// upstream's `determineMaxCharacter`: of the first set in the tree.
fn determine_max_character(ast: &Expression) -> Char {
    let mut maximum = None;
    visit_ast(ast.into(), &mut |node, visit| {
        if maximum.is_none()
            && visit == Visit::Enter
            && let NodeRef::CharacterClass(node) = node
        {
            maximum = Some(node.characters.maximum());
        }
    });
    maximum.unwrap_or(0)
}

/// upstream's `transformPass`
fn transform_pass(
    transformer: &dyn Transformer,
    ast: &mut Expression,
    max_character: Char,
) -> bool {
    let mut context = TransformContext::new(max_character);
    leave_node(ast.into(), transformer, &mut context);
    context.changed
}

/// `visitAst` with upstream's `leaveNode` as every `on..Leave`.
fn leave_node(node: NodeMut<'_>, transformer: &dyn Transformer, context: &mut TransformContext) {
    match node {
        NodeMut::Expression(node) => {
            leave_alternatives(&mut node.alternatives, transformer, context);
            transformer.on_expression(node, context);
        }
        NodeMut::Concatenation(node) => {
            for element in &mut node.elements {
                leave_node(element.into(), transformer, context);
            }
            transformer.on_concatenation(node, context);
        }
        NodeMut::Alternation(node) => {
            leave_alternatives(&mut node.alternatives, transformer, context);
            transformer.on_alternation(node, context);
        }
        NodeMut::Assertion(node) => {
            leave_alternatives(&mut node.alternatives, transformer, context);
            transformer.on_assertion(node, context);
        }
        NodeMut::Quantifier(node) => {
            leave_alternatives(&mut node.alternatives, transformer, context);
            transformer.on_quantifier(node, context);
        }
        NodeMut::CharacterClass(node) => transformer.on_character_class(node, context),
        NodeMut::Unknown(node) => transformer.on_unknown(node, context),
    }
}

fn leave_alternatives(
    alternatives: &mut [Concatenation],
    transformer: &dyn Transformer,
    context: &mut TransformContext,
) {
    for concat in alternatives {
        leave_node(concat.into(), transformer, context);
    }
}

/// upstream's `setSource` without `overwrite`: of the node and of all below it.
pub(crate) fn set_source(node: NodeMut<'_>, source: SourceLocation) {
    set_source_impl(node, source);
}

/// upstream's `setSourceImpl`: below a node that has a source, that one is given.
fn set_source_impl(mut node: NodeMut<'_>, source: SourceLocation) {
    let source = *node.source().get_or_insert(source);

    match node {
        NodeMut::Concatenation(node) => {
            for e in &mut node.elements {
                set_source_impl(e.into(), source);
            }
        }
        NodeMut::Alternation(Alternation { alternatives, .. })
        | NodeMut::Assertion(Assertion { alternatives, .. })
        | NodeMut::Expression(Expression { alternatives, .. })
        | NodeMut::Quantifier(Quantifier { alternatives, .. }) => {
            for c in alternatives {
                set_source_impl(c.into(), source);
            }
        }
        NodeMut::CharacterClass(_) | NodeMut::Unknown(_) => {}
    }
}
