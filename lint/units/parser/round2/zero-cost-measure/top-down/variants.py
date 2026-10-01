#!/usr/bin/env python3
"""Patched copies of src/js_parser (head be1ebe5295) for the zero-cost measurements. Nothing is written into the worktree.
usage: variants.py <variant> [...] | --list       copies go to $ROOT/<variant>/src/js_parser (default /tmp/zcm-td/seam/root)
Build one with paren-expr-seam/run.py (OUT=/tmp/zcm-td/seam/out RELAX=1), link it with paren-expr-seam/relink.py.
  v0       the unpatched tree (its rlib must equal the one of the release build)
  nolint   every test of the side table is a constant false: `LINT_SEAM && <test>`; is_lint_parse() and sidecar_mark() too.
           The five benchmark groups never hold a side table, so what they count is what a parse pays with the tests gone.
  nolintbt nolint, and the three lexer backtrackers as they were at the base (no read of the log, no truncate).
  f1       head with the test of a lint parse at "(" gone: the check of the stack bound in parse_expr_common is the seam.
           A lint parse holds a bound that no frame passes; the cold side of the check reads its real bound from the side table."""
import os, re, shutil, sys

SRC = '/workspace/wt/parser/src/js_parser'
ROOT = os.environ.get('ROOT', '/tmp/zcm-td/seam/root')
SEAM = 'crate::p::LINT_SEAM'

class Tree:
    def __init__(self, tag):
        self.dir = ROOT + '/' + tag + '/src/js_parser'
        if os.path.exists(ROOT + '/' + tag): shutil.rmtree(ROOT + '/' + tag)
        shutil.copytree(SRC, self.dir)
    def files(self):
        for d, _, fs in os.walk(self.dir):
            for f in fs:
                if f.endswith('.rs'): yield os.path.join(d, f)
    def read(self, f): return open(self.dir + '/' + f).read()
    def write(self, f, s): open(self.dir + '/' + f, 'w').write(s)
    def rep(self, f, old, new, count=1):
        s = self.read(f)
        assert s.count(old) == count, (f, s.count(old), old[:90])
        self.write(f, s.replace(old, new))
    def sub(self, rx, new, skip=()):
        n = 0
        for path in self.files():
            if any(path.endswith(x) for x in skip): continue
            s = open(path).read(); t, k = re.subn(rx, new, s)
            if k: open(path, 'w').write(t); n += k
        return n

def nolint(t):
    counts = {}
    t.rep('p.rs', 'pub(crate) fn is_lint_parse(&self) -> bool {\n        matches!(', 'pub(crate) fn is_lint_parse(&self) -> bool {\n        ' + SEAM + ' && matches!(')
    t.rep('p.rs', 'pub(crate) fn sidecar_mark(&self) -> Option<SidecarMark> {\n', 'pub(crate) fn sidecar_mark(&self) -> Option<SidecarMark> {\n        if !' + SEAM + ' {\n            return None;\n        }\n')
    s = t.read('p.rs'); i = s.index('\nimpl<'); t.write('p.rs', s[:i] + '\n/// Measurement only: false compiles every test of the side table out.\npub(crate) const LINT_SEAM: bool = false;\n' + s[i:])
    who = r'\b(?:p|self)\b'
    counts['is_some'] = t.sub(r'(' + who + r'\s*\.\s*starts_for_parse_only\s*\.\s*is_some\(\))', r'(' + SEAM + r' && \1)')
    counts['is_none'] = t.sub(r'(' + who + r'\s*\.\s*starts_for_parse_only\s*\.\s*is_none\(\))', r'(!' + SEAM + r' || \1)')
    counts['if let'] = t.sub(r'\bif let Some\(starts\) = &mut (' + who + r')\.starts_for_parse_only', r'if ' + SEAM + r' && let Some(starts) = &mut \1.starts_for_parse_only')
    counts['&& let'] = t.sub(r'&& let Some\(starts\) = &mut (' + who + r')\.starts_for_parse_only', r'&& ' + SEAM + r' && let Some(starts) = &mut \1.starts_for_parse_only')
    counts['tuple'] = t.sub(r'\bif let \(Some\(starts\), Some\(mark\)\) = ', r'if ' + SEAM + r' && let (Some(starts), Some(mark)) = ')
    return counts

BT_HEAD_BOOL = '''        let old_log_disabled = self.lexer.is_log_disabled;
        let log = self.log();
        let (old_msgs_len, old_errors, old_warnings) = (log.msgs.len(), log.errors, log.warnings);
        let recorded = self.sidecar_mark();
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
            // What the attempt logged without asking the lexer goes with it.
            let log = self.log();
            log.msgs.truncate(old_msgs_len);
            log.errors = old_errors;
            log.warnings = old_warnings;
            if let Some(mark) = recorded {
                self.rewind_sidecar(mark);
            }
        }
'''
BT_BASE_BOOL = '''        let old_log_disabled = self.lexer.is_log_disabled;
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
        }
'''
BT_HEAD_RESULT = '''        let old_log_disabled = self.lexer.is_log_disabled;
        let log = self.log();
        let (old_msgs_len, old_errors, old_warnings) = (log.msgs.len(), log.errors, log.warnings);
        let recorded = self.sidecar_mark();
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
            // `<out T>x`: the modifier that no type parameter of a function has is logged past the lexer
            let log = self.log();
            log.msgs.truncate(old_msgs_len);
            log.errors = old_errors;
            log.warnings = old_warnings;
            if let Some(mark) = recorded {
                self.rewind_sidecar(mark);
            }
        }
'''
BT_BASE_RESULT = '''        let old_log_disabled = self.lexer.is_log_disabled;
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
        }
'''
def bt(t):
    f = 'parse/parse_skip_typescript.rs'
    t.rep(f, BT_HEAD_BOOL, BT_BASE_BOOL)
    t.rep(f, BT_HEAD_RESULT, BT_BASE_RESULT)


PAST_BOUND = """
    /// The bound of the stack is passed, or a lint parse moved it to get here: its own bound is in the side table.
    #[cold]
    #[inline(never)]
    fn parse_expr_past_stack_bound(
        &mut self,
        level: Level,
        mut errors: Option<&mut DeferredErrors>,
        flags: EFlags,
        expr: &mut Expr,
    ) -> Result<(), Error> {
        if SCAN_ONLY || !self.is_lint_stack_safe() {
            return Err(crate::Error::StackOverflow);
        }
        let had_pure_comment_before =
            self.lexer.has_pure_comment_before && !self.options.ignore_dce_annotations;
        *expr = if self.lexer.token == T::TOpenParen {
            // "(" of a lint parse: what the parentheses hold is recorded
            let loc = self.lexer.loc();
            self.lexer.next()?;
            Self::pfx_t_open_paren_for_lint(self, loc, level, flags)?
        } else {
            self.parse_prefix(level, errors.as_deref_mut(), flags)?
        };
        if had_pure_comment_before && level.lt(Level::Call) {
            self.parse_suffix(expr, Level::Call.sub(1), errors.as_deref_mut(), flags)?;
            match &mut expr.data {
                js_ast::expr::Data::ECall(ex) => {
                    ex.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                }
                js_ast::expr::Data::ENew(ex) => {
                    ex.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                }
                _ => {}
            }
        }
        self.parse_suffix(expr, level, errors, flags)?;
        Ok(())
    }
"""

def f1(t):
    # 1. the test at "(" goes: pfx_t_open_paren is the one of the base again
    t.rep('parse/parse_prefix.rs', """        if !SCAN_ONLY && p.is_lint_parse() {
            return Self::pfx_t_open_paren_for_lint(p, loc, level, flags);
        }

""", '')
    t.rep('parse/parse_prefix.rs', '    fn pfx_t_open_paren_for_lint(', '    pub(crate) fn pfx_t_open_paren_for_lint(')
    # 2. the check of the stack bound of parse_expr_common is the seam: its cold side tells a lint parse
    old = """    ) -> Result<(), Error> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }

        let had_pure_comment_before ="""
    new = """    ) -> Result<(), Error> {
        if !self.stack_check.is_safe_to_recurse() {
            return self.parse_expr_past_stack_bound(level, errors, flags, expr);
        }

        let had_pure_comment_before ="""
    t.rep('parse/mod.rs', old, new)
    s = t.read('parse/mod.rs'); i = s.index('    pub(crate) fn parse_expr_common(')
    t.write('parse/mod.rs', s[:i] + PAST_BOUND.lstrip('\n') + s[i:])
    # 3. the side table holds the bound of a lint parse; the parser of a lint parse holds a bound that no frame passes
    t.rep('p.rs', "    pub(crate) is_lint: bool,\n}", "    pub(crate) is_lint: bool,\n    /// The bound of the stack of a lint parse, whose parser fails every check of its own bound.\n    pub(crate) stack_check: bun_core::StackCheck,\n}")
    t.rep('p.rs', "            is_lint: true,\n", "            is_lint: true,\n            stack_check: bun_core::StackCheck::init(),\n")
    t.rep('p.rs', "    pub(crate) fn is_lint_parse(&self) -> bool {", """    pub(crate) fn is_lint_parse(&self) -> bool {
        self.is_lint_parse_inner()
    }

    /// Whether a lint parse, which fails every check of the bound of the parser, has room on the stack.
    #[cold]
    #[inline(never)]
    pub(crate) fn is_lint_stack_safe(&self) -> bool {
        matches!(&self.starts_for_parse_only, Some(starts) if starts.is_lint && starts.stack_check.is_safe_to_recurse())
    }

    #[inline]
    fn is_lint_parse_inner(&self) -> bool {""")
    t.rep('parse/parse_entry.rs', "        p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());\n", "        p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());\n        // SAFETY: measurement only. `StackCheck` is one `usize`; the real change needs a constructor in bun_core.\n        p.stack_check = unsafe { core::mem::transmute::<usize, bun_core::StackCheck>(usize::MAX) };\n")
    # 4. every other check of the parse pass lets a lint parse through where its own bound holds
    n = 0
    for f in ('parse/parse_stmt.rs', 'parse/parse_typescript.rs', 'parse/parse_property.rs', 'parse/parse_skip_typescript.rs', 'parse/mod.rs', 'parse/parse_jsx.rs'):
        s = t.read(f)
        s2, k = re.subn(r'if !(p|self)\.stack_check\.is_safe_to_recurse\(\) \{\n(\s*)(// [^\n]*\n\s*// [^\n]*\n\s*)?return Err\((crate::)?Error::StackOverflow\);', lambda m: 'if !%s.stack_check.is_safe_to_recurse() && !%s.is_lint_stack_safe() {\n%s%sreturn Err(%sError::StackOverflow);' % (m.group(1), m.group(1), m.group(2), m.group(3) or '', m.group(4) or ''), s)
        s2, k2 = re.subn(r'&& self\.stack_check\.is_safe_to_recurse\(\)', '&& (self.stack_check.is_safe_to_recurse() || self.is_lint_stack_safe())', s2)
        t.write(f, s2); n += k + k2
    return {'stack checks': n}

def v0(t): return {}
def v_nolint(t): return nolint(t)
def v_nolintbt(t):
    c = nolint(t); bt(t); return c

V = {'v0': v0, 'nolint': v_nolint, 'nolintbt': v_nolintbt, 'f1': f1}
if __name__ == '__main__':
    if '--list' in sys.argv: print(' '.join(V)); sys.exit(0)
    for tag in sys.argv[1:]:
        t = Tree(tag); print(tag, V[tag](t))
