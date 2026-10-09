//! What many rules need: ports of ESLint's `lib/rules/utils/ast-utils.js`, of
//! `@eslint-community/eslint-utils` and of typescript-eslint's `util/`, under the same names in
//! snake case.
//!
//! The doc comment of each function starts with the name it has upstream, so
//! `grep -rn 'getStaticPropertyName' src/lint/utils` finds it.
//!
//! | upstream | module | a rule writes |
//! | --- | --- | --- |
//! | `require("./utils/ast-utils")` | [`ast_utils`] | `use bun_lint::utils::ast_utils;` and `ast_utils::is_function(node)`, as upstream's `astUtils.isFunction(node)` |
//! | `require("@eslint-community/eslint-utils")`, `ASTUtils` of `@typescript-eslint/utils` | [`eslint_utils`] | `use bun_lint::utils::eslint_utils::{get_static_value, ..};` |
//! | `import { .. } from '../util'` in typescript-eslint, syntax only | [`ts_utils`] | `use bun_lint::utils::ts_utils::{get_name_from_member, ..};` |
//! | the same: `collectVariables`, `analyzeClassMemberUsage`, `explicitReturnTypeUtils`, `scopeUtils`, `referenceContainsTypeQuery` | [`ts_scope`] | `use bun_lint::utils::ts_scope::{..};` |
//! | `./utils/fix-tracker` | [`fix_tracker`] | `FixTracker::new(fixer).retain_enclosing_function(node).retain_surrounding_tokens(token).retain_range(span).replace_text_range(span, text)`, `.remove(node)` |
//! | `./utils/keywords` | [`keywords`] | `keywords::KEYWORDS`, `keywords::is_keyword` |
//! | `./utils/unicode` | [`unicode`] | `is_combining_character(c)`, `is_emoji_modifier(c)`, `is_regional_indicator_symbol(c)`, `is_surrogate_pair(lead, tail)`, on `u32` |
//! | `./utils/char-source` | [`char_source`] | `parse_string_literal(raw)`, `parse_template_token(raw)` return `Vec<CharInfo>`: one for each UTF-16 code unit of the value, with the bytes of the source it comes from |
//! | `./utils/regular-expressions` | [`regular_expressions`] | `is_valid_with_unicode_flag(ecma_version, pattern, UnicodeFlag::U)`, `REGEXPP_LATEST_ECMA_VERSION` |
//! | `./utils/string-utils`, `../shared/string-utils` | [`string_utils`] | `upper_case_first`, `get_grapheme_count`, `graphemes`, `LETTER_PATTERN`: `find_letter`, `contains_letter`, `is_letter` |
//! | `../shared/naming`, `../shared/directives` | [`naming`], [`directives`] | `normalize_package_name`, `get_shorthand_name`, `get_namespace_from_term`, `directivesPattern`: `match_directives_pattern(text)` |
//! | `require("natural-compare")`, `esutils.keyword.isIdentifierES5/ES6`, `require("escape-string-regexp")` | [`text`] | `text::natural_compare(a, b)`, `text::is_identifier_es6(name)`, `text::escape_string_regexp(s)` |
//! | `require("ignore")` | `bun_glob::ignore` | `IgnoreRules::from_lines(patterns, IgnoreOptions { syntax: IgnoreSyntax::Npm5, ignores_case }).ignores(path)` |
//! | `node.type`, `node.range`, `node.parent`, `ChainExpression`, `SequenceExpression`, patterns in assignments | [`estree_compat`], re-exported from here | `utils::estree_type_name(node)`, `utils::estree_type_at(file, offset)`, `utils::sequence_expressions(e)`, `utils::Target` |
//! | `array.sort((a, b) => a > b ? 1 : -1)`, a comparison that never answers 0 | [`array`] | `utils::array_sort_by(&mut items, \|a, b\| ..)` |
//! | `a.localeCompare(b)`, `new Intl.Collator("en", { numeric: true, sensitivity: "base" })` | [`collation`] | `collation::locale_compare(a, b)`, `collation::collator_compare_numeric_base(a, b)` |
//! | a `Literal` listener that looks at strings or numbers: keys, module specifiers and literal types are not expressions here | `rule.rs` | `on.string_literals(f)`, `on.number_literals(f)` |
//! | `n.toString(radix)`, `parseInt`, `parseFloat`, `ToInt32` | [`eslint_utils::js_number`] | `js_number::parse_int(text, 10)`, .. |
//! | `n.toPrecision(p)`, `n.toFixed(d)`, `n.toExponential(d)`, `Number(s)` | `bun_core::fmt` | `FormatDouble::to_precision(&mut [0; 124], n, p)`, `js_string_to_number(s)` |
//! | methods of `String`, `/\s/`, `escapeRegExp` | [`text`] | `bun_core::strings::trim_js_whitespace(bytes)`, `bun_core::strings::wtf8_len_utf16(bytes)` |
//! | `equalTokens` of each of n nodes with each other | [`token_key`] | `TokenClasses::default().number_of(file, node)`: the same number for the same tokens |
//! | a loop over `node.parent` from each of many nodes | [`ancestor_memo`] | `AncestorMemo::default()` in the state, `cx.state.find(node, \|child, parent\| ..)` |
//!
//! A function that takes two handles has one lifetime for both, `fn f<'a>(a: Expr<'a>, b: Expr<'a>)`:
//! a `File<'a>` is invariant in `'a`.
//!
//! Several of these have a function of the same name that behaves differently, as upstream:
//! `get_function_name_with_kind` and `get_function_head_loc[ation]` in `ast_utils`, `eslint_utils`
//! and `ts_utils`, `is_parenthesised` in `ast_utils` and `is_parenthesized` in `eslint_utils`. Take
//! the one from the module that the upstream rule imports from.
//!
//! # `ast-utils.js`
//!
//! | ESLint | [`ast_utils`] |
//! | --- | --- |
//! | `COMMENTS_IGNORE_PATTERN.test(s)` | `matches_comments_ignore_pattern(s)` |
//! | `LINEBREAK_MATCHER.test(s)`, `.exec(s)` | `bun_core::strings::contains_js_line_break(s)`, `bun_core::strings::find_js_line_break(s)` |
//! | `createGlobalLinebreakMatcher()` | `create_global_linebreak_matcher(s)`, `bun_core::strings::js_lines(s)` |
//! | `SHEBANG_MATCHER` | `match_shebang(s)` |
//! | `STATEMENT_LIST_PARENTS.has(node.parent.type)` | `is_statement_list_parent(stmt.parent())` |
//! | `ECMASCRIPT_GLOBALS` | `is_ecmascript_global(name)`, `ecmascript_global_since(name)` |
//! | `isTokenOnSameLine(a, b)` | `is_token_on_same_line(file, a, b)` |
//! | `isArrowToken`, `isCommaToken`, `isSemicolonToken`, `isColonToken`, `isDotToken`, `isQuestionDotToken`, `isEqToken`, `isOpening/ClosingParen/Bracket/BraceToken`, `isNot..Token`, `isCommentToken`, `isKeywordToken` | the same in snake case, on `&Token` |
//! | `canContinueExpressionInClassBody`, `isDirectiveComment` | the same, on `&Token` |
//! | `equalTokens(a, b, sourceCode)` | `equal_tokens(file, a, b)` |
//! | `canTokensBeAdjacent(a, b)` | `can_tokens_be_adjacent(a, b)`: tokens, `&str` or `&[u8]` |
//! | `getNameLocationInGlobalDirectiveComment(sourceCode, comment, name)` | `get_name_location_in_global_directive_comment(&comment, name)` |
//! | `isFunction`, `isLoop`, `isInLoop`, `getUpperFunction` | `is_function(node)`, `as_function(node)`, `is_loop(node)`, `is_in_loop(node)`, `get_upper_function(node)` |
//! | `isBreakableStatement`, `isEmptyBlock`, `isDirective`, `isTopLevelExpressionStatement`, `getTrailingStatement`, `areBracesNecessary` | the same, on `Stmt` |
//! | `isEmptyFunction`, `isES5Constructor`, `getFunctionNameWithKind`, `getFunctionHeadLoc`, `getOpeningParenOfParams` | the same, on `Func` |
//! | `isDefaultThisBinding(node, sourceCode, { capIsConstructor })` | `is_default_this_binding(func, cap_is_constructor)` |
//! | `getDirectivePrologue(node)` | `get_directive_prologue(file_or_func)` |
//! | `isNullLiteral`, `isNullOrUndefined`, `isStringLiteral`, `isNumericLiteral`, `isStaticTemplateLiteral`, `isDecimalInteger`, `isCallee`, `couldBeError`, `getPrecedence`, `getBooleanValue`, `getStaticStringValue` | the same, on `Expr` |
//! | `isLogicalExpression`, `isCoalesceExpression`, `isMixedLogicalAndCoalesceExpressions` | the same, on `Expr` |
//! | `getPrecedence({ type: "BinaryExpression", operator })` | `get_binary_operator_precedence(op)` |
//! | `isLogicalAssignmentOperator(node.operator)` | `is_logical_assignment_operator(op)` |
//! | `getStaticPropertyName(node)` | `get_static_property_name(expr_or_prop_or_member)`, `get_static_key_name(key)` |
//! | `skipChainExpression(node)` | `skip_chain_expression(e)`, the identity |
//! | `isSpecificId(node, name)` | `is_specific_id(e, "name")`, `is_specific_id_with(e, \|name\| ..)` |
//! | `isSpecificMemberAccess(node, object, property)` | `is_specific_member_access(e, Some("object"), Some("property"))`, `is_member_access_of_any(e, &["a", "b"])` |
//! | `equalLiteralValue`, `isSameReference(a, b, disableStaticComputedKey)` | the same, on `Expr` |
//! | `isArrayFromMethod`, `isArrayFromAsyncMethod`, `isPropertyDescriptor` | the same, on `Expr` |
//! | `isParenthesised(sourceCode, node)`, `getParenthesisedText(sourceCode, node)` | `is_parenthesised(node)`, `get_parenthesised_text(node)` |
//! | `isConstant(scope, node, inBooleanPosition)` | `is_constant(e, in_boolean_position)` |
//! | `isReferenceToGlobalVariable(scope, node)`, `sourceCode.isGlobalReference(node)` | `is_reference_to_global_variable(e)`, `is_global_reference(e)`, `is_configured_global(file, name)` |
//! | `getVariableByName(scope, name)` | `get_variable_by_name(scope, name)` |
//! | `getModifyingReferences(references)` | `get_modifying_references(symbol.references())` |
//! | `isStartOfExpressionStatement(node)`, `needsPrecedingSemicolon(sourceCode, node)` | `is_start_of_expression_statement(node)`, `needs_preceding_semicolon(node)` |
//! | `getSwitchCaseColonToken(node, sourceCode)` | `get_switch_case_colon_token(case)` |
//! | `getModuleExportName(node)` | `ident.name()` |
//! | `getNextLocation(sourceCode, loc)` | `get_next_location(file, position)` |
//! | `isImportAttributeKey(node)` | `is_import_attribute_key(prop)` |
//! | `isSurroundedBy`, `hasOctalOrNonOctalDecimalEscapeSequence` | the same, on `&[u8]` |

pub mod ancestor_memo;
pub mod array;
pub mod ast_utils;
pub mod char_source;
pub mod code_frame;
pub mod collation;
pub mod directives;
pub mod eslint_utils;
pub mod estree_compat;
mod estree_type_at;
pub mod fix_tracker;
pub mod keywords;
pub mod naming;
pub mod node;
pub mod oxlint;
pub mod regular_expressions;
pub mod sort;
pub mod string_utils;
pub mod text;
pub mod token_key;
pub mod ts_scope;
pub mod ts_utils;
pub mod unicode;

pub use array::array_sort_by;
pub use estree_compat::{
    Target, TargetElement, TargetKind, catch_clause_span, chain_root, estree_ancestors,
    estree_parent, estree_span, estree_type_name, get_node_by_range_index, is_assignment_target,
    is_chain_root, is_expression_statement, is_for_init, is_in_optional_chain, is_in_type_query,
    is_sequence_root, last_sequence_expression, normalize, sequence_expressions, sequence_root,
    type_annotation_span,
};
pub use estree_type_at::estree_type_at;
