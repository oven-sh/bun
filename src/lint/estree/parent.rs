//! The way up, and the way from a node of [`crate::ast`] to the nodes that are made of it.

use super::vnode::{Part, VNode};
use crate::ast::{
    BinOp, Expr, ExprKind, FnKind, Func, List, Modifier, Node, Param, Stmt, StmtKind, TypeKind,
    TypeNode, TypeParam,
};
use smallvec::{SmallVec, smallvec};

/// The node that the parameters, the type parameters and the return type of `func` are fields of.
fn function_node<'a>(func: Func<'a>) -> VNode<'a> {
    match (func.owner(), func.kind()) {
        (Node::Member(member), FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor)
            if !member.is_signature() =>
        {
            VNode::new(func, Part::Main)
        }
        (owner @ (Node::Member(_) | Node::Type(_)), _) => VNode::new(owner, Part::Main),
        _ => VNode::new(func, Part::Main),
    }
}

/// The `Decorator` whose expression is `e`, among the modifiers of `owner`.
fn decorator<'a>(owner: Node<'a>, modifiers: List<'a, Modifier<'a>>, e: Expr<'a>) -> Option<VNode<'a>> {
    let found = modifiers.iter().find(|it| it.decorator() == Some(e))?;
    Some(VNode::new(owner, Part::Decorator(found.id().0)))
}

/// The mapped type that `param` is the `K in T` of.
fn mapped_type<'a>(param: TypeParam<'a>) -> Option<TypeNode<'a>> {
    param.parent().as_type().filter(|ty| matches!(ty.kind(), TypeKind::Mapped(_)))
}

/// The `TSImportType` of the import type `ty`.
fn import_type<'a>(ty: TypeNode<'a>) -> VNode<'a> {
    match ty.kind() {
        TypeKind::Import { is_typeof: true, .. } => VNode::new(ty, Part::ImportType),
        _ => VNode::new(ty, Part::Main),
    }
}

/// What the statement `statement`, with an `export` before it, is in.
fn above_stmt<'a>(statement: Stmt<'a>) -> VNode<'a> {
    match statement.parent() {
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Module(_) => VNode::new(parent, Part::Body),
            StmtKind::Try { handler, .. } if handler == Some(statement) => VNode::new(parent, Part::Catch),
            _ => VNode::new(parent, Part::Main),
        },
        Node::Func(func) => match (func.kind(), func.owner()) {
            (FnKind::StaticBlock, owner) => VNode::new(owner, Part::Main),
            _ => VNode::new(func, Part::Body),
        },
        parent => VNode::new(parent, Part::Main),
    }
}

/// What the main node of `statement` is in.
fn above_main_of_stmt<'a>(statement: Stmt<'a>) -> VNode<'a> {
    match VNode::is_exported_declaration(statement) {
        true => VNode::new(statement, Part::Export),
        false => above_stmt(statement),
    }
}

/// What the expression `e`, with all that ESTree has around it, is in.
fn above_expr<'a>(e: Expr<'a>) -> Option<VNode<'a>> {
    let attribute = |owner: Node<'a>, attributes: Option<crate::ast::ImportAttributes<'a>>| {
        let found = attributes?.entries().iter().find(|it| it.value() == Some(e))?;
        Some(VNode::new(owner, Part::Attribute(found.id().0)))
    };
    let parent = e.parent();
    Some(match parent {
        Node::File(_) => return None,
        Node::Expr(mut above) => match above.kind() {
            ExprKind::Binary { op: BinOp::Comma, .. } => {
                // To the outermost of the comma operators.
                while !above.is_parenthesized()
                    && let Node::Expr(next) = above.parent()
                    && matches!(next.kind(), ExprKind::Binary { op: BinOp::Comma, left, .. } if left == above)
                {
                    above = next;
                }
                VNode::new(above, Part::Main)
            }
            ExprKind::Jsx(jsx) if jsx.tag() == Some(e) => VNode::new(above, Part::Opening),
            ExprKind::Jsx(jsx) if jsx.close_tag() == Some(e) => VNode::new(above, Part::Closing),
            ExprKind::Spread(_) if above.jsx_container_span().is_some() => VNode::new(above, Part::Container),
            ExprKind::NonNull(_) if above.inner_non_null_spans().len() > 0 => VNode::new(above, Part::NonNull(0)),
            _ => VNode::new(above, Part::Main),
        },
        Node::Stmt(statement) => (attribute(parent, statement.import_attributes()))
            .unwrap_or_else(|| VNode::new(statement, Part::Main)),
        Node::Type(ty) => match ty.kind() {
            TypeKind::Import { .. } => attribute(parent, ty.import_attributes())?,
            TypeKind::Heritage { .. } => VNode::new(ty, Part::Heritage),
            _ => VNode::new(ty, Part::Main),
        },
        Node::Param(param) if param.default() == Some(e) => VNode::new(param, Part::Inner),
        Node::Param(param) => decorator(parent, param.modifiers(), e)?,
        Node::Member(member) => {
            decorator(parent, member.modifiers(), e).unwrap_or_else(|| VNode::new(member, Part::Main))
        }
        Node::Class(class) => {
            decorator(parent, class.modifiers(), e).unwrap_or_else(|| VNode::new(class, Part::Main))
        }
        Node::PatProp(prop) if prop.default() == Some(e) => VNode::new(prop, Part::Value),
        _ => VNode::new(parent, Part::Main),
    })
}

/// What the main node of `e` is in.
fn above_main_of_expr<'a>(e: Expr<'a>) -> Option<VNode<'a>> {
    if e.is_chain_root() {
        return Some(VNode::new(e, Part::Chain));
    }
    above_chain(e)
}

fn above_chain<'a>(e: Expr<'a>) -> Option<VNode<'a>> {
    match e.jsx_container_span() {
        Some(_) => Some(VNode::new(e, Part::Container)),
        None => above_expr(e),
    }
}

/// What the outermost node of `param` is in.
fn above_param<'a>(param: Param<'a>) -> Option<VNode<'a>> {
    param.func().map(function_node)
}

/// What the type `ty` itself, without a `TSTypeAnnotation`, is in.
fn above_type<'a>(ty: TypeNode<'a>) -> Option<VNode<'a>> {
    let parent = ty.parent();
    Some(match parent {
        Node::File(_) => return None,
        Node::Type(above) => match above.kind() {
            TypeKind::Ref { .. } | TypeKind::Heritage { .. } | TypeKind::Typeof { .. } | TypeKind::Import { .. } => {
                VNode::new(above, Part::TypeArgs)
            }
            _ => VNode::new(above, Part::Main),
        },
        Node::Expr(above) => match above.kind() {
            ExprKind::As { .. } | ExprKind::Satisfies { .. } => VNode::new(above, Part::Main),
            _ => VNode::new(above, Part::TypeArgs),
        },
        Node::Class(_) => VNode::new(parent, Part::TypeArgs),
        Node::TypeParam(param) => match mapped_type(param) {
            Some(mapped) => VNode::new(mapped, Part::Main),
            None => VNode::new(param, Part::Main),
        },
        Node::TupleElem(element) => {
            if element.name().is_some() {
                VNode::new(element, Part::Named)
            } else if element.is_optional() {
                VNode::new(element, Part::Optional)
            } else if element.is_rest() {
                VNode::new(element, Part::Rest)
            } else {
                VNode::new(element.parent(), Part::Main)
            }
        }
        _ => VNode::new(parent, Part::Main),
    })
}

impl<'a> VNode<'a> {
    /// The node that the qualified name in it is a field of.
    fn owner_of_name(self) -> VNode<'a> {
        match self.base {
            Node::Type(ty) if VNode::is_heritage(ty) => self.with(Part::Heritage),
            Node::Type(ty) => import_type(ty),
            _ => self.with(Part::Main),
        }
    }

    /// The number of names in the qualified name in it.
    fn name_len(self) -> u32 {
        match self.base.as_stmt().map(Stmt::kind) {
            Some(StmtKind::Module(module)) => super::views::module_depth(module) as u32,
            _ => self.entity_name().map_or(0, |it| it.len() as u32),
        }
    }

    /// The node for the names up to the one at `i`, which is not the first.
    fn names_through(self, i: u32) -> VNode<'a> {
        match self.base {
            Node::Type(ty) if VNode::is_heritage(ty) => self.with(Part::MemberName(i)),
            _ => self.with(Part::Qualified(i)),
        }
    }

    /// ESTree's `parent`. `None` for the `Program`.
    pub fn parent(self) -> Option<VNode<'a>> {
        use Part::*;
        let main = self.with(Main);
        Some(match (self.base, self.part) {
            (Node::File(_), _) => return None,

            // Parts that are the same for all.
            (_, KeyQuasi | KeyNamespace | KeyName) => self.with(Key),
            (_, Key) => main,
            (_, AttributeKey(id)) => self.with(Attribute(id)),
            (Node::Type(_), Attribute(_)) => self.with(OptionsValue),
            (_, Attribute(_)) => main,
            (_, NamePart(0)) if self.name_len() <= 1 => self.owner_of_name(),
            (_, NamePart(i)) => self.names_through(i.max(1)),
            (_, Qualified(i) | MemberName(i)) if i + 1 >= self.name_len() => self.owner_of_name(),
            (_, Qualified(i) | MemberName(i)) => self.names_through(i + 1),
            (Node::Param(param), Decorator(_)) => VNode::of_param(param),
            (_, Decorator(_)) => main,

            (Node::Expr(e), part) => match part {
                Main => return above_main_of_expr(e),
                Chain => return above_chain(e),
                Container => return above_expr(e),
                ConstName => self.with(ConstType),
                NonNull(i) if (i as usize) + 1 < e.inner_non_null_spans().len() => self.with(NonNull(i + 1)),
                TypeArgs if matches!(e.kind(), ExprKind::Jsx(_)) => self.with(Opening),
                _ => main,
            },

            (Node::Stmt(statement), part) => match part {
                Main => above_main_of_stmt(statement),
                Export => above_stmt(statement),
                DefaultLocal => self.with(DefaultSpecifier),
                NamespaceLocal => self.with(NamespaceSpecifier),
                Source if matches!(statement.kind(), StmtKind::ImportEquals(_)) => self.with(Reference),
                _ => main,
            },

            (Node::Func(func), Main) => match func.owner() {
                Node::Stmt(statement) => above_main_of_stmt(statement),
                Node::Expr(e) => return above_chain(e),
                owner => VNode::new(owner, Main),
            },
            (Node::Func(func), _) => function_node(func),

            (Node::Class(class), Main) => match class.owner() {
                Node::Stmt(statement) => above_main_of_stmt(statement),
                Node::Expr(e) => return above_chain(e),
                owner => VNode::new(owner, Main),
            },
            (Node::Class(_), _) => main,

            (Node::Member(member), _) => match member.parent() {
                parent @ Node::Type(_) => VNode::new(parent, Main),
                parent => VNode::new(parent, Body),
            },
            (Node::Prop(prop), _) => match prop.parent() {
                Node::Expr(owner) if prop.is_jsx_attribute() => VNode::new(owner, Opening),
                parent => VNode::new(parent, Main),
            },
            (Node::PatProp(_), Value) => main,
            (Node::PatProp(prop), _) => VNode::new(prop.parent(), Main),
            (Node::PatElem(element), _) => VNode::new(element.parent(), Main),
            (Node::Pat(pat), _) => match pat.parent() {
                Node::VarDecl(declaration) => match declaration.parent() {
                    Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Try { .. }) => {
                        VNode::new(statement, Catch)
                    }
                    _ => VNode::new(declaration, Main),
                },
                Node::Param(param) if param.is_rest() || param.default().is_some() => VNode::new(param, Inner),
                Node::Param(param) if VNode::has_keywords(param) => VNode::new(param, Main),
                Node::Param(param) => return above_param(param),
                Node::PatProp(prop) if prop.default().is_some() => VNode::new(prop, Value),
                Node::PatElem(element) if !element.is_rest() && element.default().is_none() => {
                    VNode::new(element.parent(), Main)
                }
                Node::File(_) => return None,
                parent => VNode::new(parent, Main),
            },
            (Node::Param(param), Inner) if VNode::has_keywords(param) => main,
            (Node::Param(param), _) => return above_param(param),

            (Node::TypeParam(param), Name) => match mapped_type(param) {
                Some(mapped) => VNode::new(mapped, Main),
                None => main,
            },
            (Node::TypeParam(param), _) => match param.parent() {
                parent @ Node::Type(_) => VNode::new(parent, Main),
                parent => VNode::new(parent, TypeParams),
            },
            (Node::EnumMember(member), _) => VNode::new(member.parent(), Body),
            (Node::TupleElem(_), Name) => self.with(Named),
            (Node::TupleElem(element), Named | Optional) if element.is_rest() => self.with(Rest),
            (Node::TupleElem(element), _) => VNode::new(element.parent(), Main),

            (Node::Type(ty), part) => match part {
                Main if VNode::is_annotated(ty) => self.with(Annotation),
                Main => return above_type(ty),
                Annotation => match ty.parent() {
                    Node::Param(param) if param.is_rest() => VNode::new(param, Inner),
                    Node::Param(param) => VNode::new(param.pat(), Main),
                    Node::VarDecl(declaration) => VNode::new(declaration.pat(), Main),
                    Node::Func(func) => function_node(func),
                    parent => VNode::new(parent, Main),
                },
                Heritage => VNode::new(ty.parent(), Main),
                TypeArgs if VNode::is_heritage(ty) => self.with(Heritage),
                TypeArgs | Source | Options | Argument => import_type(ty),
                Quasi(_) if ty.as_template().is_none() => self.with(Literal),
                LiteralArgument => self.with(Literal),
                OptionsProperty => self.with(Options),
                OptionsKey | OptionsValue => self.with(OptionsProperty),
                _ => main,
            },

            // `VarDecl`, `Case`, `ImportSpec`, `ExportSpec`
            (_, Main) => VNode::new(self.base.parent(), Main),
            _ => main,
        })
    }

    /// Calls `visit` with each child, in the order in which ESLint traverses them.
    pub fn for_each_child(self, mut visit: impl FnMut(VNode<'a>)) {
        let dialect = self.dialect();
        for entry in self.node_type().fields() {
            if !entry.is_child {
                break;
            }
            if !entry.is_in(dialect) {
                continue;
            }
            match (entry.get)(self) {
                super::Value::Node(child) => visit(child),
                super::Value::Nodes(children) => children.flatten().for_each(&mut visit),
                _ => {}
            }
        }
    }

    /// Calls `visit` with each node of the ESTree that is made of `node`: see [`VNode::base`].
    ///
    /// Together with [`NodeType::listens_to`](super::NodeType::listens_to) this finds all the nodes
    /// of a type without a traversal: listen for these kinds, and of what is made of each such node
    /// take those of the type.
    pub fn for_each_at(node: Node<'a>, visit: &mut dyn FnMut(VNode<'a>)) {
        VNode::for_each_with_type_at(node, &mut |v, _| visit(v));
    }

    /// The same. `visit` is also given the type of the node, which is known here.
    pub fn for_each_with_type_at(node: Node<'a>, visit: &mut dyn FnMut(VNode<'a>, super::NodeType)) {
        // The parts of a node are a tree of their own, except where the outermost is missing.
        fn descend<'a>(v: VNode<'a>, visit: &mut dyn FnMut(VNode<'a>, super::NodeType)) {
            // The next is the last. Not by recursion: the parts of `A.B.C..`, which is one node, are as deep as it is long.
            let mut pending: SmallVec<[VNode<'a>; 8]> = smallvec![v];
            while let Some(v) = pending.pop() {
                let node_type = v.node_type();
                visit(v, node_type);
                let first = pending.len();
                let parts = node_type.fields().iter().take_while(|it| it.is_child).filter(|it| it.is_part);
                for entry in parts {
                    if !entry.is_in(v.dialect()) {
                        continue;
                    }
                    match (entry.get)(v) {
                        super::Value::Node(child) if child.base == v.base => pending.push(child),
                        super::Value::Nodes(children) => {
                            pending.extend(children.flatten().filter(|child| child.base == v.base));
                        }
                        _ => {}
                    }
                }
                pending[first..].reverse();
            }
        }
        let mut root = |v: Option<VNode<'a>>| {
            if let Some(v) = v.filter(|v| v.base == node) {
                descend(v, &mut *visit);
            }
        };
        match node {
            Node::File(file) => root(Some(VNode::program(file))),
            Node::Expr(e) => {
                let is_operand_of_comma = matches!(e.kind(), ExprKind::Binary { op: BinOp::Comma, .. })
                    && !e.is_parenthesized()
                    && matches!(e.parent(), Node::Expr(above)
                        if matches!(above.kind(), ExprKind::Binary { op: BinOp::Comma, left, .. } if left == e));
                if !is_operand_of_comma {
                    root(VNode::of_expr(e));
                }
                // No listener is called with the placeholder in `{}`.
                if let ExprKind::Jsx(jsx) = e.kind() {
                    let values = jsx.attrs().iter().filter_map(|it| it.value());
                    for empty in jsx.children().iter().chain(values).filter(|it| it.is_missing()) {
                        VNode::of_expr(empty).into_iter().for_each(|it| descend(it, visit));
                    }
                }
            }
            Node::Stmt(statement) => root(Some(VNode::of_stmt(statement))),
            Node::Func(func) => match function_node(func).base == node {
                true => root(Some(VNode::new(func, Part::Main))),
                false => root(func.type_params().first().map(|_| VNode::new(func, Part::TypeParams))),
            },
            Node::Param(param) => {
                let outermost = VNode::of_param(param);
                match outermost.base == node {
                    true => root(Some(outermost)),
                    false => super::Nodes::decorators(param, param.modifiers()).for_each(root),
                }
            }
            Node::TypeParam(param) => match mapped_type(param) {
                Some(_) => root(Some(VNode::new(param, Part::Name))),
                None => root(Some(VNode::new(param, Part::Main))),
            },
            Node::VarDecl(declaration) => {
                if !matches!(declaration.parent(), Node::Stmt(it) if matches!(it.kind(), StmtKind::Try { .. })) {
                    root(Some(VNode::new(declaration, Part::Main)));
                }
            }
            Node::Type(ty) => root(Some(if VNode::is_annotated(ty) {
                VNode::annotation(ty)
            } else if VNode::is_heritage(ty) {
                VNode::new(ty, Part::Heritage)
            } else {
                VNode::of_type(ty)
            })),
            Node::Pat(pat) => root(VNode::of_pat(pat)),
            Node::PatElem(element) => root(VNode::of_pat_elem(element)),
            Node::TupleElem(element) => root(Some(VNode::of_tuple_elem(element))),
            _ => root(Some(VNode::new(node, Part::Main))),
        }
    }
}
