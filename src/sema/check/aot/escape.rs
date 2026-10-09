//! Escape analysis: what a function does with what it is handed.
//!
//! Per parameter, bottom-up over the calls of functions that are known: whether the identity of the argument may be observed, and whether the
//! argument may still be reachable when the call has returned. A callee that is not known does both.
//!
//! **Two evaluations of a function expression make two objects.** Nobody can tell if all that is ever done with them is to call them:
//! `some(types, t => !!(t.flags & TypeFlags.Object))`. Then a function expression that captures nothing has one closure for as long as
//! the program runs.
//!
//! It goes by the trees and the symbols, and by the types of receivers where a method of the engine is handed a callback.

use super::ByFile;
use super::callees::{Callee, Yielded};
use super::storage::Query;
use super::captures::{Activation, Capture};
use crate::bind::{Decl, FnOwner, Parent, PatParent, SymbolId};
use crate::check::Checker;
use crate::check::PropSource;
use crate::hir::{BinOp, CallId, ClassId, ExprId, ExprKind, ExprTag, Flags, FnId, FnKind, ParamId, PatKind, StmtKind, UnOp, VarDeclId, VarKind};
use crate::program::FileId;
use crate::util::{FxHashMap, FxHashSet};

/// What may happen to the argument for a parameter. A join semilattice of bits.
pub mod argument_use {
    /// Something may tell it from another object: it is compared, used as a key, looked into, constructed with.
    pub const OBSERVED: u8 = 1 << 0;
    /// It may be reachable after the call has returned: it is stored, returned, thrown, or an inner function refers to the parameter.
    pub const RETAINED: u8 = 1 << 1;
    pub const ANYTHING: u8 = OBSERVED | RETAINED;
}

/// What may keep an environment beyond its activation.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Keeper {
    Function(FnId),
    Class(ClassId),
}

/// The methods of the engine that do nothing with their first argument but call it, by the interface of `lib.*.d.ts` that declares them.
const CALLBACK_TAKERS: &[(&str, &[&str])] = &[
    ("Array", &["every", "filter", "find", "findIndex", "findLast", "findLastIndex", "flatMap", "forEach", "map", "reduce", "reduceRight", "some", "sort", "toSorted"]),
    ("ReadonlyArray", &["every", "filter", "find", "findIndex", "findLast", "findLastIndex", "flatMap", "forEach", "map", "reduce", "reduceRight", "some", "toSorted"]),
    ("Map", &["forEach"]),
    ("ReadonlyMap", &["forEach"]),
    ("Set", &["forEach"]),
    ("ReadonlySet", &["forEach"]),
];

#[derive(Default)]
pub(super) struct Shared {
    by_file: ByFile<FileUses>,
}

#[derive(Default)]
pub(super) struct State {
    /// By parameter, and whether the types of receivers are gone by.
    of_parameters: FxHashMap<(FileId, ParamId, bool), u8>,
    /// `is_function_retained`
    retained: FxHashMap<(FileId, FnId), bool>,
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

    /// `argument_use`: what the function may do with the argument for the parameter. `by_types`: a method of the engine is known for what it
    /// is by the type of its receiver. Without, the answer follows from the trees and the symbols alone.
    pub fn use_of_argument(&mut self, file: FileId, p: ParamId, by_types: bool) -> u8 {
        if let Some(&known) = self.aot.escape.of_parameters.get(&(file, p, by_types)) {
            return known;
        }
        // A function that hands the argument on to itself, by way of others or not, does no more with it for that.
        if let Some(assumed) = self.assumption(Query::ArgumentUse(file, p, by_types)) {
            return assumed as u8;
        }
        let (found, is_final) = self.solve(Query::ArgumentUse(file, p, by_types), 0, u64::from(argument_use::ANYTHING), |c| u64::from(c.find_use_of_argument(file, p, by_types)));
        if is_final {
            self.aot.escape.of_parameters.insert((file, p, by_types), found as u8);
        }
        found as u8
    }

    fn find_use_of_argument(&mut self, file: FileId, p: ParamId, by_types: bool) -> u8 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (func, pat) = (bound.param_fn[p.idx()], hir[p].pat);
        let uses = self.uses_in_file(file);
        let symbol = bound.pat_symbol[pat.idx()];
        let is_plain = matches!(hir[pat].kind, PatKind::Ident(_)) && !hir[p].flags.contains(Flags::REST) && func.is_some() && symbol.is_some();
        // What is stored to the parameter is read like the argument. The `arguments` object is another way to the argument.
        if !is_plain || uses.using_arguments.contains(&func) || !bound.assignments_to(symbol).is_empty() || self.is_stored_through_casts(file, symbol) {
            return argument_use::ANYTHING;
        }
        // The frame of a coroutine outlives the call.
        let mut found = if hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) { argument_use::RETAINED } else { 0 };
        for &e in uses.of_parameters.get(&symbol).map_or(&[][..], Vec::as_slice) {
            found |= self.use_of_reference(file, e, func, by_types);
            if found == argument_use::ANYTHING {
                break;
            }
        }
        found
    }

    /// What is done with what the reference `e` to a variable of the function yields. An inner function that refers to the variable keeps it for as
    /// long as it is there itself.
    fn use_of_reference(&mut self, file: FileId, e: ExprId, func: FnId, by_types: bool) -> u8 {
        let mut inner = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
        let mut found = self.use_of_value(file, e, by_types);
        while inner != func && found & argument_use::RETAINED == 0 {
            if inner.is_none() || !by_types || self.is_function_retained(file, inner) {
                found |= argument_use::RETAINED;
            }
            inner = self.bound(file).fns[inner.idx()].enclosing;
        }
        found
    }

    /// Whether a closure of the function, or what a call of it has been handed, may still be reachable when the activation that made the
    /// closure has ended.
    pub fn is_function_retained(&mut self, file: FileId, func: FnId) -> bool {
        if let Some(&known) = self.aot.escape.retained.get(&(file, func)) {
            return known;
        }
        // One that is handed to itself is not kept for that.
        if let Some(assumed) = self.assumption(Query::Retained(file, func)) {
            return assumed != 0;
        }
        let (found, is_final) = self.solve(Query::Retained(file, func), 0, 1, |c| u64::from(c.find_is_function_retained(file, func)));
        if is_final {
            self.aot.escape.retained.insert((file, func), found != 0);
        }
        found != 0
    }

    fn find_is_function_retained(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The frame of a coroutine outlives the call.
        if hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return true;
        }
        match bound.fns[func.idx()].owner {
            FnOwner::Expr(e) => self.use_of_value(file, e, true) & argument_use::RETAINED != 0,
            FnOwner::Stmt(_) => match self.uses_of_declaration_as_value(file, func) {
                Some(uses) => uses.iter().any(|&e| self.use_of_value(file, e, true) & argument_use::RETAINED != 0),
                None => true,
            },
            _ => true,
        }
    }

    /// The first function that captures the environment of the activation and may keep it beyond the activation, or the first class whose
    /// members do. `None`: the environment is unreachable once the activation has ended.
    pub fn keeper_of_environment(&mut self, file: FileId, activation: Activation) -> Option<Keeper> {
        if let Some(class) = self.class_importing(file, Capture::Environment(activation)) {
            return Some(Keeper::Class(class));
        }
        self.functions_capturing(file, activation).into_iter().find(|&func| self.is_function_retained(file, func)).map(Keeper::Function)
    }

    /// For `--aot-explain=escape`: of each environment of the file whether it is unreachable once its activation has ended, and if not, the first
    /// function that may keep it, with its place.
    pub fn explain_escape(&mut self, file: FileId) -> Vec<String> {
        let mut lines = Vec::new();
        for activation in self.activations_with_environment(file) {
            let what = self.describe_activation(file, activation);
            lines.push(match self.keeper_of_environment(file, activation) {
                None => format!("escape: environment {what}: stays"),
                Some(Keeper::Class(class)) => format!("escape: environment {what}: kept by the class at {}", self.line_for_people(file, self.hir(file)[class].start)),
                Some(Keeper::Function(func)) => format!("escape: environment {what}: kept by the function at {}", self.line_for_people(file, self.hir(file)[func].start)),
            });
        }
        let functions: Vec<ExprId> = self.exprs_by_kind_of(file).of(ExprTag::Fn).to_vec();
        for e in functions {
            let ExprKind::Fn(func) = self.hir(file)[e].kind else { continue };
            if self.bound(file).expr_parent[e.idx()] == Parent::None {
                continue;
            }
            let used = self.use_of_value(file, e, true);
            let verdict = match (used & argument_use::RETAINED != 0 || self.is_function_retained(file, func), used & argument_use::OBSERVED != 0) {
                (false, false) => "stays, unobserved",
                (false, true) => "stays",
                (true, false) => "kept, unobserved",
                (true, true) => "kept",
            };
            lines.push(format!("escape: closure {}: {verdict}", self.line_for_people(file, self.hir(file)[func].start)));
        }
        lines
    }

    /// What is done with the value of the expression where it stands.
    pub(super) fn use_of_value(&mut self, file: FileId, mut e: ExprId, by_types: bool) -> u8 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            let parent = match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) if parent.is_some() => parent,
                Parent::Stmt(stmt) if stmt.is_some() => {
                    return match hir[stmt].kind {
                        StmtKind::Expr(_) => 0,
                        StmtKind::If { test, .. } | StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } | StmtKind::For { test, .. } if test == e => 0,
                        _ => argument_use::ANYTHING,
                    };
                }
                // `const f = e`, with nothing ever stored to `f`: what is done with `f`.
                Parent::VarInit(d) if by_types => return self.use_of_constant(file, d),
                _ => return argument_use::ANYTHING,
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
                ExprKind::Call(call) => return self.use_of_argument_at(file, call, e, by_types),
                _ => return argument_use::ANYTHING,
            }
            e = parent;
        }
    }

    fn use_of_constant(&mut self, file: FileId, d: VarDeclId) -> u8 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (pat, stmt) = (hir[d].pat, bound.var_stmt[d.idx()]);
        let symbol = bound.pat_symbol[pat.idx()];
        let is_plain = matches!(hir[pat].kind, PatKind::Ident(_)) && matches!(hir[d].kind, VarKind::Let | VarKind::Const) && symbol.is_some() && stmt.is_some();
        // What a module declares is there for good, and other files may see it.
        let Some(func) = self.enclosing_fn(file, Parent::VarInit(d)).filter(|_| is_plain) else { return argument_use::ANYTHING };
        if !bound.assignments_to(symbol).is_empty() || self.is_stored_through_casts(file, symbol) {
            return argument_use::ANYTHING;
        }
        let mut found = 0;
        for &e in self.uses_in_file(file).of_parameters.get(&symbol).map_or(&[][..], Vec::as_slice) {
            found |= self.use_of_reference(file, e, func, true);
            if found == argument_use::ANYTHING {
                break;
            }
        }
        found
    }

    fn is_nil_literal(&self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Null | ExprKind::Unary { op: UnOp::Void, .. } => true,
            ExprKind::Ident(name) => self.bound(file).expr_symbol[e.idx()].is_none() && self.atoms().bytes(name) == b"undefined",
            _ => false,
        }
    }

    /// What the call does with its argument `e`.
    fn use_of_argument_at(&mut self, file: FileId, call: CallId, e: ExprId, by_types: bool) -> u8 {
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
        let Some(index) = index else { return argument_use::ANYTHING };
        let callee = hir[call].callee;
        if let Yielded { callee: Callee::One(of, func), is_predicted: false, .. } = self.callee_yielded_by(file, callee, 0) {
            let params = self.hir(of)[func].params;
            return match params.iter().nth(index) {
                Some(p) => self.use_of_argument(of, p, by_types),
                // Nothing names it.
                None if !self.uses_in_file(of).using_arguments.contains(&func) && !params.iter().next_back().is_some_and(|last| self.hir(of)[last].flags.contains(Flags::REST)) => 0,
                None => argument_use::ANYTHING,
            };
        }
        if index == 0 && by_types && self.is_callback_taker(file, callee) { 0 } else { argument_use::ANYTHING }
    }

    /// Whether `callee` is `receiver.name`, and whatever the receiver is, that is one of `CALLBACK_TAKERS`.
    fn is_callback_taker(&mut self, file: FileId, callee: ExprId) -> bool {
        let ExprKind::Dot { obj, name, .. } = self.hir(file)[callee].kind else { return false };
        let text = self.atoms().bytes(name);
        if !CALLBACK_TAKERS.iter().any(|holder| holder.1.iter().any(|known| known.as_bytes() == text)) {
            return false;
        }
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        let parts: Vec<_> = self.parts(receiver).to_vec();
        !parts.is_empty()
            && parts.into_iter().all(|part| {
                let apparent = self.apparent_type(part);
                let Some(members) = self.members(apparent) else { return false };
                let Some(prop) = members.resolved.prop(name) else { return false };
                let PropSource::Symbol(declared) = prop.source else { return false };
                let Some(holder) = self.holder_of(declared).filter(|_| self.files.module(declared.file).is_lib) else { return false };
                let (holder, text) = (self.atoms().bytes(holder), self.atoms().bytes(name));
                CALLBACK_TAKERS.iter().any(|known| known.0.as_bytes() == holder && known.1.iter().any(|known| known.as_bytes() == text))
            })
    }

    /// `e`: a function expression. Whether nothing can tell the object it yields from the one it yielded the last time.
    pub fn is_identity_unobserved(&mut self, file: FileId, e: ExprId) -> bool {
        self.use_of_value(file, e, true) & argument_use::OBSERVED == 0
    }
}
