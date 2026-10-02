//! Probe of checker/c50_contextual_properties_inference_context.rs: the file of the tree, by #[path], beside stand-ins for what it names. Written by c50-probe-gen.py: edit the script, not this file.
//! Real files by #[path]: diagnostics/, core/{arena,golang,linkstore,text,tristate,tristate_stringer_generated}.rs, collections/{set,ordered_map,ordered_set}.rs, jsnum/jsnum.rs, ast/{flags,ids,checkflags,symbolflags,modifierflags,nodeflags,kind_generated,diagnostic}.rs, checker/{types,c01_data}.rs.
//! Run: rustc --edition 2024 --crate-type lib --emit=metadata -o /tmp/c50-probe.rmeta c50-probe.rs
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

// checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs 152-220: a `[]T` that upstream writes after it shared it.
pub struct LiveList<'a, T>(Option<&'a [std::cell::Cell<T>]>);

impl<T> Clone for LiveList<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for LiveList<'_, T> {}
impl<T> Default for LiveList<'_, T> {
    fn default() -> Self {
        Self(None)
    }
}

impl<'a, T: Copy + Default> LiveList<'a, T> {
    pub const NIL: Self = Self(None);
    pub const fn from_cells(cells: &'a [std::cell::Cell<T>]) -> Self {
        Self(Some(cells))
    }
    pub const fn is_nil(self) -> bool {
        self.0.is_none()
    }
    fn cells(self) -> &'a [std::cell::Cell<T>] {
        self.0.unwrap_or(&[])
    }
    pub fn len(self) -> isize {
        self.cells().len() as isize
    }
    pub fn at(self, index: impl GoIndex) -> T {
        index
            .to_index()
            .and_then(|i| self.cells().get(i))
            .map(std::cell::Cell::get)
            .unwrap_or_default()
    }
    pub fn iter(self) -> impl Iterator<Item = T> + 'a {
        self.cells().iter().map(std::cell::Cell::get)
    }
}

// checker-data-model-contract/bottom-up/crate/src/tscore/golang.rs 222-270: `map[K]V` that nothing ranges over. The contract writes it on bun_collections::HashMap, which is hashbrown's map: the map of std stands for it here, with the same variance.
#[allow(clippy::disallowed_types)]
mod map {
    use std::collections::HashMap;
    use std::hash::Hash;

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
}
pub use map::*;

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
pub fn find<T: Copy + Default>(slice: &[T], f: impl FnMut(T) -> bool) -> T {
    loop {}
}
// core/core.rs
pub fn map<T: Copy, U>(slice: &[T], f: impl FnMut(T) -> U) -> Vec<U> {
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

#[allow(unused_variables)]
mod stand_ins {
    use super::*;
// jsnum/string.rs
pub fn from_string(s: &[u8]) -> Number {
    loop {}
}
}
pub use stand_ins::*;
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
pub struct ConditionalExpression {
    pub condition: NodeId,
    pub question_token: NodeId,
    pub when_true: NodeId,
    pub colon_token: NodeId,
    pub when_false: NodeId,
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
// ast/functionflags.rs
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct FunctionFlags(pub u32);

impl FunctionFlags {
    pub const NORMAL: Self = Self(0);
    pub const GENERATOR: Self = Self(1 << 0);
    pub const ASYNC: Self = Self(1 << 1);
    pub const INVALID: Self = Self(1 << 2);
    pub const ASYNC_GENERATOR: Self = Self(Self::ASYNC.0 | Self::GENERATOR.0);

    #[inline]
    pub const fn intersects(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }
    #[inline]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
    #[inline]
    pub const fn without(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }
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
    pub fn type_parameters(self, node: NodeId) -> List<'a, NodeId> {
        loop {}
    }
// ast/node_methods.rs
    pub fn body(self, node: NodeId) -> NodeId {
        loop {}
    }
// ast/node_methods.rs
    pub fn children(self, node: NodeId) -> NodeListId {
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
// ast/reader.rs
    pub fn nodes(self, list: NodeListId) -> List<'a, NodeId> {
        loop {}
    }
// ast/symbol.rs
    pub fn sym(self, symbol: SymbolId) -> Symbol<'a> {
        loop {}
    }
// ast/symbol.rs
    pub fn table_get(self, table: SymbolTable, name: &[u8]) -> SymbolId {
        loop {}
    }
// ast/ast_generated.rs
    pub fn as_conditional_expression(self, node: NodeId) -> ConditionalExpression {
        loop {}
    }
// ast/ast_generated.rs
    pub fn as_binary_expression(self, node: NodeId) -> BinaryExpression {
        loop {}
    }
    }

// ast/utilities.rs
pub fn for_each_return_statement(
    a: Ast<'_>,
    body: NodeId,
    visitor: impl FnMut(NodeId) -> bool,
) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn get_node_id(node: NodeId) -> NodeId {
    loop {}
}
// ast/utilities.rs
pub fn has_context_sensitive_parameters(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn is_object_literal_method(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/utilities.rs
pub fn node_kind_is(a: Ast<'_>, node: NodeId, kinds: &[Kind]) -> bool {
    loop {}
}
// ast/functionflags.rs
pub fn get_function_flags(a: Ast<'_>, node: NodeId) -> FunctionFlags {
    loop {}
}
// ast/ast_generated.rs
pub fn is_block(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_jsx_attribute(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_jsx_attributes(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_jsx_opening_element(a: Ast<'_>, node: NodeId) -> bool {
    loop {}
}
// ast/ast_generated.rs
pub fn is_object_literal_expression(a: Ast<'_>, node: NodeId) -> bool {
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
}
pub use stand_ins::*;
}

pub mod checker {
#[path = "/workspace/wt/typecheck/src/typecheck/checker/types.rs"]
pub mod types;
#[path = "/workspace/wt/typecheck/src/typecheck/checker/c01_data.rs"]
pub mod c01_data;
#[path = "/workspace/wt/typecheck/src/typecheck/checker/c50_contextual_properties_inference_context.rs"]
pub mod c50_contextual_properties_inference_context;
pub use c01_data::*;
pub use c50_contextual_properties_inference_context::*;
pub use stand_ins::*;
pub use types::*;

#[allow(unused_variables, unused_imports, clippy::needless_pass_by_value)]
mod stand_ins {
    use crate::ast::{Ast, NodeId, SymbolId};
    use crate::checker::c01_data::*;
    use crate::checker::types::*;
    use crate::core::{Link, LinkStore, List, Map, Text};

    // checker.go:17471: the key of a cache, as checker/c30_type_keys.rs has its fields and derives.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
    pub struct CacheHashKey {
        pub hi: u64,
        pub lo: u64,
    }
    impl CacheHashKey {
        pub fn of(bytes: &[u8]) -> Self {
            loop {}
        }
    }

    // bun_core::StackCheck
    #[derive(Clone, Copy, Default)]
    pub struct StackCheck;
    impl StackCheck {
        pub fn is_safe_to_recurse(self) -> bool {
            true
        }
    }

    // checker/relater.rs
    pub trait Discriminator<'a> {
        // Number of discriminant properties
        fn len(&self) -> isize;
        // Property name of index-th discriminator
        fn name(&self, c: &Checker<'a>, index: isize) -> Text<'a>;
        // True if index-th discriminator matches the given type
        fn matches(&mut self, c: &mut Checker<'a>, index: isize, t: TypeId) -> bool;
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

    // checker/c02_program_checker.rs 379-731: the fields that c50 and types.rs read, with the types of the tree.
    pub struct Checker<'a> {
        pub ast: Ast<'a>,
        // `lists: &'a CheckerArena<'a>` of the tree makes the checker invariant in its lifetime.
        pub lists: std::marker::PhantomData<std::cell::Cell<&'a ()>>,
        pub stack_check: StackCheck,
        pub types: Records<TypeId, Type<'a>>,
        pub type_aliases: Records<TypeAliasId, TypeAlias<'a>>,
        pub inference_contexts: Records<InferenceContextId, InferenceContext<'a>>,
        pub inference_infos: Records<InferenceInfoId, InferenceInfo>,
        pub nil_sections: NilSections<'a>,
        pub sink_sections: NilSections<'a>,
        pub string_literal_types: Map<Text<'a>, TypeId>,
        pub discriminated_contextual_types: Map<DiscriminatedContextualTypeKey, TypeId>,
        pub signatures: Records<SignatureId, Signature<'a>>,
        pub index_infos: Records<IndexInfoId, IndexInfo<'a>>,
        pub value_symbol_links: LinkStore<SymbolId, ValueSymbolLinks>,
        pub error_type: TypeId,
        pub unknown_type: TypeId,
        pub undefined_type: TypeId,
        pub regular_false_type: TypeId,
        pub regular_true_type: TypeId,
        pub true_type: TypeId,
        pub contextual_infos: Vec<ContextualInfo>,
        pub inference_context_infos: Vec<InferenceContextInfo>,
    }

    impl<'a> Checker<'a> {
// checker/c02_program_checker.rs
    pub fn fail<T: Fallback<'a>>(&self, message: &'static str) -> T {
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
    pub fn stack_limit<T: Fallback<'a>>(&self) -> T {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn list_of<T: ListItem<'a>>(&self, items: &[T]) -> List<'a, T> {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn text(&self, bytes: &[u8]) -> Text<'a> {
        loop {}
    }
// checker/c02_program_checker.rs
    pub fn filter<T: ListItem<'a>>(
        &mut self,
        slice: List<'a, T>,
        f: impl FnMut(&mut Checker<'a>, T) -> bool,
    ) -> List<'a, T> {
        loop {}
    }
// checker/links.rs
    pub fn value_symbol_links_get(&mut self, symbol: SymbolId) -> Link<ValueSymbolLinks> {
        loop {}
    }
// checker/c14_expressions.rs
    pub fn get_context_free_type_of_expression(&mut self, node: NodeId) -> TypeId {
        loop {}
    }
// checker/c28_types_of_symbols.rs
    pub fn get_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId {
        loop {}
    }
// checker/c32_type_resolution.rs
    pub fn find_resolution_cycle_start_index(
        &mut self,
        target: TypeSystemEntity,
        property_name: TypeSystemPropertyName,
    ) -> isize {
        loop {}
    }
// checker/c33_members_base_types_signatures.rs
    pub fn get_property_of_type(&mut self, t: TypeId, name: &[u8]) -> SymbolId {
        loop {}
    }
// checker/c33_members_base_types_signatures.rs
    pub fn get_properties_of_type(&mut self, t: TypeId) -> List<'a, SymbolId> {
        loop {}
    }
// checker/c33_members_base_types_signatures.rs
    pub fn find_applicable_index_info(
        &mut self,
        index_infos: List<'_, IndexInfoId>,
        key_type: TypeId,
    ) -> IndexInfoId {
        loop {}
    }
// checker/c33_members_base_types_signatures.rs
    pub fn get_index_infos_of_structured_type(&mut self, t: TypeId) -> List<'a, IndexInfoId> {
        loop {}
    }
// checker/c36_properties_apparent_types.rs
    pub fn get_reduced_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/c36_properties_apparent_types.rs
    pub fn get_apparent_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/c37_instantiation.rs
    pub fn instantiate_type(&mut self, t: TypeId, m: TypeMapperId) -> TypeId {
        loop {}
    }
// checker/c37_instantiation.rs
    pub fn get_constraint_type_from_mapped_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/c40_type_nodes_conditional_tuples.rs
    pub fn is_generic_mapped_type(&mut self, t: TypeId) -> bool {
        loop {}
    }
// checker/c40_type_nodes_conditional_tuples.rs
    pub fn get_element_type_of_slice_of_tuple_type(
        &mut self,
        t: TypeId,
        index: isize,
        end_skip_count: isize,
        writing: bool,
        no_reductions: bool,
    ) -> TypeId {
        loop {}
    }
// checker/c42_literal_types.rs
    pub fn map_type_ex(
        &mut self,
        t: TypeId,
        f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> TypeId,
        no_reductions: bool,
    ) -> TypeId {
        loop {}
    }
// checker/c42_literal_types.rs
    pub fn get_string_literal_type(&mut self, value: Text<'a>) -> TypeId {
        loop {}
    }
// checker/c43_unions_intersections.rs
    pub fn get_intersection_type(&mut self, types: List<'_, TypeId>) -> TypeId {
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
// checker/c43_unions_intersections.rs
    pub fn filter_type(
        &mut self,
        t: TypeId,
        f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> bool,
    ) -> TypeId {
        loop {}
    }
// checker/c44_index_indexed_access.rs
    pub fn get_mapped_type_name_type_kind(&mut self, t: TypeId) -> MappedTypeNameTypeKind {
        loop {}
    }
// checker/c45_base_constraints_normalization.rs
    pub fn get_base_constraint_or_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/c45_base_constraints_normalization.rs
    pub fn maybe_type_of_kind(&self, t: TypeId, kind: TypeFlags) -> bool {
        loop {}
    }
// checker/c47_promised_mapped_template.rs
    pub fn remove_missing_type(&mut self, t: TypeId, is_optional: bool) -> TypeId {
        loop {}
    }
// checker/c51_type_facts_awaited.rs
    pub fn get_actual_type_variable(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/jsx.rs
    pub fn discriminate_contextual_type_by_jsx_attributes(
        &mut self,
        node: NodeId,
        contextual_type: TypeId,
    ) -> TypeId {
        loop {}
    }
// checker/relater.rs
    pub fn is_type_assignable_to(&mut self, source: TypeId, target: TypeId) -> bool {
        loop {}
    }
// checker/relater.rs
    pub fn is_discriminant_property(&mut self, t: TypeId, name: &[u8]) -> bool {
        loop {}
    }
// checker/relater.rs
    pub fn get_key_property_name(&mut self, t: TypeId) -> Text<'a> {
        loop {}
    }
// checker/relater.rs
    pub fn get_constituent_type_for_key_type(&mut self, t: TypeId, key_type: TypeId) -> TypeId {
        loop {}
    }
// checker/relater.rs
    pub fn discriminate_type_by_discriminable_items(
        &mut self,
        target: TypeId,
        discriminator: &mut dyn Discriminator<'a>,
    ) -> TypeId {
        loop {}
    }
        // No file of the tree defines these yet.

        pub fn get_contextual_type(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId {
            loop {}
        }

        pub fn get_contextual_type_for_object_literal_method(&mut self, node: NodeId, context_flags: ContextFlags) -> TypeId {
            loop {}
        }
// checker/c47_promised_mapped_template.rs
    pub fn substitute_indexed_mapped_type(&mut self, object_type: TypeId, index: TypeId) -> TypeId {
        loop {}
    }
// checker/c40_type_nodes_conditional_tuples.rs
    pub fn get_true_type_from_conditional_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
// checker/c40_type_nodes_conditional_tuples.rs
    pub fn get_false_type_from_conditional_type(&mut self, t: TypeId) -> TypeId {
        loop {}
    }
    }

// checker/utilities.rs
pub fn is_node_descendant_of(a: Ast<'_>, node: NodeId, ancestor: NodeId) -> bool {
    loop {}
}
// checker/utilities.rs
pub fn is_numeric_literal_name(name: &[u8]) -> bool {
    loop {}
}
// checker/utilities.rs
pub fn for_each_yield_expression(
    a: Ast<'_>,
    body: NodeId,
    visitor: impl FnMut(NodeId) -> bool,
) -> bool {
    loop {}
}
// checker/utilities.rs
pub fn value_to_string(value: &LiteralValue<'_>) -> Vec<u8> {
    loop {}
}
// checker/c38_type_nodes_references.rs
pub fn is_tuple_type(c: &Checker<'_>, t: TypeId) -> bool {
    loop {}
}
// checker/c43_unions_intersections.rs
pub fn contains_type(c: &mut Checker<'_>, types: List<'_, TypeId>, t: TypeId) -> bool {
    loop {}
}
// checker/inference.rs
pub fn has_inference_candidates_or_default(c: &Checker<'_>, info: InferenceInfoId) -> bool {
    loop {}
}
}
}
