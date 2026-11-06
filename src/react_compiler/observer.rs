//! Lets the caller of the parser see each compiled function.
//!
//! The parser splices the compiler's output into its own AST. A caller that keeps a different tree for the same file
//! wraps the parse in [`observe`] and copies each function out before the parser minifies it.

use crate::diagnostics::CompilerError;
use crate::program::{Host, JsxImportKind};
use bun_alloc::Arena;
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{E, Expr, G, ImportKind, ImportRecord, Loc, Ref, Scope, Stmt, Symbol, flags};
use rustc_hash::FxHashMap;
use std::cell::Cell;
use std::ptr::NonNull;

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum SymbolOrigin {
    /// Declared in the file outside the function, or a global.
    Source,
    /// `namespace.name`, which the parser rewrote to a synthetic import.
    NamespaceMember(Ref),
    Local,
    Outlined,
    JsxImport(JsxImportKind),
    MemoCacheSentinel,
    EarlyReturnSentinel,
    ImportItem,
    ImportNamespace,
}

pub struct ObservedSymbol<'a> {
    pub reference: Ref,
    pub name: &'a [u8],
    pub origin: SymbolOrigin,
}

pub struct CompiledFunction<'a> {
    /// The `(` of a function. For an arrow function: the `{` of a block body, or the `=>` of an expression body.
    pub parameters_loc: Loc,
    pub parameters: &'a [G::Arg],
    pub flags: flags::FunctionSet,
    pub body: &'a [Stmt],
    /// One `S::Function` per function outlined from this one.
    pub outlined: &'a [Stmt],
    /// Every symbol referenced by `parameters`, `body` and `outlined`.
    pub symbols: &'a [ObservedSymbol<'a>],
    pub import_records: &'a [ImportRecord<'a>],
}

pub struct AddedImport<'a> {
    pub path: &'a [u8],
    pub imported: &'a [u8],
    pub local: Ref,
}

pub trait Observer {
    fn function_compiled(&mut self, function: &CompiledFunction<'_>);
    /// Called once, after the last function.
    fn imports_added(&mut self, imports: &[AddedImport<'_>]);
    fn compilation_failed(&mut self, error: &CompilerError);
}

pub(crate) struct Observation<'o> {
    observer: &'o mut dyn Observer,
    /// Symbols the compiler created through the host. Later functions in the file can reference them too.
    origins: FxHashMap<Ref, SymbolOrigin>,
    import_paths: Vec<(u32, Box<[u8]>)>,
}

thread_local! {
    static CURRENT: Cell<Option<NonNull<Observation<'static>>>> = const { Cell::new(None) };
}

/// Reports everything the compiler does on this thread to `observer` until `parse` returns.
pub fn observe<R>(observer: &mut dyn Observer, parse: impl FnOnce() -> R) -> R {
    struct Restore(Option<NonNull<Observation<'static>>>);
    impl Drop for Restore {
        fn drop(&mut self) {
            CURRENT.set(self.0);
        }
    }
    let mut observation = Observation {
        observer,
        origins: FxHashMap::default(),
        import_paths: Vec::new(),
    };
    let _restore = Restore(CURRENT.replace(Some(NonNull::from(&mut observation).cast())));
    parse()
}

/// Clears `CURRENT` while `then` runs, so only one reference to the observation exists at a time.
pub(crate) fn with_observation<R>(then: impl FnOnce(Option<&mut Observation<'_>>) -> R) -> R {
    let Some(mut current) = CURRENT.take() else {
        return then(None);
    };
    // SAFETY: `observe` keeps the observation alive until it restores `CURRENT`. `CURRENT` is empty while this
    // reference lives, so it is unique.
    let result = then(Some(unsafe { current.as_mut() }));
    CURRENT.set(Some(current));
    result
}

impl Observation<'_> {
    pub(crate) fn record<'h>(&'h mut self, host: &'h mut dyn Host) -> RecordingHost<'h> {
        RecordingHost {
            host,
            origins: &mut self.origins,
            import_paths: &mut self.import_paths,
            referenced: Vec::new(),
        }
    }

    pub(crate) fn report_function(
        &mut self,
        host: &dyn Host,
        mut referenced: Vec<Ref>,
        function: &CompiledFunction<'_>,
    ) {
        referenced.sort_unstable_by_key(|reference| reference.inner_index());
        referenced.dedup();
        let origins: Vec<SymbolOrigin> = (referenced.iter())
            .map(|&reference| self.origin_of(host, reference))
            .collect();
        let mut symbols: Vec<ObservedSymbol<'_>> = Vec::with_capacity(referenced.len());
        for (&reference, &origin) in referenced.iter().zip(&origins) {
            symbols.push(ObservedSymbol {
                reference,
                name: host.ref_name(reference),
                origin,
            });
            if let SymbolOrigin::NamespaceMember(namespace) = origin
                && !referenced.contains(&namespace)
                && !symbols.iter().any(|known| known.reference == namespace)
            {
                symbols.push(ObservedSymbol {
                    reference: namespace,
                    name: host.ref_name(namespace),
                    origin: SymbolOrigin::Source,
                });
            }
        }
        self.observer.function_compiled(&CompiledFunction {
            symbols: &symbols,
            import_records: host.import_records(),
            ..*function
        });
    }

    fn origin_of(&self, host: &dyn Host, reference: Ref) -> SymbolOrigin {
        if let Some(&origin) = self.origins.get(&reference) {
            return origin;
        }
        if let Some(kind) = host.jsx_import_kind(reference) {
            return SymbolOrigin::JsxImport(kind);
        }
        // The parser also lists `a` of `import { a }` and of `const { a } = require()` under a namespace, one that has
        // no name in the source.
        if host.is_module_level(reference) {
            return SymbolOrigin::Source;
        }
        match host.namespace_of_import_item(reference) {
            Some(namespace) if host.is_module_level(namespace) => {
                SymbolOrigin::NamespaceMember(namespace)
            }
            _ => SymbolOrigin::Source,
        }
    }

    pub(crate) fn report_imports(&mut self, statements: &[Stmt]) {
        let mut imports = Vec::new();
        for statement in statements {
            let StmtData::SImport(import) = &statement.data else {
                continue;
            };
            let index = import.import_record_index;
            let Some((_, path)) = self.import_paths.iter().find(|added| added.0 == index) else {
                continue;
            };
            imports.extend(import.items.slice().iter().map(|item| AddedImport {
                path,
                imported: item.alias.slice(),
                local: item.name.ref_,
            }));
        }
        self.observer.imports_added(&imports);
    }

    pub(crate) fn report_failure(&mut self, error: &CompilerError) {
        self.observer.compilation_failed(error);
    }
}

/// Forwards to the parser's host and records which symbols the compiler creates and references.
pub(crate) struct RecordingHost<'h> {
    host: &'h mut dyn Host,
    origins: &'h mut FxHashMap<Ref, SymbolOrigin>,
    import_paths: &'h mut Vec<(u32, Box<[u8]>)>,
    referenced: Vec<Ref>,
}

impl RecordingHost<'_> {
    pub(crate) fn into_referenced(self) -> Vec<Ref> {
        self.referenced
    }

    fn add(&mut self, reference: Ref, origin: SymbolOrigin) -> Ref {
        self.origins.insert(reference, origin);
        self.referenced.push(reference);
        reference
    }
}

impl Host for RecordingHost<'_> {
    fn symbols(&self) -> &[Symbol] {
        self.host.symbols()
    }
    fn module_scope(&self) -> &Scope {
        self.host.module_scope()
    }
    fn import_records(&self) -> &[ImportRecord<'_>] {
        self.host.import_records()
    }
    fn type_casts(&self) -> &[(Loc, Loc)] {
        self.host.type_casts()
    }
    fn targets_with_defaults(&self) -> &[(Loc, Loc)] {
        self.host.targets_with_defaults()
    }
    fn parentheses(&self) -> &[(Loc, Loc)] {
        self.host.parentheses()
    }
    fn namespace_of_import_item(&self, item: Ref) -> Option<Ref> {
        self.host.namespace_of_import_item(item)
    }
    fn is_module_level(&self, ref_: Ref) -> bool {
        self.host.is_module_level(ref_)
    }
    fn source(&self) -> &[u8] {
        self.host.source()
    }
    fn arena(&self) -> &Arena {
        self.host.arena()
    }
    fn ref_name(&self, ref_: Ref) -> &[u8] {
        self.host.ref_name(ref_)
    }
    fn scope_for_loc(&self, loc: Loc) -> Option<&Scope> {
        self.host.scope_for_loc(loc)
    }
    fn jsx_import(&mut self, kind: JsxImportKind) -> Ref {
        let reference = self.host.jsx_import(kind);
        self.add(reference, SymbolOrigin::JsxImport(kind))
    }
    fn jsx_import_kind(&self, ref_: Ref) -> Option<JsxImportKind> {
        self.host.jsx_import_kind(ref_)
    }
    fn is_jsx_dev(&self) -> bool {
        self.host.is_jsx_dev()
    }
    fn is_jsx_classic(&self) -> bool {
        self.host.is_jsx_classic()
    }
    fn jsx_classic_factory(&mut self, loc: Loc) -> Expr {
        let factory = self.host.jsx_classic_factory(loc);
        let mut root = &factory;
        while let ExprData::EDot(member) = &root.data {
            root = &member.target;
        }
        if let ExprData::EIdentifier(E::Identifier { ref_ })
        | ExprData::EImportIdentifier(E::ImportIdentifier { ref_ }) = &root.data
        {
            self.referenced.push(*ref_);
        }
        factory
    }
    fn new_generated(&mut self, name: &[u8]) -> Ref {
        let reference = self.host.new_generated(name);
        self.add(reference, SymbolOrigin::Outlined)
    }
    fn new_local(&mut self, name: &[u8]) -> Ref {
        let reference = self.host.new_local(name);
        self.add(reference, SymbolOrigin::Local)
    }
    fn new_import_item(&mut self, name: &[u8]) -> Ref {
        let reference = self.host.new_import_item(name);
        self.add(reference, SymbolOrigin::ImportItem)
    }
    fn runtime_sentinel(&mut self, early: bool) -> Ref {
        let reference = self.host.runtime_sentinel(early);
        self.add(
            reference,
            match early {
                true => SymbolOrigin::EarlyReturnSentinel,
                false => SymbolOrigin::MemoCacheSentinel,
            },
        )
    }
    fn global_ref(&mut self, name: &[u8]) -> Ref {
        let reference = self.host.global_ref(name);
        self.referenced.push(reference);
        reference
    }
    fn record_usage(&mut self, ref_: Ref) {
        self.referenced.push(ref_);
        self.host.record_usage(ref_);
    }
    fn add_import_record(&mut self, path: &[u8], kind: ImportKind) -> (u32, Ref) {
        let (index, namespace) = self.host.add_import_record(path, kind);
        self.import_paths.push((index, path.into()));
        (index, self.add(namespace, SymbolOrigin::ImportNamespace))
    }
}
