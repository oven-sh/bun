//! `@typescript-eslint/type-utils`, plus the parts of typescript-eslint's `eslint-plugin/src/util` that work on types.
//! The names are upstream's in snake_case, and everything is re-exported from here: `use bun_lint::types::utils::*;`
//!
//! Each function's doc comment starts with the upstream call, so `grep -rn 'isTypeAnyType' src/lint/types/utils` finds
//! it.
//!
//! Functions that take a `checker`, a `program` or `services` upstream don't here, because a handle knows its checker.
//! A `ts.Node` or `TSESTree.Node` that's only passed on to the checker is any [`Locate`] if there's a
//! [`Type`](super::Type) argument next to it, and a [`Located`] if there isn't.
//!
//! [`is_array_method_call_with_predicate`], [`is_promise_aggregator_method`] and [`is_rest_parameter_declaration`] have
//! namesakes in [`ts_utils`](crate::utils::ts_utils) that don't use types.
//!
//! # Where the checker gave up
//!
//! A type that [is unresolved](super::Type::is_unresolved) has [`TypeFlags::ANY`](super::TypeFlags), and TypeScript has
//! no such type. [`is_type_any_type`] doesn't count it as `any`, and so neither do [`is_type_any_array_type`],
//! [`discriminate_any_type`] and [`is_unsafe_assignment`]. They do count the error type as `any`, as upstream does. A
//! rule can detect it with [`tsutils::is_intrinsic_error_type`](super::tsutils::is_intrinsic_error_type).

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

use super::{Locate, NameOf, TsNode, Type};
use crate::ast::{
    Alias, Case, Class, Enum, EnumMember, Export, ExportSpec, Expr, File, Func, Import,
    ImportEquals, ImportSpec, Interface, Member, Module, Node, Param, Pat, PatElem, PatProp, Prop,
    Stmt, TupleElem, TypeNode, TypeParam, VarDecl,
};

/// True if the stack has room for a helper to keep following constituents, base types, constraints, type arguments and
/// property types. Upstream overflows its stack. When there's no room, a helper returns the answer that makes a rule
/// report nothing.
#[inline]
pub(crate) fn has_room_on_the_stack() -> bool {
    bun_core::StackCheck::init().is_safe_to_recurse()
}

/// A node that knows its file, so its type can be queried without `services`: every [`ast`](crate::ast) handle, a
/// [`NameOf`] around one, and a [`TsNode`].
///
/// An [`Ident`](crate::ast::Ident) isn't one. Use `file.type_checker().ts_node(ident)`.
pub trait Located<'a>: Copy {
    /// `services.esTreeNodeToTSNodeMap.get(node)`
    fn to_ts_node(self) -> TsNode<'a>;

    /// `services.getTypeAtLocation(node)`
    #[inline]
    fn to_type(self) -> Type<'a> {
        self.to_ts_node().get_type_at_location()
    }
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
    #[inline]
    fn to_type(self) -> Type<'a> {
        self.ty()
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
            #[inline]
            fn to_type(self) -> Type<'a> {
                self.type_at_location()
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
/// Implemented for `"Promise"`, `&["Map", "ReadonlyMap"]`, and a slice or `&Vec` of anything byte-like.
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
