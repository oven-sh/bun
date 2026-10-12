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
//! | `./utils/fix-tracker` | [`fix_tracker`] | `FixTracker::new(fixer).retain_enclosing_function(node).retain_range(span).replace_text_range(span, text)`, `.remove(node)` |
//! | `./utils/keywords` | [`keywords`] | `keywords::KEYWORDS`, `keywords::is_keyword` |
//! | `./utils/unicode` | [`unicode`] | `is_combining_character(c)`, `is_emoji_modifier(c)`, `is_regional_indicator_symbol(c)`, `is_surrogate_pair(lead, tail)`, on `u32` |
//! | `./utils/char-source` | [`char_source`] | `parse_string_literal(raw)`, `parse_template_token(raw)` return `Vec<CharInfo>`: one for each UTF-16 code unit of the value, with the bytes of the source it comes from |
//! | `./utils/regular-expressions` | [`regular_expressions`] | `is_valid_with_unicode_flag(ecma_version, pattern, UnicodeFlag::U)`, `REGEXPP_LATEST_ECMA_VERSION` |
//! | `./utils/string-utils`, `../shared/string-utils` | [`string_utils`] | `upper_case_first`, `get_grapheme_count`, `graphemes`, `LETTER_PATTERN`: `find_letter`, `contains_letter`, `is_letter` |
//! | `../shared/naming`, `../shared/directives` | [`naming`], [`directives`] | `normalize_package_name`, `get_shorthand_name`, `get_namespace_from_term`, `directivesPattern`: `match_directives_pattern(text)` |
//! | `require("natural-compare")`, `esutils.keyword.isIdentifierES5/ES6`, `require("escape-string-regexp")` | [`text`] | `text::natural_compare(a, b)`, `text::is_identifier_es6(name)`, `bun_core::strings::escape_reg_exp(s, &mut out)` |
//! | `require("ignore")` | [`crate::ignore`] | `IgnoreRules::from_lines(patterns, IgnoreOptions { has_braces: false, ignores_case }).ignores(path)` |
//! | `node.type`, `node.range`, `node.parent`, `ChainExpression`, `SequenceExpression`, patterns in assignments | [`estree_compat`], re-exported from here | `utils::estree_type_name(node)`, `utils::estree_type_at(file, offset)`, `utils::Target` |
//! | `array.sort((a, b) => a > b ? 1 : -1)`, a comparison that never answers 0 | [`array`] | `utils::array_sort_by(&mut items, \|a, b\| ..)` |
//! | `a.localeCompare(b)`, `new Intl.Collator("en", { numeric: true, sensitivity: "base" })` | `bun_core::strings` | `strings::locale_compare(a, b)`, `strings::locale_compare_numeric_base(a, b)` |
//! | a `Literal` listener that looks at strings or numbers: keys, module specifiers and literal types are not expressions here | `rule.rs` | `on.string_literals(f)`, `on.number_literals(f)` |
//! | `n.toString(radix)`, `parseInt`, `parseFloat`, `ToInt32` | [`eslint_utils::js_number`] | `js_number::parse_int(text, 10)`, .. |
//! | `n.toPrecision(p)`, `n.toFixed(d)`, `n.toExponential(d)`, `Number(s)` | `bun_core::fmt` | `FormatDouble::to_precision(&mut [0; 124], n, p)`, `js_string_to_number(s)` |
//! | methods of `String`, `/\s/` | [`text`] | `bun_core::strings::trim_js_whitespace(bytes)`, `bun_core::strings::wtf8_len_utf16(bytes)` |
//! | a loop over `node.parent` from each of many nodes | [`ancestor_memo`] | `AncestorMemo::default()` in the state, `cx.state.find(node, \|child, parent\| ..)` |
//!
//! A function that takes two handles has one lifetime for both, `fn f<'a>(a: Expr<'a>, b: Expr<'a>)`:
//! a `File<'a>` is invariant in `'a`.
//!
//! Several of these have a function of the same name that behaves differently, as upstream:
//! `get_function_name_with_kind` and `get_function_head_loc[ation]` in `ast_utils`, `eslint_utils`
//! and `ts_utils`, `is_parenthesised` in `ast_utils` and `is_parenthesized` in `eslint_utils`. Take
//! the one from the module that the upstream rule imports from.

pub mod ancestor_memo;
pub mod array;
pub mod ast_utils;
pub mod char_source;
pub mod code_frame;
pub mod directives;
pub mod eslint_utils;
pub mod estree_compat;
mod estree_type_at;
pub mod fix_tracker;
pub mod keywords;
pub mod node;
pub mod oxlint;
pub mod regular_expressions;
pub mod sort;
pub mod string_utils;
pub mod text;
pub mod ts_scope;
pub mod ts_utils;
pub mod unicode;

pub use array::array_sort_by;
pub use estree_compat::{
    Target, TargetElement, TargetKind, estree_parent, estree_span, estree_type_name,
    get_node_by_range_index, is_assignment_target, is_chain_root, is_expression_statement,
    is_for_init, is_in_type_query, is_sequence_root, last_sequence_expression, normalize,
    sequence_root, type_annotation_span,
};
pub use estree_type_at::estree_type_at;
