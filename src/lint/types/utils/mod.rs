//! `@typescript-eslint/type-utils`, and what in typescript-eslint's `eslint-plugin/src/util` works
//! on types. The names are upstream's in snake_case, and everything is re-exported from here:
//! `use bun_lint::types::utils::*;`
//!
//! The doc comment of each function starts with the call it is upstream, so
//! `grep -rn 'isTypeAnyType' src/lint/types/utils` finds it.
//!
//! What takes a `checker`, a `program` or `services` upstream does not here: a handle knows its
//! checker. A `ts.Node` or a `TSESTree.Node` that is only handed on to the checker is any
//! [`Locate`] where there is a [`Type`](super::Type) beside it, and a [`Located`]
//! where there is none.
//!
//! # `@typescript-eslint/type-utils`
//!
//! | upstream | here |
//! | --- | --- |
//! | `builtinSymbolLikes.ts` | [`is_promise_like`], [`is_promise_constructor_like`], [`is_error_like`], [`is_readonly_error_like`], [`is_readonly_type_like`], [`is_builtin_type_alias_like`], [`is_builtin_symbol_like`], [`is_builtin_symbol_like_recurser`] |
//! | `containsAllTypesByName.ts` | [`contains_all_types_by_name`] |
//! | `discriminateAnyType.ts` | [`discriminate_any_type`], [`AnyType`] |
//! | `getConstrainedTypeAtLocation.ts` | [`get_constrained_type_at_location`] |
//! | `getContextualType.ts` | [`get_contextual_type`] |
//! | `getDeclaration.ts` | [`get_declaration`] |
//! | `getTypeName.ts` | [`get_type_name`] |
//! | `isSymbolFromDefaultLibrary.ts` | [`is_symbol_from_default_library`] |
//! | `isTypeBrandedLiteralLike.ts` | [`is_type_branded_literal_like`] |
//! | `isTypeReadonly.ts` | [`is_type_readonly`], [`ReadonlynessOptions`] |
//! | `isUnsafeAssignment.ts` | [`is_unsafe_assignment`], [`UnsafeAssignment`] |
//! | `predicates.ts` | [`is_nullable_type`], [`is_type_array_type_or_union_of_array_types`], [`is_type_never_type`], [`is_type_unknown_type`], [`is_type_reference_type`], [`is_type_any_type`], [`is_type_any_array_type`], [`is_type_unknown_array_type`], [`type_is_or_has_base_type`] |
//! | `propertyTypes.ts` | [`get_type_of_property_of_name`], [`get_type_of_property_of_type`] |
//! | `requiresQuoting.ts` | [`requires_quoting`] |
//! | `typeFlagUtils.ts` | [`get_type_flags`], [`is_type_flag_set`] |
//! | `TypeOrValueSpecifier.ts` | [`TypeOrValueSpecifier`], [`parse_type_or_value_specifiers`], [`type_matches_specifier`], [`type_matches_some_specifier`], [`value_matches_specifier`], [`value_matches_some_specifier`] |
//! | `getDecorators`, `getModifiers` | `class.decorators()`, `member.modifiers()`, [`TsNode::modifier_flags`] |
//!
//! # `eslint-plugin/src/util`
//!
//! | upstream | here |
//! | --- | --- |
//! | `assertionFunctionUtils.ts` | [`find_truthiness_asserted_argument`], [`find_type_guard_asserted_argument`] |
//! | `baseTypeUtils.ts` | [`has_base_types`], [`is_number_like`], [`is_string_like`], [`matches_type_or_base_type`] |
//! | `FunctionSignature.ts` | [`FunctionSignature`] |
//! | `getBaseTypesOfClassMember.ts` | [`get_base_types_of_class_member`] |
//! | `getConstraintInfo.ts` | [`get_constraint_info`], [`ConstraintTypeInfo`] |
//! | `getValueOfLiteralType.ts` | [`get_value_of_literal_type`] |
//! | `isArrayMethodCallWithPredicate.ts` | [`is_array_method_call_with_predicate`] |
//! | `isPromiseAggregatorMethod.ts` | [`is_promise_aggregator_method`] |
//! | `isHigherPrecedenceThanAwait.ts` | [`is_higher_precedence_than_await`] |
//! | `misc.ts` | [`is_rest_parameter_declaration`], and from [`ts_utils`](crate::utils::ts_utils): [`get_static_member_access_value`], [`is_static_member_access_of_value`], [`type_node_requires_parentheses`] |
//! | `needsToBeAwaited.ts` | [`needs_to_be_awaited`], [`Awaitable`] |
//! | `promiseUtils.ts` | [`parse_then_call`], [`parse_catch_call`], [`parse_finally_call`] |
//! | `truthinessUtils.ts` | [`is_possibly_falsy`], [`is_possibly_truthy`] |
//! | `rules/enum-utils/shared.ts` | [`get_enum_literals`], [`get_enum_types`], [`is_mismatched_enum_comparison_types`], [`get_enum_value_type`], [`get_enum_key_for_literal`] |
//!
//! [`is_array_method_call_with_predicate`], [`is_promise_aggregator_method`] and
//! [`is_rest_parameter_declaration`] have namesakes in [`ts_utils`](crate::utils::ts_utils), which
//! know no types.
//!
//! # Where the checker gave up
//!
//! A type that [is unresolved](super::Type::is_unresolved) has [`TypeFlags::ANY`](super::TypeFlags),
//! and TypeScript has no such type. It is not `any` for [`is_type_any_type`], and so for
//! [`is_type_any_array_type`], [`discriminate_any_type`] and [`is_unsafe_assignment`]. The error type
//! is `any` for these, as upstream: a rule tells it by
//! [`tsutils::is_intrinsic_error_type`](super::tsutils::is_intrinsic_error_type).

mod assertion_function_utils;
mod base_type_utils;
mod builtin_symbol_likes;
mod contains_all_types_by_name;
mod discriminate_any_type;
mod enum_utils;
mod function_signature;
mod get_base_types_of_class_member;
mod get_constrained_type_at_location;
mod get_constraint_info;
mod get_contextual_type;
mod get_declaration;
mod get_type_name;
mod get_value_of_literal_type;
mod is_array_method_call_with_predicate;
mod is_promise_aggregator_method;
mod is_symbol_from_default_library;
mod is_type_branded_literal_like;
mod is_type_readonly;
mod is_unsafe_assignment;
mod misc;
mod needs_to_be_awaited;
mod predicates;
mod promise_utils;
mod property_types;
mod truthiness_utils;
mod type_flag_utils;
mod type_or_value_specifier;

pub use assertion_function_utils::*;
pub use base_type_utils::*;
pub use builtin_symbol_likes::*;
pub use contains_all_types_by_name::*;
pub use discriminate_any_type::*;
pub use enum_utils::*;
pub use function_signature::*;
pub use get_base_types_of_class_member::*;
pub use get_constrained_type_at_location::*;
pub use get_constraint_info::*;
pub use get_contextual_type::*;
pub use get_declaration::*;
pub use get_type_name::*;
pub use get_value_of_literal_type::*;
pub use is_array_method_call_with_predicate::*;
pub use is_promise_aggregator_method::*;
pub use is_symbol_from_default_library::*;
pub use is_type_branded_literal_like::*;
pub use is_type_readonly::*;
pub use is_unsafe_assignment::*;
pub use misc::*;
pub use needs_to_be_awaited::*;
pub use predicates::*;
pub use promise_utils::*;
pub use property_types::*;
pub use truthiness_utils::*;
pub use type_flag_utils::*;
pub use type_or_value_specifier::*;

pub use crate::utils::ts_utils::{
    MemberAccessValue, NodeWithKey, get_static_member_access_value,
    is_higher_precedence_than_await, is_static_member_access_of_value, requires_quoting,
    type_node_requires_parentheses,
};

use super::{Locate, NameOf, TsNode};
use crate::ast::{
    Alias, Case, Class, Enum, EnumMember, Export, ExportSpec, Expr, File, Func, Import,
    ImportEquals, ImportSpec, Interface, Member, Module, Node, Param, Pat, PatElem, PatProp, Prop,
    Stmt, TupleElem, TypeNode, TypeParam, VarDecl,
};

/// How deep a helper follows constituents, base types, constraints, type arguments and the types
/// of properties. Upstream has no bound. Beyond it the answer is the one for which a rule reports
/// nothing.
pub(crate) const MAX_DEPTH: u32 = 100;

/// A node that knows the file it is in, so that it can be asked for its type without `services`:
/// every handle of [`ast`](crate::ast), [`NameOf`] one, and a [`TsNode`].
///
/// An [`Ident`](crate::ast::Ident) is not one: `file.type_checker().ts_node(ident)` is.
pub trait Located<'a>: Copy {
    /// `services.esTreeNodeToTSNodeMap.get(node)`
    fn to_ts_node(self) -> TsNode<'a>;
}

impl<'a> Located<'a> for TsNode<'a> {
    #[inline]
    fn to_ts_node(self) -> TsNode<'a> {
        self
    }
}

impl<'a> Located<'a> for &'a File<'a> {
    #[inline]
    fn to_ts_node(self) -> TsNode<'a> {
        self.locate(self)
    }
}

impl<'a> Located<'a> for Node<'a> {
    #[inline]
    fn to_ts_node(self) -> TsNode<'a> {
        self.ts_node()
    }
}

impl<'a> Located<'a> for NameOf<Node<'a>> {
    #[inline]
    fn to_ts_node(self) -> TsNode<'a> {
        self.locate(self.0.file())
    }
}

macro_rules! located {
    ($($handle:ident)*) => {
        $(impl<'a> Located<'a> for $handle<'a> {
            #[inline]
            fn to_ts_node(self) -> TsNode<'a> {
                self.ts_node()
            }
        }

        impl<'a> Located<'a> for NameOf<$handle<'a>> {
            #[inline]
            fn to_ts_node(self) -> TsNode<'a> {
                self.ts_node()
            }
        })*
    };
}

located! {
    Expr Stmt TypeNode Pat PatProp PatElem Func Class Param TypeParam Member Prop VarDecl Case
    EnumMember ImportSpec ExportSpec TupleElem Interface Alias Enum Module Import ImportEquals Export
}

/// A name or a list of names: upstream's `string | string[]` and `Set<string>`.
///
/// `"Promise"`, `&["Map", "ReadonlyMap"]`, a slice or a `&Vec` of anything that is bytes.
pub trait Names: Copy {
    /// `names.includes(name)`
    fn includes(self, name: &[u8]) -> bool;
}

impl Names for &str {
    #[inline]
    fn includes(self, name: &[u8]) -> bool {
        self.as_bytes() == name
    }
}

impl<T: AsRef<[u8]>> Names for &[T] {
    #[inline]
    fn includes(self, name: &[u8]) -> bool {
        self.iter().any(|it| it.as_ref() == name)
    }
}

impl<T: AsRef<[u8]>, const N: usize> Names for &[T; N] {
    #[inline]
    fn includes(self, name: &[u8]) -> bool {
        self.as_slice().includes(name)
    }
}

impl<T: AsRef<[u8]>> Names for &Vec<T> {
    #[inline]
    fn includes(self, name: &[u8]) -> bool {
        self.as_slice().includes(name)
    }
}
