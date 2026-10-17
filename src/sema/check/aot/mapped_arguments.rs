use super::kinds::kind;
use crate::bind::{Parent, SymbolId};
use crate::check::Checker;
use crate::hir::{ExprId, ExprKind, FnId, PatKind, StmtKind, UnOp, VarDeclId};
use crate::program::{FileId, Sym};
use crate::util::{FxHashMap, FxHashSet};
use std::rc::Rc;

#[derive(Default)]
pub(super) struct State {
    by_file: FxHashMap<FileId, Rc<Mapped>>,
}

#[derive(Default)]
pub(super) struct Mapped {
    pub(super) functions: FxHashMap<FnId, ExprId>,
    parameters: FxHashMap<SymbolId, (FnId, u32)>,
    pub(super) materialized_on_demand: FxHashMap<FnId, ExprId>,
    dynamic_key_reads: FxHashSet<ExprId>,
}

enum ArgumentsUse {
    Harmless,
    Reads,
    DynamicKeyRead(ExprId),
    Tells,
}

impl<'p, 's> Checker<'p, 's> {
    pub(super) fn file_mapped_arguments(&mut self, file: FileId) -> Rc<Mapped> {
        if let Some(known) = self.aot.mapped_arguments.by_file.get(&file) {
            return Rc::clone(known);
        }
        let found = Rc::new(self.find_file_mapped_arguments(file));
        self.aot
            .mapped_arguments
            .by_file
            .insert(file, Rc::clone(&found));
        found
    }

    fn find_file_mapped_arguments(&mut self, file: FileId) -> Mapped {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut found = Mapped::default();
        if !hir.is_js || bound.ran_out_of_stack {
            return found;
        }
        let (mut reading, mut informative_type): (
            FxHashMap<FnId, ExprId>,
            FxHashMap<FnId, ExprId>,
        ) = Default::default();
        let mut by_dynamic_key: Vec<(FnId, ExprId)> = Vec::new();
        for &e in bound.arguments_objects.iter() {
            let owner = self.arguments_owner(file, e);
            if owner.is_none() || !self.has_mapped_arguments(file, owner) {
                continue;
            }
            let aliases = match bound.expr_parent[e.idx()] {
                Parent::VarInit(declaration) => {
                    self.arguments_alias_references(file, owner, declaration)
                }
                _ => None,
            };
            for &mention in aliases.unwrap_or(&[e]) {
                match self.arguments_use(file, owner, mention) {
                    ArgumentsUse::Harmless => {}
                    ArgumentsUse::Reads => {
                        reading.entry(owner).or_insert(e);
                    }
                    ArgumentsUse::DynamicKeyRead(read) => {
                        reading.entry(owner).or_insert(e);
                        by_dynamic_key.push((owner, read));
                    }
                    ArgumentsUse::Tells => {
                        informative_type.entry(owner).or_insert(e);
                    }
                }
            }
        }
        for (func, e) in reading {
            let is_stored_to = hir[func].params.iter().any(|p| {
                bound.pat_symbol[hir[p].pat.idx()]
                    .some()
                    .is_some_and(|symbol| {
                        !bound.assignments_to(symbol).is_empty()
                            || bound.symbols[symbol.idx()].decls.len() != 1
                    })
            });
            if is_stored_to {
                informative_type.entry(func).or_insert(e);
            }
        }
        for &func in informative_type.keys() {
            for (i, p) in hir[func].params.iter().enumerate() {
                if let Some(symbol) = bound.pat_symbol[hir[p].pat.idx()].some() {
                    found.parameters.insert(symbol, (func, i as u32));
                }
            }
        }
        for (func, read) in by_dynamic_key {
            if !informative_type.contains_key(&func) {
                found.materialized_on_demand.entry(func).or_insert(read);
                found.dynamic_key_reads.insert(read);
            }
        }
        found.functions = informative_type;
        found
    }

    fn arguments_alias_references(
        &self,
        file: FileId,
        owner: FnId,
        declaration: VarDeclId,
    ) -> Option<&'p [ExprId]> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let pat = hir[declaration].pat;
        let symbol = bound.pat_symbol[pat.idx()];
        if !matches!(hir[pat].kind, PatKind::Ident(_))
            || symbol.is_none()
            || !bound.assignments_to(symbol).is_empty()
            || self.has_direct_eval(file)
        {
            return None;
        }
        let references = self.references_to(file, symbol)?;
        references
            .iter()
            .all(|&reference| self.enclosing_fn_of_expr(file, reference) == Some(owner))
            .then_some(references)
    }

    fn arguments_use(&mut self, file: FileId, owner: FnId, e: ExprId) -> ArgumentsUse {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = match bound.expr_parent[e.idx()] {
            Parent::None => return ArgumentsUse::Harmless,
            Parent::Expr(parent) if parent.is_some() => parent,
            _ => return ArgumentsUse::Tells,
        };
        let only_reads = match hir[parent].kind {
            ExprKind::Dot { obj, name, .. }
                if obj == e && self.atoms().bytes(name) == b"length" =>
            {
                return ArgumentsUse::Harmless;
            }
            ExprKind::Index { obj, index, .. } if obj == e => {
                let is_read = match bound.expr_parent[parent.idx()] {
                    Parent::Expr(user) if user.is_some() => match hir[user].kind {
                        ExprKind::Assign { target, .. } => target != parent,
                        ExprKind::Unary { op, .. } => !matches!(
                            op,
                            UnOp::PreInc
                                | UnOp::PreDec
                                | UnOp::PostInc
                                | UnOp::PostDec
                                | UnOp::Delete
                        ),
                        ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Spread(_) => false,
                        ExprKind::Call(call) => hir[call].callee != parent,
                        _ => true,
                    },
                    Parent::VarInit(_) | Parent::FnBody(_) => true,
                    Parent::Stmt(stmt) if stmt.is_some() => !matches!(
                        hir[stmt].kind,
                        StmtKind::ForIn { .. } | StmtKind::ForOf { .. }
                    ),
                    _ => false,
                };
                if is_read
                    && self.result_kinds_of(file, index) != kind::NUMBER
                    && self.enclosing_fn_of_expr(file, parent) == Some(owner)
                {
                    return ArgumentsUse::DynamicKeyRead(parent);
                }
                is_read && self.result_kinds_of(file, index) == kind::NUMBER
            }
            ExprKind::Spread(_) => true,
            ExprKind::Call(call) => {
                hir[call].callee != e
                    && matches!(hir[hir[call].callee].kind, ExprKind::Dot { name, .. } if self.atoms().bytes(name) == b"apply")
            }
            _ => false,
        };
        if only_reads {
            ArgumentsUse::Reads
        } else {
            ArgumentsUse::Tells
        }
    }

    pub fn reads_sloppy_arguments_dynamically(&mut self, file: FileId, e: ExprId) -> bool {
        self.hir(file).is_js
            && self
                .file_mapped_arguments(file)
                .dynamic_key_reads
                .contains(&e)
    }

    pub fn keeps_parameters_in_arguments(&mut self, file: FileId, func: FnId) -> bool {
        self.file_mapped_arguments(file)
            .functions
            .contains_key(&func)
    }

    pub fn mapped_parameter(&mut self, sym: Sym) -> Option<(FnId, u32)> {
        if !self.hir(sym.file).is_js {
            return None;
        }
        self.file_mapped_arguments(sym.file)
            .parameters
            .get(&sym.id)
            .copied()
    }
}
