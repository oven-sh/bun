//! Converts the nodes that the parser recorded around a comment into the nodes that the printers use.
//!
//! The printers work with [`AstNodes`](crate::js::ast_nodes::AstNodes), which has extra nodes that wrap a parser node or are part
//! of one, such as `FunctionBody`, `TSTypeAnnotation` and `Decorator`. To find them, start at the recorded preceding or
//! following node and walk up through `AstNodes::parent()` until the parent contains the comment.

use super::{Options, Owner, flow};
use crate::js::ast_nodes::{
    AsAstNodes, AstNodes as N, ChainElement, ExpressionStatement, inner_of_stmt, is_inner_comma,
    node_as_ast_nodes,
};
use crate::js::format::is_in_head_of_for;
use crate::js::print::flow::is_flow_opaque_type;
use crate::js::source_text::SourceText;
use bun_lint::ast::comments::{self, NodeOrName};
use bun_lint::ast::{
    Expr, ExprKind, File, FnBody, FnKind, Func, List, Node, Param, Pat, Stmt, StmtKind, StmtTag,
    TypeKind, TypeNode,
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

fn is_object_of_with<'a>(statement: Stmt<'a>, e: Expr<'a>) -> bool {
    matches!(statement.parent(), Node::Stmt(parent)
        if matches!(parent.kind(), StmtKind::With { object, .. } if object == e))
}

pub(super) fn has_parameters(func: Func<'_>) -> bool {
    func.this_param().is_some() || !func.params().is_empty()
}

/// The `TSTypeAnnotation` around `node`, if `node` is the `T` of `a is T`.
fn type_annotation_of_predicate(node: N<'_>) -> Option<N<'_>> {
    let Node::Type(ty) = node.raw() else {
        return None;
    };
    (node == ty.as_ast_nodes() && is_type_of_predicate(ty)).then_some(N::TSTypeAnnotation(ty))
}

/// Whether `ty` is the `T` of `a is T`.
fn is_type_of_predicate(ty: TypeNode<'_>) -> bool {
    matches!(ty.parent(), Node::Type(parent) if matches!(parent.kind(), TypeKind::Predicate { .. }))
}

/// `namespace A.B { .. }` is a namespace `B` in a namespace `A` in the HIR, and the statements are in `B`. In ESTree it is one
/// declaration, so its body is the body of `A`.
fn body_of_whole_namespace(node: N<'_>) -> N<'_> {
    match node {
        N::TSModuleBlock(statement) => match statement.as_module() {
            Some(module) => N::TSModuleBlock(module.outermost().stmt()),
            None => node,
        },
        _ => node,
    }
}

/// The `{ .. }` body of `node`. The printers treat it as a separate node.
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

/// The enclosing, the preceding and the following node that the parser recorded for `comment`. The `{ .. }` of import
/// attributes are an object literal in the HIR. ESTree has no node for them: the attributes are children of the
/// declaration and come after its source.
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
    // `import a from "a" with { /* comment */ type: "json" }`
    if let Some(Node::Expr(braces)) = enclosing_node
        && let Some(first) = braces.as_object().and_then(|attributes| attributes.first())
        && first.is_import_attribute()
        && let Node::Stmt(statement) = first.parent()
    {
        enclosing_node = Some(Node::Stmt(statement));
        preceding_node = preceding_node.or_else(|| {
            let source = statement.module_specifier_span()?;
            Some(NodeOrName::Name(source.start))
        });
    }
    (enclosing_node, preceding_node, following_node)
}

/// The import attribute whose value is `node`. In the HIR the parent of the value is the import or the export.
fn import_attribute_of_value(node: N<'_>) -> Option<N<'_>> {
    let N::StringLiteral(value) = node else {
        return None;
    };
    let Node::Stmt(statement) = value.parent() else {
        return None;
    };
    let mut attributes = statement.import_attributes()?.entries().iter();
    attributes
        .find(|attribute| attribute.value() == Some(value))
        .map(N::ObjectProperty)
}

/// The opening tag whose name is `node`: the `<a b="c">` around `a`. `AstNodes::parent` gives the element.
fn opening_element_of_name(node: N<'_>) -> Option<N<'_>> {
    let name = node.as_expression()?;
    match name.parent() {
        Node::Expr(element) if matches!(element.kind(), ExprKind::Jsx(jsx) if jsx.tag() == Some(name)) => {
            Some(N::JSXOpeningElement(element))
        }
        _ => None,
    }
}

/// `export default function () {}` and `export default class {}` are one statement in the HIR, and have no child to climb up
/// from. In ESTree the declaration is a child of the export.
fn account_for_exported_declaration_without_children(
    nodes: &mut SurroundingNodes<'_>,
    comment: Span,
) {
    let SurroundingNodes {
        enclosing_node: Some(Owner::Node(N::ExportDefaultDeclaration(statement))),
        preceding_node: None,
        following_node: None,
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

/// In ESTree the type annotation is a child of the `Identifier`. So for the comment in `let a /* comment */: T`, the identifier
/// is the enclosing node and not the preceding node. For oxfmt the two are siblings. The type annotation of `...a: T` is a
/// child of the `RestElement`.
fn account_for_type_annotation_of_identifier(nodes: &mut SurroundingNodes<'_>) {
    if let (
        Some(identifier @ Owner::Node(N::BindingIdentifier(name))),
        Some(Owner::Node(N::TSTypeAnnotation(_))),
    ) = (nodes.preceding_node, nodes.following_node)
        && !matches!(name.parent(), Node::Param(param) if param.is_rest())
    {
        nodes.enclosing_node = Some(identifier);
        nodes.preceding_node = decorated_identifier(name)
            .and_then(|param| param.decorators().last())
            .map(|decorator| Owner::Node(N::Decorator(decorator)));
    }
}

/// The parameter that `name` is, if it is an `Identifier` with decorators in ESTree: `(@a b: T) => {}`.
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

/// `(@a /* comment */ b: T) => {}`: the children of the `Identifier` are the decorators and the type annotation. The name
/// itself is no node, so the following node is `: T`.
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
        nodes.following_node = Some(Owner::Name(e.span().end - "meta".len() as u32));
    }
}

impl<'a, 'c> AttachContext<'a, 'c> {
    pub(super) fn new(file: &'a File<'a>, cast_parens: &'c [u32], options: Options) -> Self {
        AttachContext {
            file,
            source: SourceText::new(file.text()),
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

    pub(super) fn is_cast_paren(&self, open: u32) -> bool {
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

    /// Whether `owner` is the `A` of `| A` or `& A`. See [`AttachContext::owner_of_type`].
    pub(super) fn is_only_member_of_union(&self, owner: Owner<'a>) -> bool {
        matches!(owner, Owner::Node(node) if matches!(node.raw(), Node::Type(ty)
            if matches!(ty.parent(), Node::Type(parent)
                if union_members(parent).is_some_and(|types| types.len() == 1))))
    }

    pub(super) fn owner_of_stmt(&self, statement: Stmt<'a>) -> Owner<'a> {
        match statement.kind() {
            // The HIR wraps an expression in the head of a `for`, and the object of a `with`, in a statement. ESTree does not.
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
            // `a, b, c` is one flat `SequenceExpression` in ESTree, but `(a, b), c` in the HIR. For a comment after `a, b`, the
            // preceding node is `b`.
            NodeOrName::Node(Node::Expr(mut e)) if is_preceding_node => {
                while is_inner_comma(e)
                    && let ExprKind::Binary { right, .. } = e.kind()
                {
                    e = right;
                }
                Owner::Node(e.as_chain_element())
            }
            // The comment can be inside type cast parentheses around `e`. `climb_while` finds the ones it is outside of.
            NodeOrName::Node(Node::Expr(e)) => Owner::Node(e.as_chain_element()),
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
                import_attribute_of_value(node)
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
            _ if self.file.is_flow() && flow::is_no_node(node) => false,
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
        let (enclosing_node, mut preceding_node, mut following_node) =
            recorded_nodes_without_import_attribute_braces(parsed_comment);
        if self.file.is_flow() {
            preceding_node = match preceding_node {
                Some(node) => flow::preceding_node(node, enclosing_node),
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
        account_for_exported_declaration_without_children(&mut nodes, comment);
        self.account_for_object_method_of_babel(&mut nodes, comment);
        self.account_for_empty_body(&mut nodes, comment);
        self.account_for_rebalanced_logical_expression(&mut nodes);
        if !self.options.flavor.is_oxfmt() {
            account_for_type_annotation_of_identifier(&mut nodes);
            account_for_decorators_of_identifier(&mut nodes);
        }
        account_for_names_of_meta_property(&mut nodes);
        self.stay_in_template_substitution(&mut nodes, comment);
        self.stay_in_jsx_tag(&mut nodes, comment);
        if self.file.is_flow() {
            self.account_for_children_of_match(&mut nodes, comment);
        }
        // With typescript-estree, Prettier gives a top-level comment no enclosing node.
        if !self.is_babel() && nodes.enclosing_node == Some(self.program()) {
            nodes.enclosing_node = None;
        }
        nodes
    }

    /// The children of Babel's `ObjectMethod` are the key, the parameters and the body. Here the parameters and the body are in
    /// a function expression, which Babel does not have.
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

    /// ESTree has a node for the closing tag of an element, and for the `<>` and `</>` of a fragment. `AstNodes` does not. A
    /// comment inside one of them can only be next to something in the same tag.
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

    /// The children of Flow's `MatchExpression` and `MatchStatement` are the argument and the cases. Here the argument is in a
    /// call and the cases of an expression are in an object, so a comment in one of the two does not see the other.
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
