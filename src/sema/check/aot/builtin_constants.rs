//! A constant that holds a built-in: `const hasOwnProperty = Object.prototype.hasOwnProperty`, `const ObjectKeys = Object.keys`.

use super::builtins_generated::{BUILTIN_ENTRIES, BuiltinKind, Pattern, REPLACEABLE_GLOBALS};
use crate::bind::{Decl, Parent, PatParent, SymFlags};
use crate::check::Checker;
use crate::check::errors_names_and_exports::root_declaration;
use crate::hir::{BinOp, Chain, ExprId, ExprKind, Flags, UnOp, VarKind};
use crate::program::{FileId, Sym};

/// Whether the engine's table has a function under the name: a static one of the holder, or a method of its prototype.
fn has_function(is_method: bool, holder: &[u8], name: &[u8]) -> bool {
    let kind = if is_method { BuiltinKind::Method } else { BuiltinKind::Static };
    BUILTIN_ENTRIES.iter().any(|entry| entry.kind == kind && entry.holder.as_bytes() == holder && entry.name.as_bytes() == name)
}

impl<'p, 's> Checker<'p, 's> {
    /// The initializer of a `const` that nothing finds in its dead zone, if it is a path to a function of the engine's table:
    /// `Holder.name`, `Holder.prototype.name` or `Holder.prototype[Symbol.name]`, with globals that the program does not bind. Neither the
    /// global, nor its `prototype`, nor what is found under the name can be replaced. So the path finds the same function whenever it is
    /// evaluated, runs no code and does not throw: it stands for a reference to the constant.
    ///
    /// It goes by the tree and the symbols alone: every task finds the same.
    pub fn builtin_held_by(&mut self, sym: Sym) -> Option<(FileId, ExprId)> {
        if let Some(&known) = self.aot.storage.builtins_held.get(&sym) {
            return known;
        }
        let found = self.find_builtin_held_by(sym);
        self.aot.storage.builtins_held.insert(sym, found);
        found
    }

    fn find_builtin_held_by(&mut self, sym: Sym) -> Option<(FileId, ExprId)> {
        if self.may_be_overridden(sym) {
            return None;
        }
        let (file, Decl::Var(pat)) = self.declaration_of_variable(sym)? else { return None };
        let hir = self.hir(file);
        let PatParent::Var(d) = root_declaration(self.bound(file), pat) else { return None };
        let is_code = self.is_compiled(file) && !hir[d].flags.contains(Flags::AMBIENT);
        if !is_code || hir[d].kind != VarKind::Const || hir[d].pat != pat || hir[d].init.is_none() {
            return None;
        }
        let path = hir[d].init;
        (self.is_path_to_builtin_function(file, path) && self.is_never_seen_uninitialized(sym)).then_some((file, path))
    }

    /// The same for a variable of any kind that nothing is ever stored to but by its own declaration, whoever may read it before that has run: it holds `undefined` until then (or
    /// is in its dead zone), and the function from then on. The path. The initializer may be `typeof P === "function" ? P : q`, `P || q` or `P ?? q`, which come to `P`.
    pub fn builtin_or_undefined_in_variable(&mut self, sym: Sym) -> Option<(FileId, ExprId)> {
        if let Some(&known) = self.aot.storage.builtins_held_or_undefined.get(&sym) {
            return known;
        }
        let found = self.find_builtin_or_undefined_in_variable(sym);
        self.aot.storage.builtins_held_or_undefined.insert(sym, found);
        found
    }

    fn find_builtin_or_undefined_in_variable(&mut self, sym: Sym) -> Option<(FileId, ExprId)> {
        if self.may_be_overridden(sym) {
            return None;
        }
        let (file, Decl::Var(pat)) = self.declaration_of_variable(sym)? else { return None };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Var(d) = root_declaration(bound, pat) else { return None };
        if !self.is_compiled(file) || hir[d].flags.intersects(Flags::AMBIENT | Flags::EXPORT) || hir[d].pat != pat || hir[d].init.is_none() {
            return None;
        }
        let local = bound.pat_symbol[pat.idx()];
        let symbol = bound.symbols.get(local.idx())?;
        let is_seen_elsewhere = symbol.flags.contains(SymFlags::MERGED) || self.files().sym(file, local) != sym || !self.files().module(file).is_module() && matches!(bound.stmt_parent[bound.var_stmt[d.idx()].idx()], Parent::File);
        if is_seen_elsewhere || symbol.decls.len() != 1 || !bound.assignments_to(local).is_empty() || self.has_direct_eval(file) {
            return None;
        }
        let path = self.path_of_initializer(file, hir[d].init)?;
        Some((file, path))
    }

    pub fn is_number_parameter_of_builtin_at(&self, file: FileId, path: ExprId) -> Vec<Option<bool>> {
        let hir = self.hir(file);
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[path].kind else { return Vec::new() };
        let ExprKind::Ident(holder) = hir[obj].kind else { return Vec::new() };
        let (holder, name) = (self.atoms().bytes(holder), self.atoms().bytes(name));
        let mut taken: Vec<Option<bool>> = Vec::new();
        for entry in BUILTIN_ENTRIES.iter().filter(|entry| entry.kind == BuiltinKind::Static && entry.holder.as_bytes() == holder && entry.name.as_bytes() == name) {
            for (index, parameter) in entry.parameters.iter().enumerate() {
                let is_number = match parameter.0 {
                    Pattern::Number | Pattern::Integer | Pattern::ToNumber => Some(true),
                    Pattern::ToString => Some(false),
                    _ => None,
                };
                match taken.get_mut(index) {
                    Some(known) => *known = known.or(is_number),
                    None => taken.push(is_number),
                }
            }
        }
        taken
    }

    fn path_of_initializer(&mut self, file: FileId, init: ExprId) -> Option<ExprId> {
        let hir = self.hir(file);
        let path = match hir[init].kind {
            ExprKind::Binary { op: BinOp::Or | BinOp::Nullish, left, .. } => left,
            ExprKind::Cond { test, yes, .. } => {
                let asked = match hir[test].kind {
                    ExprKind::Binary { op: BinOp::EqEqEq | BinOp::EqEq, left, right } => {
                        let (kind, name) = if matches!(hir[left].kind, ExprKind::String(_)) { (right, left) } else { (left, right) };
                        let (ExprKind::Unary { op: UnOp::Typeof, operand }, ExprKind::String(name)) = (hir[kind].kind, hir[name].kind) else { return None };
                        if self.atoms().bytes(name) != b"function" {
                            return None;
                        }
                        operand
                    }
                    _ => test,
                };
                if !self.is_path_to_builtin_function(file, asked) || !self.are_same_paths(file, asked, yes) {
                    return None;
                }
                yes
            }
            _ => init,
        };
        self.is_path_to_builtin_function(file, path).then_some(path)
    }

    /// Of names and `.name` alone.
    fn are_same_paths(&self, file: FileId, a: ExprId, b: ExprId) -> bool {
        let hir = self.hir(file);
        match (hir[a].kind, hir[b].kind) {
            (ExprKind::Ident(a), ExprKind::Ident(b)) => a == b,
            (ExprKind::Dot { obj: a, name: first, chain: Chain::No, .. }, ExprKind::Dot { obj: b, name: second, chain: Chain::No, .. }) => first == second && self.are_same_paths(file, a, b),
            _ => false,
        }
    }

    pub fn is_path_to_builtin_function(&mut self, file: FileId, path: ExprId) -> bool {
        if self.member_of_global_that_may_be_overridden(file, path).is_some() {
            return false;
        }
        let hir = self.hir(file);
        let (of, name) = match hir[path].kind {
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => (obj, self.atoms().bytes(name).to_vec()),
            ExprKind::Index { obj, index, chain: Chain::No } => {
                let ExprKind::Dot { obj: symbol, name, chain: Chain::No, .. } = hir[index].kind else { return false };
                let ExprKind::Ident(global) = hir[symbol].kind else { return false };
                if self.atoms().bytes(global) != b"Symbol" || !self.names_global(file, symbol, global) {
                    return false;
                }
                (obj, [b"@@", self.atoms().bytes(name)].concat())
            }
            _ => return false,
        };
        let (holder, is_method) = match hir[of].kind {
            ExprKind::Dot { obj, name, chain: Chain::No, .. } if self.atoms().bytes(name) == b"prototype" => (obj, true),
            // A well-known symbol names a method.
            _ if matches!(hir[path].kind, ExprKind::Index { .. }) => return false,
            _ => (of, false),
        };
        let ExprKind::Ident(global) = hir[holder].kind else { return false };
        let is_replaceable = REPLACEABLE_GLOBALS.iter().any(|replaceable| replaceable.as_bytes() == self.atoms().bytes(global));
        !is_replaceable && has_function(is_method, self.atoms().bytes(global), &name) && self.names_global(file, holder, global)
    }
}
