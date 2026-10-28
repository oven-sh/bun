use super::resolver::Resolver;
use crate::builtins::table::{self, BuiltinId, is_locked};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingInitializer, Decl, FnOwner, Parent, PatParent, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, Flags, FnId, FnKind, StmtKind};
use smallvec::{SmallVec, smallvec};

pub(super) type Texts = SmallVec<[Atom; 4]>;

// How many operands `forEach` hands over in front of the list itself.
const OPERANDS_BEFORE_LIST: usize = 2;

impl Resolver<'_, '_> {
    fn walks_lists_as_the_language_says() -> bool {
        is_locked(BuiltinId::ArrayPrototypeSymbolIterator)
            && is_locked(BuiltinId::ArrayIteratorPrototypeNext)
    }

    fn find_receiver_of_for_each(&self, function: FnId) -> Option<ExprId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let FnOwner::Expr(callback) = bound.fns[function.idx()].owner else {
            return None;
        };
        let mut parameters = hir[function].params.iter();
        let takes_list = hir[function].params.len() > OPERANDS_BEFORE_LIST
            || parameters.any(|parameter| hir[parameter].flags.contains(Flags::REST));
        if !matches!(hir[function].kind, FnKind::Expr | FnKind::Arrow)
            || takes_list
            || bound.finds_itself(hir, function)
        {
            return None;
        }
        let Parent::Expr(user) = bound.parent_of_expr(callback) else {
            return None;
        };
        let ExprKind::Call(call) = hir[user].kind else {
            return None;
        };
        let ExprKind::Dot { obj, name, .. } = hir[hir[call].callee].kind else {
            return None;
        };
        let member = table::own_member(BuiltinId::ArrayPrototype, self.input.names.get(name)?);
        let is_for_each = member == Some(BuiltinId::ArrayPrototypeForEach)
            && is_locked(BuiltinId::ArrayPrototypeForEach)
            && hir.ids(hir[call].args).next() == Some(callback);
        is_for_each.then_some(obj)
    }

    fn is_walk(&self, mention: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut node = mention;
        loop {
            match bound.parent_of_expr(node) {
                Parent::Expr(parent) if hir.skip_type_assertions(parent) == mention => {
                    node = parent
                }
                Parent::Expr(parent) => {
                    let Parent::Expr(user) = bound.parent_of_expr(parent) else {
                        return false;
                    };
                    let ExprKind::Call(call) = hir[user].kind else {
                        return false;
                    };
                    let Some(callback) = hir.ids(hir[call].args).next() else {
                        return false;
                    };
                    let ExprKind::Fn(function) = hir[callback].kind else {
                        return false;
                    };
                    return hir[call].callee == parent
                        && self.find_receiver_of_for_each(function) == Some(node);
                }
                Parent::Stmt(statement) => {
                    return Self::walks_lists_as_the_language_says()
                        && matches!(hir[statement].kind, StmtKind::ForOf { expr, is_await: false, .. } if expr == node);
                }
                _ => return false,
            }
        }
    }

    // The array literal that the expression is, or that it names: a variable that holds the literal for good and is only gone over.
    fn find_written_list(&self, list: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let list = hir.skip_type_assertions(list);
        let symbol = match (hir[list].kind, bound.binding(list)) {
            (ExprKind::Array(_), _) => return Some(list),
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => symbol,
            _ => return None,
        };
        if !bound.is_stable_binding(symbol) || !self.can_hold_builtin(symbol) {
            return None;
        }
        let BindingInitializer::Expression(written) = bound.binding_initializer(hir, symbol) else {
            return None;
        };
        let written = hir.skip_type_assertions(written);
        let mut mentions = (0..hir.exprs.len() as u32).map(ExprId).filter(|&mention| {
            bound.is_evaluated_ident(mention) && bound.binding(mention) == Binding::Symbol(symbol)
        });
        (matches!(hir[written].kind, ExprKind::Array(_))
            && mentions.all(|mention| self.is_walk(mention)))
        .then_some(written)
    }

    // The list whose elements the variable takes one after the other, and nothing else: `for (const v of list)`, `list.forEach(v => ..)`.
    fn find_list_walked_by(&self, symbol: SymbolId) -> Option<ExprId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        if !self.can_hold_builtin(symbol) || !bound.stores_to(symbol).is_empty() {
            return None;
        }
        match *bound.symbol(symbol).decls {
            [Decl::Var(name)] => {
                let PatParent::Var(declaration) = bound.pat_parent[name.idx()] else {
                    return None;
                };
                let head = bound.var_stmt[declaration.idx()];
                let Parent::Stmt(owner) = bound.parent_of_stmt(head) else {
                    return None;
                };
                match hir[owner].kind {
                    StmtKind::ForOf {
                        left,
                        expr,
                        is_await: false,
                        ..
                    } if left == head && Self::walks_lists_as_the_language_says() => Some(expr),
                    _ => None,
                }
            }
            [Decl::Param(name)] => {
                let PatParent::Param(parameter) = bound.pat_parent[name.idx()] else {
                    return None;
                };
                let function = bound.param_fn[parameter.idx()];
                let is_first = hir[function].params.iter().next() == Some(parameter);
                (is_first && hir[parameter].default.is_none())
                    .then(|| self.find_receiver_of_for_each(function))?
            }
            _ => None,
        }
    }

    /// The texts that the operand can be: it is written as one, or it is a variable that goes over a written list of texts.
    pub(super) fn find_texts_of(&self, operand: ExprId) -> Option<Texts> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let operand = hir.skip_type_assertions(operand);
        let symbol = match (hir[operand].kind, bound.binding(operand)) {
            (ExprKind::String(text), _) => return Some(smallvec![text]),
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => symbol,
            _ => return None,
        };
        let list = self.find_written_list(self.find_list_walked_by(symbol)?)?;
        let ExprKind::Array(elements) = hir[list].kind else {
            return None;
        };
        let text_of = |element: ExprId| match hir[hir.skip_type_assertions(element)].kind {
            ExprKind::String(text) => Some(text),
            _ => None,
        };
        hir.ids(elements).map(text_of).collect()
    }

    /// `list.forEach(v => answer)`: nobody gets the answer.
    pub(super) fn is_dropped_by_for_each(&self, answer: ExprId) -> bool {
        let Parent::FnBody(function) = self.input.bound.parent_of_expr(answer) else {
            return false;
        };
        let list = self.find_receiver_of_for_each(function);
        list.is_some_and(|list| self.find_written_list(list).is_some())
    }
}
