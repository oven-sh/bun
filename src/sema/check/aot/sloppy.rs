//! What only sloppy code has.
//!
//! A function is sloppy if it stands in a CommonJS module (`Module::is_commonjs`), under no `"use strict"` and in no class.
//! There, with simple parameters (names alone: no default, no rest, no pattern), the language gives it a MAPPED `arguments` object:
//! `arguments.callee` is the function that runs, and `arguments[i]` and the i-th parameter are one variable for as many as were passed.

use crate::bind::{FnOwner, Parent};
use crate::check::Checker;
use crate::hir::{ClassId, ExprId, ExprKind, ExprTag, Flags, FnBody, FnId, FnKind, IdList, PatKind, PropKey, StmtId, StmtKind, UnOp};
use crate::program::FileId;
use crate::util::FxHashMap;

/// What a function does with its `arguments` object, as the text has it.
#[derive(Copy, Clone, Default)]
struct Uses {
    /// `arguments[k]` is read, `arguments` is spread, or handed to `f.apply(x, arguments)`: whoever reads sees what the parameters hold now.
    reads_elements: bool,
    /// `arguments[k] = v`, `arguments[k]++`, `delete arguments[k]`.
    stores_elements: bool,
    /// `arguments.callee`.
    mentions_callee: bool,
    /// Anything else but `arguments.length`: it is handed on, kept, returned, read by another name.
    hands_on: bool,
}

impl<'p, 's> Checker<'p, 's> {
    /// `"use strict"` among the directives that the statements start with.
    fn starts_with_use_strict(&self, file: FileId, body: IdList<StmtId>) -> bool {
        let hir = self.hir(file);
        for stmt in hir.ids(body) {
            match hir[stmt].kind {
                StmtKind::Expr(e) => match hir[e].kind {
                    ExprKind::String(text) if self.atoms().bytes(text) == b"use strict" => return true,
                    ExprKind::String(_) => {}
                    _ => return false,
                },
                _ => return false,
            }
        }
        false
    }

    /// Whether the code of the function is sloppy.
    pub fn is_sloppy_function(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // JavaScript that is no CommonJS module is an ES module to the bundler and to the runtime, whether or not it imports or exports anything: strict.
        if !self.files().module(file).is_commonjs() || self.starts_with_use_strict(file, hir.body) {
            return false;
        }
        let mut at = func;
        while at.is_some() {
            if matches!(bound.fns[at.idx()].owner, FnOwner::Member(_)) || matches!(hir[at].kind, FnKind::Constructor | FnKind::StaticBlock) {
                return false;
            }
            if matches!(hir[at].body, FnBody::Block(body) if self.starts_with_use_strict(file, body)) {
                return false;
            }
            at = bound.fns[at.idx()].enclosing;
        }
        true
    }

    /// Whether the `arguments` object of the function is mapped by the language.
    pub fn has_mapped_arguments(&self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        hir[func].kind != FnKind::Arrow
            && hir[func].params.iter().all(|p| hir[p].default.is_none() && !hir[p].flags.contains(Flags::REST) && matches!(hir[hir[p].pat].kind, PatKind::Ident(_)))
            && self.is_sloppy_function(file, func)
    }

    /// The function whose `arguments` object the expression names: an arrow function sees that of the function around it.
    pub(super) fn owner_of_arguments(&self, file: FileId, e: ExprId) -> FnId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
        while at.is_some() && hir[at].kind == FnKind::Arrow {
            at = bound.fns[at.idx()].enclosing;
        }
        at
    }

    /// For `--aot-explain=arguments`: how many functions have what only sloppy code has. Numbers alone.
    pub fn explain_arguments(&mut self) -> Vec<String> {
        let files: Vec<FileId> = (0..self.files().modules.len() as u32).map(FileId).filter(|&file| self.hir(file).is_js && !self.files().module(file).is_opaque()).collect();
        let (mut sloppy_files, mut functions, mut sloppy_functions) = (0usize, 0usize, 0usize);
        // With an object; mapped by the language; and of those ..
        let mut counts = [0usize; 12];
        let (mut caller_sites, mut arguments_sites, mut sloppy_caller_sites, mut sloppy_arguments_sites) = (0usize, 0usize, 0usize, 0usize);
        for file in files {
            if self.bound(file).ran_out_of_stack {
                continue;
            }
            let (hir, bound) = (self.hir(file), self.bound(file));
            let mut is_any_sloppy = false;
            for (i, f) in hir.fns.iter().enumerate() {
                let func = FnId(i as u32);
                if matches!(f.body, FnBody::None) {
                    continue;
                }
                functions += 1;
                if self.is_sloppy_function(file, func) {
                    sloppy_functions += 1;
                    is_any_sloppy = true;
                }
            }
            sloppy_files += is_any_sloppy as usize;
            let mut found: FxHashMap<FnId, Uses> = FxHashMap::default();
            for &e in self.exprs_by_kind_of(file).of(ExprTag::Ident) {
                if !bound.is_arguments_object(e) {
                    continue;
                }
                let owner = self.owner_of_arguments(file, e);
                if owner.is_none() {
                    continue;
                }
                let uses = found.entry(owner).or_default();
                let Parent::Expr(parent) = bound.expr_parent[e.idx()] else {
                    uses.hands_on = true;
                    continue;
                };
                if parent.is_none() {
                    continue;
                }
                match hir[parent].kind {
                    ExprKind::Dot { obj, name, .. } if obj == e => match self.atoms().bytes(name) {
                        b"length" => {
                            // A store to it is seen by whoever reads the object, which is this function alone unless it hands it on.
                        }
                        b"callee" => uses.mentions_callee = true,
                        _ => uses.hands_on = true,
                    },
                    ExprKind::Index { obj, .. } if obj == e => match bound.expr_parent[parent.idx()] {
                        Parent::Expr(user) if user.is_some() => match hir[user].kind {
                            ExprKind::Assign { target, .. } if target == parent => uses.stores_elements = true,
                            ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec | UnOp::Delete, .. } => uses.stores_elements = true,
                            _ => uses.reads_elements = true,
                        },
                        _ => uses.reads_elements = true,
                    },
                    ExprKind::Spread(_) => uses.reads_elements = true,
                    // `f.apply(x, arguments)`.
                    ExprKind::Call(call) if hir[call].callee != e && matches!(hir[hir[call].callee].kind, ExprKind::Dot { name, .. } if self.atoms().bytes(name) == b"apply") => uses.reads_elements = true,
                    _ => uses.hands_on = true,
                }
            }
            for (&func, uses) in &found {
                counts[0] += 1;
                if !self.has_mapped_arguments(file, func) {
                    continue;
                }
                counts[1] += 1;
                let has_parameters = hir[func].params.iter().next().is_some();
                let stores_to_parameter = hir[func].params.iter().any(|p| bound.pat_symbol[hir[p].pat.idx()].some().is_some_and(|symbol| !bound.assignments_to(symbol).is_empty()));
                counts[2] += uses.mentions_callee as usize;
                counts[3] += uses.hands_on as usize;
                counts[4] += uses.stores_elements as usize;
                counts[5] += has_parameters as usize;
                counts[6] += stores_to_parameter as usize;
                // One variable under two names can be told from two variables.
                let parameter_is_seen_in_object = stores_to_parameter && (uses.reads_elements || uses.hands_on);
                let object_is_seen_in_parameter = has_parameters && (uses.stores_elements || uses.hands_on);
                counts[7] += (stores_to_parameter && uses.reads_elements) as usize;
                counts[8] += (has_parameters && uses.stores_elements) as usize;
                counts[9] += (has_parameters && uses.hands_on) as usize;
                counts[10] += (parameter_is_seen_in_object || object_is_seen_in_parameter) as usize;
                counts[11] += (parameter_is_seen_in_object || object_is_seen_in_parameter || uses.mentions_callee || uses.hands_on) as usize;
            }
            for &e in self.exprs_by_kind_of(file).of(ExprTag::Dot) {
                let ExprKind::Dot { obj, name, .. } = hir[e].kind else { continue };
                let is_sloppy = || self.enclosing_fn_of_expr(file, e).is_some_and(|func| self.is_sloppy_function(file, func));
                match self.atoms().bytes(name) {
                    b"caller" => {
                        caller_sites += 1;
                        sloppy_caller_sites += is_sloppy() as usize;
                    }
                    b"arguments" if !matches!(hir[obj].kind, ExprKind::This) => {
                        arguments_sites += 1;
                        sloppy_arguments_sites += is_sloppy() as usize;
                    }
                    _ => {}
                }
            }
        }
        let mut lines = vec![
            format!("arguments: {functions} functions with a body in JavaScript files; {sloppy_functions} of them sloppy, in {sloppy_files} files"),
            format!("arguments: {} functions name their `arguments` object; for {} of them the language maps it (sloppy, simple parameters)", counts[0], counts[1]),
        ];
        const WHAT: [&str; 10] = [
            "mention `arguments.callee`",
            "hand the object on (an argument other than of `apply`, a variable, a result, another property of it)",
            "store to `arguments[k]`, or delete it",
            "have a parameter at all",
            "store to a parameter",
            "store to a parameter AND read `arguments[k]`, spread it or `apply` it",
            "have a parameter AND store to `arguments[k]`",
            "have a parameter AND hand the object on",
            "ONE VARIABLE CAN BE TOLD FROM TWO (any of the last three, or a store to a parameter and the object handed on)",
            "NEED THE MAPPED OBJECT OR THE CLOSURE THAT RUNS (that, `callee`, or the object handed on)",
        ];
        for (i, what) in WHAT.iter().enumerate() {
            lines.push(format!("arguments: {:>8}  {what}", counts[i + 2]));
        }
        let (mut keys, mut stores, mut members, mut met) = (0usize, 0usize, 0usize, 0usize);
        let all: Vec<FileId> = (0..self.files().modules.len() as u32).map(FileId).filter(|&file| !self.files().module(file).is_opaque() && !self.bound(file).ran_out_of_stack).collect();
        for file in all {
            let (hir, bound) = (self.hir(file), self.bound(file));
            for &e in self.exprs_by_kind_of(file).of(ExprTag::Object) {
                let ExprKind::Object(props) = hir[e].kind else { continue };
                keys += props.iter().filter(|&p| matches!(hir[p].key, PropKey::Name(name) if self.atoms().bytes(name) == b"apply")).count();
            }
            for &e in self.exprs_by_kind_of(file).of(ExprTag::Dot) {
                let ExprKind::Dot { name, .. } = hir[e].kind else { continue };
                if self.atoms().bytes(name) == b"apply"
                    && let Parent::Expr(parent) = bound.expr_parent[e.idx()]
                    && parent.is_some()
                    && matches!(hir[parent].kind, ExprKind::Assign { target, .. } if target == e)
                {
                    stores += 1;
                }
            }
            for i in 0..bound.class_owner.len() {
                members += hir[ClassId(i as u32)].members.iter().filter(|&member| matches!(hir[member].key, PropKey::Name(name) if self.atoms().bytes(name) == b"apply")).count();
            }
            let mut handing: Vec<FnId> = Vec::new();
            for &e in bound.arguments_objects.iter() {
                if let Parent::Expr(parent) = bound.expr_parent[e.idx()]
                    && parent.is_some()
                    && let ExprKind::Call(call) = hir[parent].kind
                    && hir[call].callee != e
                    && matches!(hir[hir[call].callee].kind, ExprKind::Dot { name, .. } if self.atoms().bytes(name) == b"apply")
                {
                    handing.push(self.owner_of_arguments(file, e));
                }
            }
            handing.sort_unstable();
            handing.dedup();
            for func in handing {
                if func.is_some() && self.has_mapped_arguments(file, func) && !self.keeps_parameters_in_arguments(file, func) {
                    met += 1;
                }
            }
        }
        let mut mentioning = [0usize; 5];
        let javascript: Vec<FileId> = (0..self.files().modules.len() as u32).map(FileId).filter(|&file| self.files().module(file).is_commonjs() && !self.files().module(file).is_opaque() && !self.bound(file).ran_out_of_stack).collect();
        for file in javascript {
            let (hir, bound) = (self.hir(file), self.bound(file));
            for (i, f) in hir.fns.iter().enumerate() {
                let func = FnId(i as u32);
                if matches!(f.body, FnBody::None) || f.kind == FnKind::Arrow || !bound.fns[i].contains_this || !self.is_sloppy_function(file, func) {
                    continue;
                }
                mentioning[0] += 1;
                let how = match bound.fns[i].owner {
                    FnOwner::Stmt(_) => 3,
                    FnOwner::Expr(_) if bound.get_immediately_invoked_function_expression(hir, func).is_some() => 1,
                    FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                        Parent::Prop(_) => 2,
                        Parent::Expr(parent) if parent.is_some() && matches!(hir[parent].kind, ExprKind::Assign { target, .. } if matches!(hir[target].kind, ExprKind::Dot { .. } | ExprKind::Index { .. })) => 2,
                        _ => 4,
                    },
                    _ => 4,
                };
                mentioning[how] += 1;
            }
        }
        lines.push(format!(
            "arguments: {} sloppy functions mention `this`: {} immediately invoked without a receiver, {} the value of a property or stored to one, {} declarations, {} others",
            mentioning[0], mentioning[1], mentioning[2], mentioning[3], mentioning[4]
        ));
        lines.push(format!("arguments: own `apply`: {keys} keys of object literals, {stores} stores `x.apply = ..`, {members} members of classes, in all files"));
        lines.push(format!("arguments: {met} functions whose object the language maps hand it to an `apply` and do not keep their parameters in it"));
        lines.push(format!("arguments: `x.caller`: {caller_sites} sites, {sloppy_caller_sites} in sloppy functions; `x.arguments` (x is not `this`): {arguments_sites} sites, {sloppy_arguments_sites} in sloppy functions"));
        lines
    }
}
