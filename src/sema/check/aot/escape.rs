//! Escape analysis: what a function does with what it is handed.

use super::ByFile;
use super::callees::{Callee, Yielded};
use super::storage::Query;
use crate::bind::{Decl, Parent, PatParent, SymbolId};
use crate::check::Checker;
use crate::hir::{BinOp, CallId, ExprId, ExprKind, ExprTag, Flags, FnId, FnKind, ParamId, PatId, PatKind, StmtKind, UnOp, VarKind};
use crate::program::FileId;
use crate::util::{FxHashMap, FxHashSet};

/// What may happen to the argument for a parameter. A join semilattice of bits.
pub mod argument_use {
    /// Something may tell it from another object: it is compared, used as a key, looked into, constructed with.
    pub const OBSERVED: u8 = 1 << 0;
    pub const ESCAPES: u8 = 1 << 1;
    pub const ALL: u8 = OBSERVED | ESCAPES;
}

#[derive(Default)]
pub(super) struct Shared {
    by_file: ByFile<FileUses>,
}

#[derive(Default)]
pub(super) struct State {
    of_parameters: FxHashMap<(FileId, ParamId), u8>,
}

/// What one pass over the identifiers of a file finds.
#[derive(Default)]
struct FileUses {
    /// By parameter or variable that is a plain name with one declaration: the references to it, in the order of the source.
    of_parameters: FxHashMap<SymbolId, Vec<ExprId>>,
    /// The functions that refer to their `arguments` object, also from within an arrow function.
    using_arguments: FxHashSet<FnId>,
}

impl<'p, 's> Checker<'p, 's> {
    fn uses_in_file(&self, file: FileId) -> &'p FileUses {
        let program = self.p;
        program.aot.escape.by_file.get_or_init(program.files.modules.len(), file, || {
            let (hir, bound) = (self.hir(file), self.bound(file));
            let mut found = FileUses::default();
            for &e in self.exprs_by_kind_of(file).of(ExprTag::Ident) {
                if bound.expr_parent[e.idx()] == Parent::None || bound.is_in_type_query(e) {
                    continue;
                }
                if bound.is_arguments_object(e) {
                    let mut func = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
                    while func.is_some() && hir[func].kind == FnKind::Arrow {
                        func = bound.fns[func.idx()].enclosing;
                    }
                    found.using_arguments.insert(func);
                    continue;
                }
                let symbol = bound.expr_symbol[e.idx()];
                if let Some(declared) = bound.symbols.get(symbol.idx())
                    && let [Decl::Param(pat) | Decl::Var(pat)] = *declared.decls.as_slice()
                    && matches!(bound.pat_parent[pat.idx()], PatParent::Param(_) | PatParent::Var(_))
                {
                    found.of_parameters.entry(symbol).or_default().push(e);
                }
            }
            found
        })
    }

    pub(super) fn references_to(&self, file: FileId, symbol: SymbolId) -> Option<&'p [ExprId]> {
        let bound = self.bound(file);
        let [Decl::Param(pat) | Decl::Var(pat)] = *bound.symbols.get(symbol.idx())?.decls.as_slice() else { return None };
        matches!(bound.pat_parent[pat.idx()], PatParent::Param(_) | PatParent::Var(_)).then(|| self.uses_in_file(file).of_parameters.get(&symbol).map_or(&[][..], Vec::as_slice))
    }

    pub fn element_read_kept_unasserted(&mut self, file: FileId, pat: PatId) -> Option<ExprId> {
        let PatParent::Var(d) = self.bound(file).pat_parent[pat.idx()] else { return None };
        let init = self.hir(file)[d].init;
        if init.is_none() {
            return None;
        }
        let read = self.element_read_of_no_known_integers(file, init)?;
        self.is_constant_used_only_where_undefined_has_an_answer(file, pat).then_some(read)
    }

    pub fn is_constant_used_only_where_undefined_has_an_answer(&mut self, file: FileId, pat: PatId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return false };
        let decl = &hir[d];
        if decl.kind != VarKind::Const || decl.ty.is_some() || decl.init.is_none() || decl.pat != pat || !matches!(hir[pat].kind, PatKind::Ident(_)) {
            return false;
        }
        if self.enclosing_fn_of_expr(file, decl.init).is_none_or(|func| func.is_none()) || self.has_direct_eval(file) {
            return false;
        }
        let Some(references) = self.references_to(file, bound.pat_symbol[pat.idx()]) else { return false };
        let mut known = FxHashMap::default();
        references.iter().all(|&mention| self.is_used_where_undefined_has_an_answer(file, mention) || self.is_mentioned_where_it_is_shown_to_be_there(file, mention, &mut known))
    }

    pub fn use_of_argument(&mut self, file: FileId, p: ParamId) -> u8 {
        if let Some(&known) = self.aot.escape.of_parameters.get(&(file, p)) {
            return known;
        }
        // A function that hands the argument on to itself, by way of others or not, does no more with it for that.
        if let Some(assumed) = self.assumption(Query::ArgumentUse(file, p)) {
            return assumed as u8;
        }
        let (found, is_final) = self.solve(Query::ArgumentUse(file, p), 0, u64::from(argument_use::ALL), |c| u64::from(c.find_use_of_argument(file, p)));
        if is_final {
            self.aot.escape.of_parameters.insert((file, p), found as u8);
        }
        found as u8
    }

    fn find_use_of_argument(&mut self, file: FileId, p: ParamId) -> u8 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (func, pat) = (bound.param_fn[p.idx()], hir[p].pat);
        let uses = self.uses_in_file(file);
        let symbol = bound.pat_symbol[pat.idx()];
        let is_plain = matches!(hir[pat].kind, PatKind::Ident(_)) && !hir[p].flags.contains(Flags::REST) && func.is_some() && symbol.is_some();
        // What is stored to the parameter is read like the argument. The `arguments` object is another way to the argument.
        if !is_plain || uses.using_arguments.contains(&func) || !bound.assignments_to(symbol).is_empty() || self.is_stored_through_casts(file, symbol) {
            return argument_use::ALL;
        }
        let is_coroutine = hir[func].flags.contains(Flags::ASYNC) || hir[func].flags.contains(Flags::GENERATOR);
        self.use_of_binding(file, symbol, func, 0) | if is_coroutine { argument_use::ESCAPES } else { 0 }
    }

    fn use_of_binding(&mut self, file: FileId, symbol: SymbolId, func: FnId, alias_depth: u32) -> u8 {
        let Some(references) = self.references_to(file, symbol) else { return argument_use::ALL };
        let mut found = 0;
        for &e in references {
            found |= self.use_of_value_at_depth(file, e, alias_depth);
            if self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE) != func {
                found |= argument_use::ESCAPES;
            }
            if found == argument_use::ALL {
                break;
            }
        }
        found
    }

    /// What is done with the value of the expression where it stands.
    pub(super) fn use_of_value(&mut self, file: FileId, e: ExprId) -> u8 {
        self.use_of_value_at_depth(file, e, 0)
    }

    fn use_of_value_at_depth(&mut self, file: FileId, mut e: ExprId, alias_depth: u32) -> u8 {
        const MAX_ALIAS_DEPTH: u32 = 4;
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            let parent = match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) if parent.is_some() => parent,
                Parent::Stmt(stmt) if stmt.is_some() => {
                    return match hir[stmt].kind {
                        StmtKind::Expr(_) => 0,
                        StmtKind::If { test, .. } | StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } | StmtKind::For { test, .. } if test == e => 0,
                        _ => argument_use::ALL,
                    };
                }
                Parent::VarInit(d) if hir[d].kind == VarKind::Const && matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) && alias_depth < MAX_ALIAS_DEPTH && !self.has_direct_eval(file) => {
                    let func = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
                    return argument_use::OBSERVED | self.use_of_binding(file, bound.pat_symbol[hir[d].pat.idx()], func, alias_depth + 1);
                }
                _ => return argument_use::ALL,
            };
            match hir[parent].kind {
                // They yield the value itself.
                ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_) | ExprKind::Instantiation { .. } => {}
                ExprKind::Cond { test, .. } if test == e => return 0,
                ExprKind::Cond { .. } => {}
                // A function is truthy: `f && f(x)` does not yield it.
                ExprKind::Binary { op: BinOp::And, left, .. } if left == e => return 0,
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. } => {}
                ExprKind::Binary { op: BinOp::Comma, left, .. } if left == e => return 0,
                ExprKind::Binary { op: BinOp::Comma, .. } => {}
                ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq, left, right } => {
                    return if self.is_nullish_literal(file, if left == e { right } else { left }) { 0 } else { argument_use::OBSERVED };
                }
                ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, .. } => return 0,
                ExprKind::Call(call) if hir[call].callee == e => return 0,
                ExprKind::Call(call) => return self.use_of_argument_at(file, call, e),
                _ => return argument_use::ALL,
            }
            e = parent;
        }
    }

    fn is_nullish_literal(&self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Null | ExprKind::Unary { op: UnOp::Void, .. } => true,
            ExprKind::Ident(name) => self.bound(file).expr_symbol[e.idx()].is_none() && self.atoms().bytes(name) == b"undefined",
            _ => false,
        }
    }

    /// What the call does with its argument `e`.
    fn use_of_argument_at(&mut self, file: FileId, call: CallId, e: ExprId) -> u8 {
        let hir = self.hir(file);
        let mut index = None;
        for (i, argument) in hir.ids(hir[call].args).enumerate() {
            // Which parameter takes what comes after it depends on what is spread.
            if matches!(hir[argument].kind, ExprKind::Spread(_)) {
                break;
            }
            if argument == e {
                index = Some(i);
                break;
            }
        }
        let Some(index) = index else { return argument_use::ALL };
        if let Yielded { callee: Callee::One(of, func), is_predicted: false, .. } = self.callee_yielded_by(file, hir[call].callee, 0) {
            let params = self.hir(of)[func].params;
            return match params.iter().nth(index) {
                Some(p) => self.use_of_argument(of, p),
                // Nothing names it.
                None if !self.uses_in_file(of).using_arguments.contains(&func) && !params.iter().next_back().is_some_and(|last| self.hir(of)[last].flags.contains(Flags::REST)) => 0,
                None => argument_use::ALL,
            };
        }
        if self.is_only_called_before_builtin_returns(file, hir[call].callee, index) {
            return argument_use::OBSERVED;
        }
        argument_use::ALL
    }

    fn is_only_called_before_builtin_returns(&mut self, file: FileId, callee: ExprId, index: usize) -> bool {
        let ExprKind::Dot { obj, name, .. } = self.hir(file)[callee].kind else { return false };
        let (callback_index, is_string_method) = match self.atoms().bytes(name) {
            b"every" | b"filter" | b"find" | b"findIndex" | b"findLast" | b"findLastIndex" | b"flatMap" | b"forEach" | b"map" | b"reduce" | b"reduceRight" | b"some" | b"sort" | b"toSorted" => (0, false),
            b"replace" | b"replaceAll" => (1, true),
            _ => return false,
        };
        if index != callback_index {
            return false;
        }
        let receiver = self.type_of_expr(file, obj);
        self.parts(receiver).iter().all(|&part| {
            part.is_undefined()
                || part.is_null()
                || if is_string_method { self.is_string_like(part) } else { self.is_array_or_tuple(part) || self.is_instance_of_global(part, &[b"Map", b"Set", b"ReadonlyMap", b"ReadonlySet"]) }
        })
    }
}
