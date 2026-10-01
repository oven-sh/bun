// Scratch root 2: the files of K3 steps 6 to 8 against the data model of the tree (checker/c01_data.rs, c02_program_checker.rs, types.rs, mapper.rs, links.rs) and its real core, collections, stringutil, tspath, jsnum, ast, evaluator and binder/nameresolver.rs, with stand-ins for what other steps own.
#![allow(dead_code)]
#[path = "/workspace/wt/typecheck/src/typecheck/collections/mod.rs"]
pub mod collections;
#[path = "/workspace/wt/typecheck/src/typecheck/core/mod.rs"]
mod core_real;
#[path = "stubs/golang.rs"]
mod golang;
pub mod core {
    pub use crate::core_real::*;
    pub use crate::golang::{GoIndex, List, LiveList, Map, Memo, SliceBuf, Text};
}
#[path = "/workspace/wt/typecheck/src/typecheck/stringutil/mod.rs"]
pub mod stringutil;
#[path = "/workspace/wt/typecheck/src/typecheck/tspath/mod.rs"]
pub mod tspath;
#[path = "/workspace/wt/typecheck/src/typecheck/jsnum/mod.rs"]
pub mod jsnum;
#[path = "stubs/internal.rs"]
pub mod internal;
#[path = "stubs/diagnostics.rs"]
pub mod diagnostics;
#[path = "/workspace/wt/typecheck/src/typecheck/ast/mod.rs"]
mod ast_real;
#[path = "stubs/ast_diag.rs"]
mod ast_diag;
pub mod ast {
    pub use crate::ast_diag::*;
    pub use crate::ast_real::*;
}
pub mod evaluator {
    #[path = "/workspace/wt/typecheck/src/typecheck/evaluator/evaluator.rs"]
    pub mod evaluator;
    pub use evaluator::*;
}
pub mod binder {
    use crate::ast::{Ast, NodeId, SymbolId};
    // The first branch of binder.SetValueDeclaration: the scratch has no assignment declarations and no modules that lose to other kinds.
    pub fn set_value_declaration(a: Ast<'_>, symbol: SymbolId, node: NodeId) {
        if a.sym(symbol).value_declaration.is_nil() {
            a.update_symbol(symbol, |s| s.value_declaration = node);
        }
    }
    #[path = "/workspace/wt/typecheck/src/typecheck/binder/nameresolver.rs"]
    pub mod nameresolver;
    pub use nameresolver::*;
}
pub mod scanner {
    use crate::ast::{Ast, NodeId};
    pub fn declaration_name_to_string(a: Ast<'_>, name: NodeId) -> Vec<u8> {
        if name.is_nil() {
            return b"(Missing)".to_vec();
        }
        get_text_of_node(a, name)
    }
    // The real function reads the source text: the scratch files have none, so a name or a literal answers its own text and any other node nothing.
    pub fn get_text_of_node(a: Ast<'_>, node: NodeId) -> Vec<u8> {
        match a.kind(node) {
            crate::ast::Kind::Identifier | crate::ast::Kind::StringLiteral => a.text(node).to_vec(),
            _ => Vec::new(),
        }
    }
}
#[path = "/workspace/wt/typecheck/src/typecheck/module/mod.rs"]
pub mod module;
pub mod checker {
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c01_data.rs"]
    pub mod c01_data;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c02_program_checker.rs"]
    pub mod c02_program_checker;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c04_name_resolution_hooks.rs"]
    pub mod c04_name_resolution_hooks;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c21_resolved_symbols_diagnostics.rs"]
    pub mod c21_resolved_symbols_diagnostics;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c22_symbols_merge.rs"]
    pub mod c22_symbols_merge;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c23_alias_targets.rs"]
    pub mod c23_alias_targets;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c24_external_modules.rs"]
    pub mod c24_external_modules;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c25_entity_names.rs"]
    pub mod c25_entity_names;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c26_exports_late_binding.rs"]
    pub mod c26_exports_late_binding;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c27_resolve_alias.rs"]
    pub mod c27_resolve_alias;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/links.rs"]
    pub mod links;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/mapper.rs"]
    pub mod mapper;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/stringer_generated.rs"]
    pub mod stringer_generated;
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/types.rs"]
    pub mod types;
    pub mod nodebuilder {
        #[derive(Default)]
        pub struct NodeBuilderState;
    }
    pub mod symbolaccessibility {
        pub type SymbolTableID = u64;
    }
    #[path = "@SCRATCH@/stubs/other_steps.rs"]
    pub mod other_steps;
    #[allow(unused_imports)]
    pub use {
        c01_data::*, c02_program_checker::*, c04_name_resolution_hooks::*,
        c21_resolved_symbols_diagnostics::*, c22_symbols_merge::*, c23_alias_targets::*,
        c24_external_modules::*, c25_entity_names::*, c26_exports_late_binding::*,
        c27_resolve_alias::*, links::*, mapper::*, other_steps::*, types::*,
    };
}
#[cfg(test)]
#[path = "stubs/runtime_tests.rs"]
mod runtime_tests;
#[cfg(test)]
#[path = "stubs/e2e_tests.rs"]
mod e2e_tests;
