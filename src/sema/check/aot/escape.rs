//! Escape analysis: what a function does with what it is handed.

use super::ByFile;
use super::callees::{Callee, Yielded};
use super::storage::Query;
use crate::atom::known;
use crate::bind::{AccessKind, Decl, Parent, PatParent, SymFlags, SymbolId};
use crate::check::Checker;
use crate::hir::{BinOp, CallId, ExportSpecId, ExprId, ExprKind, ExprTag, Flags, FnId, FnKind, ParamId, PatId, PatKind, StmtId, StmtKind, UnOp};
use crate::program::FileId;
use crate::util::{FxHashMap, FxHashSet};

/// What may happen to the argument for a parameter. A join semilattice of bits.
pub mod argument_use {
    /// Something may tell it from another object: it is compared, used as a key, looked into, constructed with.
    pub const OBSERVED: u8 = 1 << 0;
}

#[derive(Default)]
pub(super) struct Shared {
    by_file: ByFile<FileUses>,
}

#[derive(Default)]
pub(super) struct State {
    of_parameters: FxHashMap<(FileId, ParamId), u8>,
    of_arrays: FxHashMap<(FileId, SymbolId), u8>,
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

    fn references_to(&self, file: FileId, symbol: SymbolId) -> Option<&'p [ExprId]> {
        let bound = self.bound(file);
        let [Decl::Param(pat) | Decl::Var(pat)] = *bound.symbols.get(symbol.idx())?.decls.as_slice() else { return None };
        matches!(bound.pat_parent[pat.idx()], PatParent::Param(_) | PatParent::Var(_)).then(|| self.uses_in_file(file).of_parameters.get(&symbol).map_or(&[][..], Vec::as_slice))
    }

    pub fn what_the_stores_say_of_array(&mut self, file: FileId, e: ExprId) -> u8 {
        if !matches!(self.hir(file)[e].kind, ExprKind::Ident(_)) {
            return 0;
        }
        let symbol = self.bound(file).expr_symbol[e.idx()];
        if symbol.is_none() {
            return 0;
        }
        if let Some(&known) = self.aot.escape.of_arrays.get(&(file, symbol)) {
            return known;
        }
        self.aot.escape.of_arrays.insert((file, symbol), 0);
        let found = self.find_what_the_stores_say_of_array(file, symbol).unwrap_or(0);
        self.aot.escape.of_arrays.insert((file, symbol), found);
        found
    }

    pub fn is_read_out_of_array_by_what_the_stores_say(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let read = match hir[e].kind {
            ExprKind::Index { .. } => e,
            ExprKind::Assign { op: None | Some(BinOp::And | BinOp::Or | BinOp::Nullish), target, .. } => target,
            ExprKind::NonNull(inner) => return self.is_read_out_of_array_by_what_the_stores_say(file, inner),
            _ => return false,
        };
        let ExprKind::Index { obj, .. } = hir[read].kind else { return false };
        self.what_the_stores_say_of_array(file, obj) == 1
    }

    fn find_what_the_stores_say_of_array(&mut self, file: FileId, symbol: SymbolId) -> Option<u8> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let references = self.references_to(file, symbol)?;
        let [Decl::Var(pat)] = *bound.symbols.get(symbol.idx())?.decls.as_slice() else { return None };
        let (PatParent::Var(d), PatKind::Ident(name)) = (bound.pat_parent[pat.idx()], hir[pat].kind) else { return None };
        let is_exported = bound.modifier_flags(hir, Decl::Var(pat)).contains(Flags::EXPORT) || (0..hir.export_specs.len() as u32).map(ExportSpecId).any(|spec| hir[spec].local == name);
        if is_exported || hir[d].flags.contains(Flags::AMBIENT) || !bound.assignments_to(symbol).is_empty() || self.is_stored_through_casts(file, symbol) {
            return None;
        }
        if self.is_untyped_file(file) || self.has_direct_eval(file) {
            return None;
        }
        let ExprKind::Array(first) = hir[hir[d].init.some()?].kind else { return None };
        let mut stored: Vec<ExprId> = hir.ids(first).collect();
        let mut lets_an_element_out = false;
        for &mention in references {
            lets_an_element_out |= self.use_of_array(file, mention, &mut stored)?;
        }
        let (mut are_literals, mut are_no_arrays) = (true, true);
        for value in stored {
            if !self.is_seen_to_be_what_its_type_says(file, value) {
                return None;
            }
            are_literals &= self.is_written_as_an_array_literal(file, value);
            self.prepare_enclosing(file, value);
            let ty = self.type_of_expr(file, value);
            are_no_arrays &= !self.parts(ty).iter().any(|&part| self.is_array_or_tuple(part));
        }
        match (are_no_arrays, are_literals && !lets_an_element_out) {
            (true, _) => Some(1),
            (false, true) => Some(3),
            _ => None,
        }
    }

    fn use_of_array(&mut self, file: FileId, mention: ExprId, stored: &mut Vec<ExprId>) -> Option<bool> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = match bound.expr_parent[mention.idx()] {
            Parent::Expr(parent) if parent.is_some() => parent,
            Parent::Stmt(stmt) if stmt.is_some() => {
                let StmtKind::ForOf { left, expr, is_await: false, .. } = hir[stmt].kind else { return None };
                let takes_it_apart = matches!(hir[left].kind, StmtKind::Var(decls) if !decls.is_empty() && self.binds_names_to_single_elements(file, hir[decls.at(0)].pat));
                return (expr == mention).then_some(!takes_it_apart);
            }
            _ => return None,
        };
        let around = match bound.expr_parent[parent.idx()] {
            Parent::Expr(around) if around.is_some() => Some(hir[around].kind),
            _ => None,
        };
        match hir[parent].kind {
            ExprKind::Dot { obj, name, .. } if obj == mention && name == known::length => (bound.access_kind(hir, parent) == AccessKind::Read).then_some(false),
            ExprKind::Dot { obj, name, .. } if obj == mention && name == known::push => {
                let Some(ExprKind::Call(call)) = around else { return None };
                stored.extend(hir.ids(hir[call].args));
                (hir[call].callee == parent).then_some(false)
            }
            ExprKind::Index { obj, index, .. } if obj == mention && !self.is_key_of_a_number_type(file, index) => None,
            ExprKind::Index { obj, .. } if obj == mention && bound.access_kind(hir, parent) == AccessKind::Read => match around {
                Some(ExprKind::Call(call)) if hir[call].callee == parent => None,
                Some(ExprKind::TaggedTemplate(_) | ExprKind::Unary { op: UnOp::Delete, .. }) => None,
                _ => Some(true),
            },
            ExprKind::Index { obj, .. } if obj == mention => {
                let Some(ExprKind::Assign { op: None | Some(BinOp::And | BinOp::Or | BinOp::Nullish), target, value }) = around else { return None };
                stored.push(value);
                (target == parent).then_some(true)
            }
            _ => None,
        }
    }

    fn is_key_of_a_number_type(&mut self, file: FileId, e: ExprId) -> bool {
        self.prepare_enclosing(file, e);
        let ty = self.type_of_expr(file, e);
        !self.parts(ty).is_empty() && self.parts(ty).iter().all(|&part| self.is_number_like(part))
    }

    fn constructs_an_object_of_a_class_of_the_program(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::New(call) = hir[e].kind else { return false };
        let callee = hir[call].callee;
        let ExprKind::Ident(name) = hir[callee].kind else { return false };
        let Some(sym) = self.symbol_of_identifier(file, callee, name) else { return false };
        let sym = if self.files().flags(sym).contains(SymFlags::ALIAS) { self.files().resolve_alias(sym) } else { Some(sym) };
        let Some((of, class)) = sym.and_then(|sym| self.class_held_by_variable(sym)) else { return false };
        let (declaring, bound) = (self.hir(of), self.bound(of));
        declaring[class].extends.is_none()
            && self.constructor_of_class(of, class).is_none_or(|constructor| !bound.ids(bound.fns[constructor.idx()].returns).any(|stmt: StmtId| matches!(declaring[stmt].kind, StmtKind::Return(value) if value.is_some())))
    }

    fn stands_where_a_second_body_runs_too(&mut self, file: FileId, e: ExprId) -> bool {
        let mut func = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
        while func.is_some() {
            if self.has_second_body(file, func) {
                return true;
            }
            func = self.bound(file).fns[func.idx()].enclosing;
        }
        false
    }

    fn binds_names_to_single_elements(&self, file: FileId, pat: PatId) -> bool {
        let hir = self.hir(file);
        let PatKind::Array(elems) = hir[pat].kind else { return false };
        elems.iter().all(|e| !hir[e].is_rest && hir[e].default.is_none() && matches!(hir[hir[e].pat].kind, PatKind::Ident(_) | PatKind::Missing))
    }

    fn is_written_as_an_array_literal(&self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Array(_) => true,
            ExprKind::AsConst(inner) | ExprKind::NonNull(inner) | ExprKind::Satisfies { expr: inner, .. } => self.is_written_as_an_array_literal(file, inner),
            _ => false,
        }
    }

    fn is_seen_to_be_what_its_type_says(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Spread(_) | ExprKind::Missing => false,
            ExprKind::AsConst(inner) | ExprKind::NonNull(inner) | ExprKind::Satisfies { expr: inner, .. } => self.is_seen_to_be_what_its_type_says(file, inner),
            ExprKind::Array(elements) => {
                let elements: Vec<ExprId> = hir.ids(elements).collect();
                elements.into_iter().all(|element| self.is_seen_to_be_what_its_type_says(file, element))
            }
            _ => {
                self.prepare_enclosing(file, e);
                let ty = self.type_of_expr(file, e);
                !self.is_untyped(ty) && !self.is_predicted(file, e) && (self.constructs_an_object_of_a_class_of_the_program(file, e) || !self.stands_where_a_second_body_runs_too(file, e))
            }
        }
    }

    pub fn use_of_argument(&mut self, file: FileId, p: ParamId) -> u8 {
        if let Some(&known) = self.aot.escape.of_parameters.get(&(file, p)) {
            return known;
        }
        // A function that hands the argument on to itself, by way of others or not, does no more with it for that.
        if let Some(assumed) = self.assumption(Query::ArgumentUse(file, p)) {
            return assumed as u8;
        }
        let (found, is_final) = self.solve(Query::ArgumentUse(file, p), 0, u64::from(argument_use::OBSERVED), |c| u64::from(c.find_use_of_argument(file, p)));
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
            return argument_use::OBSERVED;
        }
        let Some(references) = self.references_to(file, symbol) else { return argument_use::OBSERVED };
        let mut found = 0;
        for &e in references {
            found |= self.use_of_value(file, e);
            if found & argument_use::OBSERVED != 0 {
                break;
            }
        }
        found
    }

    /// What is done with the value of the expression where it stands.
    pub(super) fn use_of_value(&mut self, file: FileId, mut e: ExprId) -> u8 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            let parent = match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) if parent.is_some() => parent,
                Parent::Stmt(stmt) if stmt.is_some() => {
                    return match hir[stmt].kind {
                        StmtKind::Expr(_) => 0,
                        StmtKind::If { test, .. } | StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } | StmtKind::For { test, .. } if test == e => 0,
                        _ => argument_use::OBSERVED,
                    };
                }
                _ => return argument_use::OBSERVED,
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
                    return if self.is_nil_literal(file, if left == e { right } else { left }) { 0 } else { argument_use::OBSERVED };
                }
                ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, .. } => return 0,
                ExprKind::Call(call) if hir[call].callee == e => return 0,
                ExprKind::Call(call) => return self.use_of_argument_at(file, call, e),
                _ => return argument_use::OBSERVED,
            }
            e = parent;
        }
    }

    fn is_nil_literal(&self, file: FileId, e: ExprId) -> bool {
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
        let Some(index) = index else { return argument_use::OBSERVED };
        if let Yielded { callee: Callee::One(of, func), is_predicted: false, .. } = self.callee_yielded_by(file, hir[call].callee, 0) {
            let params = self.hir(of)[func].params;
            return match params.iter().nth(index) {
                Some(p) => self.use_of_argument(of, p),
                // Nothing names it.
                None if !self.uses_in_file(of).using_arguments.contains(&func) && !params.iter().next_back().is_some_and(|last| self.hir(of)[last].flags.contains(Flags::REST)) => 0,
                None => argument_use::OBSERVED,
            };
        }
        argument_use::OBSERVED
    }
}
