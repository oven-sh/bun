#!/usr/bin/env python3
"""Applies the prototype of "the checks of the reference on expressions outside the type grammar" (round 2 of the parser, B4)
to a scratch COPY of src/js_parser (at be1ebe5295). usage: apply.py <scratch>/src/js_parser
Nothing of the worktree is touched. The prototype sits on the table of the head (records beside the log): the code on the
message itself is the work of B2, and `lint_error` here stands in for the one of B2.
PROTO_WIDEN=0 leaves the eight unary handlers as they are (no record for the outer operator of a chain)."""
import os
import sys

root = sys.argv[1]
widen = os.environ.get("PROTO_WIDEN", "1") != "0"


def edit(name, replacements):
    path = os.path.join(root, name)
    text = open(path, encoding="utf-8").read()
    for old, new, count in replacements:
        found = text.count(old)
        if found != count:
            raise SystemExit(f"{name}: expected {count} of {old!r}, found {found}")
        text = text.replace(old, new)
    open(path, "w", encoding="utf-8").write(text)


def within(text, start_marker, end_marker, old, new, name):
    start = text.index(start_marker)
    end = text.index(end_marker, start + len(start_marker))
    body = text[start:end]
    if body.count(old) != 1:
        raise SystemExit(f"{name}: expected 1 of {old!r} after {start_marker!r}, found {body.count(old)}")
    return text[:start] + body.replace(old, new) + text[end:]


# ── parse_prefix.rs ────────────────────────────────────────────────────────────────────────────────────────────────
path = os.path.join(root, "parse/parse_prefix.rs")
text = open(path, encoding="utf-8").read()

operand = "        let value = p.parse_expr(Level::Prefix)?;\n"
check = (
    "        if p.lexer.token == T::TAsteriskAsterisk {\n"
    "            p.lexer.unexpected()?;\n"
    "            return Err(crate::Error::SyntaxError);\n"
    "        }\n"
)
handlers = [("pfx_t_void", "void"), ("pfx_t_typeof", "typeof"), ("pfx_t_delete", "delete"), ("pfx_t_plus", "+"), ("pfx_t_minus", "-"), ("pfx_t_tilde", "~"), ("pfx_t_exclamation", "!")]
for fn, operator in handlers:
    start = f"    fn {fn}(p: &mut Self) -> PResult<Expr> {{\n"
    end = "\n    fn "
    if widen:
        text = within(
            text, start, end, operand,
            "        let value = match p.parse_expr(Level::Prefix) {\n"
            "            Ok(value) => value,\n"
            f"            Err(err) => return Err(p.unary_operand_failed(loc, b\"{operator}\", err)),\n"
            "        };\n",
            fn,
        )
    text = within(
        text, start, end, check,
        "        if p.lexer.token == T::TAsteriskAsterisk {\n"
        f"            p.unary_before_exponent(loc, b\"{operator}\")?;\n"
        "            return Err(crate::Error::SyntaxError);\n"
        "        }\n",
        fn,
    )

old = (
    "                        let value = p.parse_expr(Level::Prefix)?;\n"
    "                        if p.lexer.token == T::TAsteriskAsterisk {\n"
    "                            p.lexer.unexpected()?;\n"
    "                            return Err(crate::Error::SyntaxError);\n"
    "                        }\n"
)
new = (
    (
        "                        let value = match p.parse_expr(Level::Prefix) {\n"
        "                            Ok(value) => value,\n"
        "                            Err(err) => {\n"
        "                                return Err(p.unary_operand_failed(loc, b\"await\", err));\n"
        "                            }\n"
        "                        };\n"
        if widen
        else "                        let value = p.parse_expr(Level::Prefix)?;\n"
    )
    + "                        if p.lexer.token == T::TAsteriskAsterisk {\n"
    "                            p.unary_before_exponent(loc, b\"await\")?;\n"
    "                            return Err(crate::Error::SyntaxError);\n"
    "                        }\n"
)
assert text.count(old) == 1, "await in pfx_t_identifier"
text = text.replace(old, new)

old = (
    "        p.log()\n"
    "            .add_range_error(Some(p.source), super_range, b\"Unexpected \\\"super\\\"\");\n"
    "        Ok(p.new_expr(E::Super {}, loc))\n"
)
new = "        p.super_unexpected(level, super_range);\n        Ok(p.new_expr(E::Super {}, loc))\n"
assert text.count(old) == 1, "pfx_t_super"
text = text.replace(old, new)

old = "                let value = p.parse_prefix(level, errors.as_deref_mut(), flags)?;\n                (type_node, greater_than, value)\n"
new = (
    "                let value = match p.parse_prefix(level, errors.as_deref_mut(), flags) {\n"
    "                    Ok(value) => value,\n"
    "                    Err(err) => {\n"
    "                        return Err(p.type_assertion_operand_failed(loc, greater_than, err));\n"
    "                    }\n"
    "                };\n"
    "                (type_node, greater_than, value)\n"
)
assert text.count(old) == 1, "operand of <T>x"
text = text.replace(old, new)

old = "        p.parse_suffix(&mut value, operand_level, errors, flags)?;\n        if let Some(starts) = &mut p.starts_for_parse_only {\n"
new = (
    "        p.parse_suffix(&mut value, operand_level, errors, flags)?;\n"
    "        // parseUnaryExpressionOrHigher\n"
    "        if p.lexer.token == T::TAsteriskAsterisk {\n"
    "            p.type_assertion_before_exponent(loc)?;\n"
    "            return Err(crate::Error::SyntaxError);\n"
    "        }\n"
    "        if let Some(starts) = &mut p.starts_for_parse_only {\n"
)
assert text.count(old) == 1, "<T>x before **"
text = text.replace(old, new)

old = "                    let _ = p.lint_type_arguments_in_expression(target);\n"
new = "                    let _ = p.lint_type_arguments_in_expression(target, true);\n"
assert text.count(old) == 1, "type arguments of new"
text = text.replace(old, new)

old = (
    "                AwaitOrYield::AllowIdent => {\n"
    "                    p.lexer.prev_token_was_await_keyword = true;\n"
    "                    p.lexer.fn_or_arrow_start_loc = p.fn_or_arrow_data_parse.needs_async_loc;\n"
    "                }\n"
)
new = (
    "                AwaitOrYield::AllowIdent => {\n"
    "                    p.lexer.prev_token_was_await_keyword = true;\n"
    "                    p.lexer.fn_or_arrow_start_loc = p.fn_or_arrow_data_parse.needs_async_loc;\n"
    "                    // parseUnaryExpressionOrHigher takes `await` for the operator of a unary expression where it is a name too.\n"
    "                    if p.lexer.token == T::TAsteriskAsterisk && p.is_lint_parse() {\n"
    "                        p.unary_before_exponent(loc, b\"await\")?;\n"
    "                        return Err(crate::Error::SyntaxError);\n"
    "                    }\n"
    "                }\n"
)
if os.environ.get("PROTO_AWAIT_NAME", "1") != "0":
    assert text.count(old) == 1, "await as a name"
    text = text.replace(old, new)

old = "                p.unexpected_as(crate::parse::syntax_errors::EXPRESSION_EXPECTED)?;\n"
new = "                p.expression_expected(level)?;\n"
assert text.count(old) == 1, "last arm of parse_prefix"
text = text.replace(old, new)
open(path, "w", encoding="utf-8").write(text)

# ── parse/mod.rs ───────────────────────────────────────────────────────────────────────────────────────────────────
edit(
    "parse/mod.rs",
    [
        (
            "            } else {\n"
            "                p.parse_expr(Level::Prefix)?\n"
            "            };\n"
            "\n"
            "            if p.lexer.token == T::TAsteriskAsterisk {\n"
            "                p.lexer.unexpected()?;\n"
            "            }\n",
            "            } else {\n"
            "                match p.parse_expr(Level::Prefix) {\n"
            "                    Ok(value) => value,\n"
            "                    Err(err) => {\n"
            "                        return Err(p.unary_operand_failed(token_range.loc, b\"await\", err));\n"
            "                    }\n"
            "                }\n"
            "            };\n"
            "\n"
            "            if p.lexer.token == T::TAsteriskAsterisk {\n"
            "                p.unary_before_exponent(token_range.loc, b\"await\")?;\n"
            "            }\n",
            1,
        ),
        (
            "            p.lexer.next()?;\n"
            "\n"
            "            if p.lexer.token == T::TIdentifier && !p.lexer.has_newline_before {\n"
            "                if opts.lexical_decl != LexicalDecl::AllowAll {\n"
            "                    p.forbid_lexical_decl(token_range.loc);\n"
            "                }\n"
            "                // p.markSyntaxFeature(.using, token_range.loc);\n",
            "            p.lexer.next()?;\n"
            "\n"
            "            if p.lexer.token == T::TIdentifier\n"
            "                && !p.lexer.has_newline_before\n"
            "                && !(opts.is_for_loop_init && p.lint_using_of_is_no_declaration())\n"
            "            {\n"
            "                if opts.lexical_decl != LexicalDecl::AllowAll {\n"
            "                    p.forbid_lexical_decl(token_range.loc);\n"
            "                }\n"
            "                // p.markSyntaxFeature(.using, token_range.loc);\n",
            1,
        ),
        ("    fn next_token_matches(", "    pub(crate) fn next_token_matches(", 1),
    ],
)

# ── parse_suffix.rs ────────────────────────────────────────────────────────────────────────────────────────────────
edit(
    "parse/parse_suffix.rs",
    [
        (
            "            if !p.lexer.is_identifier_or_keyword() {\n                p.lexer.expect(T::TIdentifier)?;\n            }\n",
            "            if !p.lexer.is_identifier_or_keyword() {\n                p.name_after_dot_expected(old_optional_chain.is_some())?;\n            }\n",
            1,
        ),
        (
            "                    if !p.lexer.is_identifier_or_keyword() {\n                        p.lexer.expect(T::TIdentifier)?;\n                    }\n",
            "                    if !p.lexer.is_identifier_or_keyword() {\n                        p.name_after_dot_expected(true)?;\n                    }\n",
            1,
        ),
        (
            "    fn sfx_type_arguments(p: &mut Self, left: &Expr) -> bool {\n        if p.starts_for_parse_only.is_some() {\n            return p.lint_type_arguments_in_expression(*left);\n",
            "    fn sfx_type_arguments(p: &mut Self, level: Level, left: &Expr) -> bool {\n        if p.starts_for_parse_only.is_some() {\n            // Only `new` reads its target at this level.\n            return p.lint_type_arguments_in_expression(*left, level == Level::Member);\n",
            1,
        ),
        ("Self::sfx_type_arguments(p, left)", "Self::sfx_type_arguments(p, level, left)", 2),
        (
            "                if level.gte(Level::Call) {\n                    return Ok(Continuation::Done);\n                }\n",
            "                if level.gte(Level::Call) {\n                    p.lint_optional_call_from_new(left);\n                    return Ok(Continuation::Done);\n                }\n",
            2,
        ),
    ],
)

# ── generics.rs ────────────────────────────────────────────────────────────────────────────────────────────────────
edit(
    "parse/generics.rs",
    [
        (
            "                TypeArgumentsOf::Expression,\n            );\n        }\n        true\n    }\n",
            "                TypeArgumentsOf::Expression,\n            );\n        }\n        self.lint_property_access_after_instantiation(less_than, end, is_target_of_new);\n        true\n    }\n",
            1,
        ),
        (
            "    pub(crate) fn lint_type_arguments_in_expression(&mut self, operand: Expr) -> bool {\n",
            "    pub(crate) fn lint_type_arguments_in_expression(\n        &mut self,\n        operand: Expr,\n        is_target_of_new: bool,\n    ) -> bool {\n",
            1,
        ),
    ],
)

# ── parse_entry.rs ─────────────────────────────────────────────────────────────────────────────────────────────────
edit(
    "parse/parse_entry.rs",
    [
        (
            "                Ok(_) if p.log().errors > orig_error_count => Err(crate::Error::SyntaxError),\n                Ok(stmts) => Ok(stmts),\n",
            "                Ok(_) if p.log().errors > orig_error_count => Err(crate::Error::SyntaxError),\n"
            "                Ok(stmts) => {\n"
            "                    // What the reference rejects and the parse pass reads without a word.\n"
            "                    p.lint_check_expressions(stmts.as_slice());\n"
            "                    if p.log().errors > orig_error_count {\n"
            "                        Err(crate::Error::SyntaxError)\n"
            "                    } else {\n"
            "                        Ok(stmts)\n"
            "                    }\n"
            "                }\n",
            1,
        ),
    ],
)

# Stand-in for B1: the lexer of a lint parse keeps its comments (here from the second token on).
edit(
    "parse/parse_entry.rs",
    [
        (
            "        p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());\n",
            "        p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());\n        p.lexer.track_comments = true;\n",
            1,
        ),
    ],
)

# ── syntax_errors.rs ───────────────────────────────────────────────────────────────────────────────────────────────
here = os.path.dirname(os.path.abspath(__file__))
constants = open(os.path.join(here, "proto_constants.rs"), encoding="utf-8").read()
table = open(os.path.join(here, "proto_table.rs"), encoding="utf-8").read()
methods = open(os.path.join(here, "proto_methods.rs"), encoding="utf-8").read()
items = open(os.path.join(here, "proto_items.rs"), encoding="utf-8").read()
edit(
    "parse/syntax_errors.rs",
    [
        (
            "use bun_ast::ts;\nuse bun_ast::{Kind, Loc, Log, Msg, Range};\n",
            "use bun_ast::op::Level;\nuse bun_ast::ts;\nuse bun_ast::walk::{self, Visitor};\n"
            "use bun_ast::{E, Expr, ExprData, Kind, Loc, Log, Msg, OpCode, OptionalChain, Range, Stmt};\n",
            1,
        ),
        (
            "use crate::p::P;\nuse crate::typescript::{SkipTypeOptions, SkipTypeOptionsBitset};\n",
            "use crate::p::P;\nuse crate::parse::erased::{ErasedData, ErasedMemberData};\nuse crate::parse::generics::TypeArgumentsOf;\nuse crate::parse::wrappers::{WrapperData, Wrappers};\n"
            "use crate::typescript::{SkipTypeOptions, SkipTypeOptionsBitset};\n",
            1,
        ),
        ("\n/// What the reference reports for one message that a lint parse left in the log.\n", "\n" + constants + "\n/// What the reference reports for one message that a lint parse left in the log.\n", 1),
        (
            "    /// Ends the parse: keeps the last record of each message that `log` still has, and reads what the lexer expected from the text of the others.\n",
            table + "\n    /// Ends the parse: keeps the last record of each message that `log` still has, and reads what the lexer expected from the text of the others.\n",
            1,
        ),
        ("        self.code_syntax_error(msgs_len, message, b\"\", range);\n    }\n}\n\n#[cfg(test)]\nmod tests {\n", "        self.code_syntax_error(msgs_len, message, b\"\", range);\n    }\n\n" + methods + "}\n\n" + items + "\n#[cfg(test)]\nmod tests {\n", 1),
    ],
)
print("prototype applied", "with" if widen else "without", "the widening of a chain of unary operators")
