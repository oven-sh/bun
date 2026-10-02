//! Probe of checker/c20_object_literals_spread.rs: the file of the tree, by #[path], beside stand-ins for what it names. Written by c20-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: diagnostics/, core/{arena,golang,linkstore,text,tristate,tristate_stringer_generated}.rs, collections/{set,ordered_map,ordered_set}.rs, jsnum/jsnum.rs, ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,kind_generated,diagnostic}.rs, checker/types.rs.
//! Run: rustc --edition 2024 --crate-type lib --emit=metadata -o /tmp/c20-probe.rmeta c20-probe.rs
#![allow(dead_code)]
#![allow(clippy::empty_loop)]
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

// checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs 223-268: `map[K]V` that nothing ranges over.
pub struct Map<K, V>(Option<std::collections::BTreeMap<K, V>>);
impl<K, V> Default for Map<K, V> {
    fn default() -> Self {
        Self(None)
    }
}
impl<K: Ord + Copy, V: Copy + Default> Map<K, V> {
    pub fn make() -> Self {
        Self(Some(std::collections::BTreeMap::new()))
    }
    pub fn is_nil(&self) -> bool {
        self.0.is_none()
    }
    pub fn get(&self, key: &K) -> V {
        self.get_ok(key).unwrap_or_default()
    }
    pub fn get_ok(&self, key: &K) -> Option<V> {
        self.0.as_ref().and_then(|m| m.get(key)).copied()
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

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Debug)]
pub struct ScriptTarget(pub i32);
impl ScriptTarget {
    pub const ES2016: Self = Self(3);
    pub const ES2017: Self = Self(4);
    pub const ES2018: Self = Self(5);
    pub const ES2019: Self = Self(6);
    pub const ES2020: Self = Self(7);
    pub const ES2021: Self = Self(8);
    pub const ES2022: Self = Self(9);
    pub const ES_NEXT: Self = Self(99);
}

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
// core/core.rs
pub fn some<T: Copy>(slice: &[T], f: impl FnMut(T) -> bool) -> bool {
    loop {}
}
// core/core.rs
pub fn every<T: Copy>(slice: &[T], f: impl FnMut(T) -> bool) -> bool {
    loop {}
}
// core/core.rs
pub fn find<T: Copy + Default>(slice: &[T], f: impl FnMut(T) -> bool) -> T {
    loop {}
}
// core/core.rs
pub fn find_index<T: Copy>(slice: &[T], f: impl FnMut(T) -> bool) -> isize {
    loop {}
}
// core/core.rs
pub fn if_else<T>(b: bool, when_true: T, when_false: T) -> T {
    loop {}
}
}
pub use stand_ins::*;
}

pub mod collections {
#[path = "/workspace/wt/typecheck/src/typecheck/collections/ordered_map.rs"]
pub mod ordered_map;
#[path = "/workspace/wt/typecheck/src/typecheck/collections/ordered_set.rs"]
pub mod ordered_set;
#[path = "/workspace/wt/typecheck/src/typecheck/collections/set.rs"]
pub mod set;
pub use ordered_map::*;
pub use ordered_set::*;
pub use set::*;
}

pub mod jsnum {
#[path = "/workspace/wt/typecheck/src/typecheck/jsnum/jsnum.rs"]
pub mod jsnum;
pub use jsnum::*;
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct PseudoBigInt {
    pub negative: bool,
    pub base10_value: Vec<u8>,
}
}

pub mod evaluator {
    #[derive(Default)]
    pub struct Result<'a> {
        pub marker: std::marker::PhantomData<&'a ()>,
    }
}

pub mod ast {
#[path = "/workspace/wt/typecheck/src/typecheck/ast/flags.rs"]
pub mod flags;
#[path = "/workspace/wt/typecheck/src/typecheck/ast/ids.rs"]
pub mod ids;
#[path = "/workspace/wt/typecheck/src/typecheck/ast/checkflags.rs"]
pub mod checkflags;
#[path = "/workspace/wt/typecheck/src/typecheck/ast/symbolflags.rs"]
pub mod symbolflags;
#[path = "/workspace/wt/typecheck/src/typecheck/ast/modifierflags.rs"]
pub mod modifierflags;
#[path = "/workspace/wt/typecheck/src/typecheck/ast/nodeflags.rs"]
pub mod nodeflags;
#[path = "/workspace/wt/typecheck/src/typecheck/ast/kind_generated.rs"]
pub mod kind_generated;
#[path = "/workspace/wt/typecheck/src/typecheck/ast/diagnostic.rs"]
pub mod diagnostic;
pub use checkflags::*;
pub use diagnostic::*;
pub use ids::*;
pub use kind_generated::*;
pub use modifierflags::*;
pub use nodeflags::*;
pub use symbolflags::*;

use crate::core::List;

// ast/symbol.rs
pub type SymbolTable = SymbolTableId;
#[derive(Clone, Copy, Default, Debug)]
pub struct Symbol<'a> {
    pub flags: SymbolFlags,
    // Non-zero only in transient symbols created by Checker
    pub check_flags: CheckFlags,
    pub name: &'a [u8],
    pub declarations: List<'a, NodeId>,
    pub value_declaration: NodeId,
    pub members: SymbolTable,
    pub exports: SymbolTable,
    pub parent: SymbolId,
    pub export_symbol: SymbolId,
}
// ast/ast_generated.rs
#[derive(Clone, Copy, Default, Debug)]
pub struct ShorthandPropertyAssignment {
    pub modifiers: ModifierListId,
    pub name: NodeId,
    pub postfix_token: NodeId,
    pub type_node: NodeId,
    pub equals_token: NodeId,
    pub object_assignment_initializer: NodeId,
    pub symbol: SymbolId,
}
#[derive(Clone, Copy, Default, Debug)]
pub struct BinaryExpression {
    pub modifiers: ModifierListId,
    pub left: NodeId,
    pub type_node: NodeId,
    pub operator_token: NodeId,
    pub right: NodeId,
    pub symbol: SymbolId,
}
#[derive(Clone, Copy, Default, Debug)]
pub struct PrefixUnaryExpression {
    pub operator: Kind,
    pub operand: NodeId,
}
// ast/utilities.rs
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct FindAncestorResult(pub i32);

impl FindAncestorResult {
    pub const FALSE: Self = Self(0);
    pub const TRUE: Self = Self(1);
    pub const QUIT: Self = Self(2);
}

// Invariant in its lifetime, as the context of the tree is: it names stores with interior mutability.
#[derive(Clone, Copy)]
pub struct Ast<'a> {
    pub marker: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
}

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use super::*;

    impl<'a> Ast<'a> {
// ast/node_methods.rs
    pub fn symbol(self, node: NodeId) -> SymbolId {
        loop {}
    }
// ast/node_methods.rs
    pub fn name(self, node: NodeId) -> NodeId {
        loop {}
    }
// ast/node_methods.rs
    pub fn properties(self, node: NodeId) -> List<'a, NodeId> {
        loop {}
    }
// ast/node_methods.rs
    pub fn initializer(self, node: NodeId) -> NodeId {
        loop {}
    }
// ast/node_methods.rs
    pub fn type_node(self, node: NodeId) -> NodeId {
        loop {}
    }
// ast/node_methods.rs
    pub fn expression(self, node: NodeId) -> NodeId {
        loop {}
    }
// ast/node_methods.rs
    pub fn elements(self, node: NodeId) -> List<'a, NodeId> {
        loop {}
    }
// ast/node_methods.rs
    pub fn parameters(self, node: NodeId) -> List<'a, NodeId> {
        loop {}
    }
// ast/node_methods.rs
    pub fn arguments(self, node: NodeId) -> List<'a, NodeId> {
        loop {}
    }
// ast/node_methods.rs
    pub fn text(self, node: NodeId) -> &'a [u8] {
        loop {}
    }
// ast/reader.rs
    pub fn kind(self, node: NodeId) -> Kind {
        loop {}
    }
// ast/reader.rs
    pub fn parent(self, node: NodeId) -> NodeId {
        loop {}
    }
// ast/symbol.rs
    pub fn sym(self, symbol: SymbolId) -> Symbol<'a> {
        loop {}
    }
// ast/symbol.rs
    pub fn new_table(self) -> SymbolTable {
        loop {}
    }
// ast/symbol.rs
    pub fn table_get(self, table: SymbolTable, name: &[u8]) -> SymbolId {
        loop {}
    }
// ast/symbol.rs
    pub fn table_set(self, table: SymbolTable, name: &'a [u8], symbol: SymbolId) {
        loop {}
    }
// ast/symbol.rs
    pub fn table_len(self, table: SymbolTable) -> isize {
        loop {}
    }
// ast/symbol.rs
    pub fn update_symbol(self, symbol: SymbolId, f: impl FnOnce(&mut Symbol<'a>)) {
        loop {}
    }
// ast/ast_generated.rs
    pub fn as_shorthand_property_assignment(self, node: NodeId) -> ShorthandPropertyAssignment {
        loop {}
    }
// ast/ast_generated.rs
    pub fn as_binary_expression(self, node: NodeId) -> BinaryExpression {
        loop {}
    }
// ast/ast_generated.rs
    pub fn as_prefix_unary_expression(self, node: NodeId) -> PrefixUnaryExpression {
        loop {}
    }
    }

// ast/utilities.rs
pub fn find_ancestor_or_quit(
    a: Ast<'_>,
    node: NodeId,
    callback: impl FnMut(NodeId) -> FindAncestorResult,
) -> NodeId {
    loop {}
}
// ast/utilities.rs
pub fn get_root_declaration(a: Ast<'_>, node: NodeId) -> NodeId {
    loop {}
}
// ast/utilities.rs
pub fn get_this_parameter(a: Ast<'_>, signature: NodeId) -> NodeId {
    loop {}
}
// ast/utilities.rs
pub fn has_syntactic_modifier(a: Ast<'_>, node: NodeId, flags: ModifierFlags) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn is_assignment_target(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn is_class_like(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn is_const_assertion(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn is_entity_name_expression(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn is_function_like_declaration(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn is_in_js_file(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn is_in_json_file(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn is_node_descendant_of(a: Ast<'_>, node: NodeId, ancestor: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn is_object_literal_method(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn is_private_identifier_class_element_declaration(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn skip_parentheses(a: Ast<'_>, node: NodeId) -> NodeId {
    loop {}
}
// ast/ast_generated.rs
pub fn is_array_literal_expression(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_binary_expression(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_binding_element(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_call_expression(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_computed_property_name(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_method_declaration(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_object_binding_pattern(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_object_literal_expression(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_parameter_declaration(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_parenthesized_expression(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_property_assignment(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_shorthand_property_assignment(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_spread_element(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_template_span(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_variable_declaration(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
}
pub use stand_ins::*;
}

pub mod checker {
#[path = "/workspace/wt/typecheck/src/typecheck/checker/types.rs"]
pub mod types;
#[path = "/workspace/wt/typecheck/src/typecheck/checker/c20_object_literals_spread.rs"]
pub mod c20_object_literals_spread;
pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{
        Arg, Ast, DiagnosticId, DiagnosticStore, FlowNodeId, ModifierFlags, NodeFlags, NodeId,
        SymbolFlags, SymbolId, SymbolTableId, CheckFlags,
    };
    use crate::checker::types::checker_flags;
    use crate::checker::types::*;
    use crate::core::{Link, LinkStore, List, Map, Text};
    use crate::diagnostics::MessageId;
    use crate::jsnum::Number;

    // checker.go:17471: the key of a cache, which no file of the tree defines.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
    pub struct CacheHashKey(pub u128);

    // bun_core::StackCheck
    #[derive(Clone, Copy, Default)]
    pub struct StackCheck;
    impl StackCheck {
        pub fn is_safe_to_recurse(self) -> bool {
            true
        }
    }

    // checker/c01_data.rs
checker_flags!(CheckMode: u32 {
    NORMAL = 0, // Normal type checking
    CONTEXTUAL = 1 << 0, // Explicitly assigned contextual type, therefore not cacheable
    INFERENTIAL = 1 << 1, // Inferential typing
    SKIP_CONTEXT_SENSITIVE = 1 << 2, // Skip context sensitive function expressions
    SKIP_GENERIC_FUNCTIONS = 1 << 3, // Skip single signature generic functions
    IS_FOR_SIGNATURE_HELP = 1 << 4, // Call resolution for purposes of signature help
    REST_BINDING_ELEMENT = 1 << 5, // Checking a type that is going to be used to determine the type of a rest binding element
    // e.g. in `const { a, ...rest } = foo`, when checking the type of `foo` to determine the type of `rest`, we need to preserve generic types instead of substituting them for constraints
    TYPE_ONLY = 1 << 6, // Called from getTypeOfExpression, diagnostics may be omitted
    FORCE_TUPLE = 1 << 7,
});
checker_flags!(UnionReduction: i32 {
    LITERAL = 1,
    SUBTYPE = 2,
});
checker_flags!(IntersectionState: u32 {
    SOURCE = 1 << 0, // Source type is a constituent of an outer intersection
    TARGET = 1 << 1, // Target type is a constituent of an outer intersection
});

    // checker/c01_data.rs 312: the field that c20 reads.
    #[derive(Default)]
    pub struct InferenceContext {
        pub non_fixing_mapper: TypeMapperId,
    }

    // checker/c02_program_checker.rs 122 and 226: the bounds of the lists and of the fallbacks.
    pub trait ListItem<'a>: Copy + Default + 'a {}
    impl<'a> ListItem<'a> for TypeId {}
    impl<'a> ListItem<'a> for SymbolId {}
    impl<'a> ListItem<'a> for NodeId {}
    impl<'a> ListItem<'a> for SignatureId {}
    impl<'a> ListItem<'a> for IndexInfoId {}
    pub trait Fallback<'a>: Sized {
        fn fallback(c: &Checker<'a>) -> Self;
    }
    impl<'a> Fallback<'a> for () {
        fn fallback(_: &Checker<'a>) -> Self {}
    }
    macro_rules! fallback_default {
        ($($ty:ty),* $(,)?) => {$(
            impl<'a> Fallback<'a> for $ty {
                fn fallback(_: &Checker<'a>) -> Self {
                    <$ty>::default()
                }
            }
        )*};
    }
    fallback_default!(bool, isize, usize, NodeId, SymbolId, TypeMapperId, IndexInfoId);
    impl<'a> Fallback<'a> for TypeId {
        fn fallback(c: &Checker<'a>) -> Self {
            c.error_type
        }
    }
    impl<'a, T: Copy + Default> Fallback<'a> for List<'a, T> {
        fn fallback(_: &Checker<'a>) -> Self {
            List::NIL
        }
    }

    // checker/c02_program_checker.rs 379-731: the fields that c20 and types.rs read, with the types of the tree.
    pub struct Checker<'a> {
        pub ast: Ast<'a>,
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
        pub stack_check: StackCheck,
        pub types: Records<TypeId, Type<'a>>,
        pub type_aliases: Records<TypeAliasId, TypeAlias<'a>>,
        pub inference_contexts: Records<InferenceContextId, InferenceContext>,
        pub nil_sections: NilSections<'a>,
        pub sink_sections: NilSections<'a>,
        pub diagnostic_store: DiagnosticStore,
        pub strict_null_checks: bool,
        pub signatures: Records<SignatureId, Signature<'a>>,
        pub index_infos: Records<IndexInfoId, IndexInfo<'a>>,
        pub node_links: LinkStore<NodeId, NodeLinks>,
        pub value_symbol_links: LinkStore<SymbolId, ValueSymbolLinks>,
        pub mapped_symbol_links: LinkStore<SymbolId, MappedSymbolLinks>,
        pub spread_links: LinkStore<SymbolId, SpreadLinks>,
        pub pattern_for_type: Map<TypeId, NodeId>,
        pub any_type: TypeId,
        pub error_type: TypeId,
        pub unknown_type: TypeId,
        pub undefined_type: TypeId,
        pub string_type: TypeId,
        pub number_type: TypeId,
        pub es_symbol_type: TypeId,
        pub never_type: TypeId,
        pub string_number_symbol_type: TypeId,
        pub empty_object_type: TypeId,
    }

    impl<'a> Checker<'a> {
// checker/c02_program_checker.rs
    pub fn fail<T: Fallback<'a>>(&self, message: &'static str) -> T {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn assert(&self, value: bool, message: &'static str) {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn bad_cast(&self, message: &'static str) {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn map_set(&self, ok: bool) {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn slice_set(&self, ok: bool) {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn stack_limit<T: Fallback<'a>>(&self) -> T {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn list_of<T: ListItem<'a>>(&self, items: &[T]) -> List<'a, T> {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn list<T: ListItem<'a>>(&self, items: &[T]) -> List<'a, T> {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn text(&self, bytes: &[u8]) -> Text<'a> {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn same_map<T: ListItem<'a> + PartialEq>(
        &mut self,
        slice: List<'a, T>,
        f: impl FnMut(&mut Checker<'a>, T) -> T,
    ) -> List<'a, T> {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn concatenate<T: ListItem<'a>>(&self, s1: List<'a, T>, s2: List<'a, T>) -> List<'a, T> {
        loop {}
    }
// checker/links.rs
    pub fn value_symbol_links_get(&mut self, symbol: SymbolId) -> Link<ValueSymbolLinks> {
        loop {}
    }
// checker/c05_check_source_file.rs
    pub fn check_node_deferred(&mut self, node: NodeId) {
        loop {}
    }
// checker/c14_expressions.rs
    pub fn check_expression(&mut self, node: NodeId) -> TypeId {
        loop {}
    }
// checker/c14_expressions.rs
    pub fn check_expression_ex(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        loop {}
    }
// checker/c14_expressions.rs
    pub fn check_expression_cached(&mut self, node: NodeId) -> TypeId {
        loop {}
    }
// checker/c14_expressions.rs
    pub fn instantiate_type_with_single_generic_call_signature(
        &mut self,
        node: NodeId,
        t: TypeId,
        check_mode: CheckMode,
    ) -> TypeId {
        loop {}
    }
// checker/c21_resolved_symbols_diagnostics.rs
    pub fn error(
        &mut self,
        location: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        loop {}
    }
// checker/c21_resolved_symbols_diagnostics.rs
    pub fn add_deprecated_suggestion(
        &mut self,
        location: NodeId,
        declarations: List<'_, NodeId>,
        deprecated_entity: &[u8],
    ) -> DiagnosticId {
        loop {}
    }
// checker/c21_resolved_symbols_diagnostics.rs
    pub fn is_deprecated_symbol(&mut self, symbol: SymbolId) -> bool {
        loop {}
    }
// checker/c22_symbols_merge.rs
    pub fn new_symbol(&mut self, flags: SymbolFlags, name: Text<'a>) -> SymbolId {
        loop {}
    }
// checker/c22_symbols_merge.rs
    pub fn new_symbol_ex(
        &mut self,
        flags: SymbolFlags,
        name: Text<'a>,
        check_flags: CheckFlags,
    ) -> SymbolId {
        loop {}
    }
// checker/c22_symbols_merge.rs
    pub fn get_symbol_of_declaration(&mut self, node: NodeId) -> SymbolId {
        loop {}
    }
// checker/c25_entity_names.rs
    pub fn resolve_entity_name(
        &mut self,
        name: NodeId,
        meaning: SymbolFlags,
        ignore_errors: bool,
        dont_resolve_alias: bool,
        location: NodeId,
    ) -> SymbolId {
        loop {}
    }
// checker/c28_types_of_symbols.rs
    pub fn get_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId {
        loop {}
    }
// checker/c29_constraints.rs
    pub fn get_constraint_of_conditional_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/c31_binding_patterns_widening.rs
    pub fn add_optionality_ex(
        &mut self,
        t: TypeId,
        is_property: bool,
        is_optional: bool,
    ) -> TypeId {
        loop {}
    }
// checker/c31_binding_patterns_widening.rs
    pub fn get_combined_node_flags_cached(&mut self, node: NodeId) -> NodeFlags {
        loop {}
    }
// checker/c31_binding_patterns_widening.rs
    pub fn get_declaration_node_flags_from_symbol(&mut self, s: SymbolId) -> NodeFlags {
        loop {}
    }
// checker/c31_binding_patterns_widening.rs
    pub fn get_type_for_binding_element_parent(
        &mut self,
        node: NodeId,
        check_mode: CheckMode,
    ) -> TypeId {
        loop {}
    }
// checker/c31_binding_patterns_widening.rs
    pub fn get_binding_element_type_from_parent_type(
        &mut self,
        declaration: NodeId,
        parent_type: TypeId,
        no_tuple_bounds_check: bool,
    ) -> TypeId {
        loop {}
    }
// checker/c33_members_base_types_signatures.rs
    pub fn get_object_literal_index_info(
        &mut self,
        is_readonly: bool,
        properties: &[SymbolId],
        key_type: TypeId,
    ) -> IndexInfoId {
        loop {}
    }
// checker/c33_members_base_types_signatures.rs
    pub fn get_property_of_type(&mut self, t: TypeId, name: &[u8]) -> SymbolId {
        loop {}
    }
// checker/c33_members_base_types_signatures.rs
    pub fn get_index_info_of_type(&mut self, t: TypeId, key_type: TypeId) -> IndexInfoId {
        loop {}
    }
// checker/c33_members_base_types_signatures.rs
    pub fn get_index_infos_of_type(&mut self, t: TypeId) -> List<'a, IndexInfoId> {
        loop {}
    }
// checker/c33_members_base_types_signatures.rs
    pub fn get_index_type_of_type(&mut self, t: TypeId, key_type: TypeId) -> TypeId {
        loop {}
    }
// checker/c33_members_base_types_signatures.rs
    pub fn get_properties_of_type(&mut self, t: TypeId) -> List<'a, SymbolId> {
        loop {}
    }
// checker/c33_members_base_types_signatures.rs
    pub fn get_type_of_property_of_type(&mut self, t: TypeId, name: &[u8]) -> TypeId {
        loop {}
    }
// checker/c36_properties_apparent_types.rs
    pub fn get_reduced_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/c36_properties_apparent_types.rs
    pub fn get_reduced_apparent_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/c37_instantiation.rs
    pub fn get_homomorphic_type_variable(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/c37_instantiation.rs
    pub fn instantiate_type(&mut self, t: TypeId, m: TypeMapperId) -> TypeId {
        loop {}
    }
// checker/c38_type_nodes_references.rs
    pub fn get_element_types(&mut self, t: TypeId) -> List<'a, TypeId> {
        loop {}
    }
// checker/c38_type_nodes_references.rs
    pub fn get_type_from_type_node(&mut self, node: NodeId) -> TypeId {
        loop {}
    }
// checker/c40_type_nodes_conditional_tuples.rs
    pub fn is_generic_object_type(&mut self, t: TypeId) -> bool {
        loop {}
    }
// checker/c40_type_nodes_conditional_tuples.rs
    pub fn is_generic_mapped_type(&mut self, t: TypeId) -> bool {
        loop {}
    }
// checker/c40_type_nodes_conditional_tuples.rs
    pub fn is_generic_tuple_type(&self, t: TypeId) -> bool {
        loop {}
    }
// checker/c41_new_types.rs
    pub fn new_anonymous_type(
        &mut self,
        symbol: SymbolId,
        members: SymbolTableId,
        call_signatures: List<'a, SignatureId>,
        construct_signatures: List<'a, SignatureId>,
        index_infos: List<'a, IndexInfoId>,
    ) -> TypeId {
        loop {}
    }
// checker/c41_new_types.rs
    pub fn new_index_info(
        &mut self,
        key_type: TypeId,
        value_type: TypeId,
        is_readonly: bool,
        declaration: NodeId,
        components: List<'a, NodeId>,
    ) -> IndexInfoId {
        loop {}
    }
// checker/c42_literal_types.rs
    pub fn map_type(
        &mut self,
        t: TypeId,
        f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> TypeId,
    ) -> TypeId {
        loop {}
    }
// checker/c42_literal_types.rs
    pub fn get_regular_type_of_literal_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/c42_literal_types.rs
    pub fn get_widened_literal_like_type_for_contextual_type(
        &mut self,
        t: TypeId,
        contextual_type: TypeId,
    ) -> TypeId {
        loop {}
    }
// checker/c42_literal_types.rs
    pub fn get_number_literal_type(&mut self, value: Number) -> TypeId {
        loop {}
    }
// checker/c43_unions_intersections.rs
    pub fn is_error_type(&self, t: TypeId) -> bool {
        loop {}
    }
// checker/c43_unions_intersections.rs
    pub fn check_cross_product_union(&mut self, types: List<'_, TypeId>) -> bool {
        loop {}
    }
// checker/c43_unions_intersections.rs
    pub fn is_empty_object_type(&mut self, t: TypeId) -> bool {
        loop {}
    }
// checker/c43_unions_intersections.rs
    pub fn get_intersection_type(&mut self, types: List<'_, TypeId>) -> TypeId {
        loop {}
    }
// checker/c43_unions_intersections.rs
    pub fn get_union_type(&mut self, types: List<'_, TypeId>) -> TypeId {
        loop {}
    }
// checker/c43_unions_intersections.rs
    pub fn get_union_type_ex(
        &mut self,
        types: List<'_, TypeId>,
        union_reduction: UnionReduction,
        alias: TypeAliasId,
        origin: TypeId,
    ) -> TypeId {
        loop {}
    }
// checker/c44_index_indexed_access.rs
    pub fn check_computed_property_name(&mut self, node: NodeId) -> TypeId {
        loop {}
    }
// checker/c44_index_indexed_access.rs
    pub fn get_indexed_access_type(&mut self, object_type: TypeId, index_type: TypeId) -> TypeId {
        loop {}
    }
// checker/c45_base_constraints_normalization.rs
    pub fn get_base_constraint_or_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/c47_promised_mapped_template.rs
    pub fn remove_missing_or_undefined_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/flow.rs
    pub fn is_some_symbol_assigned(&mut self, root_declaration: NodeId) -> bool {
        loop {}
    }
// checker/flow.rs
    pub fn get_flow_type_of_reference_ex(
        &mut self,
        reference: NodeId,
        declared_type: TypeId,
        initial_type: TypeId,
        flow_container: NodeId,
        flow_node: FlowNodeId,
    ) -> TypeId {
        loop {}
    }
// checker/grammarchecks.rs
    pub fn check_grammar_object_literal_expression(
        &mut self,
        node: NodeId,
        in_destructuring: bool,
    ) -> bool {
        loop {}
    }
// checker/grammarchecks.rs
    pub fn check_grammar_method(&mut self, node: NodeId) -> bool {
        loop {}
    }
// checker/printer.rs
    pub fn symbol_to_string(&mut self, symbol: SymbolId) -> Vec<u8> {
        loop {}
    }
// checker/printer.rs
    pub fn type_to_string_exported(&mut self, t: TypeId) -> Vec<u8> {
        loop {}
    }
// checker/relater.rs
    pub fn is_type_assignable_to(&mut self, source: TypeId, target: TypeId) -> bool {
        loop {}
    }
// checker/relater.rs
    pub fn check_type_assignable_to_and_optionally_elaborate(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: NodeId,
        expr: NodeId,
        head_message: MessageId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        loop {}
    }
// checker/utilities.rs
    pub fn new_diagnostic_for_node(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        loop {}
    }
// checker/utilities.rs
    pub fn is_canceled(&self) -> bool {
        loop {}
    }
        // No file of the tree defines these yet.

        pub fn push_cached_contextual_type(&mut self, node: NodeId) {
            loop {}
        }
        pub fn pop_contextual_type(&mut self) {
            loop {}
        }
        pub fn get_apparent_type_of_contextual_type(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId {
            loop {}
        }
        pub fn get_contextual_type(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId {
            loop {}
        }
        pub fn instantiate_contextual_type(&mut self, contextual_type: TypeId, node: NodeId, context_flags: ContextFlags) -> TypeId {
            loop {}
        }
        pub fn is_context_sensitive(&mut self, node: NodeId) -> bool {
            loop {}
        }
        pub fn is_context_sensitive_function_or_object_literal_method(&mut self, func: NodeId) -> bool {
            loop {}
        }
        pub fn get_inference_context(&mut self, node: NodeId) -> InferenceContextId {
            loop {}
        }
        pub fn add_intra_expression_inference_site(&mut self, n: InferenceContextId, node: NodeId, t: TypeId) {
            loop {}
        }
        pub fn remove_definitely_falsy_types(&mut self, t: TypeId) -> TypeId {
            loop {}
        }
        pub fn get_control_flow_container(&mut self, node: NodeId) -> NodeId {
            loop {}
        }
        pub fn get_contextual_signature(&mut self, node: NodeId) -> SignatureId {
            loop {}
        }
        pub fn check_function_expression_or_object_literal_method(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
            loop {}
        }
    }

// checker/utilities.rs
pub fn get_declaration_modifier_flags_from_symbol(a: Ast<'_>, s: SymbolId) -> ModifierFlags {
    loop {}
}
// checker/utilities.rs
pub fn get_property_name_from_type(c: &Checker<'_>, t: TypeId) -> Vec<u8> {
    loop {}
}
// checker/utilities.rs
pub fn has_dot_dot_dot_token(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// checker/utilities.rs
pub fn is_type_assertion(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// checker/utilities.rs
pub fn is_type_usable_as_property_name(c: &Checker<'_>, t: TypeId) -> bool {
    loop {}
}
// checker/utilities.rs
pub fn value_to_string(value: &LiteralValue<'_>) -> Vec<u8> {
    loop {}
}
// checker/c28_types_of_symbols.rs
pub fn signature_has_rest_parameter(c: &Checker<'_>, sig: SignatureId) -> bool {
    loop {}
}
// checker/c38_type_nodes_references.rs
pub fn is_tuple_type(c: &Checker<'_>, t: TypeId) -> bool {
    loop {}
}
// checker/c42_literal_types.rs
pub fn get_boolean_literal_value(c: &Checker<'_>, t: TypeId) -> bool {
    loop {}
}
// checker/c43_unions_intersections.rs
pub fn every_type<'a>(
    c: &mut Checker<'a>,
    t: TypeId,
    f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> bool,
) -> bool {
    loop {}
}
// checker/flow.rs
pub fn get_flow_node_of_node(a: Ast<'_>, node: NodeId) -> FlowNodeId {
    loop {}
}
}
}
