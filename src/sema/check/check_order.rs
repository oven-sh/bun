//! The order in which `checkSourceFile` comes to the expressions of a file.
//!
//! TypeScript reports some errors once per file, at the node where its checker first asks: for the module of the JSX
//! runtime, for the fragment factory, for `tslib`, for each helper in it. It asks when it evaluates the node, and that is
//! before the walk of the file arrives there if something needs a type from it. Here an evaluation stops at an entry that
//! another task has stored, and which entries are there depends on timing. So such a place is not noted during
//! evaluation. `follow_check` walks the syntax where `checkSourceFile` goes in a checker that has evaluated nothing of
//! the file. It reads the syntax and the results of queries, so what it finds is a function of the program.
//!
//! It follows `checkNodeDeferred` and `checkDeferredNodes`, and the requests that lead from one place to another:
//! `getReturnTypeFromBody`, where `contextuallyCheckFunctionExpressionOrObjectLiteralMethod`,
//! `checkFunctionExpressionOrObjectLiteralMethodDeferred`, `checkAccessorDeclaration`, `checkReturnStatement` and
//! `checkCallExpression` ask for it, `getTypeOfSymbol` of a variable, and `checkIndexConstraints` of a class.

use super::*;
use crate::bind::{Decl, FnOwner, PatParent};
use crate::util::FxHashSet;

struct CheckOrder {
    /// The file that is checked.
    file: FileId,
    follows_later_files: bool,
    /// `links.deferredNodes`
    deferred_nodes: std::collections::VecDeque<Node>,
    is_deferred: FxHashSet<(FileId, Node)>,
    /// The functions whose returned expressions were visited, and the variables and properties whose initializers were.
    is_resolved: FxHashSet<(FileId, Node)>,
    /// `c.currentNode`, as `checkSourceElement` and `checkDeferredNode` set it.
    current_node: Node,
}

impl Checker<'_, '_> {
    /// Calls `visit` with each expression in the order in which `checkSourceFile` of `file` comes to them, with the file
    /// of the expression and `c.currentNode`, until it returns true. `follows_later_files`: also where a request leads
    /// into a file that is checked later. What such a file defers is left to its own check.
    pub(super) fn follow_check(
        &mut self,
        file: FileId,
        follows_later_files: bool,
        visit: &mut dyn FnMut(&mut Self, FileId, ExprId, Node) -> bool,
    ) {
        let hir = self.hir(file);
        let mut order = CheckOrder {
            file,
            follows_later_files,
            deferred_nodes: Default::default(),
            is_deferred: Default::default(),
            is_resolved: Default::default(),
            current_node: Node::NONE,
        };
        let mut statements = hir.ids(hir.body);
        let mut ends = statements.any(|s| self.follow_node(file, hir.node(s), &mut order, visit));
        // `checkDeferredNodes`
        while !ends && let Some(node) = order.deferred_nodes.pop_front() {
            order.current_node = node;
            // `checkFunctionExpressionOrObjectLiteralMethodDeferred`, `checkAccessorDeclaration`
            ends = hir.kind(node).is_function_like_declaration()
                && self.follow_returned(file, hir.function_of(node), &mut order, visit)
                || self.follow_children(file, node, &mut order, visit);
        }
    }

    fn follow_children(
        &mut self,
        file: FileId,
        node: Node,
        order: &mut CheckOrder,
        visit: &mut dyn FnMut(&mut Self, FileId, ExprId, Node) -> bool,
    ) -> bool {
        self.hir(file).for_each_child(node, &mut |child| {
            self.follow_node(file, child, order, visit)
        })
    }

    fn follow_parameters(
        &mut self,
        file: FileId,
        func: FnId,
        order: &mut CheckOrder,
        visit: &mut dyn FnMut(&mut Self, FileId, ExprId, Node) -> bool,
    ) -> bool {
        let hir = self.hir(file);
        let mut parameters = hir[func].params.iter();
        parameters.any(|p| self.follow_node(file, hir.node(p), order, visit))
    }

    /// `getReturnTypeFromBody`
    fn follow_returned(
        &mut self,
        file: FileId,
        func: FnId,
        order: &mut CheckOrder,
        visit: &mut dyn FnMut(&mut Self, FileId, ExprId, Node) -> bool,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if func.is_none()
            || hir[func].ret.is_some()
            || !self.is_followed(file, order)
            || !order.is_resolved.insert((file, hir.node(func)))
        {
            return false;
        }
        match hir[func].body {
            FnBody::None => false,
            FnBody::Expr(e) => self.follow_node(file, hir.node(e), order, visit),
            FnBody::Block(_) => (bound.ids(bound.fns[func.idx()].returns))
                .any(|s| self.follow_children(file, hir.node(s), order, visit)),
        }
    }

    /// `checkDeclarationInitializer`
    fn follow_initializer(
        &mut self,
        file: FileId,
        declaration: Node,
        (ty, initializer): (TypeNodeId, ExprId),
        order: &mut CheckOrder,
        visit: &mut dyn FnMut(&mut Self, FileId, ExprId, Node) -> bool,
    ) -> bool {
        ty.is_none()
            && initializer.is_some()
            && self.is_followed(file, order)
            && order.is_resolved.insert((file, declaration))
            && self.follow_node(file, self.hir(file).node(initializer), order, visit)
    }

    fn is_followed(&self, file: FileId, order: &CheckOrder) -> bool {
        file == order.file
            || order.follows_later_files && self.is_checked_no_later_than(order.file, file)
    }

    fn follow_node(
        &mut self,
        file: FileId,
        node: Node,
        order: &mut CheckOrder,
        visit: &mut dyn FnMut(&mut Self, FileId, ExprId, Node) -> bool,
    ) -> bool {
        if self.is_stack_low() {
            return false;
        }
        // `checkSourceElement`
        let is_source_element = matches!(
            self.hir(file).data(node),
            NodeData::Stmt(_)
                | NodeData::VarDecl(_)
                | NodeData::Param(_)
                | NodeData::PatProp(_)
                | NodeData::PatElem(_)
                | NodeData::Member(_)
        );
        if !is_source_element || file != order.file {
            return self.follow_node_worker(file, node, order, visit);
        }
        let save_current_node = std::mem::replace(&mut order.current_node, node);
        let ends = self.follow_node_worker(file, node, order, visit);
        order.current_node = save_current_node;
        ends
    }

    fn follow_node_worker(
        &mut self,
        file: FileId,
        node: Node,
        order: &mut CheckOrder,
        visit: &mut dyn FnMut(&mut Self, FileId, ExprId, Node) -> bool,
    ) -> bool {
        use Kind::*;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let kind = hir.kind(node);
        if kind.is_type_node() {
            return false;
        }
        let expression = match hir.data(node) {
            NodeData::Expr(e) => e,
            _ => ExprId::NONE,
        };
        if expression.is_some() && visit(self, file, expression, order.current_node) {
            return true;
        }
        // `checkNodeDeferred`. Returns whether it is the first time.
        let defer = |order: &mut CheckOrder| {
            let is_first = order.is_deferred.insert((file, node));
            if is_first && file == order.file {
                order.deferred_nodes.push_back(node);
            }
            is_first
        };
        let is_in_object_literal = || hir.kind(hir.parent(node)) == ObjectLiteralExpression;
        match kind {
            JsxElement | JsxSelfClosingElement | VoidExpression => {
                defer(order);
                return false;
            }
            GetAccessor | SetAccessor if is_in_object_literal() => {
                defer(order);
                return false;
            }
            // `checkFunctionExpressionOrObjectLiteralMethod`
            FunctionExpression | ArrowFunction | MethodDeclaration
                if kind != MethodDeclaration || is_in_object_literal() =>
            {
                let func = hir.function_of(node);
                let FnOwner::Expr(owner) = bound.fns[func.idx()].owner else {
                    return false;
                };
                if !defer(order) {
                    return false;
                }
                // `contextuallyCheckFunctionExpressionOrObjectLiteralMethod`: `assignContextualParameterTypes` or
                // `assignNonContextualParameterTypes`, `getReturnTypeFromBody`, `checkSignatureDeclaration`.
                let is_context_sensitive = self.is_context_sensitive(file, owner);
                return is_context_sensitive && self.follow_parameters(file, func, order, visit)
                    || hir[func].ret.is_none()
                        && self.contextual_signature(file, func).is_some()
                        && self.follow_returned(file, func, order, visit)
                    || !is_context_sensitive && self.follow_parameters(file, func, order, visit);
            }
            // `checkClassLikeDeclaration`: `checkIndexConstraints` asks for the type of a property whose name declares an
            // index signature.
            ClassDeclaration | ClassExpression => {
                for m in hir[hir.class_of(node)].members.iter() {
                    let member = &hir[m];
                    if member.kind == MemberKind::Property
                        && matches!(member.key, PropKey::Computed(_))
                        && !self.is_late_bound(file, m)
                        && self.follow_initializer(
                            file,
                            hir.node(m),
                            (member.ty, member.init),
                            order,
                            visit,
                        )
                    {
                        return true;
                    }
                }
                if kind == ClassExpression {
                    defer(order);
                    return false;
                }
            }
            VariableDeclaration => {
                order.is_resolved.insert((file, node));
            }
            // `checkAccessorDeclaration`, `checkReturnStatement`
            GetAccessor | ReturnStatement => {
                let function = match kind {
                    GetAccessor => node,
                    _ => hir.get_containing_function(node),
                };
                if self.follow_returned(file, hir.function_of(function), order, visit) {
                    return true;
                }
            }
            // `getTypeOfSymbol`
            Identifier if expression.is_some() && bound.expr_symbol[expression.idx()].is_some() => {
                let files = self.files();
                let symbol = files.sym(file, bound.expr_symbol[expression.idx()]);
                let target = if order.follows_later_files && files.is_non_local_alias(symbol) {
                    files.resolve_alias(symbol)
                } else {
                    Some(symbol)
                };
                let declaration = target.and_then(|target| files.value_declaration(target));
                let Some((of, Decl::Var(name))) = declaration else {
                    return false;
                };
                let PatParent::Var(declaration) = self.bound(of).pat_parent[name.idx()] else {
                    return false;
                };
                let (node, declaration) =
                    (self.hir(of).node(declaration), &self.hir(of)[declaration]);
                let parts = (declaration.ty, declaration.init);
                return self.follow_initializer(of, node, parts, order, visit);
            }
            _ => {}
        }
        if self.follow_children(file, node, order, visit) {
            return true;
        }
        // `checkCallExpression`: `getReturnTypeOfSignature`
        kind == CallExpression
            && (self.resolved_signature(file, expression).sig)
                .and_then(|signature| self.sig_decl(signature))
                .is_some_and(|(of, func, _)| self.follow_returned(of, func, order, visit))
    }
}
