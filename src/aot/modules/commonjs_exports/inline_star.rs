use crate::builtins::ResolvedBuiltins;
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, MemberLookup, Mutability, is_locked};
use crate::known_helpers::{KnownHelpers, KnownReference, Shape};
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{Binding, Bound, FnOwner, Parent, SymbolId};
use bun_sema::hir::{self, Chain, ExprId, ExprKind, StmtId, StmtKind};
use bun_sema::program::FileId;

#[derive(Copy, Clone, Debug)]
pub(super) struct InlineStar {
    pub statement: StmtId,
    pub call: ExprId,
    pub holder: SymbolId,
    pub holder_name: ExprId,
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
        if known.shape != Shape::ExportStarInLineDefinesGettersForNamesThatDiffer
            || !known.relies_on_facts
        {
            continue;
        }
        let [KnownReference::Holder { symbol: holder }] = known.references[..] else {
            continue;
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
            start: hir[call].pos,
            end: hir[call].end,
        });
    }
    found
}
