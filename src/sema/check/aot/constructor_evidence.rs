use super::answers::FunctionRef;
use super::class_shape::is_prototype_object;
use super::prototype_links::list_in;
use super::queries::Queries;
use crate::atom::known;
use crate::bind::{Binding, Bound, Decl, FnOwner, Parent, SymbolId};
use crate::hir::{
    self, BinOp, ExportSpecId, ExprId, ExprKind, ExprTag, Flags, FnId, FnKind, MemberKey, PatKind,
    PropKey, TypeNodeKind, VarKind,
};
use crate::program::FileId;
use crate::util::FxHashSet;

fn is_member_of_receiver_or_prototype_object(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    place: ExprId,
) -> bool {
    let Some((object, _)) = hir.member_key(place) else {
        return false;
    };
    let object = hir.skip_type_assertions(object);
    matches!(hir[object].kind, ExprKind::This) || is_prototype_object(hir, bound, object)
}

fn stands_where_a_constructor_stands(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    mut value: ExprId,
    declares_this: bool,
) -> bool {
    loop {
        let parent = match bound.parent_of_expr(value) {
            Parent::Expr(parent) => parent,
            Parent::None => return false,
            Parent::Prop(property) => {
                return !declares_this
                    && !matches!(
                        hir.runtime_property_key(property),
                        PropKey::Name(name) if name == known::get || name == known::set
                    );
            }
            _ => return true,
        };
        let Some(parent) = parent.some() else {
            return false;
        };
        if hir.type_assertion_operand(parent) == Some(value) {
            value = parent;
            continue;
        }
        return match hir[parent].kind {
            ExprKind::New(site) => hir[site].callee == value,
            ExprKind::Call(_) | ExprKind::TaggedTemplate(_) => false,
            ExprKind::Binary {
                op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                ..
            } => false,
            ExprKind::Dot { .. } | ExprKind::Index { .. } => matches!(
                hir.member_key(parent),
                Some((object, MemberKey::Name(name))) if object == value && name == known::prototype
            ),
            ExprKind::Assign {
                op: None,
                target,
                value: stored,
            } if stored == value => {
                let becomes_member = declares_this && hir.member_key(target).is_some();
                !becomes_member && !is_member_of_receiver_or_prototype_object(hir, bound, target)
            }
            _ => true,
        };
    }
}

fn declares_this(hir: &hir::File<'_>, function: FnId) -> bool {
    let written = hir[function].this_ty(hir);
    written.is_some() && !matches!(hir[written].kind, TypeNodeKind::Keyword(_))
}

fn find_constant_holding(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> Option<(SymbolId, bool)> {
    let FnOwner::Expr(expression) = bound.fns[function.idx()].owner else {
        return None;
    };
    let Parent::VarInit(variable) = bound.parent_of_expr(expression) else {
        return None;
    };
    let variable = &hir[variable];
    if variable.kind != VarKind::Const || !matches!(hir[variable.pat].kind, PatKind::Ident(_)) {
        return None;
    }
    Some((
        bound.declared_symbol(Decl::Var(variable.pat)),
        variable.flags.contains(Flags::EXPORT),
    ))
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    fn compute_declarations_used_like_constructors(&mut self, file: FileId) -> &'s [SymbolId] {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let functions = (0..hir.fns.len() as u32).map(FnId);
        let mut unused = FxHashSet::default();
        let mut declaring_this = FxHashSet::default();
        let mut used = Vec::new();
        for function in functions {
            let (symbol, is_exported) = match hir[function].kind {
                FnKind::Decl => {
                    let is_exported = hir[function]
                        .flags
                        .intersects(Flags::EXPORT | Flags::DEFAULT);
                    (bound.declared_symbol(Decl::Fn(function)), is_exported)
                }
                FnKind::Expr => match find_constant_holding(hir, bound, function) {
                    Some(constant) => constant,
                    None => continue,
                },
                _ => continue,
            };
            if declares_this(hir, function) {
                declaring_this.insert(symbol);
            }
            match is_exported {
                true => used.push(symbol),
                false => {
                    unused.insert(symbol);
                }
            }
        }
        for spec in (0..hir.export_specs.len() as u32).map(ExportSpecId) {
            if let Binding::Symbol(symbol) = bound.exported_binding(spec)
                && unused.remove(&symbol)
            {
                used.push(symbol);
            }
        }
        if !unused.is_empty() {
            let expressions = self.c.exprs_by_kind(file);
            for &reference in expressions.of(ExprTag::Ident) {
                if let Binding::Symbol(symbol) = bound.binding(reference)
                    && unused.contains(&symbol)
                    && !bound.is_in_type_query(reference)
                    && stands_where_a_constructor_stands(
                        hir,
                        bound,
                        reference,
                        declaring_this.contains(&symbol),
                    )
                {
                    unused.remove(&symbol);
                    used.push(symbol);
                }
            }
        }
        used.sort_unstable();
        used.dedup();
        list_in(self.c.arena, &used)
    }

    pub(super) fn is_used_like_constructor(&mut self, function: FunctionRef) -> bool {
        let FunctionRef { file, function } = function;
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let named = match bound.fns[function.idx()].owner {
            FnOwner::Expr(_) => {
                find_constant_holding(hir, bound, function).map(|(symbol, _)| symbol)
            }
            FnOwner::Stmt(_) => Some(bound.declared_symbol(Decl::Fn(function))),
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => None,
        };
        if let Some(symbol) = named {
            let of_file = self.prototype_links(file);
            let used = *of_file
                .declarations_used_like_constructors
                .get_or_init(|| self.compute_declarations_used_like_constructors(file));
            return used.binary_search(&symbol).is_ok();
        }
        match bound.fns[function.idx()].owner {
            FnOwner::Expr(expression) => stands_where_a_constructor_stands(
                hir,
                bound,
                expression,
                declares_this(hir, function),
            ),
            FnOwner::Stmt(_) => unreachable!("a declared function has a name"),
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => true,
        }
    }
}
