#!/usr/bin/env python3
"""Scratch copies of src/js_parser with the expression sites of round 3, for codegen comparison only.
usage: variants.py            writes /tmp/seam/root/{m1,a,b}/src/js_parser (nothing in the worktree changes)
  m1  main's text at the expression sites + the TypeScript-only hooks; async and arrow bodies: main's text, no arm extension
  a   m1 + the lint twin of parse_async_prefix_expr behind main's existing Some(starts) arm
  b   a  + the lint tail of parse_arrow_body behind main's existing Some(starts) arm
"""
import os, re, shutil, sys
SRC = '/workspace/wt/parser/src/js_parser'
MAIN = '/tmp/seam/main'
ROOT = '/tmp/seam/root'

def read(p): return open(p, encoding='utf8').read()
def write(p, s): open(p, 'w', encoding='utf8').write(s)

def rep(text, old, new, count=1, what=''):
    n = text.count(old)
    assert n == count, (what or old[:60], 'found', n, 'wanted', count)
    return text.replace(old, new)

def fn_text(text, head, end='\n    }\n'):
    a = text.index(head)
    b = text.index(end, a) + len(end)
    return a, b

def m1(d):
    # ---------------- parse_prefix.rs
    p = d + '/parse/parse_prefix.rs'; t = read(p)
    t = rep(t, "        if !SCAN_ONLY && p.is_lint_parse() {\n", "        if Self::IS_TYPESCRIPT_ENABLED && !SCAN_ONLY && p.starts_for_parse_only.is_some() {\n")
    t = rep(t, """        // Only TypeScript has types after what may be parameters, which the one function drops.
        let value = if Self::IS_TYPESCRIPT_ENABLED {
            p.parse_paren_expr_for_lint(loc, level, opts)?
        } else {
            p.parse_paren_expr(loc, level, opts)?
        };
""", "        let value = p.parse_paren_expr_for_lint(loc, level, opts)?;\n")
    t = rep(t, """            let body_flags = Self::arrow_body_flags(flags);
            let arrow_result =
                p.parse_arrow_body_with_flags(args, &mut fn_or_arrow_data, body_flags);
""", "            let arrow_result = p.parse_arrow_body(args, &mut fn_or_arrow_data);\n")
    t = rep(t, """        if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TLessThan {
            if p.starts_for_parse_only.is_some() {
                let owner = crate::parse::attached::Owner::class(class_keyword.loc);
""", """        if Self::IS_TYPESCRIPT_ENABLED {
            if !SCAN_ONLY && p.starts_for_parse_only.is_some() {
                let owner = crate::parse::attached::Owner::class(class_keyword.loc);
""", count=2)
    t = rep(t, """                if p.starts_for_parse_only.is_some() {
                    let _ = p.lint_type_arguments_in_expression(target);
""", """                if !SCAN_ONLY && p.starts_for_parse_only.is_some() {
                    let _ = p.lint_type_arguments_in_expression(target);
""")
    t = rep(t, """            if p.is_ts_arrow_fn_jsx()? {
                if p.starts_for_parse_only.is_some() {
                    let owner = crate::parse::attached::Owner::arrow(loc);
                    p.lint_type_parameters(Some(owner))?;
                } else {
                    let _ = p.skip_type_script_type_parameters(
                        TypeParameterFlag::ALLOW_CONST_MODIFIER,
                    )?;
                }
                p.lexer.expect(T::TOpenParen)?;
                let opts = ParenExprOpts {
                    force_arrow_fn: true,
                    ..Default::default()
                };
                if !SCAN_ONLY && p.starts_for_parse_only.is_some() {
                    return p.parse_paren_expr_for_lint_cold(loc, level, opts);
                }
                return p.parse_paren_expr(loc, level, opts);
            }
""", """            if p.is_ts_arrow_fn_jsx()? {
                if !SCAN_ONLY && p.starts_for_parse_only.is_some() {
                    return Self::pfx_tsx_arrow_for_lint(p, loc, level);
                }
                let _ =
                    p.skip_type_script_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
                p.lexer.expect(T::TOpenParen)?;
                return p.parse_paren_expr(
                    loc,
                    level,
                    ParenExprOpts {
                        force_arrow_fn: true,
                        ..Default::default()
                    },
                );
            }
""")
    t = rep(t, """                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            is_after_question_and_before_colon: flags
                                == EFlags::AfterQuestionAndBeforeColon,
                            ..Default::default()
                        },
                    );
                }
            }

            // "<T>x"
""", """                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            ..Default::default()
                        },
                    );
                }
            }

            // "<T>x"
""")
    t = rep(t, "    /// `<T>x`, `<T>(x)` and `<T>(x) => {}` of a lint parse, at the `<`: an assertion is recorded around its whole operand.\n", """    /// `<T,>(x) => {}` of a lint parse of a JSX file, at the `<`: the type parameters are built and recorded for the arrow function.
    #[cold]
    #[inline(never)]
    fn pfx_tsx_arrow_for_lint(p: &mut Self, loc: bun_ast::Loc, level: Level) -> PResult<Expr> {
        let owner = crate::parse::attached::Owner::arrow(loc);
        p.lint_type_parameters(Some(owner))?;
        p.lexer.expect(T::TOpenParen)?;
        p.parse_paren_expr_for_lint(
            loc,
            level,
            ParenExprOpts {
                force_arrow_fn: true,
                ..Default::default()
            },
        )
    }

    /// `<T>x`, `<T>(x)` and `<T>(x) => {}` of a lint parse, at the `<`: an assertion is recorded around its whole operand.
""")
    write(p, t)

    # ---------------- parse/mod.rs
    p = d + '/parse/mod.rs'; t = read(p)
    t = rep(t, """        // "a ? -<T>(b) : c": an operand is no arrow function, so the ":" after it starts no return type
        if is_arrow_fn
            || opts.force_arrow_fn
            || (Self::IS_TYPESCRIPT_ENABLED
                && p.lexer.token == T::TColon
                && level.lte(Level::Assign))
        {
""", """        if is_arrow_fn
            || opts.force_arrow_fn
            || (Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon)
        {
""")
    t = rep(t, """                // "a ? (b) => (c) : d => e": after parameters that could be an expression, the body is before the ":" too
                let is_body_before_colon = Self::IS_TYPESCRIPT_ENABLED
                    && opts.is_after_question_and_before_colon
                    && (p.paren_expr_has_type_parameters(loc, opts.is_async)
                        || Self::arrow_parameters_could_be_expr(
                            items,
                            spread_range,
                            type_colon_range,
                            &errors,
                        ));
                let body_flags = if is_body_before_colon {
                    EFlags::AfterQuestionAndBeforeColon
                } else {
                    EFlags::None
                };
                let mut arrow =
                    p.parse_arrow_body_with_flags(args_slice, &mut arrow_data, body_flags)?;
""", "                let mut arrow = p.parse_arrow_body(args_slice, &mut arrow_data)?;\n")
    t = rep(t, "p.parse_arrow_body_with_flags(args_slice, &mut arrow_data, body_flags)?;", "p.parse_arrow_body_for_lint(args_slice, &mut arrow_data, body_flags)?;")
    t = rep(t, "        self.parse_arrow_body(&mut [], data)?;\n", "        self.parse_arrow_body_for_lint(&mut [], data, EFlags::None)?;\n")
    # parse_async_prefix_expr: main's text
    mt = read(MAIN + '/mod.rs')
    ma, mb = fn_text(mt, "    pub(crate) fn parse_async_prefix_expr(")
    ha, hb = fn_text(t, "    pub(crate) fn parse_async_prefix_expr(")
    t = t[:ha] + mt[ma:mb] + t[hb:]
    write(p, t)

    # ---------------- parse_fn.rs
    p = d + '/parse/parse_fn.rs'; t = read(p)
    mt = read(MAIN + '/parse_fn.rs')
    ma, mb = fn_text(mt, "    pub(crate) fn parse_arrow_body(")
    ha, hb = fn_text(t, "    pub(crate) fn parse_arrow_body(")
    t = t[:ha] + mt[ma:mb] + t[hb:]
    t = rep(t, """    /// `parse_arrow_body`, where a body that is an expression is read with `flags`.
    pub(crate) fn parse_arrow_body_with_flags(""", """    /// `parse_arrow_body` of a lint parse, where a body that is an expression is read with `flags`.
    pub(crate) fn parse_arrow_body_for_lint(""")
    write(p, t)

    # ---------------- parse_jsx.rs
    p = d + '/parse/parse_jsx.rs'; t = read(p)
    t = rep(t, """        if TYPESCRIPT && matches!(p.lexer.token, T::TLessThan | T::TLessThanLessThan) {
            if p.starts_for_parse_only.is_some() {
""", """        if TYPESCRIPT {
            if !SCAN_ONLY && p.starts_for_parse_only.is_some() {
""")
    write(p, t)

    # ---------------- parse_typescript.rs
    p = d + '/parse/parse_typescript.rs'; t = read(p)
    t = rep(t, """        if p.lexer.token == T::TOpenParen {
            let open = p.lexer.loc();
            p.lexer.next()?;
            let expr = p.parse_expr(Level::Lowest)?;
            if let Some(starts) = &mut p.starts_for_parse_only
                && starts.is_lint
            {
                starts.wrappers.parenthesized(expr, open, p.lexer.loc());
            }
            p.lexer.expect(T::TCloseParen)?;
            return Ok(expr);
        }
""", """        if p.lexer.token == T::TOpenParen {
            if Self::IS_TYPESCRIPT_ENABLED && !SCAN_ONLY && p.starts_for_parse_only.is_some() {
                return p.lint_parenthesized_decorator();
            }
            p.lexer.next()?;
            let expr = p.parse_expr(Level::Lowest)?;
            p.lexer.expect(T::TCloseParen)?;
            return Ok(expr);
        }
""")
    t = rep(t, """                    if Self::IS_TYPESCRIPT_ENABLED
                        && matches!(p.lexer.token, T::TLessThan | T::TLessThanLessThan)
                    {
                        let has_type_arguments = if p.starts_for_parse_only.is_some() {
                            let of = crate::parse::generics::TypeArgumentsOf::Expression;
                            p.lint_type_arguments_after(expr, of)?
                        } else {
                            p.skip_type_script_type_arguments::<false, false>()?
                        };
                        if has_type_arguments {
                            continue;
                        }
                    }
                    break;
""", """                    if Self::IS_TYPESCRIPT_ENABLED {
                        let has_type_arguments =
                            if !SCAN_ONLY && p.starts_for_parse_only.is_some() {
                                let of = crate::parse::generics::TypeArgumentsOf::Expression;
                                p.lint_type_arguments_after(expr, of)?
                            } else {
                                p.skip_type_script_type_arguments::<false, false>()?
                            };
                        if has_type_arguments {
                            continue;
                        }
                    }
                    break;
""")
    t = rep(t, """    /// Parse a standard (TC39) decorator expression following the `@` token.
""", """    /// `@(expr)` of a lint parse of TypeScript, at the `(`: what the parentheses hold is recorded.
    #[cold]
    #[inline(never)]
    fn lint_parenthesized_decorator(&mut self) -> Result<ExprNodeIndex, Error> {
        let open = self.lexer.loc();
        self.lexer.next()?;
        let expr = self.parse_expr(Level::Lowest)?;
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.wrappers.parenthesized(expr, open, self.lexer.loc());
        }
        self.lexer.expect(T::TCloseParen)?;
        Ok(expr)
    }

    /// Parse a standard (TC39) decorator expression following the `@` token.
""")
    write(p, t)

ASYNC_TWIN = '''
    /// `parse_async_prefix_expr` of a lint parse of TypeScript, after the `async`: the body of an arrow function is read with the flags of the arrow function, and what stands in `(` and `<` is built and recorded.
    #[cold]
    #[inline(never)]
    pub(crate) fn parse_async_prefix_expr_for_lint(
        &mut self,
        async_loc: bun_ast::Loc,
        level: Level,
        flags: EFlags,
    ) -> Result<Expr, Error> {
        let p = self;
        if !p.lexer.has_newline_before && p.lexer.token == T::TFunction {
            return p.parse_fn_expr(async_loc, true);
        }

        if !p.lexer.has_newline_before && level.lt(Level::Member) {
            match p.lexer.token {
                T::TEqualsGreaterThan => {
                    if level.lte(Level::Assign) {
                        let async_ref = p.store_name_in_ref(b"async");
                        let arg_binding = p.b(B::Identifier { r#ref: async_ref }, async_loc);
                        let args: &'a mut [G::Arg] = p.arena.alloc_slice_fill_with(1, |_| G::Arg {
                            binding: arg_binding,
                            ..Default::default()
                        });
                        let _ = p.push_scope_for_parse_pass(
                            js_ast::scope::Kind::FunctionArgs,
                            async_loc,
                        )?;
                        let mut data = FnOrArrowDataParse {
                            needs_async_loc: async_loc,
                            ..Default::default()
                        };
                        let body_flags = Self::arrow_body_flags(flags);
                        let arrow_body = p.parse_arrow_body_for_lint(args, &mut data, body_flags)?;
                        p.pop_scope();
                        return Ok(p.new_expr(arrow_body, async_loc));
                    }
                }
                T::TIdentifier => {
                    if level.lte(Level::Assign) && p.build_next_token_is(T::TEqualsGreaterThan) {
                        let ref_ = p.store_name_in_ref(p.lexer.identifier);
                        let arg_loc = p.lexer.loc();
                        let arg_binding = p.b(B::Identifier { r#ref: ref_ }, arg_loc);
                        let args: &'a mut [G::Arg] = p.arena.alloc_slice_fill_with(1, |_| G::Arg {
                            binding: arg_binding,
                            ..Default::default()
                        });
                        p.lexer.next()?;

                        let _ = p.push_scope_for_parse_pass(
                            js_ast::scope::Kind::FunctionArgs,
                            async_loc,
                        )?;

                        let mut data = FnOrArrowDataParse {
                            allow_await: AwaitOrYield::AllowExpr,
                            needs_async_loc: arg_loc,
                            ..Default::default()
                        };
                        let body_flags = Self::arrow_body_flags(flags);
                        let parsed = p.parse_arrow_body_for_lint(args, &mut data, body_flags);
                        p.pop_scope();
                        let mut arrow_body = parsed?;
                        arrow_body.is_async = true;
                        return Ok(p.new_expr(arrow_body, async_loc));
                    }
                }
                T::TOpenParen => {
                    p.lexer.next()?;
                    let opts = ParenExprOpts {
                        is_async: true,
                        is_after_question_and_before_colon: flags
                            == EFlags::AfterQuestionAndBeforeColon,
                        ..Default::default()
                    };
                    return p.parse_paren_expr_for_lint(async_loc, level, opts);
                }
                T::TLessThan => {
                    if !p.is_jsx_enabled() || p.is_ts_arrow_fn_jsx()? {
                        let mut lint_type_lists = None;
                        match p.lint_try_async_type_parameters(&mut lint_type_lists)? {
                            SkipTypeParameterResult::DidNotSkipAnything => {}
                            result => {
                                p.lexer.next()?;
                                // In a JSX file these type parameters prove an arrow function, as in the reference
                                let is_before_colon = flags == EFlags::AfterQuestionAndBeforeColon
                                    && !p.is_jsx_enabled();
                                let opts = ParenExprOpts {
                                    is_async: true,
                                    force_arrow_fn: result
                                        == SkipTypeParameterResult::DefinitelyTypeParameters,
                                    is_after_question_and_before_colon: is_before_colon,
                                    ..Default::default()
                                };
                                let value =
                                    p.parse_paren_expr_for_lint(async_loc, level, opts)?;
                                p.lint_async_type_lists(async_loc, value, lint_type_lists);
                                return Ok(value);
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        let async_ref = p.store_name_in_ref(b"async");
        Ok(p.new_expr(
            E::Identifier {
                ref_: async_ref,
                ..Default::default()
            },
            async_loc,
        ))
    }
'''

def a(d):
    p = d + '/parse/mod.rs'; t = read(p)
    t = rep(t, """        if let Some(starts) = &mut p.starts_for_parse_only {
            starts
                .async_arrow_parameters
                .insert(async_range.loc.start, p.lexer.loc().start);
        }
""", """        if let Some(starts) = &mut p.starts_for_parse_only {
            starts
                .async_arrow_parameters
                .insert(async_range.loc.start, p.lexer.loc().start);
            if Self::IS_TYPESCRIPT_ENABLED && !SCAN_ONLY {
                return p.parse_async_prefix_expr_for_lint(async_range.loc, level, flags);
            }
        }
""")
    ha, hb = fn_text(t, "    pub(crate) fn parse_async_prefix_expr(")
    t = t[:hb] + ASYNC_TWIN + t[hb:]
    write(p, t)

ARROW_TAIL = '''
    /// The arm of `parse_arrow_body` in a lint parse of TypeScript: the body of an arrow function with one name is before the ":" where "?" stands before the name on its line, or where the body that the name starts is.
    #[cold]
    #[inline(never)]
    pub(crate) fn parse_arrow_expression_body_for_lint(
        &mut self,
        args: bun_ast::StoreSlice<G::Arg>,
        data: &mut FnOrArrowDataParse,
        arrow_loc: bun_ast::Loc,
    ) -> Result<E::Arrow, Error> {
        let flags = if self.lint_is_arrow_before_colon(args) {
            EFlags::AfterQuestionAndBeforeColon
        } else {
            EFlags::None
        };
        self.lint_arrow_expression_body(args, data, arrow_loc, flags)
    }

    /// Whether the arrow function whose one parameter is a name was read between the "?" and the ":" of a conditional expression.
    fn lint_is_arrow_before_colon(&mut self, args: bun_ast::StoreSlice<G::Arg>) -> bool {
        let Some(first) = args.slice().first() else {
            return false;
        };
        let start = first.binding.loc.start;
        if let Some(starts) = &mut self.starts_for_parse_only
            && starts.body_before_colon == Some(start)
        {
            starts.body_before_colon = None;
            return true;
        }
        let mut at = usize::try_from(start).unwrap_or(0);
        let contents = self.lexer.contents;
        while at > 0 && matches!(contents.get(at - 1), Some(b' ' | b'\\t')) {
            at -= 1;
        }
        at > 0
            && contents.get(at - 1) == Some(&b'?')
            && (at < 2 || contents.get(at - 2) != Some(&b'?'))
    }

    /// The expression that is the body of the arrow function whose "=>" is at `arrow_loc`, read with `flags`: the end of `parse_arrow_body`.
    pub(crate) fn lint_arrow_expression_body(
        &mut self,
        args: bun_ast::StoreSlice<G::Arg>,
        data: &mut FnOrArrowDataParse,
        arrow_loc: bun_ast::Loc,
        flags: EFlags,
    ) -> Result<E::Arrow, Error> {
        let p = self;
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::FunctionBody, arrow_loc)?;
        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse.clone();
        p.fn_or_arrow_data_parse = data.clone();
        let body_start = p.lexer.loc().start;
        if let Some(starts) = &mut p.starts_for_parse_only {
            starts.body_before_colon =
                (flags == EFlags::AfterQuestionAndBeforeColon).then_some(body_start);
        }
        let mut expr = Expr::EMPTY;
        if let Err(err) = p.parse_expr_common(Level::Comma, None, flags, &mut expr) {
            p.pop_scope();
            return Err(err);
        }
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        let ret_stmt = p.s(S::Return { value: Some(expr) }, expr.loc);
        let stmts: &'a mut [Stmt] = p.arena.alloc_slice_copy(&[ret_stmt]);

        p.pop_scope();
        let has_react_hooks_suppression =
            p.lexer.has_react_hooks_suppression_before || p.lexer.has_react_hooks_block_suppression;
        if has_react_hooks_suppression && p.fn_or_arrow_data_parse.is_top_level {
            p.lexer.has_react_hooks_suppression_before = false;
        }
        Ok(E::Arrow {
            args,
            prefer_expr: true,
            body: G::FnBody {
                loc: arrow_loc,
                stmts: bun_ast::StoreSlice::new_mut(stmts),
            },
            has_react_hooks_suppression,
            ..Default::default()
        })
    }
'''

def b(d):
    p = d + '/parse/parse_fn.rs'; t = read(p)
    # main's parse_arrow_body is the first function with this arm
    arm = """        if let Some(starts) = &mut p.starts_for_parse_only {
            starts
                .arrow_expression_bodies
                .insert(arrow_loc.start, p.lexer.loc().start);
        }
"""
    assert t.count(arm) == 2
    i = t.index(arm)
    t = t[:i] + """        if let Some(starts) = &mut p.starts_for_parse_only {
            starts
                .arrow_expression_bodies
                .insert(arrow_loc.start, p.lexer.loc().start);
            if Self::IS_TYPESCRIPT_ENABLED && !SCAN_ONLY {
                return p.parse_arrow_expression_body_for_lint(args_slice, data, arrow_loc);
            }
        }
""" + t[i + len(arm):]
    # the lint copy ends with the shared tail
    ha, hb = fn_text(t, "    pub(crate) fn parse_arrow_body_for_lint(")
    body = t[ha:hb]
    j = body.index(arm)
    body = body[:j] + """        if let Some(starts) = &mut p.starts_for_parse_only {
            starts
                .arrow_expression_bodies
                .insert(arrow_loc.start, p.lexer.loc().start);
        }
        p.lint_arrow_expression_body(args_slice, data, arrow_loc, flags)
    }
"""
    t = t[:ha] + body + ARROW_TAIL + t[hb:]
    write(p, t)
    p = d + '/p.rs'; t = read(p)
    t = rep(t, """    /// `Parser::parse_for_lint` made it: `Parser::parse_only` keeps no parentheses.
    pub(crate) is_lint: bool,
""", """    /// `Parser::parse_for_lint` made it: `Parser::parse_only` keeps no parentheses.
    pub(crate) is_lint: bool,
    /// Where the expression starts that is the body of an arrow function read between the "?" and the ":" of a conditional expression.
    pub(crate) body_before_colon: Option<i32>,
""")
    write(p, t)


INFER = """
    /// The flags that the expression at `start` is read with. `flags` is what a caller of main passes: the body of an arrow function with one name is before the ":" where a "?" stands before the name on its line, or where the name starts such a body.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_flags_of_arrow_body(&mut self, start: bun_ast::Loc, flags: EFlags) -> EFlags {
        if flags != EFlags::None {
            return flags;
        }
        let contents = self.lexer.contents;
        let known = self
            .starts_for_parse_only
            .as_deref()
            .and_then(|starts| starts.body_before_colon);
        let mut at = usize::try_from(start.start).unwrap_or(0);
        loop {
            at = blanks_before(contents, at);
            if at < 2 || contents.get(at - 2..at) != Some(b"=>".as_slice()) {
                return flags;
            }
            at = blanks_before(contents, at - 2);
            let end = at;
            while at > 0 && contents.get(at - 1).is_some_and(|&byte| is_name_byte(byte)) {
                at -= 1;
            }
            if at == end {
                return flags;
            }
            if known.is_some_and(|known| usize::try_from(known).ok() == Some(at)) {
                return EFlags::AfterQuestionAndBeforeColon;
            }
            at = blanks_before(contents, at);
            if at > 0
                && contents.get(at - 1) == Some(&b'?')
                && (at < 2 || contents.get(at - 2) != Some(&b'?'))
            {
                return EFlags::AfterQuestionAndBeforeColon;
            }
        }
    }
"""

INFER_FREE = """
/// Where the blanks that end at `at` start: spaces and tabs, no line break.
fn blanks_before(contents: &[u8], mut at: usize) -> usize {
    while at > 0 && matches!(contents.get(at - 1), Some(b' ' | b'\\t')) {
        at -= 1;
    }
    at
}

/// Whether `byte` can be part of a name: a letter, a digit, "_", "$", or a byte of a character outside ASCII.
fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$' || byte >= 0x80
}
"""

def c(d):
    p = d + '/p.rs'; t = read(p)
    t = rep(t, """    /// `Parser::parse_for_lint` made it: `Parser::parse_only` keeps no parentheses.
    pub(crate) is_lint: bool,
""", """    /// `Parser::parse_for_lint` made it: `Parser::parse_only` keeps no parentheses.
    pub(crate) is_lint: bool,
    /// Where the expression starts that is the body of an arrow function read between the "?" and the ":" of a conditional expression.
    pub(crate) body_before_colon: Option<i32>,
""")
    write(p, t)
    p = d + '/parse/parse_fn.rs'; t = read(p)
    t = rep(t, """        p.fn_or_arrow_data_parse = data.clone();
        let expr = match p.parse_expr_flagged(Level::Comma, flags) {
""", """        p.fn_or_arrow_data_parse = data.clone();
        let body_start = p.lexer.loc().start;
        if let Some(starts) = &mut p.starts_for_parse_only {
            starts.body_before_colon =
                (flags == EFlags::AfterQuestionAndBeforeColon).then_some(body_start);
        }
        let expr = match p.parse_expr_flagged(Level::Comma, flags) {
""")
    write(p, t)
    p = d + '/parse/mod.rs'; t = read(p)
    ha, hb = fn_text(t, "    pub(crate) fn parse_async_prefix_expr_for_lint(")
    t = t[:hb] + INFER + t[hb:]
    t = rep(t, """    ) -> Result<Expr, Error> {
        let p = self;
        if !p.lexer.has_newline_before && p.lexer.token == T::TFunction {
            return p.parse_fn_expr(async_loc, true);
        }
""", """    ) -> Result<Expr, Error> {
        let p = self;
        let flags = p.lint_flags_of_arrow_body(async_loc, flags);
        if !p.lexer.has_newline_before && p.lexer.token == T::TFunction {
            return p.parse_fn_expr(async_loc, true);
        }
""")
    t = rep(t, "\n/// Where the binding starts that `item`, an entry of a list in parentheses, becomes as a parameter.\n", INFER_FREE + "\n/// Where the binding starts that `item`, an entry of a list in parentheses, becomes as a parameter.\n")
    write(p, t)
    p = d + '/parse/parse_prefix.rs'; t = read(p)
    t = rep(t, """        flags: EFlags,
    ) -> PResult<Expr> {
        if level.gt(Level::Assign) {
            let old_allow_in = p.allow_in;
""", """        flags: EFlags,
    ) -> PResult<Expr> {
        let flags = p.lint_flags_of_arrow_body(loc, flags);
        if level.gt(Level::Assign) {
            let old_allow_in = p.allow_in;
""")
    t = rep(t, """        flags: EFlags,
    ) -> PResult<Expr> {
        let had_pure_comment_before =
            p.lexer.has_pure_comment_before && !p.options.ignore_dce_annotations;
        let less_than = p.lexer.snapshot();
""", """        flags: EFlags,
    ) -> PResult<Expr> {
        let flags = p.lint_flags_of_arrow_body(loc, flags);
        let had_pure_comment_before =
            p.lexer.has_pure_comment_before && !p.options.ignore_dce_annotations;
        let less_than = p.lexer.snapshot();
""")
    t = rep(t, """                p.lexer.expect_greater_than::<false>()?;
                let value = p.parse_prefix(level, errors.as_deref_mut(), flags)?;
""", """                p.lexer.expect_greater_than::<false>()?;
                let operand_start = p.lexer.loc().start;
                if let Some(starts) = &mut p.starts_for_parse_only {
                    starts.body_before_colon =
                        (flags == EFlags::AfterQuestionAndBeforeColon).then_some(operand_start);
                }
                let value = p.parse_prefix(level, errors.as_deref_mut(), flags)?;
""")
    write(p, t)

for tag, steps in (('m1', [m1]), ('a', [m1, a]), ('b', [m1, a, b]), ('c', [m1, a, c])):
    d = ROOT + '/' + tag + '/src/js_parser'
    if os.path.exists(ROOT + '/' + tag): shutil.rmtree(ROOT + '/' + tag)
    shutil.copytree(SRC, d)
    for s in steps: s(d)
    print(tag, 'written')
