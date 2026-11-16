use super::{FoldError, FoldErrorKind};
use crate::atom::{Atom, Interner, known};
use crate::bind::{Bound, ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, SymbolId};
use crate::hir::{
    ClassId, ExprId, ExprKind, File, FnId, ImportSpecId, MemberId, NodeData, PatId, StmtId,
    StmtKind,
};

pub(super) fn find_feature_import(
    hir: &File<'_>,
    bound: &Bound<'_>,
    errors: &mut Vec<FoldError>,
) -> SymbolId {
    let mut feature_specifier = None;
    for specifier in evaluated_bundle_specifiers(hir, bound) {
        let imported = hir[specifier].imported;
        let error = if imported == known::feature {
            let first = *feature_specifier.get_or_insert(specifier);
            (first != specifier).then_some(FoldErrorKind::FeatureImportedTwice)
        } else {
            Some(FoldErrorKind::UnknownBundleExport(imported))
        };
        if let Some(kind) = error {
            let node = NodeData::ImportSpec(specifier);
            errors.push(FoldError { kind, node });
        }
    }
    feature_specifier.map_or(SymbolId::NONE, |specifier| {
        bound.declared_symbol(Decl::ImportSpec(specifier))
    })
}

fn evaluated_bundle_specifiers(
    hir: &File<'_>,
    bound: &Bound<'_>,
) -> impl Iterator<Item = ImportSpecId> {
    hir.imports
        .iter()
        .filter(move |import| {
            import.spec == known::bun_bundle
                && !import.type_only
                && bound.parent_of_stmt(import.stmt) == Parent::File
        })
        .flat_map(|import| import.named.iter())
        .filter(move |&specifier| !hir[specifier].type_only)
}

pub(super) fn find_feature_flag(
    hir: &File<'_>,
    bound: &Bound<'_>,
    atoms: &Interner<'_>,
    call: ExprId,
) -> Result<Atom, FoldError> {
    let error_at = |kind, e| FoldError {
        kind,
        node: NodeData::Expr(e),
    };
    let ExprKind::Call(id) = hir[call].kind else {
        debug_assert!(false, "`call` is a `Call`");
        return Err(error_at(FoldErrorKind::FeatureArgumentCount, call));
    };
    let args = hir[id].args;
    if args.len() != 1 {
        return Err(error_at(FoldErrorKind::FeatureArgumentCount, call));
    }
    let argument = hir.id_at(args, 0);
    let ExprKind::String(flag) = hir[hir.skip_type_assertions(argument)].kind else {
        return Err(error_at(FoldErrorKind::FeatureArgumentNotString, argument));
    };
    if !atoms.bytes(flag).is_ascii() {
        return Err(error_at(FoldErrorKind::FeatureFlagNotAscii, argument));
    }
    if !is_in_branch_condition(hir, bound, call) {
        return Err(error_at(FoldErrorKind::FeatureOutsideCondition, call));
    }
    Ok(flag)
}

#[derive(Copy, Clone)]
enum Ancestor {
    Expr(ExprId),
    Stmt(StmtId),
}

impl Ancestor {
    fn from_expr(e: ExprId) -> Option<Ancestor> {
        e.some().map(Ancestor::Expr)
    }

    fn from_stmt(stmt: StmtId) -> Option<Ancestor> {
        stmt.some().map(Ancestor::Stmt)
    }
}

fn is_in_branch_condition(hir: &File<'_>, bound: &Bound<'_>, call: ExprId) -> bool {
    let mut child = Ancestor::Expr(call);
    loop {
        let parent = match child {
            Ancestor::Expr(e) => bound.parent_of_expr(e),
            Ancestor::Stmt(stmt) => bound.parent_of_stmt(stmt),
        };
        let Some(ancestor) = find_ancestor(hir, bound, parent) else {
            return false;
        };
        let is_test = match (ancestor, child) {
            (Ancestor::Expr(e), Ancestor::Expr(child)) => {
                matches!(hir[e].kind, ExprKind::Cond { test, .. } if test == child)
            }
            (Ancestor::Stmt(stmt), Ancestor::Expr(child)) => {
                matches!(hir[stmt].kind, StmtKind::If { test, .. } if test == child)
            }
            (Ancestor::Expr(_) | Ancestor::Stmt(_), Ancestor::Stmt(_)) => false,
        };
        if is_test {
            return true;
        }
        child = ancestor;
    }
}

fn find_ancestor(hir: &File<'_>, bound: &Bound<'_>, parent: Parent) -> Option<Ancestor> {
    match parent {
        Parent::None | Parent::File => None,
        Parent::Expr(e) => Ancestor::from_expr(e),
        Parent::Stmt(stmt) => Ancestor::from_stmt(stmt),
        Parent::VarInit(declaration) => Ancestor::from_stmt(bound.var_stmt[declaration.idx()]),
        Parent::ParamDefault(param) => find_function_owner(hir, bound, bound.param_fn[param.idx()]),
        Parent::PatPropDefault(prop) | Parent::PatKey(prop) => {
            find_pattern_owner(hir, bound, hir[prop].value)
        }
        Parent::PatElemDefault(element) => find_pattern_owner(hir, bound, hir[element].pat),
        Parent::Prop(prop) | Parent::PropKey(prop) | Parent::MethodKey(prop) => {
            Ancestor::from_expr(bound.prop_owner[prop.idx()])
        }
        Parent::MemberKey(member) | Parent::MemberInit(member) => {
            find_member_owner(hir, bound, member)
        }
        Parent::FnBody(function) => find_function_owner(hir, bound, function),
        Parent::EnumInit(member) => {
            let enumeration = bound.enum_member_owner[member.idx()].some()?;
            Ancestor::from_stmt(hir[enumeration].stmt)
        }
        Parent::Case(case) => Ancestor::from_stmt(bound.case_stmt[case.idx()]),
        Parent::ClassExtends(class) => find_class_owner(bound, class),
        Parent::ClassDecorator(_) | Parent::MemberDecorator(_) | Parent::ParamDecorator(_) => {
            find_class_owner(bound, bound.class_of_decorator(parent))
        }
        Parent::Module(module) => Ancestor::from_stmt(hir[module].stmt),
    }
}

fn find_pattern_owner(hir: &File<'_>, bound: &Bound<'_>, pattern: PatId) -> Option<Ancestor> {
    let mut pattern = pattern.some()?;
    loop {
        match bound.pat_parent[pattern.idx()] {
            PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pattern = outer,
            PatParent::Var(declaration) => {
                return Ancestor::from_stmt(bound.var_stmt[declaration.idx()]);
            }
            PatParent::Param(param) => {
                return find_function_owner(hir, bound, bound.param_fn[param.idx()]);
            }
            PatParent::None => return None,
        }
    }
}

fn find_function_owner(hir: &File<'_>, bound: &Bound<'_>, function: FnId) -> Option<Ancestor> {
    match bound.fns[function.some()?.idx()].owner {
        FnOwner::Expr(e) => Ancestor::from_expr(e),
        FnOwner::Stmt(stmt) => Ancestor::from_stmt(stmt),
        FnOwner::Member(member) => find_member_owner(hir, bound, member),
        FnOwner::None | FnOwner::Type(_) => None,
    }
}

fn find_member_owner(hir: &File<'_>, bound: &Bound<'_>, member: MemberId) -> Option<Ancestor> {
    match bound.member_owner[member.idx()] {
        MemberOwner::Class(class) => find_class_owner(bound, class),
        MemberOwner::Interface(interface) => Ancestor::from_stmt(hir[interface].stmt),
        MemberOwner::None | MemberOwner::TypeLiteral(_) => None,
    }
}

fn find_class_owner(bound: &Bound<'_>, class: ClassId) -> Option<Ancestor> {
    match bound.class_owner.get(class.idx()) {
        Some(&ClassOwner::Expr(e)) => Ancestor::from_expr(e),
        Some(&ClassOwner::Stmt(stmt)) => Ancestor::from_stmt(stmt),
        None => None,
    }
}
