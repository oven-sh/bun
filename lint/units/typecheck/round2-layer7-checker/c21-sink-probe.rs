//! Probe of checker/c21_resolved_symbols_diagnostics.rs: the file of the tree, by #[path], beside stand-ins for what it names.
//! Real files by #[path]: diagnostics/, core/{arena,golang,linkstore,text,tristate,tristate_stringer_generated}.rs, ast/{diagnostic,ids}.rs. Stand-ins: the rest of `ast`, `core` and `checker` with the shapes of the tree of f49ea57437, and `SourceFiles`, `Diagnostics`, `DiagnosticsCollection` with the signatures of checker-data-model-contract/bottom-up/crate/src/ast_diagnostic.rs.
//! Run: rustc --edition 2024 --crate-type lib --emit=metadata -o /tmp/c21-sink-probe.rmeta c21-sink-probe.rs
//! The test of the end runs the deferred callbacks and the serialization limit of the real file over the stand-ins: rustc --edition 2024 --test -o /tmp/c21-sink-probe-test c21-sink-probe.rs && /tmp/c21-sink-probe-test
#![allow(dead_code)]
#![deny(warnings)]
#![deny(unused_imports, unused_variables, unused_mut, unreachable_pub, unused_assignments)]

#[path = "/workspace/wt/typecheck/src/typecheck/diagnostics/mod.rs"]
pub mod diagnostics;

pub mod core {
    #[path = "/workspace/wt/typecheck/src/typecheck/core/arena.rs"]
    pub mod arena;
    #[path = "/workspace/wt/typecheck/src/typecheck/core/golang.rs"]
    pub mod golang;
    #[path = "/workspace/wt/typecheck/src/typecheck/core/linkstore.rs"]
    pub mod linkstore;
    #[path = "/workspace/wt/typecheck/src/typecheck/core/text.rs"]
    pub mod text;
    #[path = "/workspace/wt/typecheck/src/typecheck/core/tristate.rs"]
    pub mod tristate;
    #[path = "/workspace/wt/typecheck/src/typecheck/core/tristate_stringer_generated.rs"]
    pub mod tristate_stringer_generated;
    pub use golang::*;
    pub use linkstore::*;
    pub use text::*;
    pub use tristate::*;

    pub fn some<T: Copy>(slice: &[T], mut f: impl FnMut(T) -> bool) -> bool {
        for &value in slice {
            if f(value) {
                return true;
            }
        }
        false
    }
    pub fn every<T: Copy>(slice: &[T], mut f: impl FnMut(T) -> bool) -> bool {
        for &value in slice {
            if !f(value) {
                return false;
            }
        }
        true
    }
    pub fn if_else<T>(b: bool, when_true: T, when_false: T) -> T {
        if b {
            return when_true;
        }
        when_false
    }
    pub fn or_else<T: Default + PartialEq>(value: T, default_value: T) -> T {
        if value != T::default() {
            return value;
        }
        default_value
    }
    #[derive(Default)]
    pub struct CompilerOptions {
        pub no_unused_locals: Tristate,
        pub no_unused_parameters: Tristate,
    }
    impl CompilerOptions {
        pub fn uses_wildcard_types(&self) -> bool {
            false
        }
    }
}

pub mod tspath {
    #[derive(Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
    pub struct Path(pub Vec<u8>);
}

pub mod ast {
    #[path = "/workspace/wt/typecheck/src/typecheck/ast/diagnostic.rs"]
    pub mod diagnostic;
    #[path = "/workspace/wt/typecheck/src/typecheck/ast/ids.rs"]
    pub mod ids;
    pub use diagnostic::*;
    pub use ids::*;

    use crate::core::{List, TextPos};
    use crate::tspath::Path;

    // The contract: checker-data-model-contract/bottom-up/crate/src/ast_diagnostic.rs 11-16, 363-373, 611-723 (signatures).
    pub trait SourceFiles {
        fn file_name(&self, file: NodeId) -> &[u8];
        fn path(&self, file: NodeId) -> &[u8];
        fn text(&self, file: NodeId) -> &[u8];
        fn ecma_line_map(&self, file: NodeId) -> &[i32];
    }
    pub struct Diagnostics<'a, F: ?Sized> {
        pub store: &'a DiagnosticStore,
        pub files: &'a F,
    }
    impl<F: ?Sized> Clone for Diagnostics<'_, F> {
        fn clone(&self) -> Self {
            *self
        }
    }
    impl<F: ?Sized> Copy for Diagnostics<'_, F> {}
    impl<'a, F: SourceFiles + ?Sized> Diagnostics<'a, F> {
        pub fn compare_diagnostics(&self, d1: DiagnosticId, d2: DiagnosticId) -> isize {
            let a = self.files.file_name(self.store[d1].file());
            let b = self.files.file_name(self.store[d2].file());
            a.len() as isize - b.len() as isize
        }
    }
    #[derive(Default)]
    pub struct DiagnosticsCollection {
        list: Vec<DiagnosticId>,
    }
    impl DiagnosticsCollection {
        pub fn add<F: SourceFiles + ?Sized>(
            &mut self,
            d: Diagnostics<'_, F>,
            diagnostic: DiagnosticId,
        ) -> DiagnosticId {
            let _ = d.files.file_name(d.store[diagnostic].file());
            self.list.push(diagnostic);
            diagnostic
        }
        pub fn get_global_diagnostics<F: SourceFiles + ?Sized>(
            &mut self,
            d: Diagnostics<'_, F>,
        ) -> Vec<DiagnosticId> {
            let _ = d;
            self.list.clone()
        }
        pub fn get_diagnostics_for_file<F: SourceFiles + ?Sized>(
            &mut self,
            d: Diagnostics<'_, F>,
            file: NodeId,
        ) -> Vec<DiagnosticId> {
            let _ = (d, file);
            self.list.clone()
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub enum Kind {
        #[default]
        Unknown,
        ShorthandPropertyAssignment,
    }
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub struct SymbolFlags(pub u32);
    impl SymbolFlags {
        pub const VALUE: Self = Self(1);
        pub const EXPORT_VALUE: Self = Self(2);
        pub const ALIAS: Self = Self(4);
        pub const INTERFACE: Self = Self(64);
        pub const fn intersects(self, other: Self) -> bool {
            self.0 & other.0 != 0
        }
    }
    impl std::ops::BitOr for SymbolFlags {
        type Output = Self;
        fn bitor(self, rhs: Self) -> Self {
            Self(self.0 | rhs.0)
        }
    }
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub struct NodeFlags(pub u32);

    #[derive(Clone, Copy, Default, Debug)]
    pub struct Symbol<'a> {
        pub flags: SymbolFlags,
        pub name: &'a [u8],
        pub declarations: List<'a, NodeId>,
        pub value_declaration: NodeId,
        pub parent: SymbolId,
    }
    #[derive(Default, Debug)]
    pub struct SourceFileData {
        pub file_name: Vec<u8>,
        pub path: Path,
        pub diagnostics: Vec<DiagnosticId>,
        pub root: NodeId,
    }
    #[derive(Default)]
    pub struct File {
        pub source_file: SourceFileData,
        text: Vec<u8>,
        line_map: Vec<TextPos>,
    }
    impl File {
        pub fn source_text(&self) -> &[u8] {
            &self.text
        }
        pub fn ecma_line_map(&self) -> &[TextPos] {
            &self.line_map
        }
    }
    #[derive(Clone, Copy)]
    pub struct SourceFile<'a> {
        pub(crate) file: Option<&'a File>,
    }
    impl<'a> SourceFile<'a> {
        pub fn diagnostics(self) -> &'a [DiagnosticId] {
            match self.file {
                Some(file) => &file.source_file.diagnostics,
                None => &[],
            }
        }
    }
    #[derive(Clone, Copy)]
    pub struct Ast<'a> {
        pub(crate) files: &'a [&'a File],
    }
    impl<'a> Ast<'a> {
        pub fn text(self, _node: NodeId) -> &'a [u8] {
            b""
        }
        pub fn parent(self, _node: NodeId) -> NodeId {
            NodeId::NIL
        }
        pub fn kind(self, _node: NodeId) -> Kind {
            Kind::Unknown
        }
        pub fn sym(self, _symbol: SymbolId) -> Symbol<'a> {
            Symbol::default()
        }
        pub fn as_source_file(self, node: NodeId) -> SourceFile<'a> {
            SourceFile {
                file: self.file_of(node),
            }
        }
        pub fn file_of(self, node: NodeId) -> Option<&'a File> {
            self.files.get(node.0 as usize).copied()
        }
    }
    pub fn get_jsdoc_deprecated_tag(_a: Ast<'_>, _node: NodeId) -> NodeId {
        NodeId::NIL
    }
    pub fn is_call_expression(_a: Ast<'_>, _node: NodeId) -> bool {
        false
    }
    pub fn is_deprecated_declaration_with_cached_flags(
        _a: Ast<'_>,
        _declaration: NodeId,
        _combined_flags: NodeFlags,
    ) -> bool {
        false
    }
    pub fn is_write_only_access(_a: Ast<'_>, _node: NodeId) -> bool {
        false
    }
    pub fn node_is_missing(_a: Ast<'_>, _node: NodeId) -> bool {
        false
    }
    pub fn is_type_declaration(_a: Ast<'_>, _node: NodeId) -> bool {
        false
    }
}

pub mod checker {
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c21_resolved_symbols_diagnostics.rs"]
    pub mod c21_resolved_symbols_diagnostics;
    pub use c21_resolved_symbols_diagnostics::*;

    use crate::ast::{
        Arg, Ast, DiagnosticId, DiagnosticStore, Diagnostics, DiagnosticsCollection, NodeFlags,
        NodeId, SymbolFlags, SymbolId, is_type_declaration,
    };
    use crate::core::{CompilerOptions, LinkStore, TextRange};
    use crate::diagnostics::{self, MessageId};

    pub const MAX_SERIALIZATION_LEVEL: isize = 2;
    pub type DeferredDiagnosticCallback<'a> = Box<dyn FnOnce(&mut Checker<'a>) + 'a>;

    #[derive(Default)]
    pub struct SymbolNodeLinks {
        pub resolved_symbol: SymbolId,
    }

    pub struct Checker<'a> {
        pub ast: Ast<'a>,
        pub compiler_options: &'a CompilerOptions,
        pub diagnostic_store: DiagnosticStore,
        pub diagnostics: DiagnosticsCollection,
        pub suggestion_diagnostics: DiagnosticsCollection,
        pub serialization_level: isize,
        pub was_canceled: bool,
        pub unknown_symbol: SymbolId,
        pub symbol_node_links: LinkStore<NodeId, SymbolNodeLinks>,
        pub deferred_diagnostic_callbacks: Vec<DeferredDiagnosticCallback<'a>>,
        pub last_get_combined_node_flags_node: NodeId,
        pub last_get_combined_node_flags_result: NodeFlags,
    }

    // The hook of binder/nameresolver.rs 15.
    pub struct NameResolver<H> {
        pub error: Option<fn(&mut H, NodeId, MessageId, &[Arg<'_>]) -> DiagnosticId>,
    }

    // checker/c22_symbols_merge.rs 13-20, as it is in the tree.
    fn compare_diagnostics(c: &Checker<'_>, d1: DiagnosticId, d2: DiagnosticId) -> isize {
        let files = ProgramFiles { ast: c.ast };
        let view = Diagnostics {
            store: &c.diagnostic_store,
            files: &files,
        };
        view.compare_diagnostics(d1, d2)
    }

    impl<'a> Checker<'a> {
        pub fn resolve_name(
            &mut self,
            _location: NodeId,
            _name: &[u8],
            _meaning: SymbolFlags,
            _name_not_found_message: MessageId,
            _is_use: bool,
            _exclude_globals: bool,
        ) -> SymbolId {
            SymbolId::NIL
        }
        pub fn new_diagnostic_for_node(
            &mut self,
            _node: NodeId,
            message: MessageId,
            args: &[Arg<'_>],
        ) -> DiagnosticId {
            self.diagnostic_store
                .new_diagnostic(NodeId::NIL, TextRange::default(), message, args)
        }
        pub fn create_diagnostic_for_node(
            &mut self,
            node: NodeId,
            message: MessageId,
            args: &[Arg<'_>],
        ) -> DiagnosticId {
            self.new_diagnostic_for_node(node, message, args)
        }
        pub fn check_not_canceled(&self) {}
        pub fn check_source_file(&mut self, _source_file: NodeId, _check_unused: bool) {}
        pub fn get_combined_node_flags_cached(&mut self, node: NodeId) -> NodeFlags {
            self.last_get_combined_node_flags_node = node;
            self.last_get_combined_node_flags_result
        }
        pub fn get_parent_of_symbol(&mut self, symbol: SymbolId) -> SymbolId {
            self.ast.sym(symbol).parent
        }

        // The shapes of the callers in the tree.
        pub fn callers(&mut self, node: NodeId, symbol: SymbolId) -> isize {
            let a = self.ast;
            let resolver: NameResolver<Checker<'a>> = NameResolver {
                error: Some(Checker::error),
            };
            let _ = resolver.error;
            let type_name: Vec<u8> = b"T".to_vec();
            let error = self.error(node, diagnostics::CANNOT_FIND_NAME_0, &[Arg::Str(&type_name)]);
            let diag = self.add_diagnostic(error);
            self.error_or_suggestion(true, node, diagnostics::UNUSED_LABEL, &[]);
            let awaited = self.error_and_maybe_suggest_await(
                node,
                true,
                diagnostics::CANNOT_FIND_NAME_0,
                &[Arg::Str(&type_name)],
            );
            self.error_skipped_on_no_emit(node, diagnostics::CANNOT_FIND_NAME_0, &[]);
            self.add_error_or_suggestion(false, awaited);
            let suggestion = self.diagnostic_store.clone_diagnostic(diag);
            self.add_suggestion_diagnostic(suggestion);
            let declarations = a.sym(symbol).declarations;
            if declarations.as_slice().iter().any(|&declaration| {
                is_type_declaration(a, declaration) && self.is_deprecated_declaration(declaration)
            }) {
                self.add_deprecated_suggestion(node, declarations, a.sym(symbol).name);
            }
            if self.is_deprecated_symbol(symbol) && a.sym(symbol).declarations.len() != 0 {
                self.add_deprecated_suggestion(
                    node,
                    a.sym(symbol).declarations,
                    a.sym(symbol).name,
                );
            }
            let local = [node];
            self.add_deprecated_suggestion_worker(crate::core::List::from_slice(&local), diag);
            let diags: Vec<DiagnosticId> = vec![diag];
            self.add_deferred_diagnostic(Box::new(move |c: &mut Checker<'a>| {
                let diagnostic = c.error(node, diagnostics::CANNOT_FIND_NAME_0, &[]);
                for &d in &diags {
                    c.diagnostic_store.add_related_info(diagnostic, d);
                }
            }));
            self.produce_deferred_diagnostics();
            if !self.has_parse_diagnostics(node) {
                let _ = self.get_diagnostics_exported(node);
                let _ = self.get_suggestion_diagnostics(node);
                let _ = self.get_global_diagnostics();
            }
            let _ = self.get_resolved_symbol(node);
            let _ = self.get_resolved_symbol_or_nil(node);
            let _ = self.get_referenced_value_or_alias_symbol(node);
            compare_diagnostics(self, diag, awaited)
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::{
        Arg, Ast, DiagnosticId, DiagnosticStore, DiagnosticsCollection, File, NodeFlags, NodeId, SourceFiles, SymbolId,
    };
    use crate::checker::{Checker, MAX_SERIALIZATION_LEVEL, ProgramFiles};
    use crate::tspath::Path;
    use crate::core::{CompilerOptions, LinkStore};
    use crate::diagnostics;

    fn codes(c: &Checker<'_>, ids: &[DiagnosticId]) -> Vec<i32> {
        ids.iter().map(|d| c.diagnostic_store[*d].code()).collect()
    }

    // checker-data-model-contract/bottom-up/crate/src/tests.rs 985, without what needs the collection of the contract (the same diagnostic twice is kept once).
    #[test]
    fn deferred_diagnostics_run_once_in_order() {
        let options = CompilerOptions::default();
        // The stand-in context finds the file of a node by the number of the node: node 1 is the root of `file`, node 2 a node of it.
        let none = File::default();
        let mut file = File::default();
        file.source_file.root = NodeId(1);
        file.source_file.file_name = b"a.ts".to_vec();
        file.source_file.path = Path(b"/a.ts".to_vec());
        file.source_file.diagnostics = vec![DiagnosticId(1)];
        let files = [&none, &file, &file];
        let ast = Ast { files: &files };
        let program_files = ProgramFiles { ast };
        assert_eq!(program_files.file_name(NodeId(1)), b"a.ts");
        assert_eq!(program_files.path(NodeId(1)), b"/a.ts");
        assert_eq!(program_files.text(NodeId(1)), b"");
        assert!(program_files.ecma_line_map(NodeId(1)).is_empty());
        assert_eq!(program_files.file_name(NodeId(2)), b"");
        assert_eq!(program_files.file_name(NodeId(9)), b"");
        let mut c = Checker {
            ast,
            compiler_options: &options,
            diagnostic_store: DiagnosticStore::default(),
            diagnostics: DiagnosticsCollection::default(),
            suggestion_diagnostics: DiagnosticsCollection::default(),
            serialization_level: 0,
            was_canceled: false,
            unknown_symbol: SymbolId::NIL,
            symbol_node_links: LinkStore::default(),
            deferred_diagnostic_callbacks: Vec::new(),
            last_get_combined_node_flags_node: NodeId::NIL,
            last_get_combined_node_flags_result: NodeFlags::default(),
        };
        let (n1, n2, n3) = (NodeId(1), NodeId(2), NodeId(3));
        c.add_deferred_diagnostic(Box::new(move |c| {
            c.error(
                n1,
                diagnostics::X_0_IS_DECLARED_BUT_ITS_VALUE_IS_NEVER_READ,
                &[Arg::Str(b"x")],
            );
            c.add_deferred_diagnostic(Box::new(move |c| {
                c.error(n3, diagnostics::X_0_IS_DEPRECATED, &[]);
            }));
        }));
        c.add_deferred_diagnostic(Box::new(move |c| {
            c.error(n2, diagnostics::X_0_IS_DEPRECATED, &[Arg::Str(b"y")]);
        }));
        c.produce_deferred_diagnostics();
        // The two callbacks ran in the order they were added; the one that the first added did not run and is dropped.
        let kept = c.get_global_diagnostics();
        assert_eq!(codes(&c, &kept), [6133, 6385]);
        assert!(c.deferred_diagnostic_callbacks.is_empty());
        c.produce_deferred_diagnostics();
        assert_eq!(c.get_global_diagnostics().len(), 2);
        // A diagnostic made at the serialization limit is not added, and error answers its id.
        c.serialization_level = MAX_SERIALIZATION_LEVEL;
        let dropped = c.error(n1, diagnostics::X_0_IS_DEPRECATED, &[]);
        assert!(!dropped.is_nil());
        assert_eq!(c.get_global_diagnostics().len(), 2);
        let dropped = c.add_suggestion_diagnostic(dropped);
        assert!(!dropped.is_nil());
        c.serialization_level = 0;
        // A suggestion is a copy with the category of a suggestion, in the other collection; the error keeps its category.
        let unused = c.error(n2, diagnostics::UNUSED_LABEL, &[]);
        c.add_error_or_suggestion(false, unused);
        assert_eq!(c.get_global_diagnostics().len(), 3);
        let suggestions = c.get_suggestion_diagnostics(NodeId::NIL);
        assert_eq!(codes(&c, &suggestions), [7028]);
        let suggestion = suggestions.first().copied().unwrap_or_default();
        assert_ne!(suggestion, unused);
        assert_eq!(
            c.diagnostic_store[suggestion].category(),
            diagnostics::Category::Suggestion
        );
        assert_eq!(
            c.diagnostic_store[unused].category(),
            diagnostics::UNUSED_LABEL.category()
        );
        // errorAndMaybeSuggestAwait adds one related diagnostic, errorSkippedOnNoEmit sets the flag.
        let awaited = c.error_and_maybe_suggest_await(n1, true, diagnostics::CANNOT_FIND_NAME_0, &[Arg::Str(b"a")]);
        let related = c.diagnostic_store[awaited].related_information().to_vec();
        assert_eq!(codes(&c, &related), [diagnostics::DID_YOU_FORGET_TO_USE_AWAIT.code()]);
        let plain = c.error_and_maybe_suggest_await(n1, false, diagnostics::CANNOT_FIND_NAME_0, &[Arg::Str(b"b")]);
        assert!(c.diagnostic_store[plain].related_information().is_empty());
        let skipped = c.error_skipped_on_no_emit(n1, diagnostics::CANNOT_FIND_NAME_0, &[Arg::Str(b"c")]);
        assert!(c.diagnostic_store[skipped].skipped_on_no_emit());
        assert!(!c.diagnostic_store[plain].skipped_on_no_emit());
        // A deprecation suggestion goes to the suggestions with the name as its argument.
        let deprecated = c.add_deprecated_suggestion(n1, crate::core::List::from_slice(&[n2]), b"old");
        assert_eq!(c.diagnostic_store[deprecated].code(), 6385);
        assert_eq!(c.diagnostic_store[deprecated].message_args(), [b"old".to_vec().into_boxed_slice()]);
        assert_eq!(c.get_suggestion_diagnostics(NodeId::NIL).len(), 2);
        // The nil symbol and a symbol without declarations are not deprecated.
        assert!(!c.is_deprecated_symbol(SymbolId::NIL));
        assert!(!c.is_deprecated_declaration(n1));
        // errorOrSuggestion makes the diagnostic and hands it to one of the two collections.
        let (errors, suggestions) = (c.get_diagnostics_exported(n1).len(), c.get_suggestion_diagnostics(n1).len());
        c.error_or_suggestion(true, n1, diagnostics::CANNOT_FIND_NAME_0, &[Arg::Str(b"d")]);
        c.error_or_suggestion(false, n1, diagnostics::CANNOT_FIND_NAME_0, &[Arg::Str(b"e")]);
        assert_eq!(c.get_diagnostics_exported(n1).len(), errors + 1);
        assert_eq!(c.get_suggestion_diagnostics(n1).len(), suggestions + 1);
        // A canceled check answers no diagnostics.
        c.was_canceled = true;
        assert!(c.get_diagnostics_exported(n1).is_empty());
        c.was_canceled = false;
        assert!(c.has_parse_diagnostics(n1));
        assert!(!c.has_parse_diagnostics(NodeId(0)));
    }
}
