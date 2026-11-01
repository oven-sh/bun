use std::cell::RefCell;

use bun_sema::bind::{BindingKind, Decl, SymbolId};
use bun_sema::check::aot::{BuiltinClassIndex, Queries};

use crate::builtins::BuiltinClass;

/// Which names of a file are for a FinalizationRegistry.
pub(in crate::lower) struct RegistryNames<'q, 'c, 'p, 's> {
    queries: RefCell<&'q mut Queries<'c, 'p, 's>>,
}

impl<'q, 'c, 'p, 's> RegistryNames<'q, 'c, 'p, 's> {
    pub(in crate::lower) fn new(queries: &'q mut Queries<'c, 'p, 's>) -> Self {
        RegistryNames {
            queries: RefCell::new(queries),
        }
    }

    pub(in crate::lower) fn holds(&self, symbol: SymbolId) -> bool {
        let queries = &mut **self.queries.borrow_mut();
        match queries.bound().binding_kind(symbol) {
            BindingKind::Var
            | BindingKind::Let
            | BindingKind::Const
            | BindingKind::SimpleCatchParameter
            | BindingKind::Parameter => {}
            BindingKind::NoBinding
            | BindingKind::Import
            | BindingKind::TypeScriptContainer
            | BindingKind::Class
            | BindingKind::ClassInnerName
            | BindingKind::Function
            | BindingKind::FunctionName => return false,
        }
        let file = queries.file();
        let variable = queries.canonical_symbol(file, symbol);
        let declarations = queries.files().decls_of(variable);
        let mut values = declarations.iter();
        values.any(|&(declaring_file, declaration)| match declaration {
            Decl::Var(pattern) | Decl::Param(pattern) | Decl::Require(pattern)
                if declaring_file == file =>
            {
                let registry = BuiltinClassIndex(BuiltinClass::FinalizationRegistry.to_wire());
                let answer = queries.is_binding_of_builtin(pattern, registry);
                answer.unwrap_or(false)
            }
            _ => false,
        })
    }
}
