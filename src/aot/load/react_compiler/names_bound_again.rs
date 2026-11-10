use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{BindOptions, Binding, Bound, Decl, FnOwner, RuntimeBindOptions, bind};
use bun_sema::hir::{ExprId, ExprKind, File, Flags, FnId};
use bun_sema::session::Arena;
use rustc_hash::FxHashMap;

fn find_replaced_functions(
    written: &File<'_>,
    compiled: &File<'_>,
    bound: &Bound<'_>,
) -> Vec<(u32, u32)> {
    let functions = compiled.fns.iter().enumerate().take(written.fns.len());
    let replaced = functions.filter(|(_, function)| function.flags.contains(Flags::REPLACED_BODY));
    let ranges = replaced.filter_map(|(index, _)| {
        let function = FnId(index as u32);
        let end = match bound.fns[function.idx()].owner {
            FnOwner::Expr(owner) => written[owner].end,
            FnOwner::Stmt(owner) => written[owner].loc.end,
            FnOwner::Member(owner) => written[owner].loc.end,
            FnOwner::Type(_) | FnOwner::None => return None,
        };
        Some((written[function].start, end))
    });
    ranges.collect()
}

fn find_position(written: &File<'_>, declaration: Decl) -> Option<u32> {
    match declaration {
        Decl::Var(name) | Decl::Param(name) | Decl::Require(name) => Some(written[name].pos),
        Decl::Fn(function) => Some(written[function].start),
        Decl::Class(class) => Some(written[class].start),
        Decl::Enum(declared) => Some(written[declared].name_pos),
        Decl::ImportDefault(_)
        | Decl::ImportNamespace(_)
        | Decl::ImportSpec(_)
        | Decl::ImportEquals(_)
        | Decl::Module(_) => Some(0),
        _ => None,
    }
}

pub(super) fn find_name_bound_elsewhere(
    written: &File<'_>,
    compiled: &File<'_>,
    atoms: &Interner<'_>,
    arena: &Arena,
) -> Option<(u32, Atom)> {
    let options = BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    };
    let before = bind(written, options, atoms, arena);
    let after = bind(compiled, options, atoms, arena);
    let replaced = find_replaced_functions(written, compiled, &before);
    let find_function_around = |at: u32| {
        let around = replaced
            .iter()
            .filter(|range| range.0 <= at && at < range.1);
        around.min_by_key(|range| range.0).copied()
    };
    let mut names_written: FxHashMap<u32, ExprId> = FxHashMap::default();
    for (index, expression) in written.exprs.iter().enumerate() {
        let is_name = matches!(expression.kind, ExprKind::Ident(_));
        if is_name && find_function_around(expression.pos).is_some() {
            names_written.insert(expression.pos, ExprId(index as u32));
        }
    }
    (written.exprs.len()..compiled.exprs.len()).find_map(|index| {
        let copy = ExprId(index as u32);
        let ExprKind::Ident(name) = compiled[copy].kind else {
            return None;
        };
        let position = compiled[copy].pos;
        let &original = names_written.get(&position)?;
        if !matches!(written[original].kind, ExprKind::Ident(it) if it == name) {
            return None;
        }
        let (start, end) = find_function_around(position)?;
        let is_bound_as_before = match (before.binding(original), after.binding(copy)) {
            (Binding::Symbol(was), is) => {
                let declaration = *before.symbol(was).decls.first()?;
                let declared_at = find_position(written, declaration)?;
                if start <= declared_at && declared_at < end {
                    return None;
                }
                matches!(is, Binding::Symbol(is) if after.symbol(is).decls.first() == Some(&declaration))
            }
            (Binding::Arguments(_), Binding::Arguments(_)) => true,
            (was, is) => was == is,
        };
        (!is_bound_as_before).then_some((position, name))
    })
}
