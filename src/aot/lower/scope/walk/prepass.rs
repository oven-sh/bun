use bun_sema::bind::{Binding, Bound, Decl, ScopeId, ScopeKind, SymbolId};
use bun_sema::fold::Decisions;
use bun_sema::hir::{self, ClassId, DecoratorOwner, ExprId, FnId, NodeData, ParamId};

use crate::lower::scope::analysis::sort_unique;
use crate::lower::scope::lexical_owners::scope_chain;

fn find_parameter_class(bound: &Bound<'_>, parameter: ParamId) -> Option<ClassId> {
    bound.function_class(bound.param_fn[parameter.idx()].some()?)
}

fn is_variable_scope(kind: ScopeKind) -> bool {
    matches!(
        kind,
        ScopeKind::File | ScopeKind::Fn(_) | ScopeKind::Module(_)
    )
}

pub(super) fn collect_eval_variable_scopes(
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
) -> Vec<ScopeId> {
    let mut scopes = Vec::new();
    for &(call, eval) in bound.runtime.eval_scopes() {
        if eval.is_sloppy && !decisions.is_dead_expr(call) {
            let mut chain = scope_chain(bound, eval.scope);
            scopes.extend(chain.find(|scope| is_variable_scope(bound.scopes[scope.idx()].kind)));
        }
    }
    sort_unique(&mut scopes);
    scopes
}

pub(super) fn collect_inner_module_parameters(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    callbacks: &[FnId],
) -> Vec<SymbolId> {
    let parameters = callbacks
        .iter()
        .flat_map(|&callback| hir[callback].params.iter());
    let symbols =
        parameters.map(|parameter| bound.declared_symbol(Decl::Param(hir[parameter].pat)));
    let mut symbols: Vec<SymbolId> = symbols.filter(|symbol| symbol.is_some()).collect();
    sort_unique(&mut symbols);
    symbols
}

pub(super) fn collect_implicit_uses(
    bound: &Bound<'_>,
) -> (Vec<(ExprId, Binding)>, Vec<(ClassId, Binding)>) {
    let (mut jsx_uses, mut metadata_uses) = (Vec::new(), Vec::new());
    for reference in bound.runtime.implicit_references() {
        let binding = match reference.binding {
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) => reference.binding,
            Binding::Free => continue,
        };
        let class = match reference.node {
            NodeData::Expr(expression) => {
                jsx_uses.push((expression, binding));
                continue;
            }
            NodeData::Member(member) => bound.member_class(member),
            NodeData::Param(parameter) => find_parameter_class(bound, parameter),
            _ => None,
        };
        debug_assert!(
            class.is_some(),
            "decorator metadata belongs to a class member or parameter"
        );
        metadata_uses.extend(class.map(|class| (class, binding)));
    }
    jsx_uses.sort_by_key(|entry| entry.0);
    metadata_uses.sort_by_key(|entry| entry.0);
    (jsx_uses, metadata_uses)
}

pub(super) fn collect_class_decorators(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
) -> Vec<(ClassId, ExprId)> {
    let mut decorators = Vec::with_capacity(hir.decorators.len());
    for &(owner, expression) in hir.decorators.iter() {
        let class = match owner {
            DecoratorOwner::Class(class) => Some(class),
            DecoratorOwner::Member(member) => bound.member_class(member),
            DecoratorOwner::Param(parameter) => find_parameter_class(bound, parameter),
        };
        decorators.extend(class.map(|class| (class, expression)));
    }
    decorators.sort_by_key(|entry| entry.0);
    decorators
}
