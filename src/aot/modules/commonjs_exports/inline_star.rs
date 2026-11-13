use crate::builtins::ResolvedBuiltins;
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, MemberLookup, Mutability, is_locked};
use crate::known_helpers::{KnownHelpers, KnownReference, Shape};
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{Binding, BindingInitializer, Bound, FnOwner, Parent, SymbolId};
use bun_sema::hir::{
    self, Chain, ExprId, ExprKind, PropId, PropKey, PropKind, Span, StmtId, StmtKind,
};
use bun_sema::program::FileId;

#[derive(Copy, Clone, Debug)]
pub(super) struct InlineStar {
    pub statement: StmtId,
    pub call: ExprId,
    pub holder: SymbolId,
    pub holder_name: ExprId,
    pub list: Option<SymbolId>,
    pub redefines_names: bool,
    pub start: u32,
    pub end: u32,
}

impl InlineStar {
    pub(super) fn holds(&self, hir: &hir::File<'_>, expression: ExprId) -> bool {
        self.start <= hir[expression].pos && hir[expression].end <= self.end
    }
}

pub(super) struct InlineStarInput<'a, 's> {
    pub file: FileId,
    pub atoms: &'a Interner<'s>,
    pub hir: &'a hir::File<'s>,
    pub bound: &'a Bound<'s>,
    pub builtins: &'a ResolvedBuiltins,
    pub known_helpers: &'a KnownHelpers,
}

fn is_certain(builtins: &ResolvedBuiltins, builtin: BuiltinId) -> bool {
    is_locked(builtin)
        && table::entry(builtin).mutability == Mutability::AlwaysLocked
        && !builtins.is_unlocked(builtin)
}

pub(super) fn read_list_of_names(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    stars: &[InlineStar],
    list: SymbolId,
) -> Option<Vec<Atom>> {
    let BindingInitializer::Expression(literal) = bound.binding_initializer(hir, list) else {
        return None;
    };
    let ExprKind::Object(properties) = hir[hir.skip_type_assertions(literal)].kind else {
        return None;
    };
    if !bound.is_stable_binding(list) || bound.is_visible_to_eval(list) {
        return None;
    }
    let is_read_by_star = |mention: ExprId| stars.iter().any(|star| star.holds(hir, mention));
    let is_first = stars.iter().all(|star| hir[literal].end <= star.start);
    let mentions = (0..hir.exprs.len() as u32).map(ExprId);
    let mut mentions = mentions.filter(|&mention| {
        matches!(hir[mention].kind, ExprKind::Ident(_))
            && bound.binding(mention) == Binding::Symbol(list)
    });
    if !is_first || !mentions.all(is_read_by_star) {
        return None;
    }
    names_of_literal(hir, properties)
}

fn names_of_literal(hir: &hir::File<'_>, properties: Span<PropId>) -> Option<Vec<Atom>> {
    let names = properties.iter().map(|property| {
        match (hir[property].kind, hir.runtime_property_key(property)) {
            (PropKind::Init, PropKey::Name(name)) => Some(name),
            _ => None,
        }
    });
    names.collect()
}

fn finds_for_each_of_lists(input: &InlineStarInput<'_, '_>, name: Atom) -> bool {
    let name = table::find_name(input.atoms.bytes(name));
    let found = name.map(|name| table::member(BuiltinId::ArrayPrototype, name));
    matches!(
        found,
        Some(MemberLookup::Found(member))
            if table::canonical_id(member) == BuiltinId::ArrayPrototypeForEach
    )
}

pub(super) fn find_inline_stars(input: &InlineStarInput<'_, '_>) -> Vec<InlineStar> {
    let (hir, bound, builtins) = (input.hir, input.bound, input.builtins);
    let Some(helpers) = input.known_helpers.file(input.file) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for (function, known) in helpers.functions() {
        let redefines_names = match known.shape {
            Shape::ExportStarInline
            | Shape::ExportStarInlineIfUnlisted
            | Shape::ExportStarInLineDefinesGettersForNamesThatDiffer
            | Shape::ExportStarInlineIfDifferent => true,
            Shape::ExportStarInlineIfMissing => false,
            _ => continue,
        };
        if !known.relies_on_facts {
            continue;
        }
        let (list, holder) = match known.references[..] {
            [KnownReference::Holder { symbol: holder }] => (None, holder),
            [
                KnownReference::Holder { symbol: list },
                KnownReference::Holder { symbol: holder },
            ] => (Some(list), holder),
            _ => continue,
        };
        let FnOwner::Expr(callback) = bound.fns[function.idx()].owner else {
            continue;
        };
        let Parent::Expr(call) = bound.parent_of_expr(callback) else {
            continue;
        };
        let ExprKind::Call(each) = hir[call].kind else {
            continue;
        };
        let each = hir[each];
        let ExprKind::Dot {
            obj: keys,
            name,
            chain: Chain::No,
            ..
        } = hir[each.callee].kind
        else {
            continue;
        };
        let ExprKind::Call(listing) = hir[keys].kind else {
            continue;
        };
        let listing = hir[listing];
        if each.chain != Chain::No
            || each.args.len() != 1
            || hir.id_at::<ExprId>(each.args, 0) != callback
            || !finds_for_each_of_lists(input, name)
            || listing.chain != Chain::No
            || listing.args.len() != 1
            || builtins.builtin_of_expression(listing.callee) != Some(BuiltinId::ObjectKeys)
            || !is_certain(builtins, BuiltinId::ObjectKeys)
            || !is_certain(builtins, BuiltinId::ArrayPrototypeForEach)
        {
            continue;
        }
        let holder_name = hir.id_at::<ExprId>(listing.args, 0);
        let Parent::Stmt(statement) = bound.parent_of_expr(call) else {
            continue;
        };
        if !matches!(hir[holder_name].kind, ExprKind::Ident(_))
            || bound.binding(holder_name) != Binding::Symbol(holder)
            || !matches!(hir[statement].kind, StmtKind::Expr(written) if written == call)
        {
            continue;
        }
        found.push(InlineStar {
            statement,
            call,
            holder,
            holder_name,
            list,
            redefines_names,
            start: hir[call].pos,
            end: hir[call].end,
        });
    }
    found
}
