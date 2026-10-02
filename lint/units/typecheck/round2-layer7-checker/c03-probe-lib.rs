// Probe root: the real c03_init.rs against the real flags, ids, List, LinkStore and message table, and stand-ins with the signatures of the tree for everything else.
#![deny(warnings)]
#![allow(dead_code)]

#[allow(clippy::disallowed_types)]
pub mod core {
    #[path = "/workspace/wt/typecheck/src/typecheck/core/arena.rs"]
    pub mod arena;
    #[path = "/workspace/wt/typecheck/src/typecheck/core/golang.rs"]
    pub mod golang;
    #[path = "/workspace/wt/typecheck/src/typecheck/core/linkstore.rs"]
    pub mod linkstore;
    #[path = "/workspace/wt/typecheck/src/typecheck/core/tristate.rs"]
    pub mod tristate;
    pub use arena::*;
    pub use golang::*;
    pub use linkstore::*;
    pub use tristate::*;
    use std::collections::HashMap;
    use std::hash::Hash;

    // The contract's Map and Memo (checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs).
    pub struct Map<K, V>(Option<HashMap<K, V>>);
    impl<K, V> Default for Map<K, V> {
        fn default() -> Self {
            Self(None)
        }
    }
    impl<K: Hash + Eq + Copy, V: Copy + Default> Map<K, V> {
        pub fn make() -> Self {
            Self(Some(HashMap::new()))
        }
        pub fn get(&self, key: &K) -> V {
            self.0.as_ref().and_then(|m| m.get(key)).copied().unwrap_or_default()
        }
        #[must_use]
        pub fn set(&mut self, key: K, value: V) -> bool {
            match self.0.as_mut() {
                Some(m) => {
                    m.insert(key, value);
                    true
                }
                None => false,
            }
        }
    }
    #[derive(Default, Clone, Copy, Debug)]
    pub struct Memo<T> {
        pub value: T,
        pub done: bool,
    }
    // core/core.rs 193 and 399
    pub fn find<T: Copy + Default>(slice: &[T], mut f: impl FnMut(T) -> bool) -> T {
        for &value in slice {
            if f(value) {
                return value;
            }
        }
        T::default()
    }
    pub fn if_else<T>(b: bool, when_true: T, when_false: T) -> T {
        if b {
            return when_true;
        }
        when_false
    }
    #[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Debug)]
    pub struct ScriptTarget(pub i32);
    #[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
    pub struct ModuleKind(pub i32);
    #[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
    pub struct ModuleResolutionKind(pub i32);
    // core/compileroptions.rs: the fields and methods that NewChecker reads.
    #[derive(Default)]
    pub struct CompilerOptions {
        pub exact_optional_property_types: Tristate,
        pub experimental_decorators: Tristate,
        pub no_implicit_any: Tristate,
        pub no_implicit_this: Tristate,
        pub strict_bind_call_apply: Tristate,
        pub strict_builtin_iterator_return: Tristate,
        pub strict_function_types: Tristate,
        pub strict_null_checks: Tristate,
        pub strict_property_initialization: Tristate,
        pub use_unknown_in_catch_variables: Tristate,
        pub verbatim_module_syntax: Tristate,
    }
    impl CompilerOptions {
        pub fn get_emit_script_target(&self) -> ScriptTarget {
            ScriptTarget(0)
        }
        pub fn get_emit_module_kind(&self) -> ModuleKind {
            ModuleKind(0)
        }
        pub fn get_module_resolution_kind(&self) -> ModuleResolutionKind {
            ModuleResolutionKind(0)
        }
        pub fn get_strict_option_value(&self, value: Tristate) -> bool {
            value == Tristate::TRUE
        }
        pub fn get_emit_standard_class_fields(&self) -> bool {
            false
        }
    }
    // core/pattern.rs
    #[derive(Clone, Default, PartialEq, Eq, Debug)]
    pub struct Pattern {
        pub text: Vec<u8>,
        pub star_index: isize,
    }
}

#[path = "/workspace/wt/typecheck/src/typecheck/diagnostics/mod.rs"]
pub mod diagnostics;

pub mod ast {
    #[path = "/workspace/wt/typecheck/src/typecheck/ast/checkflags.rs"]
    pub mod checkflags;
    #[path = "/workspace/wt/typecheck/src/typecheck/ast/flags.rs"]
    pub mod flags;
    #[path = "/workspace/wt/typecheck/src/typecheck/ast/ids.rs"]
    pub mod ids;
    #[path = "/workspace/wt/typecheck/src/typecheck/ast/nodeflags.rs"]
    pub mod nodeflags;
    #[path = "/workspace/wt/typecheck/src/typecheck/ast/symbolflags.rs"]
    pub mod symbolflags;
    pub use checkflags::*;
    pub use ids::*;
    pub use nodeflags::*;
    pub use symbolflags::*;
    use crate::core::List;
    use std::marker::PhantomData;

    // ast/diagnostic.rs 7
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum Arg<'a> {
        Str(&'a [u8]),
        Int(i64),
        Bool(bool),
    }
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    pub enum Kind {
        #[default]
        Unknown,
        ClassDeclaration,
        InterfaceDeclaration,
        EnumDeclaration,
        TypeAliasDeclaration,
        ModuleDeclaration,
    }
    // ast/utilities.rs 834
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
    pub struct OuterExpressionKinds(pub u16);
    impl OuterExpressionKinds {
        pub const PARENTHESES: Self = Self(1 << 0);
    }
    // ast/ast.rs 358
    pub struct PatternAmbientModule {
        pub pattern: crate::core::Pattern,
        pub symbol: SymbolId,
    }
    // ast/symbol.rs 19
    #[derive(Clone, Copy, Default, Debug)]
    pub struct Symbol<'a> {
        pub flags: SymbolFlags,
        pub check_flags: CheckFlags,
        pub name: &'a [u8],
        pub declarations: List<'a, NodeId>,
        pub value_declaration: NodeId,
        pub members: SymbolTableId,
        pub exports: SymbolTableId,
        pub parent: SymbolId,
        pub export_symbol: SymbolId,
    }
    pub const INTERNAL_SYMBOL_NAME_EXPORT_STAR: &[u8] = b"\xFEexport";
    pub const INTERNAL_SYMBOL_NAME_TYPE: &[u8] = b"\xFEtype";
    // ast/file.rs 562: the fields that initializeChecker reads.
    #[derive(Clone, Copy)]
    pub struct SourceFile<'a> {
        pub symbol: SymbolId,
        pub locals: SymbolTableId,
        pub module_augmentations: &'a [NodeId],
        pub pattern_ambient_modules: &'a [PatternAmbientModule],
        pub global_exports: SymbolTableId,
    }
    // ast/ast_generated.rs 2954
    #[derive(Clone, Copy, Default, Debug)]
    pub struct ModuleDeclaration {
        pub keyword: Kind,
        pub name: NodeId,
        pub body: NodeId,
        pub symbol: SymbolId,
        pub locals: SymbolTableId,
    }
    #[derive(Clone, Copy)]
    pub struct Ast<'a> {
        marker: PhantomData<&'a ()>,
    }
    #[allow(unused_variables)]
    impl<'a> Ast<'a> {
        pub fn new() -> Self {
            Self {
                marker: PhantomData,
            }
        }
        pub fn sym(self, symbol: SymbolId) -> Symbol<'a> {
            Symbol::default()
        }
        pub fn update_symbol(self, symbol: SymbolId, f: impl FnOnce(&mut Symbol<'a>)) {
            let mut value = Symbol::default();
            f(&mut value);
        }
        pub fn new_table(self) -> SymbolTableId {
            SymbolTableId::NIL
        }
        pub fn table_get(self, table: SymbolTableId, name: &[u8]) -> SymbolId {
            SymbolId::NIL
        }
        pub fn table_len(self, table: SymbolTableId) -> isize {
            0
        }
        pub fn table_entry_at(
            self,
            table: SymbolTableId,
            position: usize,
        ) -> Option<(&'a [u8], SymbolId)> {
            None
        }
        pub fn table_set(self, table: SymbolTableId, name: &'a [u8], symbol: SymbolId) {}
        pub fn as_source_file(self, node: NodeId) -> SourceFile<'a> {
            SourceFile {
                symbol: SymbolId::NIL,
                locals: SymbolTableId::NIL,
                module_augmentations: &[],
                pattern_ambient_modules: &[],
                global_exports: SymbolTableId::NIL,
            }
        }
        pub fn as_module_declaration(self, node: NodeId) -> ModuleDeclaration {
            ModuleDeclaration::default()
        }
        pub fn parent(self, node: NodeId) -> NodeId {
            NodeId::NIL
        }
        pub fn flags(self, node: NodeId) -> NodeFlags {
            NodeFlags::NONE
        }
        pub fn text(self, node: NodeId) -> &'a [u8] {
            b""
        }
        pub fn kind(self, node: NodeId) -> Kind {
            Kind::Unknown
        }
    }
    // ast/utilities.rs 40, 1947, 1955, 1990, 4356; ast_generated.rs 1378; symbol.rs 79
    pub fn get_symbol_table(a: Ast<'_>, data: &mut SymbolTableId) -> SymbolTableId {
        if data.is_nil() {
            *data = a.new_table();
        }
        *data
    }
    pub fn is_ambient_module_symbol_name(s: &[u8]) -> bool {
        s.first() == Some(&b'"')
    }
    pub fn is_external_or_common_js_module(a: Ast<'_>, file: NodeId) -> bool {
        a.kind(file) == Kind::ModuleDeclaration
    }
    pub fn is_global_scope_augmentation(a: Ast<'_>, node: NodeId) -> bool {
        a.kind(node) == Kind::ModuleDeclaration
    }
    pub fn is_type_alias_declaration(a: Ast<'_>, node: NodeId) -> bool {
        a.kind(node) == Kind::TypeAliasDeclaration
    }
    pub fn is_type_declaration(a: Ast<'_>, node: NodeId) -> bool {
        a.kind(node) == Kind::TypeAliasDeclaration
    }
    pub fn symbol_name<'a>(a: Ast<'a>, symbol: SymbolId) -> &'a [u8] {
        a.sym(symbol).name
    }
}

pub mod binder {
    use crate::ast::{Arg, Ast, DiagnosticId, NodeId, SymbolFlags, SymbolId, SymbolTableId};
    use crate::core::{CompilerOptions, Tristate};
    use crate::diagnostics::MessageId;
    // binder/nameresolver.rs 12-41: the fields as they are, and the signature of resolve.
    pub struct NameResolver<'o, H> {
        pub compiler_options: &'o CompilerOptions,
        pub get_symbol_of_declaration: Option<fn(&mut H, NodeId) -> SymbolId>,
        pub error: Option<fn(&mut H, NodeId, MessageId, &[Arg<'_>]) -> DiagnosticId>,
        pub globals: SymbolTableId,
        pub arguments_symbol: SymbolId,
        pub require_symbol: SymbolId,
        pub lookup: Option<fn(&mut H, SymbolTableId, &[u8], SymbolFlags) -> SymbolId>,
        pub symbol_referenced: Option<fn(&mut H, SymbolId, SymbolFlags)>,
        pub set_requires_scope_change_cache: Option<fn(&mut H, NodeId, Tristate)>,
        pub get_requires_scope_change_cache: Option<fn(&mut H, NodeId) -> Tristate>,
        pub on_property_with_invalid_initializer:
            Option<fn(&mut H, NodeId, &[u8], NodeId, SymbolId) -> bool>,
        pub on_failed_to_resolve_symbol: Option<fn(&mut H, NodeId, &[u8], SymbolFlags, MessageId)>,
        pub on_successfully_resolved_symbol:
            Option<fn(&mut H, NodeId, SymbolId, SymbolFlags, NodeId, NodeId, bool)>,
    }
    impl<H> NameResolver<'_, H> {
        #[allow(unused_variables, clippy::too_many_arguments)]
        pub fn resolve(
            &mut self,
            a: Ast<'_>,
            host: &mut H,
            location: NodeId,
            name: &[u8],
            meaning: SymbolFlags,
            name_not_found_message: MessageId,
            is_use: bool,
            exclude_globals: bool,
        ) -> SymbolId {
            match self.lookup {
                Some(lookup) => lookup(host, self.globals, name, meaning),
                None => SymbolId::NIL,
            }
        }
    }
}

pub mod jsnum {
    #[derive(Clone, Copy, PartialEq, PartialOrd, Debug, Default)]
    pub struct Number(pub f64);
    #[derive(Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
    pub struct PseudoBigInt {
        pub negative: bool,
        pub base10_value: Vec<u8>,
    }
}

pub mod evaluator {
    use crate::ast::{Ast, NodeId, OuterExpressionKinds};
    use crate::checker::LiteralValue;
    // evaluator/evaluator.rs 9-57
    #[derive(Clone, Default, PartialEq, Debug)]
    pub struct Result<'a> {
        pub value: LiteralValue<'a>,
        pub is_syntactically_string: bool,
        pub resolved_other_files: bool,
        pub has_external_references: bool,
    }
    #[derive(Clone, Copy, Debug)]
    pub struct Evaluator {
        outer_expressions_to_skip: OuterExpressionKinds,
    }
    pub fn new_evaluator(outer_expressions_to_skip: OuterExpressionKinds) -> Evaluator {
        Evaluator {
            outer_expressions_to_skip,
        }
    }
    impl Evaluator {
        pub fn evaluate<'a>(
            self,
            a: Ast<'a>,
            expr: NodeId,
            location: NodeId,
            evaluate_entity: &mut dyn FnMut(NodeId, NodeId) -> Result<'a>,
        ) -> Result<'a> {
            let _ = a;
            evaluate_entity(expr, location)
        }
    }
}

pub mod checker {
    #[path = "/workspace/wt/typecheck/src/typecheck/checker/c03_init.rs"]
    pub mod c03_init;
    #[path = "@WORK@/checker_stubs.rs"]
    pub mod stubs;
    pub use c03_init::*;
    pub use stubs::*;
}
