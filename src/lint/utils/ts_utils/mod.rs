//! The syntactic parts of typescript-eslint's `util/` and of `@typescript-eslint/utils`' `ast-utils`.
//!
//! Everything is re-exported from here: `use bun_lint::utils::ts_utils::{get_name_from_member, ..};`
//!
//! No function takes `sourceCode` or `context`: a handle knows its file.
//!
//! **`ChainExpression`.** ESTree has two nodes for all of `a?.b.c()`: the `ChainExpression` and the
//! `CallExpression` in it. Here they are one `Expr`. Where the answer depends on which is meant, it
//! stands for the one that upstream's callers pass, and the doc comment says which:
//! the `ChainExpression` in [`is_strong_precedence_node`], [`is_weak_precedence_parent`],
//! [`get_wrapping_fixer`], [`get_moved_node_code`], [`is_node_equal`], [`is_conditional_test`], the
//! element in it in [`is_assignee`] and [`get_wrapping_fixer_for_chain_element`].
//!
//! # `@typescript-eslint/utils`: `ast-utils/`
//!
//! | upstream | here |
//! | --- | --- |
//! | `helpers.ts`: `isNodeOfType`, `isNodeOfTypes`, `isNodeOfTypeWithConditions`, `isTokenOfTypeWithConditions`, `isNotTokenOfTypeWithConditions` | `matches!(x.kind(), ..)`, `token.is_punctuator("..")`, `token.is_keyword("..")` |
//! | `misc.ts`: `LINEBREAK_MATCHER.exec(s)`, `.test(s)`, `s.split(LINEBREAK_MATCHER)` | `utils::text::{find_line_break, has_line_break, line_break_len, lines}` |
//! | `misc.ts`: `isTokenOnSameLine(a, b)` | [`is_token_on_same_line`]`(file, a, b)` |
//! | `predicates.ts`: `isOptionalChainPunctuator`, `isNonNullAssertionPunctuator`, `isAwaitKeyword`, `isTypeKeyword`, `isImportKeyword` | the same in snake case, on `&Token`, so that `tokens.find(is_await_keyword)` works |
//! | `isOptionalCallExpression`, `isLogicalOrOperator`, `isTypeAssertion`, `isAwaitExpression` | the same, on `Expr` |
//! | `isVariableDeclarator`, `isFunction`, `isFunctionType`, `isFunctionOrFunctionType`, `isTSFunctionType`, `isTSConstructorType`, `isClassOrTypeElement`, `isConstructor`, `isSetter`, `isLoop` | the same, on anything that converts to a `Node` |
//! | `eslint-utils/*`: `isParenthesized`, `getStaticValue`, `isOpeningParenToken`, .. | `utils::eslint_utils`, `utils::ast_utils` |
//!
//! # `eslint-plugin/src/util/`
//!
//! | upstream | here |
//! | --- | --- |
//! | `astUtils.ts`: `getNameLocationInGlobalDirectiveComment(sourceCode, comment, name)` | [`get_name_location_in_global_directive_comment`]`(&comment, name)` |
//! | `astUtils.ts`: `forEachReturnStatement(body, visitor)` | [`for_each_return_statement`]`(func, visitor)`, or `func.returns()` |
//! | `astUtils.ts`: `forEachChildESTree(node, callback)` | [`for_each_child_estree`] |
//! | `escapeRegExp.ts` | [`escape_reg_exp`] |
//! | `getAwaitTokenRemovalRange.ts` | [`get_await_token_removal_range`]`(file, token)` |
//! | `getFixOrSuggest.ts` | [`get_fix_or_suggest`]`(report, FixOrSuggest::.., MESSAGE, \|fixer\| ..)`, [`get_fix_or_suggest_with`] |
//! | `getForStatementHeadLoc.ts` | [`get_for_statement_head_loc`]`(stmt)` |
//! | `getFunctionHeadLoc.ts` | [`get_function_head_loc`]`(func)` |
//! | `getMemberHeadLoc.ts` | [`get_member_head_loc`]`(member)`, [`get_parameter_property_head_loc`]`(param, name)` |
//! | `getOperatorPrecedence.ts`: `OperatorPrecedence` | [`OperatorPrecedence`], with `COALESCE` as a constant |
//! | `getOperatorPrecedenceForNode(node)` | [`get_operator_precedence_for_node`]`(expr)` |
//! | `getOperatorPrecedence(tsNode.kind, operator, hasArguments)` | [`get_operator_precedence`], on `types::SyntaxKind`. Without a program: [`ts_syntax_kind`]`(expr)`, [`ts_operator_kind`]`(expr)` |
//! | `getOperatorPrecedence(tsNode.parent.kind, ..)` | [`get_operator_precedence_of_ts_parent`]`(expr)`, [`ts_parent_syntax_kind`] |
//! | `getBinaryOperatorPrecedence(operator)` | [`get_binary_operator_precedence`]`(BinOp)`, [`get_binary_operator_precedence_of_kind`]`(SyntaxKind)` |
//! | `getParentFunctionNode.ts` | [`get_parent_function_node`] |
//! | `getStaticStringValue.ts` | [`get_static_string_value`] |
//! | `getStringLength.ts` | [`get_string_length`] |
//! | `getTextWithParentheses.ts` | [`get_text_with_parentheses`] |
//! | `getThisExpression.ts` | [`get_this_expression`] |
//! | `getWrappedCode.ts` | [`get_wrapped_code`] |
//! | `getWrappingFixer.ts`: `getWrappingFixer({ node, innerNode, sourceCode, wrap })` | `.fix(\|fixer\| `[`get_wrapping_fixer`]`(fixer, `[`WrappingFixerParams`]` { node, inner_nodes: &[..], wrap: \|code\| .. }))`, [`get_wrapping_fixer_for_chain_element`], [`get_wrapping_fixer_without_wrap`] |
//! | `getMovedNodeCode`, `isStrongPrecedenceNode`, `isWeakPrecedenceParent`, and the private `isMissingSemicolonBefore`, `isLeftHandSide` | the same in snake case |
//! | `hasOverloadSignatures.ts` | [`has_overload_signatures`] |
//! | `isArrayMethodCallWithPredicate.ts` | [`is_array_method_call_with_predicate`]`(call, \|object\| ..)`: the closure tests the type |
//! | `isPromiseAggregatorMethod.ts` | [`is_promise_aggregator_method`]`(call, \|object\| ..)`: the closure tests the type |
//! | `isAssignee.ts`, `isConditionalTest.ts`, `isNodeEqual.ts`, `isNullLiteral.ts`, `isUndefinedIdentifier.ts` | the same in snake case, on `Expr` |
//! | `isHigherPrecedenceThanAwait.ts` | [`is_higher_precedence_than_await`]`(expr)` |
//! | `isStartOfExpressionStatement.ts`, `isStartOfExpressionStatementNeedingParentheses.ts`, `isStartOfArrowFunctionBodyNeedingParentheses.ts`, `needsPrecedingSemiColon.ts` | the same in snake case. A token is a `&Token` |
//! | `isTypeImport.ts` | [`is_type_import`]`(declaration)` |
//! | `skipChainExpression.ts` | [`skip_chain_expression`], the identity |
//! | `walkStatements.ts` | [`walk_statements`]`(statements)`, an iterator |
//! | `misc.ts`: `isDefinitionFile`, `upperCaseFirst`, `formatWordList`, `typeNodeRequiresParentheses`, `isRestParameterDeclaration`, `isParenlessArrowFunction`, `getNameFromIndexSignature` | the same in snake case |
//! | `misc.ts`: `getNameFromMember`, `MemberNameType` | [`get_name_from_member`]`(member_or_prop)` returns a [`MemberName`], [`MemberNameType`] |
//! | `misc.ts`: `NodeWithKey`, `getStaticMemberAccessValue`, `isStaticMemberAccessOfValue` | [`NodeWithKey`], [`get_static_member_access_value`] returns a [`MemberAccessValue`], [`is_static_member_access_of_value`]`(node, &["a", "b"])` |
//! | `requiresQuoting` of `type-utils` | [`requires_quoting`] |
//! | `misc.ts`: `findFirstResult`, `findLastIndex` | nothing: `Iterator::find_map`, `Iterator::rposition` |
//! | `misc.ts`: `getEnumNames`; `objectIterators.ts`: `objectForEachKey`, `objectMapKey`, `objectReduceKey` | nothing: they enumerate the keys of a JavaScript object. Write the list, or iterate over it |
//! | `rangeToLoc.ts` | nothing: `cx.report(Span::new(start, end), ..)` |
//! | `nullThrows`, `NullThrowsReasons` | `let .. else { return }`, `?` |
//! | `types.ts`: `MakeRequired`, `ValueOf`; `misc.ts`: `Equal`, `ExcludeKeys`, `RequireKeys` | nothing: types of TypeScript |
//! | `createRule.ts`, `getESLintCoreRule.ts`, `applyDefault`, `deepMerge`, `isObjectNotArray` | `rule.rs`, `options.rs` |
//! | `collectUnusedVariables.ts`, `class-scope-analyzer/`, `explicitReturnTypeUtils.ts`, `scopeUtils.ts`, `referenceContainsTypeQuery.ts`, `referenceContainsTypePredicate.ts`, `isTypeOnlyReference.ts` | `utils::ts_scope` |
//! | `truthinessUtils.ts`, `FunctionSignature.ts`, `assertionFunctionUtils.ts`, `baseTypeUtils.ts`, `getBaseTypesOfClassMember.ts`, `getConstraintInfo.ts`, `getValueOfLiteralType.ts`, `needsToBeAwaited.ts`, `promiseUtils.ts`, `getParserServices` | `types`: all of them work on types |

mod estree;
mod head_loc;
mod member_access;
mod misc;
mod nodes;
mod precedence;
mod predicates;
mod statement_start;
mod wrapping_fixer;

pub use head_loc::*;
pub use member_access::*;
pub use misc::*;
pub use nodes::*;
pub use precedence::*;
pub use predicates::*;
pub use statement_start::*;
pub use wrapping_fixer::*;

pub use super::ast_utils::{
    get_name_location_in_global_directive_comment, get_static_string_value, is_function, is_loop,
    is_null_literal, is_start_of_expression_statement, is_token_on_same_line,
    skip_chain_expression,
};
pub use super::text::{escape_reg_exp, upper_case_first};
