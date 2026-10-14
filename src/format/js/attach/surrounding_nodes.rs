//! Converts the nodes that the parser recorded around a comment into the nodes that the printers use.
//!
//! The printers work with [`AstNodes`](crate::js::ast_nodes::AstNodes), which has extra nodes that wrap a parser node or are part
//! of one, such as `FunctionBody`, `TSTypeAnnotation` and `Decorator`. To find them, start at the recorded preceding or
//! following node and walk up through `AstNodes::parent()` until the parent contains the comment.

use super::{Options, Owner};
use crate::js::ast_nodes::{
    AsAstNodes, AstNodes as N, ChainElement, ExpressionStatement, inner_of_stmt, is_inner_comma,
    node_as_ast_nodes,
};
use crate::js::comments::Comment;
use crate::js::format::is_in_head_of_for;
use crate::js::source_text::SourceText;
use bun_lint::ast::comments::{self, NodeOrName};
use bun_lint::ast::{
    Expr, ExprKind, File, FnBody, FnKind, Func, List, Node, Stmt, StmtKind, StmtTag, TypeKind,
    TypeNode,
};
use bun_lint::span::Span;

/// Prettier's `enclosingNode`, `precedingNode` and `followingNode`.
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub(super) struct SurroundingNodes<'a> {
    pub(super) enclosing_node: Option<Owner<'a>>,
    pub(super) preceding_node: Option<Owner<'a>>,
    pub(super) following_node: Option<Owner<'a>>,
}

pub(super) struct AttachContext<'a, 'c> {
    pub(super) file: &'a File<'a>,
    pub(super) source: SourceText<'a>,
    /// Indexed by comment id.
    pub(super) comments: &'c [Comment],
    pub(super) options: Options,
    /// See [`crate::js::comments::cast_parens`].
    cast_parens: &'c [u32],
}

/// The member types of a union or an intersection type.
pub(super) fn union_members(ty: TypeNode<'_>) -> Option<List<'_, TypeNode<'_>>> {
    match ty.kind() {
        TypeKind::Union(types) | TypeKind::Intersection(types) => Some(types),
        _ => None,
    }
}

/// The function behind `node`, if `node` is a function, a method or a call signature.
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

/// The class member or object property whose value is `func`, if `func` is a method, a getter or a setter.
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

pub(super) fn has_parameters(func: Func<'_>) -> bool {
    func.this_param().is_some() || !func.params().is_empty()
}

/// The `{ .. }` body of `node`. The printers treat it as a separate node.
fn body_of(node: N<'_>) -> Option<N<'_>> {
    match node {
        N::Class(class) => Some(N::ClassBody(class)),
        N::TSInterfaceDeclaration(statement) => Some(N::TSInterfaceBody(statement)),
        N::TSEnumDeclaration(statement) => Some(N::TSEnumBody(statement)),
        N::TSModuleDeclaration(statement) => match statement.kind() {
            StmtKind::Module(module) if module.innermost().has_body() => {
                Some(N::TSModuleBlock(statement))
            }
            _ => None,
        },
        _ => function_of(node)
            .filter(|func| {
                matches!(func.body(), FnBody::Block(_)) && func.kind() != FnKind::StaticBlock
            })
            .map(N::FunctionBody),
    }
}

impl<'a, 'c> AttachContext<'a, 'c> {
    pub(super) fn new(
        file: &'a File<'a>,
        comments: &'c [Comment],
        cast_parens: &'c [u32],
        options: Options,
    ) -> Self {
        AttachContext {
            file,
            source: SourceText::new(file.text()),
            comments,
            options,
            cast_parens,
        }
    }

    pub(super) fn is_babel(&self) -> bool {
        self.options.has_tree_of_babel
    }

    pub(super) fn program(&self) -> Owner<'a> {
        Owner::Node(node_as_ast_nodes(Node::File(self.file)))
    }

    fn is_cast_paren(&self, open: u32) -> bool {
        self.cast_parens.binary_search(&open).is_ok()
    }

    /// The owner for the expression `e`. If `e` is wrapped in type cast parentheses, that is the outermost pair.
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

    /// The owner for the type `ty`. Prettier removes unions and intersections with a single member from its tree, as in
    /// `type A = | B`.
    pub(super) fn owner_of_type(&self, mut ty: TypeNode<'a>) -> Owner<'a> {
        while let Some(types) = union_members(ty)
            && types.len() == 1
            && let Some(only) = types.first()
        {
            ty = only;
        }
        Owner::Node(ty.as_ast_nodes())
    }

    pub(super) fn owner_of_stmt(&self, statement: Stmt<'a>) -> Owner<'a> {
        match statement.kind() {
            // The HIR wraps an expression in the head of a `for` in a statement. ESTree does not.
            StmtKind::Expr(e) if is_in_head_of_for(statement) => self.owner_of_expr(e),
            _ => Owner::Node(statement.as_ast_nodes()),
        }
    }

    fn owner_of_node(&self, node: Node<'a>) -> Owner<'a> {
        match node {
            Node::Expr(e) => self.owner_of_expr(e),
            Node::Type(ty) => self.owner_of_type(ty),
            Node::Stmt(statement) => self.owner_of_stmt(statement),
            _ => Owner::Node(node_as_ast_nodes(node)),
        }
    }

    fn owner_of_node_or_name(&self, node: NodeOrName<'a>, is_preceding_node: bool) -> Owner<'a> {
        match node {
            NodeOrName::Name(start) => Owner::Name(start),
            // `a, b, c` is one flat `SequenceExpression` in ESTree, but `(a, b), c` in the HIR. For a comment after `a, b`, the
            // preceding node is `b`.
            NodeOrName::Node(Node::Expr(mut e)) if is_preceding_node => {
                while is_inner_comma(e)
                    && let ExprKind::Binary { right, .. } = e.kind()
                {
                    e = right;
                }
                self.owner_of_expr(e)
            }
            NodeOrName::Node(node) => self.owner_of_node(node),
        }
    }

    /// The closest ancestor of `owner` that comments can be attached to. `name_parent` is the parent to use for a name, which
    /// does not know its own parent.
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
                node.parent()
            }
        };
        while !self.can_attach_comment(node) {
            node = node.parent();
        }
        Some(Owner::Node(node))
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
            Owner::Node(node) => node,
        };
        let span = node.span();
        // Decorators can come before `export`: `@decorator export class A {}`.
        let class = match node {
            N::Class(class) => Some(class),
            N::ExportNamedDeclaration(statement) | N::ExportDefaultDeclaration(statement) => {
                match statement.kind() {
                    StmtKind::Class(class) => Some(class),
                    StmtKind::ExportDefault(e) => e.as_class(),
                    _ => None,
                }
            }
            _ => None,
        };
        match class.and_then(|class| class.decorators().next()) {
            Some(first) => Span::new(N::Decorator(first).span().start.min(span.start), span.end),
            None => span,
        }
    }

    pub(super) fn start_of(&self, owner: Owner<'a>) -> u32 {
        self.span_of(owner).start
    }

    /// Prettier's `canAttachComment`. Also false for nodes that exist in `AstNodes` but not in Prettier's tree.
    fn can_attach_comment(&self, node: N<'a>) -> bool {
        match node {
            N::ChainExpression(_)
            | N::FormalParameters(_)
            | N::Elision(_)
            | N::ExpressionStatement(ExpressionStatement::ArrowBody(_)) => false,
            N::FunctionBody(func) => matches!(func.body(), FnBody::Block(_)),
            // The `FunctionExpression` inside a method. Babel has no such node. With typescript-estree, Prettier does not attach
            // comments to it if it has no body, or if it is in a class and has neither parameters nor a return type.
            N::Function(func) => match method_of(func) {
                Some(_) if self.is_babel() || !func.has_body() => false,
                Some(Node::Member(_)) => has_parameters(func) || func.return_type().is_some(),
                _ => true,
            },
            // A plain parameter like `a` is a single `Identifier` in ESTree, but a parameter wrapping an identifier here.
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

    /// Walks up from `owner` while `keep_climbing` accepts the parent's span. Returns the last accepted node and its parent.
    fn climb_while(
        &self,
        mut owner: Owner<'a>,
        name_parent: N<'a>,
        keep_climbing: impl Fn(Span) -> bool,
    ) -> (Owner<'a>, Option<Owner<'a>>) {
        loop {
            match self.parent(owner, name_parent) {
                Some(parent) if keep_climbing(self.span_of(parent)) => owner = parent,
                parent => return (owner, parent),
            }
        }
    }

    fn surrounding_nodes(&self, parsed_comment: comments::Comment<'a>) -> SurroundingNodes<'a> {
        let comment = parsed_comment.span();
        let enclosing_node = parsed_comment.enclosing_node();
        let name_parent = match enclosing_node {
            Some(Node::Stmt(statement)) => inner_of_stmt(statement),
            Some(node) => node_as_ast_nodes(node),
            None => node_as_ast_nodes(Node::File(self.file)),
        };
        // Each is a pair of the node and its parent, which contains the comment.
        let preceding = parsed_comment.preceding_node().map(|node| {
            let owner = self.owner_of_node_or_name(node, true);
            self.climb_while(owner, name_parent, |span| span.end <= comment.start)
        });
        let following = parsed_comment.following_node().map(|node| {
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
                }
            }
            // The two parents differ, so one is inside the other, as in `class A { /* comment */ b() {} }`, where the
            // preceding node `A` is in the class and the following node `b() {}` is in the class body. The inner parent is
            // the enclosing node, and the node outside of it is not a sibling of the comment.
            (Some((preceding_node, parent)), Some((_, other_parent)))
                if span_len(parent) < span_len(other_parent) =>
            {
                SurroundingNodes {
                    enclosing_node: parent,
                    preceding_node: Some(preceding_node),
                    following_node: None,
                }
            }
            (_, Some((following_node, parent))) => SurroundingNodes {
                enclosing_node: parent,
                preceding_node: None,
                following_node: Some(following_node),
            },
            (Some((preceding_node, parent)), None) => SurroundingNodes {
                enclosing_node: parent,
                preceding_node: Some(preceding_node),
                following_node: None,
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
        self.account_for_empty_body(&mut nodes, comment);
        self.stay_in_template_substitution(&mut nodes, comment);
        // With typescript-estree, Prettier gives a top-level comment no enclosing node.
        if !self.is_babel() && nodes.enclosing_node == Some(self.program()) {
            nodes.enclosing_node = None;
        }
        nodes
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

    /// Prettier does not let a comment move from one `${}` of a template literal to another.
    fn stay_in_template_substitution(&self, nodes: &mut SurroundingNodes<'a>, comment: Span) {
        let Some(Owner::Node(N::TemplateLiteral(e))) = nodes.enclosing_node else {
            return;
        };
        let ExprKind::Template(template) = e.kind() else {
            return;
        };
        let substitution_index = |offset: u32| {
            (1..template.quasi_count())
                .position(|index| offset <= template.quasi_span(index).start + 1)
                .unwrap_or(0)
        };
        let is_in_same_substitution = |node: &Owner<'a>| {
            substitution_index(self.start_of(*node)) == substitution_index(comment.start)
        };
        nodes.preceding_node = nodes.preceding_node.filter(is_in_same_substitution);
        nodes.following_node = nodes.following_node.filter(is_in_same_substitution);
    }

    /// Indexed by comment id.
    pub(super) fn surrounding_nodes_of_all_comments(&self) -> Vec<SurroundingNodes<'a>> {
        (self.file.comments_by_id())
            .map(|comment| self.surrounding_nodes(comment))
            .collect()
    }

    /// Prettier's `isGap`: only whitespace and `(` between the two offsets.
    pub(super) fn is_gap(&self, from: u32, to: u32) -> bool {
        (self.source).all_bytes(Span::new(from, to), |b| {
            b == b'(' || b.is_ascii_whitespace()
        })
    }
}
