//! Which functions keep their parameters in their `arguments` object.
//!
//! In sloppy code with simple parameters (`Checker::has_mapped_arguments`) `arguments[i]` and the i-th parameter are one variable, and
//! `arguments.callee` is the function that runs. Most functions that name `arguments` cannot tell: they ask for its length, read it by
//! a number, spread it or hand it to `apply`, and store to no parameter. For those nothing changes.
//!
//! For the others the object is the engine's own mapped one, the parameters live in it, and whoever refers to a parameter, an inner
//! function too, goes through the object. Nothing follows the stores to such a parameter: see `find_told_of_variable`.
//!
//! It goes by the trees and the symbols of one file, and by `kinds.rs`, which does: every task finds the same.

use super::kinds::kind;
use crate::bind::{Parent, SymbolId};
use crate::check::Checker;
use crate::hir::{ExprId, ExprKind, FnId, StmtKind, UnOp};
use crate::program::{FileId, Sym};
use crate::util::FxHashMap;
use std::rc::Rc;

#[derive(Default)]
pub(super) struct State {
    by_file: FxHashMap<FileId, Rc<Mapped>>,
}

#[derive(Default)]
pub(super) struct Mapped {
    /// By function that keeps its parameters in the object: the first place where it names the object.
    pub(super) functions: FxHashMap<FnId, ExprId>,
    /// By parameter of such a function: the function, and which of its parameters it is.
    parameters: FxHashMap<SymbolId, (FnId, u32)>,
}

impl<'p, 's> Checker<'p, 's> {
    pub(super) fn mapped_arguments_of_file(&mut self, file: FileId) -> Rc<Mapped> {
        if let Some(known) = self.aot.mapped_arguments.by_file.get(&file) {
            return known.clone();
        }
        let found = Rc::new(self.find_mapped_arguments_of_file(file));
        self.aot.mapped_arguments.by_file.insert(file, found.clone());
        found
    }

    fn find_mapped_arguments_of_file(&mut self, file: FileId) -> Mapped {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut found = Mapped::default();
        if !hir.is_js || bound.ran_out_of_stack {
            return found;
        }
        // Those that read what the parameters hold now, and those that can tell whatever the parameters do.
        let (mut reading, mut telling): (FxHashMap<FnId, ExprId>, FxHashMap<FnId, ExprId>) = Default::default();
        for &e in bound.arguments_objects.iter() {
            let owner = self.owner_of_arguments(file, e);
            if owner.is_none() || !self.has_mapped_arguments(file, owner) {
                continue;
            }
            let parent = match bound.expr_parent[e.idx()] {
                Parent::None => continue,
                Parent::Expr(parent) if parent.is_some() => parent,
                _ => {
                    telling.entry(owner).or_insert(e);
                    continue;
                }
            };
            let only_reads = match hir[parent].kind {
                ExprKind::Dot { obj, name, .. } if obj == e && self.atoms().bytes(name) == b"length" => continue,
                // By a number: under any other key there may be `callee`.
                ExprKind::Index { obj, index, .. } if obj == e => {
                    let is_read = match bound.expr_parent[parent.idx()] {
                        Parent::Expr(user) if user.is_some() => match hir[user].kind {
                            ExprKind::Assign { target, .. } => target != parent,
                            ExprKind::Unary { op, .. } => !matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec | UnOp::Delete),
                            // It may be part of a pattern that is assigned to.
                            ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Spread(_) => false,
                            _ => true,
                        },
                        Parent::VarInit(_) | Parent::FnBody(_) => true,
                        Parent::Stmt(stmt) if stmt.is_some() => !matches!(hir[stmt].kind, StmtKind::ForIn { .. } | StmtKind::ForOf { .. }),
                        _ => false,
                    };
                    is_read && self.kinds_yielded_by(file, index) == kind::NUMBER
                }
                ExprKind::Spread(_) => true,
                // `f.apply(x, arguments)`.
                ExprKind::Call(call) => hir[call].callee != e && matches!(hir[hir[call].callee].kind, ExprKind::Dot { name, .. } if self.atoms().bytes(name) == b"apply"),
                _ => false,
            };
            if only_reads { reading.entry(owner).or_insert(e) } else { telling.entry(owner).or_insert(e) };
        }
        for (func, e) in reading {
            // A `var` of the name may have an initializer, a function of the name takes its place.
            let is_stored_to = hir[func].params.iter().any(|p| {
                bound.pat_symbol[hir[p].pat.idx()].some().is_some_and(|symbol| !bound.assignments_to(symbol).is_empty() || bound.symbols[symbol.idx()].decls.len() != 1)
            });
            if is_stored_to {
                telling.entry(func).or_insert(e);
            }
        }
        for &func in telling.keys() {
            for (i, p) in hir[func].params.iter().enumerate() {
                if let Some(symbol) = bound.pat_symbol[hir[p].pat.idx()].some() {
                    found.parameters.insert(symbol, (func, i as u32));
                }
            }
        }
        found.functions = telling;
        found
    }

    /// Whether the parameters of the function live in its `arguments` object, which is the mapped one of the language.
    pub fn keeps_parameters_in_arguments(&mut self, file: FileId, func: FnId) -> bool {
        self.mapped_arguments_of_file(file).functions.contains_key(&func)
    }

    /// Of a parameter of such a function: the function, and which of its parameters it is.
    pub fn mapped_parameter(&mut self, sym: Sym) -> Option<(FnId, u32)> {
        if !self.hir(sym.file).is_js {
            return None;
        }
        self.mapped_arguments_of_file(sym.file).parameters.get(&sym.id).copied()
    }
}
