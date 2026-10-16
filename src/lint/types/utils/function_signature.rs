//! `FunctionSignature.ts`

use super::{Located, is_rest_parameter_declaration};
use crate::types::Type;
use crate::types::ty::TypeList;
use smallvec::SmallVec;

#[derive(Copy, Clone, Debug)]
enum RestTypeKind<'a> {
    /// The type of an element of the array, or the type of the parameter if it is no array.
    ArrayOrOther(Type<'a>),
    Tuple(TypeList<'a>),
}

#[derive(Copy, Clone, Debug)]
struct RestType<'a> {
    index: usize,
    kind: RestTypeKind<'a>,
}

/// `FunctionSignature`: the types of the parameters of the function that a call calls, one for each
/// argument in turn.
#[derive(Clone, Debug)]
pub struct FunctionSignature<'a> {
    has_consumed_arguments: bool,
    parameter_type_index: usize,
    param_types: SmallVec<[Type<'a>; 4]>,
    rest_type: Option<RestType<'a>>,
}

impl<'a> FunctionSignature<'a> {
    /// `FunctionSignature.create(checker, tsNode)`, for a call, a `new` or a tagged template.
    /// A call that resolves to no signature has no parameters.
    pub fn create(ts_node: impl Located<'a>) -> FunctionSignature<'a> {
        Self::with_rest_type(ts_node, rest_type_of_base_constraint)
    }

    /// tsgolint's `newFunctionSignature(typeChecker, node)` of `no_unsafe_argument.go`: the rest
    /// type is its `getRestType()`.
    pub fn new_function_signature(ts_node: impl Located<'a>) -> FunctionSignature<'a> {
        Self::with_rest_type(ts_node, get_rest_type)
    }

    fn with_rest_type(
        ts_node: impl Located<'a>,
        rest_type_kind: fn(Type<'a>) -> RestTypeKind<'a>,
    ) -> FunctionSignature<'a> {
        let ts_node = ts_node.to_ts_node();
        let mut param_types = SmallVec::new();
        let mut rest_type = None;
        let parameters = ts_node
            .get_resolved_signature()
            .map(|signature| signature.get_parameters());
        for (index, param) in parameters.into_iter().flatten().enumerate() {
            let ty = param.get_type_at_location(ts_node);
            if param
                .declarations()
                .next()
                .is_some_and(is_rest_parameter_declaration)
            {
                let kind = rest_type_kind(ty);
                rest_type = Some(RestType { index, kind });
                break;
            }
            param_types.push(ty);
        }
        FunctionSignature {
            has_consumed_arguments: false,
            parameter_type_index: 0,
            param_types,
            rest_type,
        }
    }

    /// `consumeRemainingArguments()`: after a spread argument, how many arguments there are is
    /// unknown.
    pub fn consume_remaining_arguments(&mut self) {
        self.has_consumed_arguments = true;
    }

    /// `getNextParameterType()`: the type of the parameter that the next argument is for. `None`:
    /// there are more arguments than parameters.
    pub fn get_next_parameter_type(&mut self) -> Option<Type<'a>> {
        let index = self.parameter_type_index;
        self.parameter_type_index += 1;
        if index < self.param_types.len() && !self.has_consumed_arguments {
            return self.param_types.get(index).copied();
        }
        let rest_type = self.rest_type?;
        match rest_type.kind {
            RestTypeKind::Tuple(type_arguments) => {
                let type_index = index.saturating_sub(rest_type.index);
                match self.has_consumed_arguments || type_index >= type_arguments.len() {
                    true => type_arguments.last(),
                    false => type_arguments.get(type_index),
                }
            }
            RestTypeKind::ArrayOrOther(ty) => Some(ty),
        }
    }
}

/// typescript-eslint: of the base constraint, the elements of a tuple, or else the number index type.
fn rest_type_of_base_constraint<'a>(ty: Type<'a>) -> RestTypeKind<'a> {
    let constrained_type = ty.get_base_constraint_of_type().unwrap_or(ty);
    match constrained_type.is_tuple_type() {
        true => RestTypeKind::Tuple(constrained_type.get_type_arguments()),
        false => RestTypeKind::ArrayOrOther(
            constrained_type
                .get_number_index_type()
                .unwrap_or(constrained_type),
        ),
    }
}

/// tsgolint's `getRestType()`: only an array or a tuple is taken apart, and no constraint is
/// looked at. A type parameter, a union and an interface that extends `Array` stay as they are.
fn get_rest_type<'a>(ty: Type<'a>) -> RestTypeKind<'a> {
    if ty.is_array_type() {
        return RestTypeKind::ArrayOrOther(ty.get_type_arguments().get(0).unwrap_or(ty));
    }
    match ty.is_tuple_type() {
        true => RestTypeKind::Tuple(ty.get_type_arguments()),
        false => RestTypeKind::ArrayOrOther(ty),
    }
}
