#!/usr/bin/env python3
"""Applies the prototype of B4 (checks of the reference on expressions outside the type grammar) to a COPY of src/js_parser,
never to the worktree. usage: apply.py <copy of src/js_parser> [--comments]
Every replacement must match exactly once: the script stops where the copy is not be1ebe5295.
--comments turns the comment list of the lexer on in a lint parse, as B1 will: the ranges that end before a comment need it."""
import sys, pathlib

root = pathlib.Path(sys.argv[1])
with_comments = "--comments" in sys.argv
here = pathlib.Path(__file__).resolve().parent

def patch(path, pairs):
    p = root / path
    s = p.read_text()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            sys.exit(f"{path}: {n} matches for:\n{old[:300]}")
        s = s.replace(old, new)
    p.write_text(s)

def patch_after(path, anchor, old, new):
    p = root / path
    s = p.read_text()
    if s.count(anchor) != 1:
        sys.exit(f"{path}: {s.count(anchor)} matches for the anchor:\n{anchor}")
    at = s.index(anchor)
    found = s.find(old, at)
    if found < 0:
        sys.exit(f"{path}: no match after {anchor!r} for:\n{old[:300]}")
    s = s[:found] + new + s[found + len(old):]
    p.write_text(s)

# ---- parse_prefix.rs
PP = "parse/parse_prefix.rs"
patch(PP, [
# pfx_t_super: the error path asks the reference
('''        p.log()
            .add_range_error(Some(p.source), super_range, b"Unexpected \\"super\\"");
        Ok(p.new_expr(E::Super {}, loc))''',
 '''        p.unexpected_super(super_range, level);
        Ok(p.new_expr(E::Super {}, loc))'''),
# await inside an expression
('''                        let value = p.parse_expr(Level::Prefix)?;
                        if p.lexer.token == T::TAsteriskAsterisk {
                            p.lexer.unexpected()?;
                            return Err(crate::Error::SyntaxError);
                        }

                        return Ok(p.new_expr(E::Await { value }, loc));''',
 '''                        let value = match p.parse_expr(Level::Prefix) {
                            Ok(value) => value,
                            Err(err) => return Err(p.operand_of_unary_failed(loc, b"await", err)),
                        };
                        if p.lexer.token == T::TAsteriskAsterisk {
                            p.unexpected_exponentiation_after_unary(loc, b"await")?;
                            return Err(crate::Error::SyntaxError);
                        }

                        return Ok(p.new_expr(E::Await { value }, loc));'''),
# the lint twin of <T>x: the operand, then "**"
('''                p.lexer.expect_greater_than::<false>()?;
                let value = p.parse_prefix(level, errors.as_deref_mut(), flags)?;
                (type_node, greater_than, value)
            };''',
 '''                p.lexer.expect_greater_than::<false>()?;
                let value = match p.parse_prefix(level, errors.as_deref_mut(), flags) {
                    Ok(value) => value,
                    Err(err) => return Err(p.operand_of_assertion_failed(loc, greater_than, err)),
                };
                (type_node, greater_than, value)
            };'''),
('''        p.parse_suffix(&mut value, operand_level, errors, flags)?;
        if let Some(starts) = &mut p.starts_for_parse_only {
            starts
                .wrappers
                .type_assertion(value, loc, greater_than, type_node);
        }
        Ok(value)''',
 '''        p.parse_suffix(&mut value, operand_level, errors, flags)?;
        // parseUnaryExpressionOrHigher: a type assertion is no left operand of "**"
        if p.lexer.token == T::TAsteriskAsterisk {
            p.unexpected_exponentiation_after_assertion(loc)?;
            return Err(crate::Error::SyntaxError);
        }
        if let Some(starts) = &mut p.starts_for_parse_only {
            starts
                .wrappers
                .type_assertion(value, loc, greater_than, type_node);
        }
        Ok(value)'''),
# the last arm of parse_prefix says at which level it was asked
('''                p.unexpected_as(crate::parse::syntax_errors::EXPRESSION_EXPECTED)?;''',
 '''                p.expression_expected(level)?;'''),
])
UNARY_OLD = '''        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(crate::Error::SyntaxError);
        }
'''
def unary_new(op):
    return f'''        let value = match p.parse_expr(Level::Prefix) {{
            Ok(value) => value,
            Err(err) => return Err(p.operand_of_unary_failed(loc, b"{op}", err)),
        }};
        if p.lexer.token == T::TAsteriskAsterisk {{
            p.unexpected_exponentiation_after_unary(loc, b"{op}")?;
            return Err(crate::Error::SyntaxError);
        }}
'''
for name, op in [("pfx_t_void", "void"), ("pfx_t_typeof", "typeof"), ("pfx_t_delete", "delete"), ("pfx_t_plus", "+"), ("pfx_t_minus", "-"), ("pfx_t_tilde", "~"), ("pfx_t_exclamation", "!")]:
    patch_after(PP, f"    fn {name}(p: &mut Self) -> PResult<Expr> {{", UNARY_OLD, unary_new(op))
if (root / PP).read_text().count("p.lexer.unexpected()?;\n            return Err(crate::Error::SyntaxError);\n        }\n\n        Ok(p.new_expr(\n            E::Unary") != 0:
    sys.exit("a unary site is left")

# ---- parse/mod.rs
PM = "parse/mod.rs"
patch(PM, [
# `using of` in the head of a `for`
('''            if p.lexer.token == T::TIdentifier && !p.lexer.has_newline_before {
                if opts.lexical_decl != LexicalDecl::AllowAll {
                    p.forbid_lexical_decl(token_range.loc);
                }
                // p.markSyntaxFeature(.using, token_range.loc);''',
 '''            if p.lexer.token == T::TIdentifier
                && !p.lexer.has_newline_before
                && !(opts.is_for_loop_init && p.lint_using_of_is_a_name())
            {
                if opts.lexical_decl != LexicalDecl::AllowAll {
                    p.forbid_lexical_decl(token_range.loc);
                }
                // p.markSyntaxFeature(.using, token_range.loc);'''),
# `await` that starts a statement
('''            } else {
                p.parse_expr(Level::Prefix)?
            };

            if p.lexer.token == T::TAsteriskAsterisk {
                p.lexer.unexpected()?;
            }''',
 '''            } else {
                match p.parse_expr(Level::Prefix) {
                    Ok(value) => value,
                    Err(err) => {
                        return Err(p.operand_of_unary_failed(token_range.loc, b"await", err));
                    }
                }
            };

            if p.lexer.token == T::TAsteriskAsterisk {
                p.unexpected_exponentiation_after_unary(token_range.loc, b"await")?;
            }'''),
])

# ---- parse_suffix.rs
PS = "parse/parse_suffix.rs"
patch(PS, [
# sfx_t_dot: the name after "."
('''            // "a.b"
            // "a?.b.c"
            if !p.lexer.is_identifier_or_keyword() {
                p.lexer.expect(T::TIdentifier)?;
            }''',
 '''            // "a.b"
            // "a?.b.c"
            if !p.lexer.is_identifier_or_keyword() {
                p.expect_member_name(old_optional_chain.is_some())?;
            }'''),
# sfx_t_question_dot: "?.["
('''                // allow "in" inside the brackets;
                let old_allow_in = p.allow_in;
                p.allow_in = true;

                let index = p.parse_expr(Level::Lowest)?;''',
 '''                // allow "in" inside the brackets;
                let old_allow_in = p.allow_in;
                p.allow_in = true;

                let index = match p.parse_expr(Level::Lowest) {
                    Ok(index) => index,
                    Err(err) => return Err(p.element_access_argument_expected(err)),
                };'''),
# sfx_t_question_dot: "?.(" where the target of `new` ends
('''                // "a?.()"
                if level.gte(Level::Call) {
                    return Ok(Continuation::Done);
                }''',
 '''                // "a?.()"
                if level.gte(Level::Call) {
                    p.lint_optional_chain_from_new(*left);
                    return Ok(Continuation::Done);
                }'''),
# sfx_t_question_dot: "?.<T>(" of a lint parse
('''                if p.starts_for_parse_only.is_some() {
                    let of = crate::parse::generics::TypeArgumentsOf::OptionalCall;
                    p.lint_type_arguments_after(*left, of)?;''',
 '''                if p.starts_for_parse_only.is_some() {
                    if level.gte(Level::Call) {
                        p.lint_optional_chain_from_new(*left);
                    }
                    let of = crate::parse::generics::TypeArgumentsOf::OptionalCall;
                    p.lint_type_arguments_after(*left, of)?;'''),
# sfx_t_question_dot: "?.#b"
('''                    // "a?.#b"
                    let name = p.lexer.identifier;''',
 '''                    // "a?.#b"
                    if p.starts_for_parse_only.is_some() {
                        p.lint_private_name_after_question_dot(level);
                    }
                    let name = p.lexer.identifier;'''),
# sfx_t_question_dot: the name after "?."
('''                    // "a?.b"
                    if !p.lexer.is_identifier_or_keyword() {
                        p.lexer.expect(T::TIdentifier)?;
                    }''',
 '''                    // "a?.b"
                    if !p.lexer.is_identifier_or_keyword() {
                        p.expect_name_after_question_dot(level, *left)?;
                    }'''),
# sfx_t_open_bracket
('''        // Allow "in" inside the brackets
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        let index = p.parse_expr(Level::Lowest)?;''',
 '''        // Allow "in" inside the brackets
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        let index = match p.parse_expr(Level::Lowest) {
            Ok(index) => index,
            Err(err) => return Err(p.element_access_argument_expected(err)),
        };'''),
])

# the two template handlers: the chain of the target of `new` first
TEMPLATE_OLD = '''        if old_optional_chain.is_some() {
            p.log().add_range_error(
                Some(p.source),
                p.lexer.range(),
                b"Template literals cannot have an optional chain as a tag",
            );
        }'''
TEMPLATE_NEW = '''        if old_optional_chain.is_some() {
            p.lint_optional_chain_of_new_before_template(level, *left);
            p.log().add_range_error(
                Some(p.source),
                p.lexer.range(),
                b"Template literals cannot have an optional chain as a tag",
            );
        }'''
for name in ["sfx_t_no_substitution_template_literal", "sfx_t_template_head"]:
    anchor = f"    fn {name}(\n        p: &mut Self,\n        _level: Level,"
    patch_after(PS, anchor, TEMPLATE_OLD, TEMPLATE_NEW)
    patch(PS, [(anchor, f"    fn {name}(\n        p: &mut Self,\n        level: Level,")])

# ---- generics.rs
PG = "parse/generics.rs"
patch(PG, [
('''            starts.generics.type_argument_list(
                operand,
                less_than,
                end,
                list,
                TypeArgumentsOf::Expression,
            );
        }
        true
    }''',
 '''            starts.generics.type_argument_list(
                operand,
                less_than,
                end,
                list,
                TypeArgumentsOf::Expression,
            );
        }
        self.lint_instantiation_before_property_access(less_than, end, level);
        true
    }'''),
('''    pub(crate) fn lint_type_arguments_in_expression(&mut self, operand: Expr) -> bool {''',
 '''    pub(crate) fn lint_type_arguments_in_expression(
        &mut self,
        operand: Expr,
        level: Level,
    ) -> bool {'''),
('''            starts
                .generics
                .type_argument_list(operand, less_than, end, list, of);
        }
        Ok(true)''',
 '''            starts
                .generics
                .type_argument_list(operand, less_than, end, list, of);
        }
        if of == TypeArgumentsOf::Expression {
            self.lint_instantiation_before_property_access(less_than, end, Level::Lowest);
        }
        Ok(true)'''),
])
# the level at which the operand of the type arguments is read: the target of `new` is read at `Level::Member`
patch(PP, [
('''                    let _ = p.lint_type_arguments_in_expression(target);''',
 '''                    let _ = p.lint_type_arguments_in_expression(target, Level::Member);'''),
])
patch(PS, [
('''    fn sfx_type_arguments(p: &mut Self, left: &Expr) -> bool {
        if p.starts_for_parse_only.is_some() {
            return p.lint_type_arguments_in_expression(*left);
        }''',
 '''    fn sfx_type_arguments(p: &mut Self, left: &Expr, level: Level) -> bool {
        if p.starts_for_parse_only.is_some() {
            return p.lint_type_arguments_in_expression(*left, level);
        }'''),
])
suffix = (root / PS).read_text()
if suffix.count("Self::sfx_type_arguments(p, left)") != 2:
    sys.exit("sfx_type_arguments: the two callers")
(root / PS).write_text(suffix.replace("Self::sfx_type_arguments(p, left)", "Self::sfx_type_arguments(p, left, level)"))

# ---- parse_entry.rs: the stand-in for the walk, after a parse that logged nothing
PE = "parse/parse_entry.rs"
patch(PE, [
('''                // An error that the parser only logs fails the parse all the same.
                Ok(_) if p.log().errors > orig_error_count => Err(crate::Error::SyntaxError),
                Ok(stmts) => Ok(stmts),
                Err(crate::Error::StackOverflow) => {
                    p.log().add_error(
                        Some(p.source),
                        p.lexer.loc(),
                        b"Maximum call stack size exceeded",
                    );
                    Err(crate::Error::SyntaxError)
                }
                Err(err) => Err(err),
            }
        };
        let stmts = match parsed {''',
 '''                // An error that the parser only logs fails the parse all the same.
                Ok(_) if p.log().errors > orig_error_count => Err(crate::Error::SyntaxError),
                Ok(stmts) => {
                    p.lint_check_shapes(stmts.as_slice());
                    if p.log().errors > orig_error_count {
                        Err(crate::Error::SyntaxError)
                    } else {
                        Ok(stmts)
                    }
                }
                Err(crate::Error::StackOverflow) => {
                    p.log().add_error(
                        Some(p.source),
                        p.lexer.loc(),
                        b"Maximum call stack size exceeded",
                    );
                    Err(crate::Error::SyntaxError)
                }
                Err(err) => Err(err),
            }
        };
        let stmts = match parsed {'''),
])
if with_comments:
    patch(PE, [
    ('''        p.start_syntax_errors(orig_error_count);
        let parsed: Result<_, Error> = 'parse: {''',
     '''        p.start_syntax_errors(orig_error_count);
        p.lexer.track_comments = true;
        let parsed: Result<_, Error> = 'parse: {'''),
    ])

# ---- syntax_errors.rs
SE = "parse/syntax_errors.rs"
patch(SE, [
('''use bun_ast::ts;
use bun_ast::{Kind, Loc, Log, Msg, Range};''',
 '''use bun_ast::op::Level;
use bun_ast::ts;
use bun_ast::{Expr, ExprData, Kind, Loc, Log, Msg, OptionalChain, Range, Stmt};'''),
('''use crate::p::P;
use crate::typescript::{SkipTypeOptions, SkipTypeOptionsBitset};''',
 '''use crate::p::P;
use crate::parse::wrappers::WrapperData;
use crate::typescript::{SkipTypeOptions, SkipTypeOptionsBitset};'''),
('''    /// The index in the log of the first message of the parse.
    first: usize,
}''',
 '''    /// The index in the log of the first message of the parse.
    first: usize,
    /// Where the token is at which `parse_prefix`, asked for an expression at the lowest level, last found none.
    lowest: Option<usize>,
}'''),
('''#[cfg(test)]
mod tests {''',
 (here / "b4_helpers.rs.inc").read_text() + '''#[cfg(test)]
mod tests {'''),
])
print("applied")
