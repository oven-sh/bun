//! The React Compiler's `Host` without a parser: a symbol table that the adapter fills.

use bun_alloc::Arena;
use bun_ast::{Expr, ImportKind, ImportRecord, Loc, Ref, RefTag, Scope, StoreStr, Symbol, scope, symbol};
use bun_react_compiler::JsxImportKind;

const JSX_IMPORTS: [(JsxImportKind, &[u8]); 5] = [
    (JsxImportKind::Jsx, b"jsx"),
    (JsxImportKind::Jsxs, b"jsxs"),
    (JsxImportKind::JsxDEV, b"jsxDEV"),
    (JsxImportKind::Fragment, b"Fragment"),
    (JsxImportKind::CreateElement, b"createElement"),
];

pub(super) struct Host<'a> {
    arena: &'a Arena,
    source: &'a [u8],
    symbols: Vec<Symbol>,
    module_scope: Scope,
    /// By index in `JSX_IMPORTS`.
    jsx_imports: [Ref; 5],
    /// `__MEMO_CACHE_SENTINEL`, `__EARLY_RETURN_SENTINEL`
    sentinels: [Ref; 2],
    is_jsx_dev: bool,
    is_jsx_classic: bool,
    /// Of the last element the adapter has converted.
    pub(super) classic_factory: Expr,
}

impl<'a> Host<'a> {
    pub(super) fn new(arena: &'a Arena, source: &'a [u8], is_jsx_classic: bool, is_jsx_dev: bool) -> Host<'a> {
        Host {
            arena,
            source,
            symbols: Vec::new(),
            module_scope: Scope { kind: scope::Kind::Entry, ..Scope::EMPTY },
            jsx_imports: [Ref::NONE; 5],
            sentinels: [Ref::NONE; 2],
            is_jsx_dev,
            is_jsx_classic,
            classic_factory: Expr::EMPTY,
        }
    }

    /// `name` outlives the host.
    pub(super) fn new_symbol(&mut self, kind: symbol::Kind, name: &'a [u8]) -> Ref {
        let ref_ = Ref::new(self.symbols.len() as u32, 0, RefTag::Symbol);
        self.symbols.push(Symbol { kind, original_name: StoreStr::new(name), ..Default::default() });
        ref_
    }

    /// Makes the symbol one that the module scope declares.
    pub(super) fn declare_in_module(&mut self, ref_: Ref) {
        let name = self.symbols[ref_.inner_index() as usize].original_name;
        // SAFETY: `new_symbol` was handed a name that outlives the host, and so the scope.
        unsafe { self.module_scope.members.put(name.slice(), scope::Member { ref_, loc: Loc::EMPTY }) };
    }

    fn generate(&mut self, kind: symbol::Kind, name: &[u8]) -> Ref {
        let name: &'a [u8] = self.arena.alloc_slice_copy(name);
        let ref_ = self.new_symbol(kind, name);
        self.module_scope.generated.push(ref_);
        ref_
    }
}

impl bun_react_compiler::Host for Host<'_> {
    fn symbols(&self) -> &[Symbol] {
        &self.symbols
    }

    fn module_scope(&self) -> &Scope {
        &self.module_scope
    }

    fn import_records(&self) -> &[ImportRecord] {
        &[]
    }

    fn source(&self) -> &[u8] {
        self.source
    }

    fn arena(&self) -> &Arena {
        self.arena
    }

    fn ref_name(&self, ref_: Ref) -> &[u8] {
        self.symbols[ref_.inner_index() as usize].original_name.slice()
    }

    fn scope_for_loc(&self, _loc: Loc) -> Option<&Scope> {
        None
    }

    fn jsx_import(&mut self, kind: JsxImportKind) -> Ref {
        let index = JSX_IMPORTS.iter().position(|import| import.0 == kind).unwrap_or_default();
        if !self.jsx_imports[index].is_valid() {
            self.jsx_imports[index] = self.generate(symbol::Kind::Other, JSX_IMPORTS[index].1);
        }
        self.jsx_imports[index]
    }

    fn jsx_import_kind(&self, ref_: Ref) -> Option<JsxImportKind> {
        let index = self.jsx_imports.iter().position(|&import| import.is_valid() && import == ref_)?;
        Some(JSX_IMPORTS[index].0)
    }

    fn is_jsx_dev(&self) -> bool {
        self.is_jsx_dev
    }

    fn is_jsx_classic(&self) -> bool {
        self.is_jsx_classic
    }

    fn jsx_classic_factory(&mut self, loc: Loc) -> Expr {
        Expr { loc, data: self.classic_factory.data }
    }

    fn new_generated(&mut self, name: &[u8]) -> Ref {
        self.generate(symbol::Kind::Other, name)
    }

    fn new_local(&mut self, name: &[u8]) -> Ref {
        let name = self.arena.alloc_slice_copy(name);
        self.new_symbol(symbol::Kind::Other, name)
    }

    fn new_import_item(&mut self, name: &[u8]) -> Ref {
        self.generate(symbol::Kind::Import, name)
    }

    fn runtime_sentinel(&mut self, early: bool) -> Ref {
        let index = usize::from(early);
        if !self.sentinels[index].is_valid() {
            let name: &[u8] = if early { b"__EARLY_RETURN_SENTINEL" } else { b"__MEMO_CACHE_SENTINEL" };
            self.sentinels[index] = self.generate(symbol::Kind::Other, name);
        }
        self.sentinels[index]
    }

    fn record_usage(&mut self, _ref: Ref) {}

    fn add_import_record(&mut self, path: &[u8], _kind: ImportKind) -> (u32, Ref) {
        (0, self.generate(symbol::Kind::Other, path))
    }
}
