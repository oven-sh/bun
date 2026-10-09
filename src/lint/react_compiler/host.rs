//! What the compiler asks of the parser, answered from a [`Converted`] function.

use crate::convert::Converted;
use bun_alloc::Arena;
use bun_ast::{Expr, ImportKind, ImportRecord, Loc, Ref, Scope, Symbol};
use bun_react_compiler::{Host, JsxImportKind};

pub(crate) struct LintHost<'c> {
    converted: &'c Converted,
    arena: &'c Arena,
    source: &'c [u8],
    /// Nothing is in it: [`Host::is_module_level`] says what is bound outside of the function.
    module_scope: Scope,
}

impl<'c> LintHost<'c> {
    pub(crate) fn new(converted: &'c Converted, arena: &'c Arena, source: &'c [u8]) -> Self {
        LintHost {
            converted,
            arena,
            source,
            module_scope: Scope::EMPTY,
        }
    }
}

impl Host for LintHost<'_> {
    fn symbols(&self) -> &[Symbol] {
        &self.converted.symbols
    }
    fn module_scope(&self) -> &Scope {
        &self.module_scope
    }
    fn import_records(&self) -> &[ImportRecord] {
        &[]
    }
    fn type_casts(&self) -> &[(Loc, Loc)] {
        &self.converted.casts
    }
    fn is_module_level(&self, ref_: Ref) -> bool {
        let is_outside = self.converted.is_outside.get(ref_.inner_index() as usize);
        is_outside.copied().unwrap_or(true)
    }
    fn source(&self) -> &[u8] {
        self.source
    }
    fn arena(&self) -> &Arena {
        self.arena
    }
    fn ref_name(&self, ref_: Ref) -> &[u8] {
        let symbol = self.converted.symbols.get(ref_.inner_index() as usize);
        symbol.map_or(b"", |it| it.original_name.slice())
    }
    fn scope_for_loc(&self, _: Loc) -> Option<&Scope> {
        None
    }
    fn jsx_import_kind(&self, ref_: Ref) -> Option<JsxImportKind> {
        (ref_ == self.converted.fragment).then_some(JsxImportKind::Fragment)
    }
    fn is_jsx_classic(&self) -> bool {
        true
    }

    // The rest is for generating code, which a linter does not.
    fn jsx_import(&mut self, _: JsxImportKind) -> Ref {
        Ref::NONE
    }
    fn jsx_classic_factory(&mut self, _: Loc) -> Expr {
        Expr::EMPTY
    }
    fn new_generated(&mut self, _: &[u8]) -> Ref {
        Ref::NONE
    }
    fn new_local(&mut self, _: &[u8]) -> Ref {
        Ref::NONE
    }
    fn runtime_sentinel(&mut self, _: bool) -> Ref {
        Ref::NONE
    }
    fn record_usage(&mut self, _: Ref) {}
    fn add_import_record(&mut self, _: &[u8], _: ImportKind) -> (u32, Ref) {
        (0, Ref::NONE)
    }
}
