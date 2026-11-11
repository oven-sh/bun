use super::ImportSiteKind;
use super::alternatives::may_change_or_hand_on_its_object;
use super::call_sites::is_free_common_js;
use super::parameters::is_exported;
use crate::atom::{Atom, Interner, known};
use crate::bind::{Binding, Bound, CommonJsVariable, FnOwner, Parent, SymbolId};
use crate::hir::{
    BinOp, ExprId, ExprKind, File, FnId, FnKind, MemberKey, PatKind, PropKey, StmtKind, UnOp,
};
use smallvec::SmallVec;

pub(super) fn is_only_tested(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let Parent::Expr(above) = bound.parent_of_expr(e) else {
        return false;
    };
    match hir[above].kind {
        ExprKind::Binary {
            op: BinOp::And,
            left,
            ..
        } => left == e,
        ExprKind::Binary {
            op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
            ..
        } => true,
        ExprKind::Unary {
            op: UnOp::Not | UnOp::Typeof,
            ..
        } => true,
        _ => false,
    }
}

pub(super) fn stands_in_function_with_arguments(
    hir: &File<'_>,
    bound: &Bound<'_>,
    e: ExprId,
) -> bool {
    let is_declared = matches!(bound.binding(e), Binding::Symbol(_));
    let mut functions = (0..).map(FnId).zip(bound.fns.iter());
    is_declared
        || functions.any(|it| match it.1.owner {
            _ if hir[it.0].kind == FnKind::Arrow => false,
            FnOwner::Expr(written) => (hir[written].pos..hir[written].end).contains(&hir[e].pos),
            FnOwner::Stmt(declared) => {
                (hir[declared].loc.pos..hir[declared].loc.end).contains(&hir[e].pos)
            }
            _ => false,
        })
}

fn leads_on_off_module(member: &[u8]) -> bool {
    matches!(
        member,
        b"parent" | b"children" | b"require" | b"constructor" | b"__proto__"
    )
}

fn leads_on_off_process(member: &[u8]) -> bool {
    matches!(
        member,
        b"mainModule"
            | b"binding"
            | b"_linkedBinding"
            | b"getBuiltinModule"
            | b"constructor"
            | b"__proto__"
    )
}

fn leads_on_off_global_object(member: &[u8]) -> bool {
    matches!(
        member,
        b"process"
            | b"eval"
            | b"Function"
            | b"globalThis"
            | b"global"
            | b"self"
            | b"window"
            | b"require"
            | b"module"
            | b"constructor"
            | b"__proto__"
    )
}

fn leads_on_off_anything(member: &[u8]) -> bool {
    matches!(member, b"mainModule" | b"_cache" | b"_load")
}

pub(crate) fn is_module_that_reaches_modules(name: &[u8]) -> bool {
    matches!(
        name.strip_prefix(b"node:").unwrap_or(name),
        b"module" | b"process" | b"vm" | b"repl" | b"inspector"
    )
}

fn is_callee(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    matches!(bound.parent_of_expr(e), Parent::Expr(user)
        if matches!(hir[user].kind,
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call)
                if hir[call].callee == e))
}

fn reads_members_that_lead_nowhere(
    hir: &File<'_>,
    bound: &Bound<'_>,
    atoms: &Interner<'_>,
    e: ExprId,
    leads_on: fn(&[u8]) -> bool,
) -> bool {
    match bound.parent_of_expr(e) {
        Parent::Expr(above) => match hir.member_key(above) {
            Some((of, MemberKey::Name(read))) if of == e => {
                !leads_on(atoms.bytes(read)) || is_only_tested(hir, bound, above)
            }
            _ => is_only_tested(hir, bound, e),
        },
        Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
            PatKind::Object(taken) => taken.iter().all(|it| {
                !hir[it].is_rest
                    && matches!(hir[it].key, PropKey::Name(read) if !leads_on(atoms.bytes(read)))
            }),
            _ => false,
        },
        _ => false,
    }
}

fn is_mentioned_harmlessly(
    hir: &File<'_>,
    bound: &Bound<'_>,
    atoms: &Interner<'_>,
    e: ExprId,
    name: Atom,
) -> bool {
    if is_free_common_js(hir, bound, e, CommonJsVariable::Module) {
        return reads_members_that_lead_nowhere(hir, bound, atoms, e, leads_on_off_module);
    }
    if is_free_common_js(hir, bound, e, CommonJsVariable::Require) {
        let only_resolves = |member: &[u8]| member != b"resolve";
        return is_callee(hir, bound, e)
            || reads_members_that_lead_nowhere(hir, bound, atoms, e, only_resolves);
    }
    if name == known::arguments {
        return stands_in_function_with_arguments(hir, bound, e);
    }
    if bound.binding(e) != Binding::Free {
        return true;
    }
    match atoms.bytes(name) {
        b"process" => reads_members_that_lead_nowhere(hir, bound, atoms, e, leads_on_off_process),
        b"globalThis" | b"global" | b"self" | b"window" => {
            reads_members_that_lead_nowhere(hir, bound, atoms, e, leads_on_off_global_object)
        }
        b"eval" | b"Function" => {
            is_only_tested(hir, bound, e)
                || matches!(bound.parent_of_expr(e), Parent::Expr(above)
                    if matches!(hir[above].kind, ExprKind::Binary { op: BinOp::Instanceof, right, .. } if right == e))
        }
        _ => true,
    }
}

pub(crate) fn reaches_modules_unnamed(
    hir: &File<'_>,
    bound: &Bound<'_>,
    atoms: &Interner<'_>,
) -> bool {
    let mut statements = hir.stmts.iter();
    let mut expressions = (0..hir.exprs.len() as u32).map(ExprId);
    statements.any(|it| matches!(it.kind, StmtKind::With { .. }))
        || expressions.any(|it| match (hir[it].kind, hir.member_key(it)) {
            (ExprKind::Ident(name), _) => !is_mentioned_harmlessly(hir, bound, atoms, it, name),
            (_, Some((_, MemberKey::Name(read)))) => {
                let read = atoms.bytes(read);
                leads_on_off_anything(read) || read == b"constructor" && is_callee(hir, bound, it)
            }
            _ => false,
        })
}

pub(crate) fn touches_export(
    hir: &File<'_>,
    bound: &Bound<'_>,
    atoms: &Interner<'_>,
    site: ImportSiteKind,
    key: Atom,
) -> bool {
    match site {
        ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) => {
            touches_through(hir, bound, atoms, call, key, &mut SmallVec::new())
        }
        ImportSiteKind::Import(import) => {
            let import = hir[import];
            let mut named = import.named.iter();
            let takes_all = import.default.is_some() || import.namespace.is_some();
            let takes_nothing = !takes_all && import.named.iter().next().is_none();
            !import.type_only
                && !takes_nothing
                && (takes_all
                    || key == known::exports
                    || named
                        .any(|it| hir[it].imported == key || hir[it].imported == known::default))
        }
        ImportSiteKind::RequireResolve(_) | ImportSiteKind::ImportMetaResolve(_) => false,
        _ => true,
    }
}

fn touches_through(
    hir: &File<'_>,
    bound: &Bound<'_>,
    atoms: &Interner<'_>,
    mut value: ExprId,
    key: Atom,
    names: &mut SmallVec<[SymbolId; 4]>,
) -> bool {
    while let Parent::Expr(above) = bound.parent_of_expr(value)
        && hir.type_assertion_operand(above).is_some()
    {
        value = above;
    }
    match bound.parent_of_expr(value) {
        Parent::Stmt(statement) => !matches!(hir[statement].kind, StmtKind::Expr(_)),
        _ if key == known::exports => true,
        Parent::Expr(above) => !matches!(hir.member_key(above),
            Some((of, MemberKey::Name(other))) if of == value
                && other != key
                && !may_change_or_hand_on_its_object(atoms.bytes(other))),
        Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
            PatKind::Ident(_) => {
                let Binding::Symbol(name) = bound.initialized_binding(hir[declaration].pat) else {
                    return true;
                };
                if names.contains(&name) {
                    return false;
                }
                names.push(name);
                let mut expressions = (0..).map(ExprId).zip(hir.exprs.iter());
                !bound.is_stable_binding(name)
                    || is_exported(hir, bound, name)
                    || bound.is_visible_to_eval(name)
                    || expressions.any(|(it, written)| {
                        matches!(written.kind, ExprKind::Ident(_))
                            && bound.binding(it) == Binding::Symbol(name)
                            && touches_through(hir, bound, atoms, it, key, names)
                    })
            }
            PatKind::Object(taken) => taken.iter().any(|it| {
                hir[it].is_rest
                    || !matches!(hir[it].key, PropKey::Name(other) if other != key
                        && !may_change_or_hand_on_its_object(atoms.bytes(other)))
            }),
            _ => true,
        },
        _ => true,
    }
}
