#!/usr/bin/env python3
"""Applies one variant of the paren-expr seam experiment to a fresh copy of src/js_parser (base e3566be889).
usage: variant.py <variant>[+<variant>...] <directory of a fresh copy>
Every variant first gets the stubs: three fields in the boxed StartsForParseOnly and #[cold] #[inline(never)] helpers
that stand for the lint code (they call the Discard grammar where the real code calls the Build sink).
Variants (see README.md of this directory for what each one means):
  stub   only the stubs
  v1     a test of the boxed table after the token test at the three sites inside parse_paren_expr
  v1ts   v1 without the parenthesis record (the two TypeScript-only sites only)
  v1one  v1ts with ONE test for the return type (the cold helper also runs the expensive check)
  v1x    v1ts with the tests moved into two #[inline(never)] wrappers that parse_paren_expr calls
  v2     the five callers choose between parse_paren_expr and a #[cold] twin (const generic on the function)
  v2ts   v2 with the choice only in the TypeScript instantiation
  v3     nothing inside: the five callers call a cold helper after the function returned
  v3p    nothing inside: only the parenthesis record after return (pfx_t_open_paren, the cast path)
  v3r    v3 with the result kept in place (the cold helper gets &mut Result), v3pr: the same for v3p
  v3d    nothing inside: the five callers test BEFORE the call and go to a cold wrapper that calls the SAME
         parse_paren_expr and then the hook (no code after the call on the path without lint), v3pd: two callers only
  p57    the parenthesis record at parse_prefix.rs:57 (level above Assign), outside parse_paren_expr; p57v: the
         expression goes to the cold helper by value (no copy to the stack on the path without lint)
  v3d2   v3d without the pfx_t_open_paren site (use with topd), v3pd2: only the '<T>(' cast path (use with topd)
  topd   ONE test at the top of pfx_t_open_paren: a lint parse goes to a cold copy of that small function (both of its
         paths record), which calls the SAME parse_paren_expr
  r1     sidecar lengths saved and cut back inside lexer_backtracker_bool and lexer_backtracker_result
  r1f    the cut only on the failure path of the two backtrackers, by position (nothing saved)
  r2     sidecar lengths as a field of ParserSnapshot (saved in parser_snapshot, cut in restore_parser_snapshot)
  r3     nothing saved: restore_parser_snapshot cuts the lists by position
  e1     P1: the ':' test at parse/mod.rs:516 also asks level <= Assign
  e1c    P1: the same fix in the two callers that can pass a level above Assign (nothing inside)
  e2     P1: the '<T>(' and 'async<T>(' callers pass is_after_question_and_before_colon
"""
import sys, os
variants, d = sys.argv[1].split('+'), sys.argv[2]
files = {}
def get(rel):
    if rel not in files: files[rel] = open(os.path.join(d, rel)).read()
    return files[rel]
def rep(rel, old, new, count=1):
    s = get(rel)
    assert s.count(old) == count, (rel, old[:80], s.count(old))
    files[rel] = s.replace(old, new)

# ---------------------------------------------------------------- stubs
rep('p.rs', '''    pub(crate) class_elements: bun_collections::HashMap<i32, i32>,
}''', '''    pub(crate) class_elements: bun_collections::HashMap<i32, i32>,
    pub(crate) lint: bool,
    pub(crate) lint_types: Vec<[u32; 4]>,
    pub(crate) lint_wrappers: Vec<(Expr, u32, u32)>,
}''')

STUBS = '''
impl crate::p::StartsForParseOnly {
    #[inline]
    pub(crate) fn lint_mark(&self) -> [u32; 2] {
        [self.lint_types.len() as u32, self.lint_wrappers.len() as u32]
    }
    #[inline]
    pub(crate) fn lint_rewind(&mut self, mark: [u32; 2]) {
        self.lint_types.truncate(mark[0] as usize);
        self.lint_wrappers.truncate(mark[1] as usize);
    }
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_rewind_to(&mut self, start: usize) {
        while self.lint_types.last().is_some_and(|r| r[2] as usize >= start) {
            self.lint_types.pop();
        }
        while self.lint_wrappers.last().is_some_and(|r| r.1 as usize >= start) {
            self.lint_wrappers.pop();
        }
    }
}
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_arrow_parameter_type(&mut self, item: &bun_ast::Expr) -> Result<(), Error> {
        let key = match &item.data {
            bun_ast::ExprData::ESpread(spread) => spread.value.loc,
            _ => item.loc,
        };
        let start = self.lexer.start as u32;
        self.skip_type_script_type_with_opts::<Discard>(
            Level::Lowest,
            SkipTypeOptionsBitset::empty(),
            &mut (),
        )?;
        let end = self.lexer.start as u32;
        if let Some(side) = self.starts_for_parse_only.as_deref_mut() {
            side.lint_types.push([0, key.start as u32, start, end]);
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_arrow_return_type_known(&mut self, arrow: bun_ast::Loc) -> Result<(), Error> {
        let start = self.lexer.start as u32;
        self.skip_typescript_return_type()?;
        let end = self.lexer.start as u32;
        if let Some(side) = self.starts_for_parse_only.as_deref_mut() {
            side.lint_types.push([1, arrow.start as u32, start, end]);
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_try_arrow_return_type(&mut self, arrow: bun_ast::Loc) -> bool {
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let mark = self.starts_for_parse_only.as_deref().map(|side| side.lint_mark());
        let result: Result<(u32, u32), Error> = (|| {
            self.lexer.expect(T::TColon)?;
            let start = self.lexer.start as u32;
            self.skip_typescript_return_type()?;
            if self.lexer.token != T::TEqualsGreaterThan {
                return Err(crate::Error::Backtrack);
            }
            Ok((start, self.lexer.start as u32))
        })();
        self.lexer.is_log_disabled = old_log_disabled;
        match result {
            Ok((start, end)) => {
                if let Some(side) = self.starts_for_parse_only.as_deref_mut() {
                    side.lint_types.push([1, arrow.start as u32, start, end]);
                }
                true
            }
            Err(_) => {
                self.lexer.restore(&old_lexer);
                self.lexer.is_log_disabled = old_log_disabled;
                if let (Some(side), Some(mark)) = (self.starts_for_parse_only.as_deref_mut(), mark) {
                    side.lint_rewind(mark);
                }
                false
            }
        }
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_arrow_return_type(
        &mut self,
        arrow: bun_ast::Loc,
        after_question: bool,
        arrow_data: &FnOrArrowDataParse,
    ) -> Result<bool, Error> {
        if !after_question {
            return Ok(self.lint_try_arrow_return_type(arrow));
        }
        if !self.is_type_script_arrow_return_type_after_question_and_before_colon(arrow_data)? {
            return Ok(false);
        }
        self.lexer.next()?;
        self.lint_arrow_return_type_known(arrow)?;
        Ok(true)
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_parenthesized(&mut self, open: bun_ast::Loc, value: &bun_ast::Expr) {
        let close = self.lexer.start as u32;
        if let Some(side) = self.starts_for_parse_only.as_deref_mut() {
            if side.lint {
                side.lint_wrappers.push((*value, open.start as u32, close));
            }
        }
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_after_paren_expr(
        &mut self,
        open: bun_ast::Loc,
        owner: bun_ast::Loc,
        value: &bun_ast::Expr,
    ) -> Result<(), Error> {
        if value.loc.start != owner.start {
            self.lint_parenthesized(open, value);
            return Ok(());
        }
        if !TYPESCRIPT || !matches!(value.data, bun_ast::ExprData::EArrow(_)) {
            return Ok(());
        }
        let old_lexer = self.lexer.snapshot();
        if let Some(side) = self.starts_for_parse_only.as_deref_mut() {
            side.lint_types.push([2, owner.start as u32, open.start as u32, old_lexer.start as u32]);
        }
        self.lexer.restore(&old_lexer);
        Ok(())
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_after_paren_expr_in_place(
        &mut self,
        open: usize,
        owner: bun_ast::Loc,
        result: &mut Result<bun_ast::Expr, Error>,
    ) {
        let Ok(value) = result else {
            return;
        };
        let value = *value;
        let open = bun_ast::Loc { start: open as i32 };
        if let Err(err) = self.lint_after_paren_expr(open, owner, &value) {
            *result = Err(err);
        }
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_parenthesized_value(&mut self, open: bun_ast::Loc, value: bun_ast::Expr) {
        self.lint_parenthesized(open, &value);
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_parse_paren_expr(
        &mut self,
        open: usize,
        loc: bun_ast::Loc,
        level: Level,
        opts: crate::parser::ParenExprOpts,
    ) -> Result<bun_ast::Expr, Error> {
        let value = self.parse_paren_expr(loc, level, opts)?;
        let open = bun_ast::Loc { start: open as i32 };
        self.lint_after_paren_expr(open, loc, &value)?;
        Ok(value)
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_open_paren(
        &mut self,
        level: Level,
        flags: bun_ast::expr::EFlags,
    ) -> Result<bun_ast::Expr, Error> {
        let loc = self.lexer.loc();
        self.lexer.next()?;
        if level.gt(Level::Assign) {
            let old_allow_in = self.allow_in;
            self.allow_in = true;
            let mut value = self.parse_expr(Level::Lowest)?;
            self.mark_expr_as_parenthesized(&mut value);
            self.lint_parenthesized(loc, &value);
            self.lexer.expect(T::TCloseParen)?;
            self.allow_in = old_allow_in;
            return Ok(value);
        }
        let value = self.parse_paren_expr(
            loc,
            level,
            crate::parser::ParenExprOpts {
                is_after_question_and_before_colon: flags
                    == bun_ast::expr::EFlags::AfterQuestionAndBeforeColon,
                ..Default::default()
            },
        )?;
        self.lint_after_paren_expr(loc, loc, &value)?;
        Ok(value)
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_rewind_after_backtrack(&mut self) {
        let start = self.lexer.start;
        if let Some(side) = self.starts_for_parse_only.as_deref_mut() {
            side.lint_rewind_to(start);
        }
    }
}
'''
files['parse/parse_skip_typescript.rs'] = get('parse/parse_skip_typescript.rs') + STUBS

M = 'parse/mod.rs'; PP = 'parse/parse_prefix.rs'; SK = 'parse/parse_skip_typescript.rs'
SITE1 = '''                type_colon_range = p.lexer.range();
                p.lexer.next()?;
                p.skip_type_script_type(Level::Lowest)?;
            }'''
SITE2 = '''                if opts.is_after_question_and_before_colon {
                    // Only do this very expensive check if we must
                    is_arrow_fn = p
                        .is_type_script_arrow_return_type_after_question_and_before_colon(
                            &arrow_data,
                        )?;
                    if is_arrow_fn {
                        // We know this will succeed because we've already done it once above
                        p.lexer.next()?;
                        p.skip_typescript_return_type()?;
                    }
                } else {
                    // Otherwise, do the less expensive check
                    is_arrow_fn = p.try_skip_type_script_arrow_return_type_with_backtracking();
                }'''
SITE3 = '''            let mut value = Expr::join_all_with_comma(items);
            p.mark_expr_as_parenthesized(&mut value);
            return Ok(value);'''
def site1(test):
    rep(M, SITE1, '''                type_colon_range = p.lexer.range();
                p.lexer.next()?;
                if %s {
                    p.lint_arrow_parameter_type(&item)?;
                } else {
                    p.skip_type_script_type(Level::Lowest)?;
                }
            }''' % test)
def site2(test):
    rep(M, SITE2, '''                if opts.is_after_question_and_before_colon {
                    // Only do this very expensive check if we must
                    is_arrow_fn = p
                        .is_type_script_arrow_return_type_after_question_and_before_colon(
                            &arrow_data,
                        )?;
                    if is_arrow_fn {
                        // We know this will succeed because we've already done it once above
                        p.lexer.next()?;
                        if %s {
                            p.lint_arrow_return_type_known(loc)?;
                        } else {
                            p.skip_typescript_return_type()?;
                        }
                    }
                } else if %s {
                    is_arrow_fn = p.lint_try_arrow_return_type(loc);
                } else {
                    // Otherwise, do the less expensive check
                    is_arrow_fn = p.try_skip_type_script_arrow_return_type_with_backtracking();
                }''' % (test, test))
def site3(test):
    rep(M, SITE3, '''            let mut value = Expr::join_all_with_comma(items);
            p.mark_expr_as_parenthesized(&mut value);
            if %s {
                p.lint_parenthesized(loc, &value);
            }
            return Ok(value);''' % test)
TEST = 'p.starts_for_parse_only.is_some()'
CALL1 = '''        p.parse_paren_expr(
            loc,
            level,
            ParenExprOpts {
                is_after_question_and_before_colon: flags == EFlags::AfterQuestionAndBeforeColon,
                ..Default::default()
            },
        )
    }'''
CALL2 = '''                return p.parse_paren_expr(
                    loc,
                    level,
                    ParenExprOpts {
                        force_arrow_fn: true,
                        ..Default::default()
                    },
                );'''
CALL3 = '''                    p.lexer.expect(T::TOpenParen)?;
                    return p.parse_paren_expr(
                        loc,
                        level,
                        ParenExprOpts {
                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            ..Default::default()
                        },
                    );'''
CALL4 = '''                    p.lexer.next()?;
                    return p.parse_paren_expr(
                        async_range.loc,
                        level,
                        ParenExprOpts {
                            is_async: true,
                            is_after_question_and_before_colon: flags
                                == EFlags::AfterQuestionAndBeforeColon,
                            ..Default::default()
                        },
                    );'''
CALL5 = '''                                p.lexer.next()?;
                                return p.parse_paren_expr(
                                    async_range.loc,
                                    level,
                                    ParenExprOpts {
                                        is_async: true,
                                        force_arrow_fn: result
                                            == SkipTypeParameterResult::DefinitelyTypeParameters,
                                        ..Default::default()
                                    },
                                );'''
HEAD = '''    /// This assumes that the open parenthesis has already been parsed by the caller
    pub(crate) fn parse_paren_expr(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        let p = self;'''

for v in variants:
    if v == 'stub':
        pass
    elif v == 'v1':
        site1(TEST); site2(TEST); site3(TEST)
    elif v == 'v1ts':
        site1(TEST); site2(TEST)
    elif v == 'v1one':
        site1(TEST)
        rep(M, SITE2, '''                if p.starts_for_parse_only.is_some() {
                    is_arrow_fn = p.lint_arrow_return_type(
                        loc,
                        opts.is_after_question_and_before_colon,
                        &arrow_data,
                    )?;
                } else if opts.is_after_question_and_before_colon {
                    // Only do this very expensive check if we must
                    is_arrow_fn = p
                        .is_type_script_arrow_return_type_after_question_and_before_colon(
                            &arrow_data,
                        )?;
                    if is_arrow_fn {
                        // We know this will succeed because we've already done it once above
                        p.lexer.next()?;
                        p.skip_typescript_return_type()?;
                    }
                } else {
                    // Otherwise, do the less expensive check
                    is_arrow_fn = p.try_skip_type_script_arrow_return_type_with_backtracking();
                }''')
    elif v == 'v1x':
        rep(M, SITE1, '''                type_colon_range = p.lexer.range();
                p.lexer.next()?;
                p.skip_arrow_parameter_type(&item)?;
            }''')
        rep(M, SITE2, '''                is_arrow_fn = p.skip_arrow_return_type(
                    loc,
                    opts.is_after_question_and_before_colon,
                    &arrow_data,
                )?;''')
        files[SK] = get(SK) + '''
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline(never)]
    pub(crate) fn skip_arrow_parameter_type(&mut self, item: &bun_ast::Expr) -> Result<(), Error> {
        if self.starts_for_parse_only.is_some() {
            return self.lint_arrow_parameter_type(item);
        }
        self.skip_type_script_type(Level::Lowest)
    }

    #[inline(never)]
    pub(crate) fn skip_arrow_return_type(
        &mut self,
        arrow: bun_ast::Loc,
        after_question: bool,
        arrow_data: &FnOrArrowDataParse,
    ) -> Result<bool, Error> {
        if self.starts_for_parse_only.is_some() {
            return self.lint_arrow_return_type(arrow, after_question, arrow_data);
        }
        if after_question {
            let is_arrow_fn =
                self.is_type_script_arrow_return_type_after_question_and_before_colon(arrow_data)?;
            if is_arrow_fn {
                self.lexer.next()?;
                self.skip_typescript_return_type()?;
            }
            return Ok(is_arrow_fn);
        }
        Ok(self.try_skip_type_script_arrow_return_type_with_backtracking())
    }
}
'''
    elif v in ('v2', 'v2ts'):
        rep(M, HEAD, '''    /// This assumes that the open parenthesis has already been parsed by the caller
    pub(crate) fn parse_paren_expr(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        self.parse_paren_expr_impl::<false>(loc, level, opts)
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn parse_paren_expr_for_lint(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        self.parse_paren_expr_impl::<true>(loc, level, opts)
    }

    #[inline(always)]
    pub(crate) fn parse_paren_expr_either(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        if %s {
            return self.parse_paren_expr_for_lint(loc, level, opts);
        }
        self.parse_paren_expr(loc, level, opts)
    }

    #[inline(always)]
    fn parse_paren_expr_impl<const LINT: bool>(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        let p = self;''' % ('self.starts_for_parse_only.is_some()' if v == 'v2' else 'Self::IS_TYPESCRIPT_ENABLED && self.starts_for_parse_only.is_some()'))
        site1('LINT'); site2('LINT'); site3('LINT')
        rep(PP, CALL1, CALL1.replace('p.parse_paren_expr(', 'p.parse_paren_expr_either('))
        rep(PP, CALL2, CALL2.replace('p.parse_paren_expr(', 'p.parse_paren_expr_either('))
        rep(PP, CALL3, CALL3.replace('p.parse_paren_expr(', 'p.parse_paren_expr_either('))
        rep(M, CALL4, CALL4.replace('p.parse_paren_expr(', 'p.parse_paren_expr_either('))
        rep(M, CALL5, CALL5.replace('p.parse_paren_expr(', 'p.parse_paren_expr_either('))
    elif v == 'v3':
        rep(PP, CALL1, '''        let value = p.parse_paren_expr(
            loc,
            level,
            ParenExprOpts {
                is_after_question_and_before_colon: flags == EFlags::AfterQuestionAndBeforeColon,
                ..Default::default()
            },
        )?;
        if p.starts_for_parse_only.is_some() {
            p.lint_after_paren_expr(loc, loc, &value)?;
        }
        Ok(value)
    }''')
        rep(PP, CALL2, '''                let paren_loc = p.lexer.loc();
                p.lexer.expect(T::TOpenParen)?;
                let value = p.parse_paren_expr(
                    loc,
                    level,
                    ParenExprOpts {
                        force_arrow_fn: true,
                        ..Default::default()
                    },
                )?;
                if p.starts_for_parse_only.is_some() {
                    p.lint_after_paren_expr(paren_loc, loc, &value)?;
                }
                return Ok(value);''')
        rep(PP, '''                p.lexer.expect(T::TOpenParen)?;
                let paren_loc = p.lexer.loc();
                p.lexer.expect(T::TOpenParen)?;''', '''                let paren_loc = p.lexer.loc();
                p.lexer.expect(T::TOpenParen)?;''')
        rep(PP, CALL3, '''                    let paren_loc = p.lexer.loc();
                    p.lexer.expect(T::TOpenParen)?;
                    let value = p.parse_paren_expr(
                        loc,
                        level,
                        ParenExprOpts {
                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            ..Default::default()
                        },
                    )?;
                    if p.starts_for_parse_only.is_some() {
                        p.lint_after_paren_expr(paren_loc, loc, &value)?;
                    }
                    return Ok(value);''')
        rep(M, CALL4, '''                    let paren_loc = p.lexer.loc();
                    p.lexer.next()?;
                    let value = p.parse_paren_expr(
                        async_range.loc,
                        level,
                        ParenExprOpts {
                            is_async: true,
                            is_after_question_and_before_colon: flags
                                == EFlags::AfterQuestionAndBeforeColon,
                            ..Default::default()
                        },
                    )?;
                    if Self::IS_TYPESCRIPT_ENABLED && p.starts_for_parse_only.is_some() {
                        p.lint_after_paren_expr(paren_loc, async_range.loc, &value)?;
                    }
                    return Ok(value);''')
        rep(M, CALL5, '''                                let paren_loc = p.lexer.loc();
                                p.lexer.next()?;
                                let value = p.parse_paren_expr(
                                    async_range.loc,
                                    level,
                                    ParenExprOpts {
                                        is_async: true,
                                        force_arrow_fn: result
                                            == SkipTypeParameterResult::DefinitelyTypeParameters,
                                        ..Default::default()
                                    },
                                )?;
                                if p.starts_for_parse_only.is_some() {
                                    p.lint_after_paren_expr(paren_loc, async_range.loc, &value)?;
                                }
                                return Ok(value);''')
    elif v in ('v3r', 'v3pr'):
        rep(PP, CALL1, '''        let mut result = p.parse_paren_expr(
            loc,
            level,
            ParenExprOpts {
                is_after_question_and_before_colon: flags == EFlags::AfterQuestionAndBeforeColon,
                ..Default::default()
            },
        );
        if p.starts_for_parse_only.is_some() {
            p.lint_after_paren_expr_in_place(loc.start as usize, loc, &mut result);
        }
        result
    }''')
        rep(PP, CALL3, '''                    let paren_start = p.lexer.start;
                    p.lexer.expect(T::TOpenParen)?;
                    let mut result = p.parse_paren_expr(
                        loc,
                        level,
                        ParenExprOpts {
                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            ..Default::default()
                        },
                    );
                    if p.starts_for_parse_only.is_some() {
                        p.lint_after_paren_expr_in_place(paren_start, loc, &mut result);
                    }
                    return result;''')
        if v == 'v3r':
            rep(PP, CALL2, '''                let mut result = p.parse_paren_expr(
                    loc,
                    level,
                    ParenExprOpts {
                        force_arrow_fn: true,
                        ..Default::default()
                    },
                );
                if p.starts_for_parse_only.is_some() {
                    p.lint_after_paren_expr_in_place(paren_start, loc, &mut result);
                }
                return result;''')
            rep(PP, '''                p.lexer.expect(T::TOpenParen)?;
                let mut result = p.parse_paren_expr(
                    loc,
                    level,
                    ParenExprOpts {
                        force_arrow_fn: true,''', '''                let paren_start = p.lexer.start;
                p.lexer.expect(T::TOpenParen)?;
                let mut result = p.parse_paren_expr(
                    loc,
                    level,
                    ParenExprOpts {
                        force_arrow_fn: true,''')
            rep(M, CALL4, '''                    let paren_start = p.lexer.start;
                    p.lexer.next()?;
                    let mut result = p.parse_paren_expr(
                        async_range.loc,
                        level,
                        ParenExprOpts {
                            is_async: true,
                            is_after_question_and_before_colon: flags
                                == EFlags::AfterQuestionAndBeforeColon,
                            ..Default::default()
                        },
                    );
                    if Self::IS_TYPESCRIPT_ENABLED && p.starts_for_parse_only.is_some() {
                        p.lint_after_paren_expr_in_place(paren_start, async_range.loc, &mut result);
                    }
                    return result;''')
            rep(M, CALL5, '''                                let paren_start = p.lexer.start;
                                p.lexer.next()?;
                                let mut result = p.parse_paren_expr(
                                    async_range.loc,
                                    level,
                                    ParenExprOpts {
                                        is_async: true,
                                        force_arrow_fn: result
                                            == SkipTypeParameterResult::DefinitelyTypeParameters,
                                        ..Default::default()
                                    },
                                );
                                if p.starts_for_parse_only.is_some() {
                                    p.lint_after_paren_expr_in_place(
                                        paren_start,
                                        async_range.loc,
                                        &mut result,
                                    );
                                }
                                return result;''')
    elif v in ('v3d', 'v3pd', 'v3d2', 'v3pd2'):
        def disp(text, open_expr, owner, gate='p.starts_for_parse_only.is_some()', indent=''):
            a = text.index('return p.parse_paren_expr(') if 'return p.parse_paren_expr(' in text else text.index('p.parse_paren_expr(')
            head = text[:a]; call = text[a:]
            ret = call.startswith('return ')
            body = call[len('return '):] if ret else call
            args = body[len('p.parse_paren_expr('):]
            lint = 'p.lint_parse_paren_expr(' + open_expr + ',' + args
            lint = lint.rstrip()
            if lint.endswith(';'): lint = lint[:-1]
            if lint.endswith('}'): lint = lint[:-1].rstrip()
            return head + 'if ' + gate + ' {\n' + indent + '    return ' + lint + ';\n' + indent + '}\n' + indent + call
        if v in ('v3d', 'v3pd'):
            rep(PP, CALL1, disp(CALL1, 'loc.start as usize', 'loc', indent='        '))
        rep(PP, CALL3, disp(CALL3.replace('p.lexer.expect(T::TOpenParen)?;', 'let paren_start = p.lexer.start;\n                    p.lexer.expect(T::TOpenParen)?;'), 'paren_start', 'loc', indent='                    '))
        if v in ('v3d', 'v3d2'):
            rep(PP, CALL2, disp(CALL2, 'paren_start', 'loc', indent='                '))
            rep(PP, '''                p.lexer.expect(T::TOpenParen)?;
                if p.starts_for_parse_only.is_some() {
                    return p.lint_parse_paren_expr(paren_start,
                    loc,
                    level,
                    ParenExprOpts {
                        force_arrow_fn: true,''', '''                let paren_start = p.lexer.start;
                p.lexer.expect(T::TOpenParen)?;
                if p.starts_for_parse_only.is_some() {
                    return p.lint_parse_paren_expr(paren_start,
                    loc,
                    level,
                    ParenExprOpts {
                        force_arrow_fn: true,''')
            rep(M, CALL4, disp(CALL4.replace('p.lexer.next()?;', 'let paren_start = p.lexer.start;\n                    p.lexer.next()?;'), 'paren_start', 'async_range.loc', gate='Self::IS_TYPESCRIPT_ENABLED && p.starts_for_parse_only.is_some()', indent='                    '))
            rep(M, CALL5, disp(CALL5.replace('p.lexer.next()?;', 'let paren_start = p.lexer.start;\n                                p.lexer.next()?;'), 'paren_start', 'async_range.loc', indent='                                '))
    elif v == 'v3p':
        rep(PP, CALL1, '''        let value = p.parse_paren_expr(
            loc,
            level,
            ParenExprOpts {
                is_after_question_and_before_colon: flags == EFlags::AfterQuestionAndBeforeColon,
                ..Default::default()
            },
        )?;
        if p.starts_for_parse_only.is_some() && value.loc.start != loc.start {
            p.lint_parenthesized(loc, &value);
        }
        Ok(value)
    }''')
        rep(PP, CALL3, '''                    let paren_loc = p.lexer.loc();
                    p.lexer.expect(T::TOpenParen)?;
                    let value = p.parse_paren_expr(
                        loc,
                        level,
                        ParenExprOpts {
                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            ..Default::default()
                        },
                    )?;
                    if p.starts_for_parse_only.is_some() && value.loc.start != loc.start {
                        p.lint_parenthesized(paren_loc, &value);
                    }
                    return Ok(value);''')
    elif v == 'p57':
        rep(PP, '''            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            p.lexer.expect(T::TCloseParen)?;
''', '''            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            if p.starts_for_parse_only.is_some() {
                p.lint_parenthesized(loc, &value);
            }
            p.lexer.expect(T::TCloseParen)?;
''')
    elif v == 'topd':
        rep(PP, '''    fn pfx_t_open_paren(p: &mut Self, level: Level, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();''', '''    fn pfx_t_open_paren(p: &mut Self, level: Level, flags: EFlags) -> PResult<Expr> {
        if p.starts_for_parse_only.is_some() {
            return p.lint_open_paren(level, flags);
        }
        let loc = p.lexer.loc();''')
    elif v == 'p57v':
        rep(PP, '''            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            p.lexer.expect(T::TCloseParen)?;
''', '''            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            if p.starts_for_parse_only.is_some() {
                p.lint_parenthesized_value(loc, value);
            }
            p.lexer.expect(T::TCloseParen)?;
''')
    elif v == 'r1':
        rep(SK, '''        self.mark_type_script_only();
        // The Lexer
        // holds `&mut Log`, so backtracking goes through a POD `LexerSnapshot` + `restore()`.
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let mut backtrack = false;
        match func(self) {
            Ok(_) => {}
            Err(_) => {
                backtrack = true;
            }
        }

        if backtrack {
            self.lexer.restore(&old_lexer);
        }''', '''        self.mark_type_script_only();
        // The Lexer
        // holds `&mut Log`, so backtracking goes through a POD `LexerSnapshot` + `restore()`.
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let mark = self.starts_for_parse_only.as_deref().map(|side| side.lint_mark());
        let mut backtrack = false;
        match func(self) {
            Ok(_) => {}
            Err(_) => {
                backtrack = true;
            }
        }

        if backtrack {
            self.lexer.restore(&old_lexer);
            if let (Some(side), Some(mark)) = (self.starts_for_parse_only.as_deref_mut(), mark) {
                side.lint_rewind(mark);
            }
        }''')
        rep(SK, '''        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let mut backtrack = false;
        let result = match func(self) {
            Ok(r) => r,
            Err(_) => {
                backtrack = true;
                SkipTypeParameterResult::DidNotSkipAnything
            }
        };

        if backtrack {
            self.lexer.restore(&old_lexer);
        }''', '''        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let mark = self.starts_for_parse_only.as_deref().map(|side| side.lint_mark());
        let mut backtrack = false;
        let result = match func(self) {
            Ok(r) => r,
            Err(_) => {
                backtrack = true;
                SkipTypeParameterResult::DidNotSkipAnything
            }
        };

        if backtrack {
            self.lexer.restore(&old_lexer);
            if let (Some(side), Some(mark)) = (self.starts_for_parse_only.as_deref_mut(), mark) {
                side.lint_rewind(mark);
            }
        }''')
    elif v == 'r1f':
        rep(SK, '''        if backtrack {
            self.lexer.restore(&old_lexer);
        }''', '''        if backtrack {
            self.lexer.restore(&old_lexer);
            if self.starts_for_parse_only.is_some() {
                self.lint_rewind_after_backtrack();
            }
        }''', 2)
    elif v == 'r2':
        rep('p.rs', '''    allocated_names_len: usize,
    import_records_len: usize,
}''', '''    allocated_names_len: usize,
    import_records_len: usize,
    lint_mark: Option<[u32; 2]>,
}''')
        rep('p.rs', '''            import_records_len: self.import_records.len(),
        }
    }''', '''            import_records_len: self.import_records.len(),
            lint_mark: self.starts_for_parse_only.as_deref().map(|side| side.lint_mark()),
        }
    }''')
        rep('p.rs', '''    pub(crate) fn restore_parser_snapshot(&mut self, snapshot: ParserSnapshot<'a>) {
        self.lexer.restore(&snapshot.lexer);''', '''    pub(crate) fn restore_parser_snapshot(&mut self, snapshot: ParserSnapshot<'a>) {
        self.lexer.restore(&snapshot.lexer);
        if let (Some(side), Some(mark)) = (self.starts_for_parse_only.as_deref_mut(), snapshot.lint_mark) {
            side.lint_rewind(mark);
        }''')
    elif v == 'r3':
        rep('p.rs', '''    pub(crate) fn restore_parser_snapshot(&mut self, snapshot: ParserSnapshot<'a>) {
        self.lexer.restore(&snapshot.lexer);''', '''    pub(crate) fn restore_parser_snapshot(&mut self, snapshot: ParserSnapshot<'a>) {
        self.lexer.restore(&snapshot.lexer);
        if self.starts_for_parse_only.is_some() {
            self.lint_rewind_after_backtrack();
        }''')
    elif v == 'e1':
        rep(M, '''            || (Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon)
        {
            // Arrow functions are not allowed inside certain expressions''', '''            || (Self::IS_TYPESCRIPT_ENABLED
                && p.lexer.token == T::TColon
                && level.lte(Level::Assign))
        {
            // Arrow functions are not allowed inside certain expressions''')
    elif v == 'e1c':
        rep(PP, '''                result => {
                    p.lexer.expect(T::TOpenParen)?;
                    return p.parse_paren_expr(''', '''                result => {
                    p.lexer.expect(T::TOpenParen)?;
                    if level.gt(Level::Assign)
                        && result != SkipTypeParameterResult::DefinitelyTypeParameters
                    {
                        let old_allow_in = p.allow_in;
                        p.allow_in = true;
                        let mut value = p.parse_expr(Level::Lowest)?;
                        p.mark_expr_as_parenthesized(&mut value);
                        p.lexer.expect(T::TCloseParen)?;
                        p.allow_in = old_allow_in;
                        return Ok(value);
                    }
                    return p.parse_paren_expr(''')
        rep(M, '''                T::TOpenParen => {
                    p.lexer.next()?;
                    return p.parse_paren_expr(
                        async_range.loc,''', '''                T::TOpenParen => {
                    if Self::IS_TYPESCRIPT_ENABLED && level.gt(Level::Assign) {
                        return p.parse_async_call(async_range.loc);
                    }
                    p.lexer.next()?;
                    return p.parse_paren_expr(
                        async_range.loc,''')
        rep(M, '''                            result => {
                                p.lexer.next()?;
                                return p.parse_paren_expr(
                                    async_range.loc,''', '''                            result => {
                                if level.gt(Level::Assign)
                                    && result != SkipTypeParameterResult::DefinitelyTypeParameters
                                {
                                    return p.parse_async_call(async_range.loc);
                                }
                                p.lexer.next()?;
                                return p.parse_paren_expr(
                                    async_range.loc,''')
        rep(M, '''    /// This parses an expression. This assumes we've already parsed the "async"
    /// keyword and are currently looking at the following token.''', '''    #[cold]
    #[inline(never)]
    fn parse_async_call(&mut self, loc: bun_ast::Loc) -> Result<Expr, Error> {
        let async_ref = self.store_name_in_ref(b"async");
        let target = self.new_expr(
            E::Identifier {
                ref_: async_ref,
                ..Default::default()
            },
            loc,
        );
        let call_args = self.parse_call_args()?;
        Ok(self.new_expr(
            E::Call {
                target,
                args: call_args.list,
                close_paren_loc: call_args.loc,
                ..Default::default()
            },
            loc,
        ))
    }

    /// This parses an expression. This assumes we've already parsed the "async"
    /// keyword and are currently looking at the following token.''')
    elif v == 'e2':
        rep(PP, '''                        ParenExprOpts {
                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            ..Default::default()
                        },''', '''                        ParenExprOpts {
                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            is_after_question_and_before_colon: flags
                                == EFlags::AfterQuestionAndBeforeColon,
                            ..Default::default()
                        },''')
        rep(M, '''                                    ParenExprOpts {
                                        is_async: true,
                                        force_arrow_fn: result
                                            == SkipTypeParameterResult::DefinitelyTypeParameters,
                                        ..Default::default()
                                    },''', '''                                    ParenExprOpts {
                                        is_async: true,
                                        force_arrow_fn: result
                                            == SkipTypeParameterResult::DefinitelyTypeParameters,
                                        is_after_question_and_before_colon: flags
                                            == EFlags::AfterQuestionAndBeforeColon,
                                        ..Default::default()
                                    },''')
    else:
        raise SystemExit('unknown variant ' + v)
for rel, s in files.items(): open(os.path.join(d, rel), 'w').write(s)
print('patched', '+'.join(variants), sorted(files))
