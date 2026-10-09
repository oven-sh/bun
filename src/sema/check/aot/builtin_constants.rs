//! A constant that holds a built-in: `const hasOwnProperty = Object.prototype.hasOwnProperty`, `const ObjectKeys = Object.keys`.

use super::builtins_generated::{BUILTIN_ENTRIES, BuiltinKind};
use crate::bind::{Decl, PatParent};
use crate::check::Checker;
use crate::check::errors_names_and_exports::root_declaration;
use crate::hir::{Chain, ExprId, ExprKind, Flags, VarKind};
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

    fn is_path_to_builtin_function(&mut self, file: FileId, path: ExprId) -> bool {
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
        has_function(is_method, self.atoms().bytes(global), &name) && self.names_global(file, holder, global)
    }
}
