use super::queries::Queries;
use crate::atom::known;
use crate::bind::{Binding, BindingInitializer, Bound, FnOwner, Parent, SymbolId};
use crate::hir::{
    self, Chain, ExprId, ExprKind, ExprTag, Flags, FnId, FnKind, MemberKey, StmtKind,
};
use crate::program::FileId;
use std::ops::Range;

#[derive(Copy, Clone)]
pub struct SuperCall {
    pub constructor: FnId,
    pub name: SymbolId,
    pub this: ExprId,
    pub form: SuperCallForm,
}

#[derive(Copy, Clone)]
pub enum SuperCallForm {
    List(Option<ExprId>),
    Call { created: ExprId },
    Apply { created: ExprId, list: ExprId },
}

fn find_constructor_named_by(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    name: ExprId,
) -> Option<(SymbolId, FnId)> {
    let name = hir.skip_type_assertions(name);
    let Binding::Symbol(symbol) = bound.binding(name) else {
        return None;
    };
    if !matches!(hir[name].kind, ExprKind::Ident(_)) || !bound.is_stable_binding(symbol) {
        return None;
    }
    match bound.binding_initializer(hir, symbol) {
        BindingInitializer::Function(function) if may_be_constructor_function(hir, function) => {
            Some((symbol, function))
        }
        _ => None,
    }
}

fn find_creation_of_super(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    variable: ExprId,
) -> Option<ExprId> {
    let Binding::Symbol(symbol) = bound.binding(variable) else {
        return None;
    };
    if !matches!(hir[variable].kind, ExprKind::Ident(_)) || !bound.is_stable_binding(symbol) {
        return None;
    }
    let BindingInitializer::Expression(created) = bound.binding_initializer(hir, symbol) else {
        return None;
    };
    let created = hir.skip_type_assertions(created);
    match hir[created].kind {
        ExprKind::Call(site) if hir[site].args.len() == 1 => Some(created),
        _ => None,
    }
}

pub fn find_super_call(hir: &hir::File<'_>, bound: &Bound<'_>, call: ExprId) -> Option<SuperCall> {
    let ExprKind::Call(id) = hir[call].kind else {
        return None;
    };
    let site = hir[id];
    if site.args.is_empty() || site.chain != Chain::No {
        return None;
    }
    let this = hir.skip_type_assertions(hir.id_at(site.args, 0));
    if !matches!(hir[this].kind, ExprKind::This) {
        return None;
    }
    let callee = hir.skip_type_assertions(site.callee);
    let (name, form) = match hir[callee].kind {
        ExprKind::Ident(_) if (2..=3).contains(&site.args.len()) => {
            let list = (site.args.len() == 3).then(|| hir.id_at(site.args, 2));
            let list = list.map(|list| hir.skip_type_assertions(list));
            (hir.id_at(site.args, 1), SuperCallForm::List(list))
        }
        _ => {
            let (object, MemberKey::Name(method)) = hir.member_key(callee)? else {
                return None;
            };
            let created = find_creation_of_super(hir, bound, hir.skip_type_assertions(object))?;
            let form = match method {
                known::call => SuperCallForm::Call { created },
                known::apply if site.args.len() == 2 => SuperCallForm::Apply {
                    created,
                    list: hir.skip_type_assertions(hir.id_at(site.args, 1)),
                },
                _ => return None,
            };
            let ExprKind::Call(creation) = hir[created].kind else {
                return None;
            };
            (hir.id_at(hir[creation].args, 0), form)
        }
    };
    let (name, constructor) = find_constructor_named_by(hir, bound, name)?;
    let is_statement = matches!(
        bound.parent_of_expr(call),
        Parent::Stmt(statement) if matches!(hir[statement].kind, StmtKind::Expr(_))
    );
    if is_statement || function_of_this(hir, this) != Some(constructor) {
        return None;
    }
    Some(SuperCall {
        constructor,
        name,
        this,
        form,
    })
}

pub fn may_be_constructor_function(hir: &hir::File<'_>, function: FnId) -> bool {
    let node = hir[function];
    matches!(node.kind, FnKind::Decl | FnKind::Expr)
        && !node.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
}

pub fn function_of_this(hir: &hir::File<'_>, this: ExprId) -> Option<FnId> {
    let container = hir.get_this_container(hir.node(this), false, false);
    hir.function_of(container).some()
}

pub fn text_of_function(hir: &hir::File<'_>, bound: &Bound<'_>, function: FnId) -> Range<u32> {
    match bound.fns[function.idx()].owner {
        FnOwner::Expr(owner) => hir[owner].pos..hir[owner].end,
        FnOwner::Stmt(owner) => hir[owner].start..hir[owner].loc.end,
        FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => 0..u32::MAX,
    }
}

impl Queries<'_, '_, '_> {
    pub fn expressions_of_kind_in(
        &mut self,
        file: FileId,
        kind: ExprTag,
        text: &Range<u32>,
    ) -> Vec<ExprId> {
        let expressions = self.c.exprs_by_kind(file);
        let hir = self.c.hir(file);
        let mut found = Vec::new();
        for &expression in expressions.of(kind) {
            if text.contains(&hir[expression].pos) {
                found.push(expression);
            }
        }
        found
    }
}
