//! The parts of typescript-eslint's `util/` that analyze scopes and classes.
//!
//! `test/cli/lint/oracle/utils-tsscope` compares them with upstream (`bun-lint utils-tsscope batch`).
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
//! | `isTypeImport` | [`is_type_import`] |
//! | `collectVariables`, `VariableAnalysis` | [`collect_variables`], [`VariableAnalysis`] |
//! | scope-manager's `Variable`, with the two variables of a class | [`Variable`] |
//! | `variable.eslintUsed`, `sourceCode.markVariableAsUsed`, `/* exported */` | [`UsedMarks`] |
//! | `isUsedVariable` | [`is_used_variable`], [`is_used_global_variable`] |
//! | `isExported`, `isMergeableExported` | [`is_exported`], [`is_mergeable_exported`] |
//! | `isSelfReference`, `isInsideOneOf` | [`get_self_reference_ranges`] |
//! | `isReadForItself`, `getRhsNode`, `isUnusedExpression` | [`is_read_for_itself`], [`get_rhs_node`], [`is_unused_expression`] |
//! | `hasRestSibling(id.parent)`, `def.name.parent.type === "ArrayPattern"`, `ref.identifier.parent.type === "ArrayPattern"` | [`has_rest_sibling`], [`is_defined_in_array_pattern`], [`is_referenced_in_array_pattern`] |
//! | `isInsideOfStorableFunction`, `isStorableFunction` | [`is_inside_of_storable_function`], [`is_storable_function`] |
//! | `analyzeClassMemberUsage`, `ClassScopeResult` | [`analyze_class_member_usage`], [`ClassMemberUsage`], [`ClassScopeResult`] |
//! | `Member`, `MemberNode` of `class-scope-analyzer` | [`ClassMember`], [`MemberNode`] |
//! | `extractNameForMember`, `extractNameForMemberExpression`, `ExtractedName` | [`extract_name_for_member`], [`extract_name_for_member_expression`], [`ExtractedName`] |

mod class_scope_analyzer;
mod collect_unused_variables;
mod estree;
mod explicit_return_type_utils;
mod is_type_import;
mod is_type_only_reference;
mod reference_contains_type_predicate;
mod reference_contains_type_query;
mod scope_utils;

pub use class_scope_analyzer::*;
pub use collect_unused_variables::*;
pub use explicit_return_type_utils::*;
pub use is_type_import::*;
pub use is_type_only_reference::*;
pub use reference_contains_type_predicate::*;
pub use reference_contains_type_query::*;
pub use scope_utils::*;
