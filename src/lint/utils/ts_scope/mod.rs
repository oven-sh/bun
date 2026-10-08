//! The parts of typescript-eslint's `util/` that analyze scopes and classes.
//!
//! | typescript-eslint | here |
//! | --- | --- |
//! | `checkFunctionReturnType` | [`check_function_return_type`] |
//! | `checkFunctionExpressionReturnType` | [`check_function_expression_return_type`] |
//! | `doesImmediatelyReturnFunctionExpression` | [`does_immediately_return_function_expression`] |
//! | `isTypedFunctionExpression` | [`is_typed_function_expression`] |
//! | `isValidFunctionExpressionReturnType` | [`is_valid_function_expression_return_type`] |
//! | `ancestorHasReturnType` | [`ancestor_has_return_type`] |
//! | `FunctionInfo`, `Options` of `explicitReturnTypeUtils` | [`FunctionInfo`], [`ReturnTypeOptions`] |
//! | `isReferenceToGlobalFunction` | [`is_reference_to_global_function`] |
//! | `referenceContainsTypeQuery` | [`reference_contains_type_query`] |
//! | `referenceContainsTypePredicate` | [`reference_contains_type_predicate`] |
//! | `isTypeOnlyReference` | [`is_type_only_reference`] |
//! | `isMergedTypeValueVariable` | [`is_merged_type_value_variable`] |
//! | `variable.isTypeVariable`, `variable.isValueVariable` | [`is_type_variable`], [`is_value_variable`] |
//! | `definition.isTypeDefinition`, `definition.isVariableDefinition` | [`is_type_definition`], [`is_variable_definition`] |
//! | `definition.type === DefinitionType.Variable` | [`is_variable_declarator_definition`] |
//! | `reference.isValueReference` | [`is_value_reference`] |

mod estree;
mod explicit_return_type_utils;
mod is_type_only_reference;
mod reference_contains_type_predicate;
mod reference_contains_type_query;
mod scope_utils;

pub use explicit_return_type_utils::*;
pub use is_type_only_reference::*;
pub use reference_contains_type_predicate::*;
pub use reference_contains_type_query::*;
pub use scope_utils::*;
