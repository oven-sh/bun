#!/usr/bin/env python3
"""Applies the prototype of B3 to a scratch COPY of src/js_parser (never to the worktree).
usage: apply.py <scratch>/src/js_parser
Each edit replaces one exact text that must stand once in its file."""
import sys
from pathlib import Path

root = Path(sys.argv[1])


def edit(name, old, new, count=1):
    path = root / name
    text = path.read_text()
    if text.count(old) != count:
        sys.exit(f"{name}: {text.count(old)} times, not {count}: {old[:70]!r}")
    path.write_text(text.replace(old, new))


# the module
edit("parse/mod.rs", "pub mod generics;\n", "pub mod generics;\npub(crate) mod operand_checks;\n")

# the walk, after a lint parse that logged nothing
edit(
    "parse/parse_entry.rs",
    "                Ok(_) if p.log().errors > orig_error_count => Err(crate::Error::SyntaxError),\n                Ok(stmts) => Ok(stmts),\n",
    "                Ok(_) if p.log().errors > orig_error_count => Err(crate::Error::SyntaxError),\n"
    "                Ok(stmts) => match p.check_operands_for_lint(stmts.as_slice()) {\n"
    "                    Ok(()) => Ok(stmts),\n"
    "                    Err(err) => Err(err),\n"
    "                },\n",
)

# the diagnostics of the reference that the walk reports
edit("parse/syntax_errors.rs", "    const fn new(code: u32, text: &'static [u8]) -> Message {", "    pub(crate) const fn code(self) -> u32 {\n        self.code\n    }\n\n    const fn new(code: u32, text: &'static [u8]) -> Message {")
edit("parse/syntax_errors.rs", "const IDENTIFIER_EXPECTED: Message = ", "pub(crate) const IDENTIFIER_EXPECTED: Message = ")
edit("parse/syntax_errors.rs", "const X_0_EXPECTED: Message = ", "pub(crate) const X_0_EXPECTED: Message = ")
edit(
    "parse/syntax_errors.rs",
    "const DECLARATION_OR_STATEMENT_EXPECTED: Message =\n",
    "/// `Unexpected_token_A_constructor_method_accessor_or_property_was_expected`\n"
    "pub(crate) const UNEXPECTED_TOKEN_CLASS_MEMBER: Message = Message::new(\n"
    "    1068,\n"
    "    b\"Unexpected token. A constructor, method, accessor, or property was expected.\",\n"
    ");\n"
    "/// `Statement_expected`\n"
    "pub(crate) const STATEMENT_EXPECTED: Message = Message::new(1129, b\"Statement expected.\");\n"
    "/// `An_enum_member_name_must_be_followed_by_a_or`\n"
    "pub(crate) const ENUM_MEMBER_NAME_MUST_BE_FOLLOWED: Message = Message::new(\n"
    "    1357,\n"
    "    b\"An enum member name must be followed by a ',', '=', or '}'.\",\n"
    ");\n"
    "/// `Declaration_or_statement_expected_This_follows_a_block_of_statements_so_if_you_intended_to_write_a_destructuring_assignment_you_might_need_to_wrap_the_whole_assignment_in_parentheses`\n"
    "pub(crate) const EQUALS_AFTER_BLOCK: Message = Message::new(\n"
    "    2809,\n"
    "    b\"Declaration or statement expected. This '=' follows a block of statements, so if you intended to write a destructuring assignment, you might need to wrap the whole assignment in parentheses.\",\n"
    ");\n"
    "pub(crate) const DECLARATION_OR_STATEMENT_EXPECTED: Message =\n",
)
edit("parse/syntax_errors.rs", "    fn code_syntax_error(\n", "    pub(crate) fn code_syntax_error(\n")

# H1: a type assertion is no left side of an assignment
edit(
    "parse/parse_prefix.rs",
    "                .type_assertion(value, loc, greater_than, type_node);\n        }\n        Ok(value)\n",
    "                .type_assertion(value, loc, greater_than, type_node);\n        }\n"
    "        // parseAssignmentExpressionOrHigher: a type assertion is no left-hand side expression.\n"
    "        if p.lexer.token.is_assign() {\n"
    "            p.forbid_suffix_after_as_loc = p.lexer.loc();\n"
    "        }\n"
    "        Ok(value)\n",
)

# H2: no non-null "!" after a postfix update or a JSX element
edit(
    "parse/parse_suffix.rs",
    "        if let Some(starts) = &mut p.starts_for_parse_only {\n            starts.wrappers.non_null(*left, p.lexer.loc());\n        }\n",
    "        if p.starts_for_parse_only.is_some() && Self::sfx_non_null_for_lint(p, left) {\n"
    "            return Ok(Continuation::Done);\n"
    "        }\n",
)
edit(
    "parse/parse_suffix.rs",
    "    fn sfx_t_minus_minus(p: &mut Self, level: Level, left: &mut Expr) -> CResult {\n",
    "    /// `operand!` of a lint parse, at the `!`. True: the reference ends the expression before it.\n"
    "    #[cold]\n"
    "    #[inline(never)]\n"
    "    fn sfx_non_null_for_lint(p: &mut Self, left: &Expr) -> bool {\n"
    "        if p.is_bare_chain_end(left) {\n"
    "            return true;\n"
    "        }\n"
    "        if let Some(starts) = &mut p.starts_for_parse_only {\n"
    "            starts.wrappers.non_null(*left, p.lexer.loc());\n"
    "        }\n"
    "        false\n"
    "    }\n\n"
    "    fn sfx_t_minus_minus(p: &mut Self, level: Level, left: &mut Expr) -> CResult {\n",
)

# H3: no type arguments after a postfix update or a JSX element
edit(
    "parse/parse_suffix.rs",
    "        if p.starts_for_parse_only.is_some() {\n            return p.lint_type_arguments_in_expression(*left);\n        }\n",
    "        if p.starts_for_parse_only.is_some() {\n"
    "            return !p.is_bare_chain_end(left) && p.lint_type_arguments_in_expression(*left);\n"
    "        }\n",
)
print("applied")
