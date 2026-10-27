use bun_sema::bind::{Binding, Decl, PatParent};
use bun_sema::hir::{ExprId, ExprKind, FnBody, FnId, VarDeclId};

use crate::lower::FileLowering;
use crate::lower::transpiled::{Rewrite, TranspiledFile};

// What Bun's transpiler prints in place of a name.
#[derive(Copy, Clone)]
pub(in crate::lower) enum Printed {
    Initializer(ExprId),
    // A function that a block declares. The transpiler declares it as a `let` variable at the start of the block, with a function expression that has no name.
    Function(FnId),
}

impl FileLowering<'_, '_, '_, '_> {
    // What Bun's transpiler prints in place of the name of a constant, of the only use of a `let` or `const` variable or of a function that a block declares.
    // An initializer that replaces a name ends in front of the name, so following names to their initializers comes to an end.
    // A function may be declared behind the name: `last_mapped_position_in` enters none that it is in already.
    pub(in crate::lower) fn find_printed_in_place(&self, name: ExprId) -> Option<Printed> {
        let hir = self.hir;
        let transpiled = self.transpiled.as_ref()?;
        if transpiled.has_identifier_at(hir[name].pos) {
            return None;
        }
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return None;
        };
        match *self.bound.symbol(symbol).decls {
            [Decl::Var(pattern) | Decl::Require(pattern)] => {
                let PatParent::Var(declaration) = self.bound.pat_parent[pattern.idx()] else {
                    return None;
                };
                // A name in code that the transpiler drops is gone too. Its declaration stays.
                let is_replaced = hir[declaration].loc.end <= hir[name].pos
                    && (!transpiled.has_binding_at(hir[pattern].pos)
                        || matches!(transpiled.find_rewrite(name), Some(Rewrite::Operand(_))));
                let initializer = hir[declaration].init.some().filter(|_| is_replaced);
                initializer.map(Printed::Initializer)
            }
            ref functions => {
                let mut functions = functions.iter().rev();
                let last = functions.find_map(|&declaration| match declaration {
                    Decl::Fn(function) if !matches!(hir[function].body, FnBody::None) => {
                        Some(function)
                    }
                    _ => None,
                });
                last.filter(|&last| !transpiled.has_binding_at(hir[last].name_pos))
                    .map(Printed::Function)
            }
        }
    }

    pub(in crate::lower) fn find_printed_initializer(&self, name: ExprId) -> Option<ExprId> {
        match self.find_printed_in_place(name)? {
            Printed::Initializer(initializer) => Some(initializer),
            Printed::Function(_) => None,
        }
    }

    // The transpiler prints no declaration of the variable.
    pub(in crate::lower) fn is_initializer_moved(&self, declaration: VarDeclId) -> bool {
        let position = self.hir[self.hir[declaration].pat].pos;
        let is_printed = |transpiled: &TranspiledFile| transpiled.has_binding_at(position);
        !self.transpiled.as_ref().is_none_or(is_printed)
    }

    // `const a = f(); const b = a; return b;` is printed `return f();`. The position of that `return`.
    pub(in crate::lower) fn find_return_printed_with(&self, declaration: VarDeclId) -> Option<u32> {
        let transpiled = self.transpiled.as_ref()?;
        let mut value = self.skip_unprinted_syntax(self.hir[declaration].init);
        while let ExprKind::Ident(_) = self.hir[value].kind
            && let Some(initializer) = self.find_printed_initializer(value)
        {
            value = self.skip_unprinted_syntax(initializer);
        }
        transpiled.find_return_of_moved_value_at(self.parsed_position(value))
    }

    pub(in crate::lower) fn is_replaced_by_its_value(&self, declaration: VarDeclId) -> bool {
        let initializer = self.hir[declaration].init;
        self.is_initializer_moved(declaration)
            && initializer.is_some()
            && self.is_literal_operand(initializer)
    }
}
