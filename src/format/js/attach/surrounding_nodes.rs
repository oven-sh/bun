//! Converts the nodes that the parser recorded around a comment into the nodes that the printers use.
//!
//! The printers work with [`AstNodes`](crate::js::ast_nodes::AstNodes), which has extra nodes that wrap a parser node
//! or are part of one, such as `FunctionBody`, `TSTypeAnnotation` and `Decorator`. To find them, start at the recorded
//! preceding or following node and walk up through `AstNodes::parent()` until the parent contains the comment.

use super::{Options, Owner, flow};
use crate::js::ast_nodes::{
    AsAstNodes, AstNodes as N, ChainElement, ExpressionStatement, inner_of_stmt, is_inner_comma,
    node_as_ast_nodes,
};
use crate::js::format::is_in_head_of_for;
use crate::js::print::expressions::start_of_meta_property_name;
use crate::js::print::flow::{is_flow_opaque_type, is_interface_type};
use crate::js::source_text::SourceText;
use bun_lint::ast::comments::{self, NodeOrName};
use bun_lint::ast::{
    Expr, ExprKind, File, FnBody, FnKind, Func, List, Node, Param, Pat, Stmt, StmtKind, StmtTag,
    TypeKind, TypeNode,
};
use bun_lint::span::{Span, Spanned};
use std::cell::Cell;
use std::ops::Range;

/// Prettier's `enclosingNode`, `precedingNode` and `followingNode`.
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub(super) struct SurroundingNodes<'a> {
    pub(super) enclosing_node: Option<Owner<'a>>,
    pub(super) preceding_node: Option<Owner<'a>>,
    pub(super) following_node: Option<Owner<'a>>,
    /// See [`AttachContext::list_elements_around`]. If true, `enclosing_node` isn't set.
    pub(super) is_before_list_element: bool,
}

pub(super) struct AttachContext<'a, 'c> {
    pub(super) file: &'a File<'a>,
    pub(super) source: SourceText<'a>,
    pub(super) options: Options,
    /// See [`crate::js::comments::cast_parens`].
    cast_parens: &'c [u32],
    /// The last two results of [`AttachContext::comments_between_same_tokens`].
    last_comments_between_tokens: Cell<[CommentsBetweenTokens; 2]>,
    /// The last result of [`AttachContext::has_bracket_in`].
    last_search_for_bracket: Cell<(Span, bool)>,
    /// Caches an expression and the start of the chain of member accesses and calls that ends with it. All comments
    /// between two tokens look up the same expression.
    pub(super) last_start_of_chain: Cell<Option<(Expr<'a>, Owner<'a>)>>,
    pub(super) is_name_of_type_query_or_jsx_element: AnswerForAncestors,
    pub(super) is_link_of_member_chain: AnswerForAncestors,
    pub(super) has_following_node: AnswerForAncestors,
}

/// Caches the last answer to a question about a node, where the answer is the same for its parent, its grandparent, and
/// so on up to the node that decides it. `a()()()..` can be thousands of nested calls with a comment in each, so the
/// walk up happens once for all of them instead of once for each.
#[derive(Default)]
pub(super) struct AnswerForAncestors(Cell<Option<(Span, Span, bool)>>);

impl AnswerForAncestors {
    /// `step` returns the node's parent if it has the same answer, or else the answer.
    pub(super) fn find<T: Spanned + Copy>(
        &self,
        start: T,
        step: impl Fn(T) -> Result<T, bool>,
    ) -> bool {
        let mut node = start;
        let (last, answer) = loop {
            // A node that contains `first` and is inside `last` is on the cached path between them.
            if let Some((first, last, answer)) = self.0.get()
                && node.span().contains(first)
                && last.contains(node.span())
            {
                break (last, answer);
            }
            match step(node) {
                Ok(parent) => node = parent,
                Err(answer) => break (node.span(), answer),
            }
        };
        self.0.set(Some((start.span(), last, answer)));
        answer
    }
}

/// Facts the rules need about all the comments between two tokens. There can be thousands of them, so this is computed
/// once for all of them instead of once for each.
#[derive(Copy, Clone, Default)]
pub(super) struct CommentsBetweenTokens {
    pub(super) first_id: u32,
    /// The id after the last one.
    pub(super) end_id: u32,
    /// One of them has a line break before it.
    pub(super) has_line_break_before_one: bool,
    /// The first and the last comment that have no line break before them.
    pub(super) first_without_line_break_before: Option<u32>,
    pub(super) last_without_line_break_before: Option<u32>,
    /// The first comment that ends its line, if it's on the same line as the token before the comments.
    pub(super) first_that_ends_line_of_prev_token: Option<u32>,
}

impl CommentsBetweenTokens {
    pub(super) fn ids(self) -> Range<u32> {
        self.first_id..self.end_id
    }
}

/// Returns the member types of a union or intersection type.
pub(super) fn union_members(ty: TypeNode<'_>) -> Option<List<'_, TypeNode<'_>>> {
    match ty.kind() {
        // Flow's `interface { .. }` as a type is an intersection in the tree.
        TypeKind::Intersection(_) if is_interface_type(ty) => None,
        TypeKind::Union(types) | TypeKind::Intersection(types) => Some(types),
        _ => None,
    }
}

/// Returns `node`'s function if `node` is a function, a method or a call signature.
pub(super) fn function_of(node: N<'_>) -> Option<Func<'_>> {
    match node {
        N::Function(func) | N::ArrowFunctionExpression(func) => Some(func),
        N::MethodDefinition(member)
        | N::TSMethodSignature(member)
        | N::TSCallSignatureDeclaration(member)
        | N::TSConstructSignatureDeclaration(member) => member.func(),
        N::ObjectProperty(prop) => prop.func(),
        N::TSFunctionType(ty) | N::TSConstructorType(ty) => match ty.kind() {
            TypeKind::Fn(func) => Some(func),
            _ => None,
        },
        _ => None,
    }
}

/// Returns the class member or object property whose value is `func`, if `func` is a method, a getter or a setter.
fn method_of(func: Func<'_>) -> Option<Node<'_>> {
    match func.owner() {
        owner @ Node::Member(_) => Some(owner),
        Node::Expr(e) => match e.parent() {
            Node::Prop(prop) if prop.func() == Some(func) => Some(Node::Prop(prop)),
            _ => None,
        },
        _ => None,
    }
}

fn is_object_of_with<'a>(statement: Stmt<'a>, e: Expr<'a>) -> bool {
    matches!(statement.parent(), Node::Stmt(parent)
        if matches!(parent.kind(), StmtKind::With { object, .. } if object == e))
}

pub(super) fn has_parameters(func: Func<'_>) -> bool {
    func.this_param().is_some() || !func.params().is_empty()
}

/// Returns the `TSTypeAnnotation` around `node`, if `node` is the `T` of `a is T`.
fn type_annotation_of_predicate(node: N<'_>) -> Option<N<'_>> {
    let Node::Type(ty) = node.raw() else {
        return None;
    };
    (node == ty.as_ast_nodes() && is_type_of_predicate(ty)).then_some(N::TSTypeAnnotation(ty))
}

/// True if `ty` is the `T` of `a is T`.
fn is_type_of_predicate(ty: TypeNode<'_>) -> bool {
    matches!(ty.parent(), Node::Type(parent) if matches!(parent.kind(), TypeKind::Predicate { .. }))
}

/// `namespace A.B { .. }` is a namespace `B` in a namespace `A` in the HIR, and the statements are in `B`. In ESTree
/// it's one declaration, so its body is the body of `A`.
fn body_of_whole_namespace(node: N<'_>) -> N<'_> {
    match node {
        N::TSModuleBlock(statement) => match statement.as_module() {
            Some(module) => N::TSModuleBlock(module.outermost().stmt()),
            None => node,
        },
        _ => node,
    }
}

/// Returns the `{ .. }` body of `node`. The printers treat it as a separate node.
fn body_of(node: N<'_>) -> Option<N<'_>> {
    match node {
        N::Class(class) => Some(N::ClassBody(class)),
        N::TSInterfaceDeclaration(statement) if is_flow_opaque_type(statement) => None,
        N::TSInterfaceDeclaration(statement) => Some(N::TSInterfaceBody(statement)),
        N::TSEnumDeclaration(statement) => Some(N::TSEnumBody(statement)),
        N::TSModuleDeclaration(statement) | N::TSGlobalDeclaration(statement) => {
            match statement.kind() {
                StmtKind::Module(module) if module.innermost().has_body() => {
                    Some(N::TSModuleBlock(statement))
                }
                _ => None,
            }
        }
        _ => function_of(node)
            .filter(|func| {
                matches!(func.body(), FnBody::Block(_)) && func.kind() != FnKind::StaticBlock
            })
            .map(N::FunctionBody),
    }
}

/// Returns the enclosing, preceding and following nodes that the parser recorded for `comment`, adjusted for import
/// attributes. Their `{ .. }` is an object literal in the HIR, but ESTree has no node for it. There the attributes are
/// children of the declaration and come after its source.
fn recorded_nodes_without_import_attribute_braces<'a>(
    comment: comments::Comment<'a>,
) -> (
    Option<Node<'a>>,
    Option<NodeOrName<'a>>,
    Option<NodeOrName<'a>>,
) {
    let mut enclosing_node = comment.enclosing_node();
    let mut preceding_node = comment.preceding_node();
    let mut following_node = comment.following_node();
    // `import a from "a" /* comment */ with { type: "json" }`
    if let (Some(Node::Stmt(statement)), Some(NodeOrName::Node(Node::Expr(braces)))) =
        (enclosing_node, following_node)
        && let Some(attributes) = statement.import_attributes()
        && attributes.object() == braces
    {
        let first = attributes.entries().first();
        following_node = first.map(|first| NodeOrName::Node(Node::Prop(first)));
    }
    // `import a from "a" with { /* comment */ type: "json" }`, `import a from "a" with { /* comment */ }`
    if let Some(Node::Expr(braces)) = enclosing_node
        && braces.as_object().is_some()
        && let Some(Node::Stmt(statement)) = braces.owner_of_import_attributes()
    {
        enclosing_node = Some(Node::Stmt(statement));
        preceding_node = preceding_node.or_else(|| {
            let source = statement.module_specifier_span()?;
            Some(NodeOrName::Name(source.start))
        });
    }
    (enclosing_node, preceding_node, following_node)
}

/// `import { type /* comment */ a } from "b"`: the parser treats `type` or `as` as a name until it sees what follows,
/// so it may have recorded a keyword. This replaces it with the name before or after the comment.
fn without_keywords_of_specifier<'a>(
    enclosing_node: Option<Node<'a>>,
    preceding_node: &mut Option<NodeOrName<'a>>,
    following_node: &mut Option<NodeOrName<'a>>,
    comment: Span,
) {
    let names = match enclosing_node {
        Some(Node::ImportSpec(specifier)) => [specifier.imported(), specifier.local()],
        Some(Node::ExportSpec(specifier)) => [specifier.local(), specifier.exported()],
        _ => return,
    };
    let starts = names.map(|name| name.span().start);
    let is_keyword = |node: Option<NodeOrName<'a>>| matches!(node, Some(NodeOrName::Name(start)) if !starts.contains(&start));
    if is_keyword(*preceding_node) {
        let name = starts.into_iter().rfind(|start| *start < comment.start);
        *preceding_node = name.map(NodeOrName::Name);
    }
    if is_keyword(*following_node) {
        let name = starts.into_iter().find(|start| *start >= comment.end);
        *following_node = name.map(NodeOrName::Name);
    }
}

/// Returns the import attribute whose value is `node`. In the HIR the value's parent is the import, the export or the
/// import type.
fn import_attribute_of_value(node: N<'_>) -> Option<N<'_>> {
    let N::StringLiteral(value) = node else {
        return None;
    };
    let attributes = match value.parent() {
        Node::Stmt(statement) => statement.import_attributes(),
        Node::Type(import_type) => import_type.import_attributes(),
        _ => None,
    };
    (attributes?.entries().around(value.span().start))
        .filter(|attribute| attribute.value() == Some(value))
        .map(N::ObjectProperty)
}

/// Returns the import type whose attributes are the object `node`: the `import("a", { with: { b: "c" } })` around
/// `{ b: "c" }`.
fn import_type_of_attributes(node: N<'_>) -> Option<N<'_>> {
    let N::ObjectExpression(attributes) = node else {
        return None;
    };
    match attributes.as_object()?.first()?.parent() {
        Node::Type(import_type) => Some(import_type.as_ast_nodes()),
        _ => None,
    }
}

/// The `this` of `this is A` and of `asserts this` is a `TSThisType` in ESTree. The parser doesn't record it.
fn account_for_this_of_predicate(nodes: &mut SurroundingNodes<'_>, comment: Span) {
    let Some(Owner::Node(N::TSTypePredicate(predicate))) = nodes.enclosing_node else {
        return;
    };
    let Some(parameter) = predicate.predicate_param().map(|it| it.span()) else {
        return;
    };
    if comment.end <= parameter.start {
        nodes.following_node = Some(Owner::Name(parameter.start));
    } else if nodes.preceding_node.is_none() {
        nodes.preceding_node = Some(Owner::Name(parameter.start));
    }
}

/// Returns the opening tag whose name is `node`: the `<a b="c">` around `a`. `AstNodes::parent` would return the
/// element.
fn opening_element_of_name(node: N<'_>) -> Option<N<'_>> {
    let name = node.as_expression()?;
    match name.parent() {
        Node::Expr(element) if matches!(element.kind(), ExprKind::Jsx(jsx) if jsx.tag() == Some(name)) => {
            Some(N::JSXOpeningElement(element))
        }
        _ => None,
    }
}

/// `export default function () {}` and `export default class {}` are one statement in the HIR, and have no child to
/// climb up from. In ESTree the declaration is a child of the export.
fn account_for_exported_declaration_without_children(
    nodes: &mut SurroundingNodes<'_>,
    comment: Span,
) {
    let SurroundingNodes {
        enclosing_node: Some(Owner::Node(N::ExportDefaultDeclaration(statement))),
        preceding_node: None,
        following_node: None,
        ..
    } = *nodes
    else {
        return;
    };
    let declaration = inner_of_stmt(statement);
    if !matches!(declaration, N::Function(_) | N::Class(_)) {
        return;
    }
    let (span, declaration) = (declaration.span(), Some(Owner::Node(declaration)));
    if span.contains(comment) {
        nodes.enclosing_node = declaration;
    } else if comment.end <= span.start {
        nodes.following_node = declaration;
    } else {
        nodes.preceding_node = declaration;
    }
}

/// In ESTree the type annotation is a child of the `Identifier`. So for the comment in `let a /* comment */: T`, the
/// identifier is the enclosing node and not the preceding node. For oxfmt the two are siblings. The type annotation of
/// `...a: T` is a child of the `RestElement`.
fn account_for_type_annotation_of_identifier(nodes: &mut SurroundingNodes<'_>) {
    if let (
        Some(identifier @ Owner::Node(N::BindingIdentifier(name))),
        Some(Owner::Node(N::TSTypeAnnotation(_))),
    ) = (nodes.preceding_node, nodes.following_node)
        && !matches!(name.parent(), Node::Param(param) if param.is_rest())
    {
        nodes.enclosing_node = Some(identifier);
        nodes.preceding_node = decorated_identifier(name)
            .and_then(|param| param.modifiers().iter().rev().find_map(|it| it.decorator()))
            .map(|decorator| Owner::Node(N::Decorator(decorator)));
    }
    // `let a: T /* comment */ = b`: the preceding node is `a: T`.
    if let (
        Some(Owner::Node(N::VariableDeclarator(declarator))),
        Some(Owner::Node(N::TSTypeAnnotation(_))),
    ) = (nodes.enclosing_node, nodes.preceding_node)
    {
        nodes.preceding_node = Some(Owner::Node(declarator.pat().as_ast_nodes()));
    }
}

/// Returns `name`'s parameter if ESTree represents the whole parameter as one `Identifier`, which then holds the
/// decorators: `(@a b: T) => {}`.
fn decorated_identifier(name: Pat<'_>) -> Option<Param<'_>> {
    match name.parent() {
        Node::Param(param)
            if param.default().is_none() && !param.is_rest() && !param.is_parameter_property() =>
        {
            Some(param)
        }
        _ => None,
    }
}

/// `(@a /* comment */ b: T) => {}`: the children of the `Identifier` are the decorators and the type annotation. The
/// name itself isn't a node, so the following node is `: T`.
fn account_for_decorators_of_identifier(nodes: &mut SurroundingNodes<'_>) {
    if let (Some(Owner::Node(N::Decorator(_))), Some(Owner::Node(N::BindingIdentifier(name)))) =
        (nodes.preceding_node, nodes.following_node)
        && let Some(param) = decorated_identifier(name)
    {
        nodes.following_node = param.ty().map(|ty| Owner::Node(N::TSTypeAnnotation(ty)));
    }
}

/// Both words of `import.meta` and `new.target` are `Identifier`s in ESTree.
fn account_for_names_of_meta_property(nodes: &mut SurroundingNodes<'_>) {
    let Some(Owner::Node(N::MetaProperty(e))) = nodes.enclosing_node else {
        return;
    };
    nodes.preceding_node = Some(Owner::Name(e.span().start));
    if matches!(e.kind(), ExprKind::ImportMeta) {
        nodes.following_node = Some(Owner::Name(start_of_meta_property_name(e)));
    }
}

impl<'a, 'c> AttachContext<'a, 'c> {
    pub(super) fn new(file: &'a File<'a>, cast_parens: &'c [u32], options: Options) -> Self {
        AttachContext {
            file,
            source: SourceText::new(file.text()),
            options,
            cast_parens,
            last_comments_between_tokens: Cell::default(),
            last_search_for_bracket: Cell::default(),
            last_start_of_chain: Cell::default(),
            is_name_of_type_query_or_jsx_element: AnswerForAncestors::default(),
            is_link_of_member_chain: AnswerForAncestors::default(),
            has_following_node: AnswerForAncestors::default(),
        }
    }

    /// True if the text of `span` contains a `[`. Cached, because all comments between two tokens check the same span.
    pub(super) fn has_bracket_in(&self, span: Span) -> bool {
        let (last_span, last_answer) = self.last_search_for_bracket.get();
        if last_span == span {
            return last_answer;
        }
        let answer = bun_core::strings::contains_char(self.source.text_for(&span), b'[');
        self.last_search_for_bracket.set((span, answer));
        answer
    }

    pub(super) fn is_babel(&self) -> bool {
        self.options.has_babel_tree
    }

    pub(super) fn program(&self) -> Owner<'a> {
        Owner::Node(node_as_ast_nodes(Node::File(self.file)))
    }

    pub(super) fn is_cast_paren(&self, open: u32) -> bool {
        self.cast_parens.binary_search(&open).is_ok()
    }

    /// Returns the owner for the expression `e`. If `e` is wrapped in type cast parentheses, that's the outermost pair.
    pub(super) fn owner_of_expr(&self, e: Expr<'a>) -> Owner<'a> {
        if !self.cast_parens.is_empty()
            && e.is_parenthesized()
            && let Some(paren) = e
                .parens()
                .rev()
                .find(|paren| self.is_cast_paren(paren.start))
        {
            return Owner::CastParens(e, paren.start);
        }
        Owner::Node(e.as_chain_element())
    }

    /// Returns the owner for the type `ty`. Prettier removes unions and intersections with a single member from its
    /// tree, as in `type A = | B`.
    pub(super) fn owner_of_type(&self, mut ty: TypeNode<'a>) -> Owner<'a> {
        while let Some(types) = union_members(ty)
            && types.len() == 1
            && let Some(only) = types.first()
        {
            ty = only;
        }
        Owner::Node(ty.as_ast_nodes())
    }

    /// True if `owner` is the `A` of `| A` or `& A`. See [`AttachContext::owner_of_type`].
    pub(super) fn is_only_member_of_union(&self, owner: Owner<'a>) -> bool {
        matches!(owner, Owner::Node(node) if matches!(node.raw(), Node::Type(ty)
            if matches!(ty.parent(), Node::Type(parent)
                if union_members(parent).is_some_and(|types| types.len() == 1))))
    }

    pub(super) fn owner_of_stmt(&self, statement: Stmt<'a>) -> Owner<'a> {
        match statement.kind() {
            // The HIR wraps an expression in the head of a `for`, and the object of a `with`, in a statement. ESTree
            // doesn't.
            StmtKind::Expr(e)
                if is_in_head_of_for(statement) || is_object_of_with(statement, e) =>
            {
                self.owner_of_expr(e)
            }
            _ => Owner::Node(statement.as_ast_nodes()),
        }
    }

    fn owner_of_node(&self, node: Node<'a>) -> Owner<'a> {
        match node {
            Node::Expr(e) => self.owner_of_expr(e),
            Node::Type(ty) => self.owner_of_type(ty),
            Node::Stmt(statement) => self.owner_of_stmt(statement),
            // A tuple element without a name, `?` or `...` is just its type in ESTree.
            Node::TupleElem(element)
                if element.name().is_none() && !element.is_rest() && !element.is_optional() =>
            {
                self.owner_of_type(element.ty())
            }
            _ => Owner::Node(node_as_ast_nodes(node)),
        }
    }

    fn owner_of_node_or_name(&self, node: NodeOrName<'a>, is_preceding_node: bool) -> Owner<'a> {
        match node {
            NodeOrName::Name(start) => Owner::Name(start),
            // `a, b, c` is one flat `SequenceExpression` in ESTree, but `(a, b), c` in the HIR. For a comment after
            // `a, b`, the preceding node is `b`.
            NodeOrName::Node(Node::Expr(mut e)) if is_preceding_node => {
                while is_inner_comma(e)
                    && let ExprKind::Binary { right, .. } = e.kind()
                {
                    e = right;
                }
                Owner::Node(e.as_chain_element())
            }
            // The comment can be inside type cast parentheses around `e`. `climb_while` finds the ones it is outside
            // of.
            NodeOrName::Node(Node::Expr(e)) => Owner::Node(e.as_chain_element()),
            NodeOrName::Node(node) => self.owner_of_node(node),
        }
    }

    /// Returns the closest ancestor of `owner` that comments can be attached to. `name_parent` is the parent to use for
    /// a name, which has no parent pointer.
    fn parent(&self, owner: Owner<'a>, name_parent: N<'a>) -> Option<Owner<'a>> {
        let mut node = match owner {
            Owner::Name(_) => name_parent,
            Owner::CastParens(e, open) => {
                let is_outer = |paren: &Span| paren.start < open && self.is_cast_paren(paren.start);
                match e.parens().find(is_outer) {
                    Some(outer) => return Some(Owner::CastParens(e, outer.start)),
                    None => e.ast_parent(),
                }
            }
            Owner::Node(N::Program(_)) => return None,
            Owner::Node(node) => {
                if !self.cast_parens.is_empty()
                    && let Some(e) = node.as_expression().filter(|e| e.is_parenthesized())
                    && let Some(paren) = e.parens().find(|paren| self.is_cast_paren(paren.start))
                {
                    return Some(Owner::CastParens(e, paren.start));
                }
                import_attribute_of_value(node)
                    .or_else(|| import_type_of_attributes(node))
                    .or_else(|| opening_element_of_name(node))
                    .or_else(|| type_annotation_of_predicate(node))
                    .or_else(|| (self.file.is_flow()).then(|| flow::parent_of_type(node))?)
                    .unwrap_or_else(|| node.parent())
            }
        };
        while !self.can_attach_comment(node) {
            node = node.parent();
        }
        Some(Owner::Node(body_of_whole_namespace(node)))
    }

    /// Prettier's `locStart` and `locEnd`, except that a statement includes its `;`.
    pub(super) fn span_of(&self, owner: Owner<'a>) -> Span {
        let node = match owner {
            // Nothing needs the end of a name.
            Owner::Name(start) => return Span::new(start, start),
            Owner::CastParens(e, open) => {
                let paren = e.parens().find(|paren| paren.start == open);
                return paren.unwrap_or_else(|| e.span());
            }
            Owner::Node(N::Program(_)) => return self.file.span(),
            Owner::Node(N::JSXEmptyExpression(e)) => {
                return match e.jsx_container_span() {
                    Some(container) => Span::new(container.start + 1, container.end - 1),
                    None => e.span(),
                };
            }
            Owner::Node(N::TSFunctionType(ty)) if self.file.is_flow() => {
                let span = ty.span();
                return Span::new(flow::start_of_hook_type(ty).unwrap_or(span.start), span.end);
            }
            Owner::Node(node) => node,
        };
        node.span_with_decorators()
    }

    pub(super) fn start_of(&self, owner: Owner<'a>) -> u32 {
        self.span_of(owner).start
    }

    /// Prettier's `canAttachComment`. Also false for nodes that exist in `AstNodes` but not in Prettier's tree.
    fn can_attach_comment(&self, node: N<'a>) -> bool {
        match node {
            _ if self.file.is_flow() && flow::is_not_prettier_node(node) => false,
            N::ChainExpression(_)
            | N::FormalParameters(_)
            | N::Elision(_)
            | N::ExpressionStatement(ExpressionStatement::ArrowBody(_)) => false,
            N::FunctionBody(func) => matches!(func.body(), FnBody::Block(_)),
            // The `a = 1` of `constructor(private a = 1) {}`. For oxfmt the parameter is one node.
            N::AssignmentPattern(Node::Param(_)) => !self.options.flavor.is_oxfmt(),
            // The `FunctionExpression` inside a method. Babel has no such node. With typescript-estree, Prettier
            // doesn't attach comments to it if it has no body, or if it's in a class and has neither parameters nor a
            // return type.
            N::Function(func) => match method_of(func) {
                Some(_) if self.is_babel() || !func.has_body() => false,
                Some(Node::Member(_)) => has_parameters(func) || func.return_type().is_some(),
                _ => true,
            },
            // A plain parameter like `a` is a single `Identifier` in ESTree, but a parameter wrapping an identifier
            // here.
            N::BindingIdentifier(pat)
                if self.file.is_flow() && flow::is_name_of_function_type_param(pat) =>
            {
                true
            }
            N::BindingIdentifier(pat) => match pat.parent() {
                Node::Param(param) => param.default().is_some() || param.is_parameter_property(),
                _ => true,
            },
            // `isMeaningfulEmptyStatement`
            N::EmptyStatement(statement) => match statement.parent() {
                Node::Stmt(parent) => !matches!(
                    parent.tag(),
                    StmtTag::Block | StmtTag::Module | StmtTag::Try | StmtTag::Switch
                ),
                _ => false,
            },
            N::TSTypeAnnotation(ty) => !matches!(ty.parent(), Node::Member(member)
                if matches!(member.as_ast_nodes(), N::TSPropertySignature(_))),
            N::TSUnionType(ty) | N::TSIntersectionType(ty) => {
                union_members(ty).is_none_or(|types| types.len() != 1)
            }
            _ => true,
        }
    }

    /// Walks up from `owner` while `keep_climbing` accepts the parent's span. Returns the last accepted node and its
    /// parent.
    fn climb_while(
        &self,
        mut owner: Owner<'a>,
        name_parent: N<'a>,
        keep_climbing: impl Fn(Span) -> bool,
    ) -> (Owner<'a>, Option<Owner<'a>>) {
        loop {
            match self.parent(owner, name_parent) {
                // One expression can have many pairs of type cast parentheses around it. If a pair is accepted, so are
                // the pairs inside it.
                Some(Owner::CastParens(e, open))
                    if keep_climbing(self.span_of(Owner::CastParens(e, open))) =>
                {
                    let outermost = (e.parens().rev())
                        .find(|paren| self.is_cast_paren(paren.start) && keep_climbing(*paren));
                    owner = Owner::CastParens(e, outermost.map_or(open, |paren| paren.start));
                }
                Some(parent) if keep_climbing(self.span_of(parent)) => owner = parent,
                parent => return (owner, parent),
            }
        }
    }

    pub(super) fn next_token_starts_with(&self, comment: comments::Comment<'a>, byte: u8) -> bool {
        self.file.text().get(comment.next_token_start() as usize) == Some(&byte)
    }

    pub(super) fn prev_token_ends_with(&self, comment: comments::Comment<'a>, byte: u8) -> bool {
        let end = comment.prev_token_end() as usize;
        end > 0 && self.file.text().get(end - 1) == Some(&byte)
    }

    /// Returns the facts about all the comments between the same two tokens as `comment`.
    pub(super) fn comments_between_same_tokens(
        &self,
        comment: comments::Comment<'a>,
    ) -> CommentsBetweenTokens {
        let [last, second_last] = self.last_comments_between_tokens.get();
        for known in [last, second_last] {
            if known.ids().contains(&comment.id()) {
                return known;
            }
        }
        let id = comment.id();
        let is_between_same_tokens =
            |id: &u32| self.file.comment(*id).next_token_start() == comment.next_token_start();
        let before = (0..id).rev().take_while(is_between_same_tokens);
        let after = (id..self.file.comment_count() as u32).take_while(is_between_same_tokens);
        let first_id = before.last().unwrap_or(id);
        let mut all = CommentsBetweenTokens {
            first_id,
            end_id: after.last().unwrap_or(id) + 1,
            ..CommentsBetweenTokens::default()
        };
        for id in all.ids() {
            let it = self.file.comment(id);
            match it.has_newline_before() {
                true => all.has_line_break_before_one = true,
                false => {
                    all.first_without_line_break_before =
                        all.first_without_line_break_before.or(Some(id));
                    all.last_without_line_break_before = Some(id);
                }
            }
            if !all.has_line_break_before_one
                && all.first_that_ends_line_of_prev_token.is_none()
                && (it.is_line() || it.has_newline_after())
            {
                all.first_that_ends_line_of_prev_token = Some(id);
            }
        }
        self.last_comments_between_tokens.set([all, last]);
        all
    }

    /// The fast path. Most comments come before a statement in a body or a member of a class, interface or enum, and
    /// after the previous one or the `{`. In that case the parser already recorded the nodes that Prettier finds, and
    /// the enclosing node is a `Program`, a `BlockStatement`, a `ClassBody`, a `TSInterfaceBody`, a `TSTypeLiteral` or
    /// a `TSEnumBody`, for which Prettier has no rule.
    fn list_elements_around(&self, comment: comments::Comment<'a>) -> Option<SurroundingNodes<'a>> {
        if self.file.is_flow() {
            return None;
        }
        let NodeOrName::Node(following_node) = comment.following_node()? else {
            return None;
        };
        // oxfmt's rules only apply to comments that stay on the same line as what's before or after them. That could be
        // this comment, or one between it and the following node, though usually there's none in between.
        if self.options.flavor.is_oxfmt() {
            if !comment.has_newline_before() {
                return None;
            }
            let is_followed_by_comment = comment.id() + 1 < self.file.comment_count() as u32
                && self.file.comment(comment.id() + 1).next_token_start()
                    == comment.next_token_start();
            if is_followed_by_comment
                && (self
                    .comments_between_same_tokens(comment)
                    .last_without_line_break_before)
                    .is_some_and(|id| id > comment.id())
            {
                return None;
            }
        }
        let text = self.file.text();
        let enclosing_node = comment.enclosing_node();
        // The body isn't a node in the HIR, so the enclosing node is the body's owner.
        let is_list_of_following_node = match (enclosing_node, following_node) {
            (None | Some(Node::Member(_)), Node::Stmt(_)) => true,
            (Some(Node::Stmt(statement)), Node::Stmt(_)) => match statement.tag() {
                StmtTag::Fn => true,
                // `with (a) b` is a block of `a` and `b` in the HIR.
                StmtTag::Block => text.get(statement.span().start as usize) == Some(&b'{'),
                _ => false,
            },
            (Some(Node::Expr(e)), Node::Stmt(_)) => matches!(e.kind(), ExprKind::Fn(_)),
            (Some(Node::Stmt(statement)), Node::Member(_)) => {
                matches!(statement.tag(), StmtTag::Class | StmtTag::Interface)
            }
            (Some(Node::Expr(e)), Node::Member(_)) => matches!(e.kind(), ExprKind::Class(_)),
            (Some(Node::Type(ty)), Node::Member(_)) => matches!(ty.kind(), TypeKind::Object(_)),
            (Some(Node::Stmt(statement)), Node::EnumMember(_)) => statement.tag() == StmtTag::Enum,
            _ => false,
        };
        if !is_list_of_following_node {
            return None;
        }
        let preceding_node = match (comment.preceding_node(), following_node) {
            (Some(NodeOrName::Node(node @ Node::Stmt(_))), Node::Stmt(_))
            | (Some(NodeOrName::Node(node @ Node::Member(_))), Node::Member(_))
            | (Some(NodeOrName::Node(node @ Node::EnumMember(_))), Node::EnumMember(_)) => {
                Some(node)
            }
            (None, _) if enclosing_node.is_none() => None,
            // Whatever comes before the `{` isn't in the body.
            _ if self.prev_token_ends_with(comment, b'{') => None,
            _ => return None,
        };
        Some(SurroundingNodes {
            enclosing_node: None,
            preceding_node: preceding_node.map(|node| self.owner_of_node(node)),
            following_node: Some(self.owner_of_node(following_node)),
            is_before_list_element: true,
        })
    }

    fn surrounding_nodes(&self, parsed_comment: comments::Comment<'a>) -> SurroundingNodes<'a> {
        if let Some(nodes) = self.list_elements_around(parsed_comment) {
            return nodes;
        }
        let comment = parsed_comment.span();
        let (enclosing_node, mut preceding_node, mut following_node) =
            recorded_nodes_without_import_attribute_braces(parsed_comment);
        without_keywords_of_specifier(
            enclosing_node,
            &mut preceding_node,
            &mut following_node,
            comment,
        );

        // The `source` of `import.source("a")` is a name for the parser. ESTree has no node for it.
        if let Some(Node::Expr(import)) = enclosing_node
            && let ExprKind::ImportCall { args } = import.kind()
        {
            preceding_node = preceding_node.filter(|it| !matches!(it, NodeOrName::Name(_)));
            if let Some(NodeOrName::Name(_)) = following_node {
                following_node = args.first().map(|it| NodeOrName::Node(Node::Expr(it)));
            }
        }
        if self.file.is_flow() {
            preceding_node = match preceding_node {
                Some(node) => flow::preceding_node(node, enclosing_node, comment.start),
                None => flow::unrecorded_preceding_node(enclosing_node, comment.start),
            };
            following_node = following_node.and_then(|it| flow::following_node(it, enclosing_node));
        }
        let name_parent = match enclosing_node {
            Some(Node::Stmt(statement)) => inner_of_stmt(statement),
            Some(node) => node_as_ast_nodes(node),
            None => node_as_ast_nodes(Node::File(self.file)),
        };
        // Each is a pair of the node and its parent, which contains the comment.
        let preceding = preceding_node.map(|node| {
            let owner = self.owner_of_node_or_name(node, true);
            self.climb_while(owner, name_parent, |span| span.end <= comment.start)
        });
        let following = following_node.map(|node| {
            let owner = self.owner_of_node_or_name(node, false);
            self.climb_while(owner, name_parent, |span| span.start >= comment.end)
        });
        let span_len =
            |owner: Option<Owner<'a>>| owner.map_or(u32::MAX, |it| self.span_of(it).len());
        let mut nodes = match (preceding, following) {
            (Some((preceding_node, parent)), Some((following_node, other_parent)))
                if parent == other_parent =>
            {
                SurroundingNodes {
                    enclosing_node: parent,
                    preceding_node: Some(preceding_node),
                    following_node: Some(following_node),
                    ..SurroundingNodes::default()
                }
            }
            // The two parents differ, so one is inside the other, as in `class A { /* comment */ b() {} }`, where the
            // preceding node `A` is in the class and the following node `b() {}` is in the class body. The inner parent
            // is the enclosing node, and the node outside of it isn't a sibling of the comment.
            (Some((preceding_node, parent)), Some((_, other_parent)))
                if span_len(parent) < span_len(other_parent) =>
            {
                SurroundingNodes {
                    enclosing_node: parent,
                    preceding_node: Some(preceding_node),
                    ..SurroundingNodes::default()
                }
            }
            (_, Some((following_node, parent))) => SurroundingNodes {
                enclosing_node: parent,
                following_node: Some(following_node),
                ..SurroundingNodes::default()
            },
            (Some((preceding_node, parent)), None) => SurroundingNodes {
                enclosing_node: parent,
                preceding_node: Some(preceding_node),
                ..SurroundingNodes::default()
            },
            (None, None) => {
                let mut node = match enclosing_node {
                    Some(Node::Stmt(statement)) => statement.as_ast_nodes(),
                    _ => name_parent,
                };
                while !self.can_attach_comment(node) {
                    node = node.parent();
                }
                SurroundingNodes {
                    enclosing_node: Some(Owner::Node(node)),
                    ..SurroundingNodes::default()
                }
            }
        };
        account_for_exported_declaration_without_children(&mut nodes, comment);
        self.account_for_expression_statement_in_head_of_for(&mut nodes, enclosing_node);
        self.account_for_object_method_of_babel(&mut nodes, comment);
        self.account_for_empty_body(&mut nodes, comment);
        self.account_for_rebalanced_logical_expression(&mut nodes);
        if !self.options.flavor.is_oxfmt() {
            account_for_type_annotation_of_identifier(&mut nodes);
            account_for_decorators_of_identifier(&mut nodes);
        }
        account_for_names_of_meta_property(&mut nodes);
        account_for_this_of_predicate(&mut nodes, comment);
        self.stay_in_template_substitution(&mut nodes, parsed_comment);
        self.stay_in_jsx_tag(&mut nodes, comment);
        if self.file.is_flow() {
            self.account_for_children_of_match(&mut nodes, comment);
        }
        // With typescript-estree, Prettier doesn't give a top-level comment an enclosing node.
        if !self.is_babel() && nodes.enclosing_node == Some(self.program()) {
            nodes.enclosing_node = None;
        }
        nodes
    }

    /// `for ((a /* comment */) of b);`: in the HIR `(a /* comment */)` is an expression statement, and the parser
    /// recorded nothing after the comment in it. In ESTree `a` and `b` are children of the `for`.
    fn account_for_expression_statement_in_head_of_for(
        &self,
        nodes: &mut SurroundingNodes<'a>,
        recorded_enclosing_node: Option<Node<'a>>,
    ) {
        let Some(Node::Stmt(statement)) = recorded_enclosing_node else {
            return;
        };
        if nodes.following_node.is_some()
            || statement.tag() != StmtTag::Expr
            || !is_in_head_of_for(statement)
        {
            return;
        }
        let Node::Stmt(parent) = statement.parent() else {
            return;
        };
        nodes.following_node = match parent.kind() {
            StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => {
                Some(self.owner_of_expr(expr))
            }
            StmtKind::For {
                test, update, body, ..
            } => Some(match test.or(update) {
                Some(e) => self.owner_of_expr(e),
                None => self.owner_of_stmt(body),
            }),
            _ => None,
        };
    }

    /// The children of Babel's `ObjectMethod` are the key, the parameters and the body. Here the parameters and the
    /// body are in a function expression, which Babel doesn't have.
    fn account_for_object_method_of_babel(&self, nodes: &mut SurroundingNodes<'a>, comment: Span) {
        let Some(Owner::Node(N::ObjectProperty(prop))) = nodes.enclosing_node else {
            return;
        };
        let (true, Some(func), Some(key)) = (self.is_babel(), prop.func(), prop.key()) else {
            return;
        };
        // `{ a /* comment */ (b) {} }`
        if nodes.following_node == Some(Owner::Node(N::Function(func))) {
            let first_parameter = func.params().first();
            nodes.following_node = first_parameter.map(|it| self.owner_of_node(Node::Param(it)));
        }
        // `{ a() /* comment */ {} }`
        if nodes.preceding_node.is_none() && key.span(self.file).end <= comment.start {
            nodes.preceding_node = Some(match prop.computed_key() {
                Some(e) => self.owner_of_expr(e),
                None => Owner::Name(key.span(self.file).start),
            });
        }
    }

    /// Prettier turns `a && (b && c)` into `(a && b) && c` before it attaches comments. So for the comment in
    /// `a && ((/* comment */ b && c) && d)`, which is at the start of `(b && c) && d`, the preceding node is `a`.
    fn account_for_rebalanced_logical_expression(&self, nodes: &mut SurroundingNodes<'a>) {
        let (Some(Owner::Node(N::LogicalExpression(e))), None, false) = (
            nodes.enclosing_node,
            nodes.preceding_node,
            self.options.flavor.is_oxfmt(),
        ) else {
            return;
        };
        if let Node::Expr(parent) = e.parent()
            && let ExprKind::Binary { op, left, right } = parent.kind()
            && right == e
            && e.binary_op() == Some(op)
            && self.owner_of_expr(e) == Owner::Node(N::LogicalExpression(e))
        {
            nodes.enclosing_node = Some(Owner::Node(N::LogicalExpression(parent)));
            nodes.preceding_node = Some(self.owner_of_expr(left));
        }
    }

    /// An empty `{}` body has no child to climb up from, so it has to be checked separately.
    fn account_for_empty_body(&self, nodes: &mut SurroundingNodes<'a>, comment: Span) {
        let Some(Owner::Node(enclosing_node)) = nodes.enclosing_node else {
            return;
        };
        let Some(body) = body_of(enclosing_node) else {
            return;
        };
        let (span, body) = (body.span(), Some(Owner::Node(body)));
        if span.contains(comment) {
            *nodes = SurroundingNodes {
                enclosing_node: body,
                ..SurroundingNodes::default()
            };
        } else if span.start >= comment.end {
            if nodes.following_node.is_none() {
                nodes.following_node = body;
            }
        } else if (nodes.preceding_node).is_none_or(|node| self.start_of(node) < span.start) {
            nodes.preceding_node = body;
        }
    }

    /// Prettier doesn't let a comment move from one `${}` of a template literal to another. The comment is in the
    /// parentheses around one of the two expressions next to it, directly after the `${`, or directly before the `}`.
    fn stay_in_template_substitution(
        &self,
        nodes: &mut SurroundingNodes<'a>,
        comment: comments::Comment<'a>,
    ) {
        let Some(Owner::Node(N::TemplateLiteral(_))) = nodes.enclosing_node else {
            return;
        };
        let is_in_parentheses_of = |owner: Option<Owner<'a>>| {
            let expression = match owner {
                Some(Owner::Node(node)) => node.as_expression(),
                Some(Owner::CastParens(e, _)) => Some(e),
                Some(Owner::Name(_)) | None => None,
            };
            expression.is_some_and(|e| e.outer_span().contains(comment.span()))
        };
        let (preceding_node, following_node) = (nodes.preceding_node, nodes.following_node);
        if is_in_parentheses_of(following_node) || self.prev_token_ends_with(comment, b'{') {
            nodes.preceding_node = None;
        }
        if is_in_parentheses_of(preceding_node) || self.next_token_starts_with(comment, b'}') {
            nodes.following_node = None;
        }
    }

    /// ESTree has a node for the closing tag of an element, and for the `<>` and `</>` of a fragment. `AstNodes`
    /// doesn't. A comment inside one of them can only be next to something in the same tag.
    fn stay_in_jsx_tag(&self, nodes: &mut SurroundingNodes<'a>, comment: Span) {
        let Some(Owner::Node(N::JSXElement(e) | N::JSXFragment(e))) = nodes.enclosing_node else {
            return;
        };
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let tags = [Some(jsx.opening_span()), jsx.closing_span()];
        let Some(tag) = tags.into_iter().flatten().find(|tag| tag.contains(comment)) else {
            return;
        };
        let is_in_tag = |node: &Owner<'a>| tag.contains_offset(self.start_of(*node));
        nodes.preceding_node = nodes.preceding_node.filter(is_in_tag);
        nodes.following_node = nodes.following_node.filter(is_in_tag);
    }

    /// The children of Flow's `MatchExpression` and `MatchStatement` are the argument and the cases. Here the argument
    /// is in a call and the cases of an expression are in an object, so a comment in one of the two doesn't see the
    /// other.
    fn account_for_children_of_match(&self, nodes: &mut SurroundingNodes<'a>, comment: Span) {
        let Some(Owner::Node(enclosing_node)) = nodes.enclosing_node else {
            return;
        };
        let Some((argument, first_case)) = flow::argument_and_first_case_of_match(enclosing_node)
        else {
            return;
        };
        if nodes.preceding_node.is_none() && argument.outer_span().end <= comment.start {
            nodes.preceding_node = Some(self.owner_of_expr(argument));
        }
        if nodes.following_node.is_none() {
            nodes.following_node = first_case
                .filter(|case| comment.end <= case.span().start)
                .map(Owner::Node);
        }
    }

    /// Indexed by comment id.
    pub(super) fn surrounding_nodes_of_all_comments(&self) -> Vec<SurroundingNodes<'a>> {
        let mut all: Vec<SurroundingNodes<'a>> = Vec::with_capacity(self.file.comment_count());
        let mut next_token_start = u32::MAX;
        for comment in self.file.comments_by_id() {
            // Nodes start and end at tokens. If there's no token between two comments, both have the same surrounding
            // nodes.
            let nodes = match all.last() {
                Some(&previous) if comment.next_token_start() == next_token_start => previous,
                _ => self.surrounding_nodes(comment),
            };
            next_token_start = comment.next_token_start();
            all.push(nodes);
        }
        all
    }

    /// Prettier's `isGap`: only whitespace and `(` between the two offsets.
    pub(super) fn is_gap(&self, from: u32, to: u32) -> bool {
        (self.source).all_bytes(Span::new(from, to), |b| {
            b == b'(' || b.is_ascii_whitespace()
        })
    }
}
