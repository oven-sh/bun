use super::ByFile;
use super::callees::{Callee, ResultCallees};
use super::storage::Query;
use crate::bind::{Decl, Parent, PatParent, SymbolId};
use crate::check::Checker;
use crate::hir::{BinOp, CallId, ExprId, ExprKind, ExprTag, Flags, FnId, FnKind, ParamId, PatId, PatKind, StmtKind, UnOp, VarKind};
use crate::program::FileId;
use crate::util::{FxHashMap, FxHashSet};

pub mod argument_use {
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
    parameter_uses: FxHashMap<(FileId, ParamId), u8>,
}

#[derive(Default)]
struct FileUses {
    parameter_uses: FxHashMap<SymbolId, Vec<ExprId>>,
    using_arguments: FxHashSet<FnId>,
}

impl<'p, 's> Checker<'p, 's> {
    fn file_uses(&self, file: FileId) -> &'p FileUses {
        let program = self.p;
        program.aot.escape.by_file.get_or_init(program.files.modules.len(), file, || {
            let (hir, bound) = (self.hir(file), self.bound(file));
            let mut found = FileUses::default();
            for &e in self.file_exprs_by_kind(file).of(ExprTag::Ident) {
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
                    found.parameter_uses.entry(symbol).or_default().push(e);
                }
            }
            found
        })
    }

    pub(super) fn references_to(&self, file: FileId, symbol: SymbolId) -> Option<&'p [ExprId]> {
        let bound = self.bound(file);
        let [Decl::Param(pat) | Decl::Var(pat)] = *bound.symbols.get(symbol.idx())?.decls.as_slice() else { return None };
        matches!(bound.pat_parent[pat.idx()], PatParent::Param(_) | PatParent::Var(_)).then(|| self.file_uses(file).parameter_uses.get(&symbol).map_or(&[][..], Vec::as_slice))
    }

    pub fn unasserted_element_read(&mut self, file: FileId, pat: PatId) -> Option<ExprId> {
        let PatParent::Var(d) = self.bound(file).pat_parent[pat.idx()] else { return None };
        let init = self.hir(file)[d].init;
        if init.is_none() {
            return None;
        }
        let read = self.element_read_without_integer_range(file, init)?;
        self.is_const_used_only_undefined_safely(file, pat).then_some(read)
    }

    pub fn is_const_used_only_undefined_safely(&mut self, file: FileId, pat: PatId) -> bool {
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
        references.iter().all(|&mention| self.is_undefined_safe_use(file, mention) || self.is_reference_guarded_by_defined_check(file, mention, &mut known))
    }

    pub fn argument_use_flags(&mut self, file: FileId, p: ParamId) -> u8 {
        if let Some(&known) = self.aot.escape.parameter_uses.get(&(file, p)) {
            return known;
        }
        if let Some(assumed) = self.assumption(Query::ArgumentUse(file, p)) {
            return assumed as u8;
        }
        let (found, is_final) = self.solve(Query::ArgumentUse(file, p), 0, u64::from(argument_use::ALL), |c| u64::from(c.find_argument_use_flags(file, p)));
        if is_final {
            self.aot.escape.parameter_uses.insert((file, p), found as u8);
        }
        found as u8
    }

    fn find_argument_use_flags(&mut self, file: FileId, p: ParamId) -> u8 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (func, pat) = (bound.param_fn[p.idx()], hir[p].pat);
        let uses = self.file_uses(file);
        let symbol = bound.pat_symbol[pat.idx()];
        let is_plain = matches!(hir[pat].kind, PatKind::Ident(_)) && !hir[p].flags.contains(Flags::REST) && func.is_some() && symbol.is_some();
        if !is_plain || uses.using_arguments.contains(&func) || !bound.assignments_to(symbol).is_empty() || self.is_stored_through_casts(file, symbol) {
            return argument_use::ALL;
        }
        let is_coroutine = hir[func].flags.contains(Flags::ASYNC) || hir[func].flags.contains(Flags::GENERATOR);
        self.binding_use_flags(file, symbol, func, 0) | if is_coroutine { argument_use::ESCAPES } else { 0 }
    }

    fn binding_use_flags(&mut self, file: FileId, symbol: SymbolId, func: FnId, alias_depth: u32) -> u8 {
        let Some(references) = self.references_to(file, symbol) else { return argument_use::ALL };
        let mut found = 0;
        for &e in references {
            found |= self.value_use_flags_at_depth(file, e, alias_depth);
            if self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE) != func {
                found |= argument_use::ESCAPES;
            }
            if found == argument_use::ALL {
                break;
            }
        }
        found
    }

    pub(super) fn value_use_flags(&mut self, file: FileId, e: ExprId) -> u8 {
        self.value_use_flags_at_depth(file, e, 0)
    }

    fn value_use_flags_at_depth(&mut self, file: FileId, mut e: ExprId, alias_depth: u32) -> u8 {
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
                    return argument_use::OBSERVED | self.binding_use_flags(file, bound.pat_symbol[hir[d].pat.idx()], func, alias_depth + 1);
                }
                _ => return argument_use::ALL,
            };
            match hir[parent].kind {
                ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_) | ExprKind::Instantiation { .. } => {}
                ExprKind::Cond { test, .. } if test == e => return 0,
                ExprKind::Cond { .. } => {}
                ExprKind::Binary { op: BinOp::And, left, .. } if left == e => return 0,
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. } => {}
                ExprKind::Binary { op: BinOp::Comma, left, .. } if left == e => return 0,
                ExprKind::Binary { op: BinOp::Comma, .. } => {}
                ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq, left, right } => {
                    return if self.is_nullish_literal(file, if left == e { right } else { left }) { 0 } else { argument_use::OBSERVED };
                }
                ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, .. } => return 0,
                ExprKind::Call(call) if hir[call].callee == e => return 0,
                ExprKind::Call(call) => return self.call_argument_use_flags(file, call, e),
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

    fn call_argument_use_flags(&mut self, file: FileId, call: CallId, e: ExprId) -> u8 {
        let hir = self.hir(file);
        let mut index = None;
        for (i, argument) in hir.ids(hir[call].args).enumerate() {
            if matches!(hir[argument].kind, ExprKind::Spread(_)) {
                break;
            }
            if argument == e {
                index = Some(i);
                break;
            }
        }
        let Some(index) = index else { return argument_use::ALL };
        if let ResultCallees { callee: Callee::One(of, func), is_predicted: false, .. } = self.result_callees_of(file, hir[call].callee, 0) {
            let params = self.hir(of)[func].params;
            return match params.iter().nth(index) {
                Some(p) => self.argument_use_flags(of, p),
                None if !self.file_uses(of).using_arguments.contains(&func) && !params.iter().next_back().is_some_and(|last| self.hir(of)[last].flags.contains(Flags::REST)) => 0,
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
                || if is_string_method { self.is_string_like(part) } else { self.is_array_or_tuple(part) || self.is_global_instance(part, &[b"Map", b"Set", b"ReadonlyMap", b"ReadonlySet"]) }
        })
    }
}
