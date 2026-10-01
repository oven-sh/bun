#!/usr/bin/env python3
"""Makes patched copies of src/js_parser (base e3566be889) for the experiments of the parse_paren_expr seam.
usage: variants.py <variant> [<variant> ...] | --list        copies go to $ROOT/<variant>/src/js_parser (default /tmp/paren-seam/root)
Every variant starts from the unpatched tree of /workspace/wt/parser. The lint helpers are stubs: #[cold] #[inline(never)],
they push into Vecs in the boxed table; the DecoratorMetadata sink stands in for the Build sink. Nothing is written into the worktree."""
import os, shutil, sys

SRC = '/workspace/wt/parser/src/js_parser'
ROOT = os.environ.get('ROOT', '/tmp/paren-seam/root')
MOD, PFX, SKIP, PRS, FN, PARSER = 'parse/mod.rs', 'parse/parse_prefix.rs', 'parse/parse_skip_typescript.rs', 'p.rs', 'parse/parse_fn.rs', 'parser.rs'

class Tree:
    def __init__(self, tag):
        self.dir = ROOT + '/' + tag + '/src/js_parser'
        if os.path.exists(ROOT + '/' + tag): shutil.rmtree(ROOT + '/' + tag)
        shutil.copytree(SRC, self.dir)
    def rep(self, f, old, new, count=1):
        p = self.dir + '/' + f; s = open(p).read()
        assert s.count(old) == count, (f, s.count(old), old[:90])
        open(p, 'w').write(s.replace(old, new))
    def append(self, f, text):
        open(self.dir + '/' + f, 'a').write(text)

LINT = 'p.starts_for_parse_only.is_some()'

# ---- the stub: a field in the boxed table and cold helpers ----
def stub(t):
    t.rep(PRS, "    pub(crate) class_elements: bun_collections::HashMap<i32, i32>,\n}",
          "    pub(crate) class_elements: bun_collections::HashMap<i32, i32>,\n    pub lint: Option<LintSeam>,\n}\n\n"
          "#[derive(Default)]\npub struct LintSeam {\n    pub parens: Vec<(i32, i32, js_ast::Expr)>,\n    pub annotations: Vec<(i32, i32, i32)>,\n    pub return_types: Vec<(i32, i32, i32)>,\n}")
    t.append(SKIP, r'''
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline]
    pub(crate) fn lint_seam(&mut self) -> Option<&mut crate::p::LintSeam> {
        self.starts_for_parse_only.as_deref_mut().and_then(|s| s.lint.as_mut())
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_mark(&mut self) -> [u32; 3] {
        match self.lint_seam() {
            Some(l) => [l.parens.len() as u32, l.annotations.len() as u32, l.return_types.len() as u32],
            None => [0; 3],
        }
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_rewind(&mut self, mark: [u32; 3]) {
        if let Some(l) = self.lint_seam() {
            l.parens.truncate(mark[0] as usize);
            l.annotations.truncate(mark[1] as usize);
            l.return_types.truncate(mark[2] as usize);
        }
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_rewind_to(&mut self, position: usize) {
        let position = position as i32;
        if let Some(l) = self.lint_seam() {
            while l.parens.last().is_some_and(|r| r.1 >= position) { l.parens.pop(); }
            while l.annotations.last().is_some_and(|r| r.1 >= position) { l.annotations.pop(); }
            while l.return_types.last().is_some_and(|r| r.1 >= position) { l.return_types.pop(); }
        }
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_paren(&mut self, open: bun_ast::Loc, value: bun_ast::Expr) {
        let close = self.lexer.start as i32;
        if let Some(l) = self.lint_seam() {
            l.parens.push((open.start, close, value));
        }
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_after_paren_expr(&mut self, loc: bun_ast::Loc, value: bun_ast::Expr) {
        if value.loc.start == loc.start {
            return;
        }
        let close = self.lexer.start as i32;
        if let Some(l) = self.lint_seam() {
            l.parens.push((loc.start, close, value));
        }
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_type(&mut self, return_type: bool) -> Result<(i32, i32), Error> {
        let start = self.lexer.start as i32;
        let mut out = Metadata::DEFAULT;
        let opts = if return_type {
            SkipTypeOptionsBitset::only(SkipTypeOptions::IsReturnType)
        } else {
            SkipTypeOptionsBitset::empty()
        };
        self.skip_type_script_type_with_opts::<DecoratorMetadata>(Level::Lowest, opts, &mut out)?;
        Ok((start, self.lexer.start as i32))
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_arrow_param_type(&mut self, item: bun_ast::Expr) -> Result<(), Error> {
        let (start, end) = self.lint_type(false)?;
        let owner = match item.data {
            bun_ast::ExprData::ESpread(spread) => spread.value.loc.start,
            _ => item.loc.start,
        };
        if let Some(l) = self.lint_seam() {
            l.annotations.push((owner, start, end));
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_arrow_param_type_by_scope(&mut self) -> Result<(), Error> {
        let (start, end) = self.lint_type(false)?;
        let owner = self.lint_loc_of_current_scope();
        if let Some(l) = self.lint_seam() {
            l.annotations.push((owner, start, end));
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_loc_of_current_scope(&mut self) -> i32 {
        let current = self.current_scope;
        for entry in self.scopes_in_order.iter().rev() {
            if let Some(order) = entry {
                if order.scope == current.as_ptr() {
                    return order.loc.start;
                }
            }
        }
        -1
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_arrow_return_type(&mut self, loc: bun_ast::Loc) -> Result<(), Error> {
        let (start, end) = self.lint_type(true)?;
        if let Some(l) = self.lint_seam() {
            l.return_types.push((loc.start, start, end));
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_try_arrow_return_type(&mut self, loc: bun_ast::Loc) -> bool {
        let mark = self.lint_mark();
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let result: Result<(), Error> = (|| {
            self.lexer.expect(T::TColon)?;
            self.lint_arrow_return_type(loc)?;
            if self.lexer.token != T::TEqualsGreaterThan {
                return Err(crate::Error::Backtrack);
            }
            Ok(())
        })();
        if result.is_err() {
            self.lexer.restore(&old_lexer);
            self.lint_rewind(mark);
        }
        self.lexer.is_log_disabled = old_log_disabled;
        result.is_ok()
    }
}
''')

ANNOT_OLD = '''                type_colon_range = p.lexer.range();
                p.lexer.next()?;
                p.skip_type_script_type(Level::Lowest)?;
            }
'''
RET_OLD = '''                if opts.is_after_question_and_before_colon {
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
                }
'''
PAREN_OLD = '''            let mut value = Expr::join_all_with_comma(items);
            p.mark_expr_as_parenthesized(&mut value);
            return Ok(value);
'''
FAST_OLD = '''            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            p.lexer.expect(T::TCloseParen)?;
'''
OPEN_CALL_OLD = '''        p.parse_paren_expr(
            loc,
            level,
            ParenExprOpts {
                is_after_question_and_before_colon: flags == EFlags::AfterQuestionAndBeforeColon,
                ..Default::default()
            },
        )
    }
'''
TSX_CALL_OLD = '''                return p.parse_paren_expr(
                    loc,
                    level,
                    ParenExprOpts {
                        force_arrow_fn: true,
                        ..Default::default()
                    },
                );
'''
CAST_CALL_OLD = '''                    return p.parse_paren_expr(
                        loc,
                        level,
                        ParenExprOpts {
                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            ..Default::default()
                        },
                    );
'''
ASYNC_CALL_OLD = '''                    return p.parse_paren_expr(
                        async_range.loc,
                        level,
                        ParenExprOpts {
                            is_async: true,
                            is_after_question_and_before_colon: flags
                                == EFlags::AfterQuestionAndBeforeColon,
                            ..Default::default()
                        },
                    );
'''
ASYNC_LT_CALL_OLD = '''                                return p.parse_paren_expr(
                                    async_range.loc,
                                    level,
                                    ParenExprOpts {
                                        is_async: true,
                                        force_arrow_fn: result
                                            == SkipTypeParameterResult::DefinitelyTypeParameters,
                                        ..Default::default()
                                    },
                                );
'''

# ---- V1: tests inside parse_paren_expr ----
def v1_types(t, lint=LINT):
    t.rep(MOD, ANNOT_OLD, '''                type_colon_range = p.lexer.range();
                p.lexer.next()?;
                if %s {
                    p.lint_arrow_param_type(item)?;
                } else {
                    p.skip_type_script_type(Level::Lowest)?;
                }
            }
''' % lint)
    t.rep(MOD, RET_OLD, '''                if opts.is_after_question_and_before_colon {
                    // Only do this very expensive check if we must
                    is_arrow_fn = p
                        .is_type_script_arrow_return_type_after_question_and_before_colon(
                            &arrow_data,
                        )?;
                    if is_arrow_fn {
                        // We know this will succeed because we've already done it once above
                        p.lexer.next()?;
                        if %s {
                            p.lint_arrow_return_type(loc)?;
                        } else {
                            p.skip_typescript_return_type()?;
                        }
                    }
                } else if %s {
                    is_arrow_fn = p.lint_try_arrow_return_type(loc);
                } else {
                    // Otherwise, do the less expensive check
                    is_arrow_fn = p.try_skip_type_script_arrow_return_type_with_backtracking();
                }
''' % (lint, lint))

def paren_tests(t, ts_only, in_function=True, fast=True):
    guard = ('Self::IS_TYPESCRIPT_ENABLED && ' if ts_only else '') + LINT
    if in_function:
        t.rep(MOD, PAREN_OLD, '''            let mut value = Expr::join_all_with_comma(items);
            p.mark_expr_as_parenthesized(&mut value);
            if %s {
                p.lint_paren(loc, value);
            }
            return Ok(value);
''' % guard)
    if fast:
        t.rep(PFX, FAST_OLD, '''            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            if %s {
                p.lint_paren(loc, value);
            }
            p.lexer.expect(T::TCloseParen)?;
''' % guard)

# ---- V3: nothing inside the function, tests after the call returns ----
def after_tests(t, ts_only, others=True):
    guard = ('Self::IS_TYPESCRIPT_ENABLED && ' if ts_only else '') + LINT
    t.rep(PFX, OPEN_CALL_OLD, '''        let value = p.parse_paren_expr(
            loc,
            level,
            ParenExprOpts {
                is_after_question_and_before_colon: flags == EFlags::AfterQuestionAndBeforeColon,
                ..Default::default()
            },
        )?;
        if %s {
            p.lint_after_paren_expr(loc, value);
        }
        Ok(value)
    }
''' % guard)
    if not others: return
    tail = '''?;
%(i)sif %(g)s {
%(i)s    p.lint_after_paren_expr(%(loc)s, value);
%(i)s}
%(i)sreturn Ok(value);
'''
    for f, old, loc in ((PFX, TSX_CALL_OLD, 'loc'), (PFX, CAST_CALL_OLD, 'loc'), (MOD, ASYNC_CALL_OLD, 'async_range.loc'), (MOD, ASYNC_LT_CALL_OLD, 'async_range.loc')):
        indent = old[:len(old) - len(old.lstrip(' '))]
        new = old.replace('return p.parse_paren_expr(', 'let value = p.parse_paren_expr(', 1)
        assert new.endswith(');\n')
        g = LINT if (f == PFX or 'force_arrow_fn' in old) else guard
        new = new[:-2] + tail % {'i': indent, 'g': g, 'loc': loc}
        t.rep(f, old, new)

# ---- V2: a second instantiation for lint, the callers dispatch ----
def twin(t, ts_only, fixed, no_scan=False):
    guard = ('!SCAN_ONLY && ' if no_scan else '') + ('Self::IS_TYPESCRIPT_ENABLED && ' if ts_only else '') + LINT
    t.rep(MOD, '''    /// This assumes that the open parenthesis has already been parsed by the caller
    pub(crate) fn parse_paren_expr(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        let p = self;
''', '''    /// This assumes that the open parenthesis has already been parsed by the caller
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
    fn parse_paren_expr_impl<const LINT: bool>(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        let p = self;
''')
    t.rep(MOD, ANNOT_OLD, '''                type_colon_range = p.lexer.range();
                p.lexer.next()?;
                if LINT {
                    p.lint_arrow_param_type(item)?;
                } else {
                    p.skip_type_script_type(Level::Lowest)?;
                }
            }
''')
    attempt = 'is_type_script_arrow_return_type_after_question_and_before_colon'
    t.rep(MOD, RET_OLD, '''                if LINT {
                    is_arrow_fn = p.lint_decide_arrow_return_type(
                        loc,
                        &arrow_data,
                        opts.is_after_question_and_before_colon,
                    )?;
                } else if opts.is_after_question_and_before_colon {
                    // Only do this very expensive check if we must
                    is_arrow_fn = p
                        .%s(
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
                }
''' % (attempt + ('::<false>' if fixed else '')))
    t.rep(MOD, PAREN_OLD, '''            let mut value = Expr::join_all_with_comma(items);
            p.mark_expr_as_parenthesized(&mut value);
            if LINT {
                p.lint_paren(loc, value);
            }
            return Ok(value);
''')
    if fixed:
        t.rep(MOD, '        p.pop_and_flatten_scope(scope_index);\n', '        if LINT {\n            p.lint_pop_and_flatten_scope(scope_index);\n        } else {\n            p.pop_and_flatten_scope(scope_index);\n        }\n')
        t.rep(MOD, '                p.log_arrow_arg_errors(&mut arrow_arg_errors);\n', '                if LINT {\n                    p.lint_log_arrow_arg_errors(&mut arrow_arg_errors);\n                } else {\n                    p.log_arrow_arg_errors(&mut arrow_arg_errors);\n                }\n')
        t.rep(SKIP, '''    pub(crate) fn is_type_script_arrow_return_type_after_question_and_before_colon(
        &mut self,
        arrow_data: &FnOrArrowDataParse,
    ) -> Result<bool, Error> {''', '''    pub(crate) fn is_type_script_arrow_return_type_after_question_and_before_colon<
        const LINT: bool,
    >(
        &mut self,
        arrow_data: &FnOrArrowDataParse,
    ) -> Result<bool, Error> {''')
        t.rep(SKIP, '        let snapshot = self.parser_snapshot();\n        self.lexer.is_log_disabled = true;\n', '        let snapshot = if LINT {\n            self.lint_parser_snapshot()\n        } else {\n            self.parser_snapshot()\n        };\n        self.lexer.is_log_disabled = true;\n')
        t.append(SKIP, '''
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_parser_snapshot(&mut self) -> crate::p::ParserSnapshot<'a> {
        self.parser_snapshot()
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_pop_and_flatten_scope(&mut self, scope_index: usize) {
        self.pop_and_flatten_scope(scope_index)
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn lint_log_arrow_arg_errors(&mut self, errors: &mut crate::parser::DeferredArrowArgErrors) {
        self.log_arrow_arg_errors(errors)
    }
}
''')
    t.append(SKIP, '''
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_decide_arrow_return_type(
        &mut self,
        loc: bun_ast::Loc,
        arrow_data: &FnOrArrowDataParse,
        after_question: bool,
    ) -> Result<bool, Error> {
        if after_question {
            let is_arrow_fn = self.%s(arrow_data)?;
            if is_arrow_fn {
                self.lexer.next()?;
                self.lint_arrow_return_type(loc)?;
            }
            return Ok(is_arrow_fn);
        }
        Ok(self.lint_try_arrow_return_type(loc))
    }
}
''' % (attempt + ('::<true>' if fixed else '')))
    # the callers
    t.rep(PFX, '''    fn pfx_t_open_paren(p: &mut Self, level: Level, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
''', '''    #[cold]
    #[inline(never)]
    fn pfx_t_open_paren_for_lint(
        p: &mut Self,
        loc: bun_ast::Loc,
        level: Level,
        flags: EFlags,
    ) -> PResult<Expr> {
        if level.gt(Level::Assign) {
            let old_allow_in = p.allow_in;
            p.allow_in = true;
            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            p.lint_paren(loc, value);
            p.lexer.expect(T::TCloseParen)?;
            p.allow_in = old_allow_in;
            return Ok(value);
        }
        p.parse_paren_expr_for_lint(
            loc,
            level,
            ParenExprOpts {
                is_after_question_and_before_colon: flags == EFlags::AfterQuestionAndBeforeColon,
                ..Default::default()
            },
        )
    }

    fn pfx_t_open_paren(p: &mut Self, level: Level, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        if %s {
            return Self::pfx_t_open_paren_for_lint(p, loc, level, flags);
        }
''' % guard)
    for f, old in ((PFX, TSX_CALL_OLD), (PFX, CAST_CALL_OLD), (MOD, ASYNC_CALL_OLD), (MOD, ASYNC_LT_CALL_OLD)):
        indent = old[:len(old) - len(old.lstrip(' '))]
        g = (('!SCAN_ONLY && ' if no_scan else '') + LINT) if (f == PFX or 'force_arrow_fn' in old) else guard
        lint_call = old.replace('p.parse_paren_expr(', 'p.parse_paren_expr_for_lint(', 1)
        lint_call = ''.join('    ' + l + '\n' for l in lint_call.splitlines())
        t.rep(f, old, indent + 'if ' + g + ' {\n' + lint_call + indent + '}\n' + old)

# ---- V2 as a source-level twin: the function of a parse without lint keeps its text, every helper that only it calls is copied ----
def cut(src, start, end):
    a = src.index(start); b = src.index(end, a + len(start))
    return src[a:b]

def source_twin(t, always_inline=False, cold_twin=True):
    guard = '!SCAN_ONLY && Self::IS_TYPESCRIPT_ENABLED && ' + LINT
    mod = open(t.dir + '/' + MOD).read()
    body = cut(mod, '    /// This assumes that the open parenthesis has already been parsed by the caller\n    pub(crate) fn parse_paren_expr(', '    pub(crate) fn parse_label_name(')
    tw = body.replace('    /// This assumes that the open parenthesis has already been parsed by the caller\n    pub(crate) fn parse_paren_expr(', ('    #[cold]\n' if cold_twin else '') + '    #[inline(never)]\n    pub(crate) fn parse_paren_expr_for_lint(')
    def r(old, new):
        nonlocal tw
        assert tw.count(old) == 1, old[:60]
        tw = tw.replace(old, new)
    r(ANNOT_OLD, ANNOT_OLD.replace('p.skip_type_script_type(Level::Lowest)?;', 'p.lint_arrow_param_type(item)?;'))
    r(RET_OLD, '                is_arrow_fn = p.lint_decide_arrow_return_type(\n                    loc,\n                    &arrow_data,\n                    opts.is_after_question_and_before_colon,\n                )?;\n')
    r(PAREN_OLD, PAREN_OLD.replace('            return Ok(value);', '            p.lint_paren(loc, value);\n            return Ok(value);'))
    if not always_inline:
        r('        p.pop_and_flatten_scope(scope_index);\n', '        p.lint_pop_and_flatten_scope(scope_index);\n')
        r('                p.log_arrow_arg_errors(&mut arrow_arg_errors);\n', '                p.lint_log_arrow_arg_errors(&mut arrow_arg_errors);\n')
    t.rep(MOD, '    pub(crate) fn parse_label_name(', tw + '    pub(crate) fn parse_label_name(')
    prs = open(t.dir + '/' + PRS).read()
    pop = cut(prs, '    pub(crate) fn pop_and_flatten_scope(&mut self, scope_index: usize) {', '    /// Everything the parse pass mutates')
    snap = cut(prs, '    pub(crate) fn parser_snapshot(&mut self) -> ParserSnapshot<\'a> {', '    /// Undo every parse-pass mutation')
    logerr = cut(prs, '    pub(crate) fn log_arrow_arg_errors(&mut self, errors: &mut DeferredArrowArgErrors) {', '    // Only reached while building diagnostics')
    skip = open(t.dir + '/' + SKIP).read()
    attempt = cut(skip, '    pub(crate) fn is_type_script_arrow_return_type_after_question_and_before_colon(', '    // ─────────────────────── try_* wrappers')
    if always_inline:
        for f, text in ((PRS, pop), (PRS, snap), (PRS, logerr), (SKIP, attempt)):
            assert text.startswith('    pub(crate) fn ')
            t.rep(f, text, '    #[inline(always)]\n' + text)
        lint_attempt = 'self.is_type_script_arrow_return_type_after_question_and_before_colon(arrow_data)?'
        copies_p = ''; copies_s = ''
    else:
        cold = '    #[cold]\n    #[inline(never)]\n' if cold_twin else ''
        copies_p = (cold + pop.replace('fn pop_and_flatten_scope(', 'fn lint_pop_and_flatten_scope(') + cold + snap.replace('fn parser_snapshot(', 'fn lint_parser_snapshot(') + cold + logerr.replace('fn log_arrow_arg_errors(', 'fn lint_log_arrow_arg_errors('))
        copies_s = cold + attempt.replace('fn is_type_script_arrow_return_type_after_question_and_before_colon(', 'fn lint_is_arrow_return_type_after_question(').replace('self.parser_snapshot()', 'self.lint_parser_snapshot()')
        lint_attempt = 'self.lint_is_arrow_return_type_after_question(arrow_data)?'
    if copies_p:
        t.append(PRS, "\nimpl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {\n" + copies_p + "}\n")
    t.append(SKIP, "\nimpl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {\n" + copies_s + """    #[cold]
    #[inline(never)]
    pub(crate) fn lint_decide_arrow_return_type(
        &mut self,
        loc: bun_ast::Loc,
        arrow_data: &FnOrArrowDataParse,
        after_question: bool,
    ) -> Result<bool, Error> {
        if after_question {
            let mark = self.lint_mark();
            let is_arrow_fn = %s;
            self.lint_rewind(mark);
            if is_arrow_fn {
                self.lexer.next()?;
                self.lint_arrow_return_type(loc)?;
            }
            return Ok(is_arrow_fn);
        }
        Ok(self.lint_try_arrow_return_type(loc))
    }
}
""" % lint_attempt)
    t.rep(PFX, """    fn pfx_t_open_paren(p: &mut Self, level: Level, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
""", """    #[cold]
    #[inline(never)]
    fn pfx_t_open_paren_for_lint(
        p: &mut Self,
        loc: bun_ast::Loc,
        level: Level,
        flags: EFlags,
    ) -> PResult<Expr> {
        if level.gt(Level::Assign) {
            let old_allow_in = p.allow_in;
            p.allow_in = true;
            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            p.lint_paren(loc, value);
            p.lexer.expect(T::TCloseParen)?;
            p.allow_in = old_allow_in;
            return Ok(value);
        }
        p.parse_paren_expr_for_lint(
            loc,
            level,
            ParenExprOpts {
                is_after_question_and_before_colon: flags == EFlags::AfterQuestionAndBeforeColon,
                ..Default::default()
            },
        )
    }

    fn pfx_t_open_paren(p: &mut Self, level: Level, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        if %s {
            return Self::pfx_t_open_paren_for_lint(p, loc, level, flags);
        }
""" % guard)
    name = 'parse_paren_expr_for_lint' if cold_twin else 'parse_paren_expr_for_lint_cold'
    if not cold_twin:
        t.rep(MOD, '    pub(crate) fn parse_label_name(', '''    #[cold]
    #[inline(never)]
    pub(crate) fn parse_paren_expr_for_lint_cold(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        self.parse_paren_expr_for_lint(loc, level, opts)
    }

    pub(crate) fn parse_label_name(''')
    for f, old in ((PFX, TSX_CALL_OLD), (PFX, CAST_CALL_OLD), (MOD, ASYNC_CALL_OLD), (MOD, ASYNC_LT_CALL_OLD)):
        indent = old[:len(old) - len(old.lstrip(' '))]
        lint_call = old.replace('p.parse_paren_expr(', 'p.' + name + '(', 1)
        lint_call = ''.join('    ' + l + '\n' for l in lint_call.splitlines())
        t.rep(f, old, indent + 'if ' + guard + ' {\n' + lint_call + indent + '}\n' + old)

# ---- V2 with ONE source text: a macro defines the function and its lint twin; lint_pick! selects tokens, it adds no block ----
def macro_twin(t):
    source_twin(t, cold_twin=False)
    mod = open(t.dir + '/' + MOD).read()
    normal = cut(mod, '    /// This assumes that the open parenthesis has already been parsed by the caller\n    pub(crate) fn parse_paren_expr(', '    #[inline(never)]\n    pub(crate) fn parse_paren_expr_for_lint(')
    twin_text = cut(mod, '    #[inline(never)]\n    pub(crate) fn parse_paren_expr_for_lint(', '    #[cold]\n    #[inline(never)]\n    pub(crate) fn parse_paren_expr_for_lint_cold(')
    body = normal
    def pick(plain, lint):
        nonlocal body
        assert body.count(plain) == 1, plain[:50]
        body = body.replace(plain, 'lint_pick!($is_lint, { ' + lint + ' }, { ' + plain + ' });' if not plain.endswith('\n') else 'lint_pick!($is_lint, {\n' + lint + '}, {\n' + plain + '});\n')
    pick('p.skip_type_script_type(Level::Lowest)?;', 'p.lint_arrow_param_type(item)?;')
    pick(RET_OLD, '                is_arrow_fn = p.lint_decide_arrow_return_type(\n                    loc,\n                    &arrow_data,\n                    opts.is_after_question_and_before_colon,\n                )?;\n')
    pick('p.pop_and_flatten_scope(scope_index);', 'p.lint_pop_and_flatten_scope(scope_index);')
    pick('p.log_arrow_arg_errors(&mut arrow_arg_errors);', 'p.lint_log_arrow_arg_errors(&mut arrow_arg_errors);')
    assert body.count('            p.mark_expr_as_parenthesized(&mut value);\n            return Ok(value);\n') == 1
    body = body.replace('            p.mark_expr_as_parenthesized(&mut value);\n            return Ok(value);\n', '            p.mark_expr_as_parenthesized(&mut value);\n            lint_pick!($is_lint, { p.lint_paren(loc, value); }, {});\n            return Ok(value);\n')
    head = '    /// This assumes that the open parenthesis has already been parsed by the caller\n    pub(crate) fn parse_paren_expr('
    assert body.startswith(head)
    body = '        $(#[$attr])*\n        pub(crate) fn $name(' + body[len(head):]
    macro = ('macro_rules! lint_pick {\n    (true, { $($lint:tt)* }, { $($plain:tt)* }) => { $($lint)* };\n    (false, { $($lint:tt)* }, { $($plain:tt)* }) => { $($plain)* };\n}\n\n'
             'macro_rules! define_parse_paren_expr {\n    ($(#[$attr:meta])* $name:ident, $is_lint:tt) => {\n' + body + '    };\n}\n\n')
    mod = mod.replace(normal, '    define_parse_paren_expr!(parse_paren_expr, false);\n\n').replace(twin_text, '    define_parse_paren_expr!(\n        #[inline(never)]\n        parse_paren_expr_for_lint,\n        true\n    );\n\n')
    anchor = "// File-split mixin: Round-C lowered"
    assert mod.count(anchor) == 1
    mod = mod.replace(anchor, macro + anchor)
    open(t.dir + '/' + MOD, 'w').write(mod)

# ---- the source twin with a hook for a run: BUN_LINT_SEAM_OUT=<file> turns the records on and appends them to the file ----
ENTRY = 'parse/parse_entry.rs'
TSD = 'parse/parse_typescript.rs'
def runnable_twin(t):
    source_twin(t, cold_twin=False)
    guard = '!SCAN_ONLY && Self::IS_TYPESCRIPT_ENABLED && ' + LINT
    mod = open(t.dir + '/' + MOD).read()
    tw = cut(mod, '    #[inline(never)]\n    pub(crate) fn parse_paren_expr_for_lint(', '    #[cold]\n    #[inline(never)]\n    pub(crate) fn parse_paren_expr_for_lint_cold(')
    new = tw
    old_close = '        // The parenthetical construct must end with a close parenthesis\n        p.lexer.expect(T::TCloseParen)?;\n'
    assert new.count(old_close) == 1
    new = new.replace(old_close, '        // The parenthetical construct must end with a close parenthesis\n        let lint_close = p.lexer.loc();\n        p.lexer.expect(T::TCloseParen)?;\n')
    assert new.count('p.lint_paren(loc, value);') == 1
    new = new.replace('p.lint_paren(loc, value);', 'p.lint_paren_at(loc, lint_close, value);')
    open(t.dir + '/' + MOD, 'w').write(mod.replace(tw, new))
    t.append(SKIP, """
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_paren_at(&mut self, open: bun_ast::Loc, close: bun_ast::Loc, value: bun_ast::Expr) {
        if let Some(l) = self.lint_seam() {
            l.parens.push((open.start, close.start, value));
        }
    }
}
""")
    t.rep(TSD, """        if p.lexer.token == T::TOpenParen {
            p.lexer.next()?;
            let expr = p.parse_expr(Level::Lowest)?;
            p.lexer.expect(T::TCloseParen)?;
            return Ok(expr);
        }
""", """        if p.lexer.token == T::TOpenParen {
            let open = p.lexer.loc();
            p.lexer.next()?;
            let expr = p.parse_expr(Level::Lowest)?;
            if %s {
                p.lint_paren(open, expr);
            }
            p.lexer.expect(T::TCloseParen)?;
            return Ok(expr);
        }
""" % guard)
    t.rep(ENTRY, """        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };

        if p.options.features.hot_module_reloading {""", """        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };
        if TS && std::env::var_os("BUN_LINT_SEAM_OUT").is_some() {
            p.starts_for_parse_only = Some(Box::new(crate::p::StartsForParseOnly {
                lint: Some(Default::default()),
                ..Default::default()
            }));
        }

        if p.options.features.hot_module_reloading {""")
    t.rep(ENTRY, """        parse_tracer.end();

        // Halt parsing right here if there were any errors""", """        parse_tracer.end();
        if TS {
            if let Some(side) = p.starts_for_parse_only.take() {
                if let (Some(lint), Some(path)) = (side.lint, std::env::var_os("BUN_LINT_SEAM_OUT")) {
                    use std::io::Write as _;
                    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                        let mut s = format!("F {} {}\\n", p.source.contents().len(), p.log().errors);
                        for r in &lint.parens {
                            s.push_str(&format!("P {} {} {} {}\\n", r.0, r.1, r.2.loc.start, r.2.data.tag() as u8));
                        }
                        for r in &lint.annotations {
                            s.push_str(&format!("A {} {} {}\\n", r.0, r.1, r.2));
                        }
                        for r in &lint.return_types {
                            s.push_str(&format!("R {} {} {}\\n", r.0, r.1, r.2));
                        }
                        let _ = f.write_all(s.as_bytes());
                    }
                }
            }
        }

        // Halt parsing right here if there were any errors""")

# ---- V5: the tests live in callees, the function only calls other names ----
def callee(t, with_args=True, never=True):
    nv = '    #[inline(never)]\n' if never else ''
    if with_args:
        t.rep(MOD, ANNOT_OLD, ANNOT_OLD.replace('p.skip_type_script_type(Level::Lowest)?;', 'p.skip_type_script_type_of_arrow_parameter(item)?;'))
        t.rep(MOD, RET_OLD, RET_OLD.replace('p.skip_typescript_return_type()?;', 'p.skip_typescript_return_type_of_arrow(loc)?;').replace('p.try_skip_type_script_arrow_return_type_with_backtracking();', 'p.try_skip_type_script_arrow_return_type_with_backtracking(loc);'))
        a_item, a_loc, p_item, p_loc, by = 'item: bun_ast::Expr', 'loc: bun_ast::Loc', 'self.lint_arrow_param_type(item)', 'loc', ''
    else:
        t.rep(MOD, ANNOT_OLD, ANNOT_OLD.replace('p.skip_type_script_type(Level::Lowest)?;', 'p.skip_type_script_type_of_arrow_parameter()?;'))
        t.rep(MOD, RET_OLD, RET_OLD.replace('p.skip_typescript_return_type()?;', 'p.skip_typescript_return_type_of_arrow()?;'))
        a_item, a_loc, p_item, p_loc, by = '', '', 'self.lint_arrow_param_type_by_scope()', 'bun_ast::Loc { start: self.lint_loc_of_current_scope() }', ''
    t.rep(SKIP, '''    pub(crate) fn try_skip_type_script_arrow_return_type_with_backtracking(&mut self) -> bool {
        self.lexer_backtracker_bool(Self::skip_type_script_arrow_return_type_with_backtracking)
    }
''', '''%s    pub(crate) fn try_skip_type_script_arrow_return_type_with_backtracking(&mut self%s) -> bool {
        if self.starts_for_parse_only.is_some() {
            let loc = %s;
            return self.lint_try_arrow_return_type(loc);
        }
        self.lexer_backtracker_bool(Self::skip_type_script_arrow_return_type_with_backtracking)
    }

%s    pub(crate) fn skip_type_script_type_of_arrow_parameter(&mut self%s) -> Result<(), Error> {
        if self.starts_for_parse_only.is_some() {
            return %s;
        }
        self.skip_type_script_type(Level::Lowest)
    }

%s    pub(crate) fn skip_typescript_return_type_of_arrow(&mut self%s) -> Result<(), Error> {
        if self.starts_for_parse_only.is_some() {
            let loc = %s;
            return self.lint_arrow_return_type(loc);
        }
        self.skip_typescript_return_type()
    }
''' % (nv, (', ' + a_loc) if a_loc else '', p_loc, nv, (', ' + a_item) if a_item else '', p_item, nv, (', ' + a_loc) if a_loc else '', p_loc))

# ---- V5 with one dispatch at the top of pfx_t_open_paren: the lint wrapper calls the function of a parse without lint ----
def top_dispatch_wrapper(t, js_too=False):
    guard = ('!SCAN_ONLY && ' if js_too else '!SCAN_ONLY && Self::IS_TYPESCRIPT_ENABLED && ') + LINT
    t.rep(PFX, """    fn pfx_t_open_paren(p: &mut Self, level: Level, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
""", """    #[cold]
    #[inline(never)]
    fn pfx_t_open_paren_for_lint(
        p: &mut Self,
        loc: bun_ast::Loc,
        level: Level,
        flags: EFlags,
    ) -> PResult<Expr> {
        if level.gt(Level::Assign) {
            let old_allow_in = p.allow_in;
            p.allow_in = true;
            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            p.lint_paren(loc, value);
            p.lexer.expect(T::TCloseParen)?;
            p.allow_in = old_allow_in;
            return Ok(value);
        }
        let value = p.parse_paren_expr(
            loc,
            level,
            ParenExprOpts {
                is_after_question_and_before_colon: flags == EFlags::AfterQuestionAndBeforeColon,
                ..Default::default()
            },
        )?;
        p.lint_after_paren_expr(loc, value);
        Ok(value)
    }

    fn pfx_t_open_paren(p: &mut Self, level: Level, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        if %s {
            return Self::pfx_t_open_paren_for_lint(p, loc, level, flags);
        }
""" % guard)

# ---- P3.4: where the lists are rewound ----
def rewind_in_backtrackers(t):
    for name in ('bool', 'result'):
        pass
    t.rep(SKIP, '''        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let mut backtrack = false;
''', '''        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let lint_mark = if self.starts_for_parse_only.is_some() {
            self.lint_mark()
        } else {
            [0; 3]
        };
        let mut backtrack = false;
''', count=2)
    t.rep(SKIP, '''        if backtrack {
            self.lexer.restore(&old_lexer);
        }
''', '''        if backtrack {
            self.lexer.restore(&old_lexer);
            if self.starts_for_parse_only.is_some() {
                self.lint_rewind(lint_mark);
            }
        }
''', count=2)

def rewind_by_position_on_failure(t):
    t.rep(SKIP, '''        if backtrack {
            self.lexer.restore(&old_lexer);
        }
''', '''        if backtrack {
            self.lexer.restore(&old_lexer);
            if self.starts_for_parse_only.is_some() {
                self.lint_rewind_to(old_lexer.start);
            }
        }
''', count=2)

def rewind_in_snapshot_mark(t):
    t.rep(PRS, '    import_records_len: usize,\n}', '    import_records_len: usize,\n    lint_mark: [u32; 3],\n}')
    t.rep(PRS, '            import_records_len: self.import_records.len(),\n        }\n    }', '            import_records_len: self.import_records.len(),\n            lint_mark: if self.starts_for_parse_only.is_some() {\n                self.lint_mark()\n            } else {\n                [0; 3]\n            },\n        }\n    }')
    t.rep(PRS, '        self.lexer.restore(&snapshot.lexer);\n        self.lexer.comments_to_preserve_before = snapshot.comments_to_preserve_before;\n', '        self.lexer.restore(&snapshot.lexer);\n        self.lexer.comments_to_preserve_before = snapshot.comments_to_preserve_before;\n        if self.starts_for_parse_only.is_some() {\n            self.lint_rewind(snapshot.lint_mark);\n        }\n')

def rewind_in_snapshot_position(t):
    t.rep(PRS, '        self.lexer.restore(&snapshot.lexer);\n        self.lexer.comments_to_preserve_before = snapshot.comments_to_preserve_before;\n', '        self.lexer.restore(&snapshot.lexer);\n        self.lexer.comments_to_preserve_before = snapshot.comments_to_preserve_before;\n        if self.starts_for_parse_only.is_some() {\n            self.lint_rewind_to(snapshot.lexer.start);\n        }\n')

# ---- P1 edits in and around the function ----
def p1_level(t):
    t.rep(MOD, '            || (Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon)\n        {\n            // Arrow functions are not allowed inside certain expressions',
          '            || (Self::IS_TYPESCRIPT_ENABLED\n                && p.lexer.token == T::TColon\n                && level.lte(Level::Assign))\n        {\n            // Arrow functions are not allowed inside certain expressions')

def p1_flag_at_callers(t):
    t.rep(PFX, CAST_CALL_OLD, CAST_CALL_OLD.replace('                            ..Default::default()', '                            is_after_question_and_before_colon: flags\n                                == EFlags::AfterQuestionAndBeforeColon,\n                            ..Default::default()'))
    t.rep(MOD, ASYNC_LT_CALL_OLD, ASYNC_LT_CALL_OLD.replace('                                        ..Default::default()', '                                        is_after_question_and_before_colon: flags\n                                            == EFlags::AfterQuestionAndBeforeColon,\n                                        ..Default::default()'))

def p1_body_flag_parameter(t, ts_guard, keep_shape=False):
    g = (lambda e: 'if Self::IS_TYPESCRIPT_ENABLED { %s } else { EFlags::None }' % e) if ts_guard else (lambda e: e)
    t.rep(FN, '        args: &\'a mut [G::Arg],\n        data: &mut FnOrArrowDataParse,\n    ) -> Result<E::Arrow, Error> {', '        args: &\'a mut [G::Arg],\n        data: &mut FnOrArrowDataParse,\n        flags: bun_ast::expr::EFlags,\n    ) -> Result<E::Arrow, Error> {')
    if keep_shape:
        t.rep(FN, '        let expr = match p.parse_expr(Level::Comma) {\n            Ok(e) => e,', '        let expr = match p.parse_expr_flagged(Level::Comma, flags) {\n            Ok(e) => e,')
        t.rep(MOD, '''    #[inline]
    pub(crate) fn parse_expr_with_flags(''', '''    #[inline]
    pub(crate) fn parse_expr_flagged(&mut self, level: Level, flags: EFlags) -> Result<Expr, Error> {
        let mut expr = Expr::EMPTY;
        self.parse_expr_common(level, None, flags, &mut expr)?;
        Ok(expr)
    }
    #[inline]
    pub(crate) fn parse_expr_with_flags(''')
    else:
        t.rep(FN, '        let expr = match p.parse_expr(Level::Comma) {\n            Ok(e) => e,', '        let mut expr = Expr::EMPTY;\n        let expr = match p.parse_expr_with_flags(Level::Comma, flags, &mut expr) {\n            Ok(()) => expr,')
    t.rep(PFX, 'p.parse_arrow_body(args, &mut fn_or_arrow_data);', 'p.parse_arrow_body(args, &mut fn_or_arrow_data, %s);' % g('flags'))
    t.rep(SKIP, 'self.parse_arrow_body(&mut [], &mut data)?;', 'self.parse_arrow_body(&mut [], &mut data, EFlags::AfterQuestionAndBeforeColon)?;')
    t.rep(SKIP, 'use bun_ast::op::Level;\n', 'use bun_ast::expr::EFlags;\nuse bun_ast::op::Level;\n')
    t.rep(MOD, 'let mut arrow = p.parse_arrow_body(args_slice, &mut arrow_data)?;', 'let body_flags = if Self::IS_TYPESCRIPT_ENABLED && opts.is_after_question_and_before_colon {\n                    EFlags::AfterQuestionAndBeforeColon\n                } else {\n                    EFlags::None\n                };\n                let mut arrow = p.parse_arrow_body(args_slice, &mut arrow_data, body_flags)?;')
    t.rep(MOD, 'let arrow_body = p.parse_arrow_body(args, &mut data)?;', 'let arrow_body = p.parse_arrow_body(args, &mut data, %s)?;' % g('flags'))
    t.rep(MOD, 'let mut arrow_body = match p.parse_arrow_body(args, &mut data) {', 'let mut arrow_body = match p.parse_arrow_body(args, &mut data, %s) {' % g('flags'))

def p1_body_flag_field(t):
    t.rep(PARSER, '    /// Allow TypeScript decorators in function arguments\n    pub(crate) allow_ts_decorators: bool,\n}', '    /// Allow TypeScript decorators in function arguments\n    pub(crate) allow_ts_decorators: bool,\n\n    pub(crate) is_after_question_and_before_colon: bool,\n}')
    t.rep(PARSER, '            is_this_disallowed: false,\n', '            is_this_disallowed: false,\n            is_after_question_and_before_colon: false,\n', count=1)
    t.rep(FN, '        let expr = match p.parse_expr(Level::Comma) {\n            Ok(e) => e,', '        let body_flags = if Self::IS_TYPESCRIPT_ENABLED && data.is_after_question_and_before_colon {\n            bun_ast::expr::EFlags::AfterQuestionAndBeforeColon\n        } else {\n            bun_ast::expr::EFlags::None\n        };\n        let mut expr = Expr::EMPTY;\n        let expr = match p.parse_expr_with_flags(Level::Comma, body_flags, &mut expr) {\n            Ok(()) => expr,')
    t.rep(MOD, '''            let mut arrow_data = FnOrArrowDataParse {
                allow_await: if opts.is_async {
                    AwaitOrYield::AllowExpr
                } else {
                    AwaitOrYield::AllowIdent
                },
                ..Default::default()
            };
''', '''            let mut arrow_data = FnOrArrowDataParse {
                allow_await: if opts.is_async {
                    AwaitOrYield::AllowExpr
                } else {
                    AwaitOrYield::AllowIdent
                },
                is_after_question_and_before_colon: Self::IS_TYPESCRIPT_ENABLED
                    && opts.is_after_question_and_before_colon,
                ..Default::default()
            };
''')
    t.rep(PFX, '''            let mut fn_or_arrow_data = FnOrArrowDataParse {
                needs_async_loc: loc,
                ..Default::default()
            };
            let arrow_result = p.parse_arrow_body(args, &mut fn_or_arrow_data);''', '''            let mut fn_or_arrow_data = FnOrArrowDataParse {
                needs_async_loc: loc,
                is_after_question_and_before_colon: Self::IS_TYPESCRIPT_ENABLED
                    && flags == EFlags::AfterQuestionAndBeforeColon,
                ..Default::default()
            };
            let arrow_result = p.parse_arrow_body(args, &mut fn_or_arrow_data);''')

# The DecoratorMetadata sink calls find_symbol while it parses (type_sink.rs:239, parse_skip_typescript.rs:540): inside a lint
# attempt that is not pure. v2y stands in with the Discard sink, which touches nothing but the lexer, as the Build sink will.
def pure_type_stub(t):
    t.rep(SKIP, "        let mut out = Metadata::DEFAULT;\n        let opts = if return_type {", "        let opts = if return_type {")
    t.rep(SKIP, "        self.skip_type_script_type_with_opts::<DecoratorMetadata>(Level::Lowest, opts, &mut out)?;\n        Ok((start, self.lexer.start as i32))", "        self.skip_type_script_type_with_opts::<Discard>(Level::Lowest, opts, &mut ())?;\n        Ok((start, self.lexer.start as i32))")

VARIANTS = {
    'base': lambda t: None,
    'stub': lambda t: stub(t),
    # V1
    'v1': lambda t: (stub(t), v1_types(t), paren_tests(t, ts_only=False)),
    'v1t': lambda t: (stub(t), v1_types(t), paren_tests(t, ts_only=True)),
    'v1types': lambda t: (stub(t), v1_types(t)),
    'v1paren': lambda t: (stub(t), paren_tests(t, ts_only=False)),
    'v1parent': lambda t: (stub(t), paren_tests(t, ts_only=True)),
    'fastparen': lambda t: (stub(t), paren_tests(t, ts_only=False, in_function=False)),
    'fastparent': lambda t: (stub(t), paren_tests(t, ts_only=True, in_function=False)),
    # V2
    'v2': lambda t: (stub(t), twin(t, ts_only=False, fixed=False)),
    'v2g': lambda t: (stub(t), twin(t, ts_only=False, fixed=True)),
    'v2gt': lambda t: (stub(t), twin(t, ts_only=True, fixed=True)),
    'v2gts': lambda t: (stub(t), twin(t, ts_only=True, fixed=True, no_scan=True)),
    'v2m': lambda t: (stub(t), source_twin(t)),
    'v2m2': lambda t: (stub(t), source_twin(t, cold_twin=False)),
    'v2mm': lambda t: (stub(t), macro_twin(t)),
    'v2x': lambda t: (stub(t), runnable_twin(t)),
    'v2y': lambda t: (stub(t), runnable_twin(t), pure_type_stub(t)),
    'v2mi': lambda t: (stub(t), source_twin(t, always_inline=True)),
    # V3
    'v3': lambda t: (stub(t), after_tests(t, ts_only=False), paren_tests(t, ts_only=False, in_function=False)),
    'v3t': lambda t: (stub(t), after_tests(t, ts_only=True), paren_tests(t, ts_only=True, in_function=False)),
    'v3open': lambda t: (stub(t), after_tests(t, ts_only=False, others=False)),
    'v3opent': lambda t: (stub(t), after_tests(t, ts_only=True, others=False)),
    # V5
    'v5': lambda t: (stub(t), callee(t, with_args=True)),
    'v5n': lambda t: (stub(t), callee(t, with_args=False)),
    'v5inl': lambda t: (stub(t), callee(t, with_args=True, never=False)),
    'v5p': lambda t: (stub(t), callee(t, with_args=True), after_tests(t, ts_only=True, others=False), paren_tests(t, ts_only=True, in_function=False)),
    'v5t': lambda t: (stub(t), callee(t, with_args=True), top_dispatch_wrapper(t)),
    'topw': lambda t: (stub(t), top_dispatch_wrapper(t)),
    'topwjs': lambda t: (stub(t), top_dispatch_wrapper(t, js_too=True)),
    # P3.4
    'w1': lambda t: (stub(t), rewind_in_backtrackers(t), rewind_in_snapshot_mark(t)),
    'w1b': lambda t: (stub(t), rewind_in_backtrackers(t)),
    'w1f': lambda t: (stub(t), rewind_by_position_on_failure(t)),
    'w2': lambda t: (stub(t), rewind_in_snapshot_position(t)),
    'w1s': lambda t: (stub(t), rewind_in_snapshot_mark(t)),
    # P1
    'p1a': lambda t: p1_level(t),
    'p1b': lambda t: p1_flag_at_callers(t),
    'p1c': lambda t: p1_body_flag_parameter(t, ts_guard=True),
    'p1cu': lambda t: p1_body_flag_parameter(t, ts_guard=False),
    'p1d': lambda t: p1_body_flag_field(t),
    'p1abc': lambda t: (p1_level(t), p1_flag_at_callers(t), p1_body_flag_parameter(t, ts_guard=True)),
    'p1c2': lambda t: p1_body_flag_parameter(t, ts_guard=True, keep_shape=True),
    'p1abc2': lambda t: (p1_level(t), p1_flag_at_callers(t), p1_body_flag_parameter(t, ts_guard=True, keep_shape=True)),
}

if __name__ == '__main__':
    if '--list' in sys.argv: print(' '.join(VARIANTS)); sys.exit(0)
    for tag in sys.argv[1:]:
        t = Tree(tag); VARIANTS[tag](t); print('made', t.dir)
