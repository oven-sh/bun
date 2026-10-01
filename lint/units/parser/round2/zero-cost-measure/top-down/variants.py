#!/usr/bin/env python3
"""Patched copies of src/js_parser (head be1ebe5295) for the zero-cost measurements. Nothing is written into the worktree.
usage: variants.py <variant> [...] | --list       copies go to $ROOT/<variant>/src/js_parser (default /tmp/zcm-td/seam/root)
Build one with paren-expr-seam/run.py (OUT=/tmp/zcm-td/seam/out RELAX=1), link it with paren-expr-seam/relink.py.
  v0       the unpatched tree (its rlib must equal the one of the release build)
  nolint   every test of the side table is a constant false: `LINT_SEAM && <test>`; is_lint_parse() and sidecar_mark() too.
           The five benchmark groups never hold a side table, so what they count is what a parse pays with the tests gone.
  nolintbt nolint, and the three lexer backtrackers as they were at the base (no read of the log, no truncate).
  f1       head with the test of a lint parse at "(" gone: the check of the stack bound in parse_expr_common is the seam.
           A lint parse holds a bound that no frame passes; the cold side of the check reads its real bound from the side table.
           MEASURED WORSE: js-control +1,838,620 raw Bc against head (parse_expr_common gains a test of the level and four
           instructions per expression). Do not take it as it is.
  f1b      f1 with an entry of its own for the one call of parse_expr_common at Level::Member (pfx_t_new).
  vold     head, and a type, an object type, the body of an interface and a list of type arguments are read by the grammar of
           the base first where the sink is Discard; where that returns Err, the lexer and the log go back and the grammar of
           the head reads. The trigger is incomplete: the grammar of the base logs most errors and returns Ok.
  vold2    vold with the trigger `read.is_err() | (log.errors != mark.errors)`: two jumps in the assembly. For reading only.
  vold3    vold with the trigger as a wrapping sum of the two conditions: one jump. The one to measure and to run the harness on.
  f3       head with the named-like cast recognised at the word of the cast (one jump per cast) instead of before every statement.
           Its rule never runs (wrong call site): it measures the bare deletion of the check. Use f3b.
  f3b      f3 with the statement handed down through a copy of parse_expr_common (parse_expr_of_statement)."""
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

BASE_PARSE = '/tmp/zcm-td/base-src/src/js_parser/parse/'

def vold(t):
    """The type grammar of the base (e3566be889) is the path of the Discard sink again; the grammar of the head reads a
    type only where the one of the base failed, from where that one started (ReadMark: lexer and log)."""
    # 1. the sink of the base, Discard only
    sink = open(BASE_PARSE + 'type_sink.rs').read()
    cut = sink.index('pub(crate) struct DecoratorMetadata;')
    cut = sink.rindex('\n}\n', 0, cut) + 3
    t.write('parse/old_sink.rs', sink[:cut])
    # 2. the grammar of the base, every function of it named old_*
    g = open(BASE_PARSE + 'parse_skip_typescript.rs').read()
    g = g.replace('use crate::parse::type_sink::{\n    DecoratorMetadata, Discard, Operand, TypeKeyword, TypeLiteral, TypeSink,\n};', 'use crate::parse::old_sink::{Discard, Operand, TypeKeyword, TypeLiteral, TypeSink};')
    assert 'old_sink' in g
    def drop_fn(text, name):
        i = text.index('pub(crate) fn ' + name + '(')
        a = text.rindex('\n\n', 0, i) + 1
        b = text.index('\n    }\n', i) + len('\n    }\n')
        return text[:a] + text[b:]
    for name in ('skip_typescript_return_type_with_metadata', 'skip_type_script_type_with_metadata'):
        g = drop_fn(g, name)
    names = sorted(set(re.findall(r'\bfn (\w+)', g)), key=len, reverse=True)
    for n in names:
        g = re.sub(r'(?<![\w.])(fn |self\s*\.|Self::|p\.|\|p\| p\.)' + n + r'\b', lambda m: m.group(1) + 'old_' + n, g)
    g = re.sub(r'\bSelf::(skip_|try_skip_|is_type_script_|lexer_backtracker_)', r'Self::old_\1', g)
    g = g.replace('#![warn(unused_must_use)]\n', '')
    g = g.replace('pub(crate) type SkipTypeOptionsBitset = typescript::SkipTypeOptionsBitset;', 'type SkipTypeOptionsBitset = typescript::SkipTypeOptionsBitset;')
    t.write('parse/old_skip.rs', g)
    t.rep('parse/mod.rs', 'pub(crate) mod parse_skip_typescript;', 'pub(crate) mod old_sink;\npub(crate) mod old_skip;\npub(crate) mod parse_skip_typescript;')
    f = 'parse/parse_skip_typescript.rs'
    # 3. a whole type
    t.rep(f, """        debug_assert_eq!(level, Level::Lowest);
        self.parse_type::<S>(opts, out)
    }
""", """        debug_assert_eq!(level, Level::Lowest);
        if !S::BUILDS && core::mem::size_of::<S::Out>() == 0 {
            let mark = self.read_mark();
            return match self.old_skip_type_script_type_with_opts::<crate::parse::old_sink::Discard>(level, opts, &mut ()) {
                Ok(()) => Ok(()),
                Err(err) => self.skip_type_after_old_failed(&mark, err, opts),
            };
        }
        self.parse_type::<S>(opts, out)
    }

    /// The grammar of the base read no type at `mark`: the one of the reference reads there, with the messages of its own.
    #[cold]
    #[inline(never)]
    fn skip_type_after_old_failed(&mut self, mark: &ReadMark<'a>, err: Error, opts: SkipTypeOptionsBitset) -> Result<(), Error> {
        if matches!(err, Error::StackOverflow | Error::Alloc(_)) {
            return Err(err);
        }
        self.rewind_to_read_mark(mark);
        self.parse_type::<Discard>(opts, &mut ())
    }

    #[cold]
    #[inline(never)]
    fn skip_object_type_after_old_failed(&mut self, mark: &ReadMark<'a>, err: Error) -> Result<(), Error> {
        if matches!(err, Error::StackOverflow | Error::Alloc(_)) {
            return Err(err);
        }
        self.rewind_to_read_mark(mark);
        self.new_skip_type_script_object_type()
    }

    #[cold]
    #[inline(never)]
    fn skip_type_arguments_after_old_failed<const IS_INSIDE_JSX_ELEMENT: bool, const IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION: bool>(&mut self, mark: &ReadMark<'a>, err: Error) -> Result<bool, Error> {
        if matches!(err, Error::StackOverflow | Error::Alloc(_)) {
            return Err(err);
        }
        self.rewind_to_read_mark(mark);
        let (has_type_arguments, ()) = self.skip_type_script_type_arguments_in::<Discard, IS_INSIDE_JSX_ELEMENT, IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION>()?;
        Ok(has_type_arguments)
    }
""")
    # 4. an object type
    t.rep(f, """    pub(crate) fn skip_type_script_object_type(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();
""", """    pub(crate) fn skip_type_script_object_type(&mut self) -> Result<(), Error> {
        let mark = self.read_mark();
        match self.old_skip_type_script_object_type() {
            Ok(()) => Ok(()),
            Err(err) => self.skip_object_type_after_old_failed(&mark, err),
        }
    }

    fn new_skip_type_script_object_type(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();
""")
    # 5. type arguments
    t.rep(f, """    ) -> Result<bool, Error> {
        let (has_type_arguments, ()) = self.skip_type_script_type_arguments_in::<
            Discard,
            IS_INSIDE_JSX_ELEMENT,
            IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION,
        >()?;
        Ok(has_type_arguments)
    }
""", """    ) -> Result<bool, Error> {
        let mark = self.read_mark();
        match self.old_skip_type_script_type_arguments::<IS_INSIDE_JSX_ELEMENT, IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION>() {
            Ok(has_type_arguments) => Ok(has_type_arguments),
            Err(err) => self.skip_type_arguments_after_old_failed::<IS_INSIDE_JSX_ELEMENT, IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION>(&mark, err),
        }
    }
""")
    # 6. the body of an interface
    t.rep(f, """    fn parse_object_type_members(&mut self) -> Result<(), Error> {
        self.lexer.expect(T::TOpenBrace)?;
        self.parse_type_member_list()
    }
""", """    fn parse_object_type_members(&mut self) -> Result<(), Error> {
        let mark = self.read_mark();
        match self.old_skip_type_script_object_type() {
            Ok(()) => Ok(()),
            Err(err) => self.object_type_members_after_old_failed(&mark, err),
        }
    }

    #[cold]
    #[inline(never)]
    fn object_type_members_after_old_failed(&mut self, mark: &ReadMark<'a>, err: Error) -> Result<(), Error> {
        if matches!(err, Error::StackOverflow | Error::Alloc(_)) {
            return Err(err);
        }
        self.rewind_to_read_mark(mark);
        self.lexer.expect(T::TOpenBrace)?;
        self.parse_type_member_list()
    }
""")
    return {'old fns': len(names)}

MEMBER = """
    /// `parse_expr_common` at `Level::Member`, the one level that a "__PURE__" comment does not reach.
    pub(crate) fn parse_expr_at_member_level(&mut self, flags: EFlags, expr: &mut Expr) -> Result<(), Error> {
        if !self.stack_check.is_safe_to_recurse() {
            return self.parse_expr_past_stack_bound(Level::Member, None, flags, expr);
        }
        *expr = self.parse_prefix(Level::Member, None, flags)?;
        self.parse_suffix(expr, Level::Member, None, flags)?;
        Ok(())
    }
"""

def f1b(t):
    """f1, and the one call of parse_expr_common above Level::Call (the target of `new`) has its own entry, so that the
    test of the level in parse_expr_common is dead for every caller that is left, as ThinLTO proves it at the head."""
    c = f1(t)
    t.rep('parse/parse_prefix.rs', "        p.parse_expr_with_flags(Level::Member, flags, &mut target)?;\n", "        p.parse_expr_at_member_level(flags, &mut target)?;\n")
    s = t.read('parse/mod.rs'); i = s.index('    pub(crate) fn parse_expr_common(')
    t.write('parse/mod.rs', s[:i] + MEMBER.lstrip('\n') + s[i:])
    return c

def vold2(t):
    """vold with the whole trigger: the grammar of the base logs most errors and reads on (Lexer::expect returns Ok), so a reading
    failed when it returned Err OR the count of errors of the log moved. One jump decides: `is_err() | (errors != mark.errors)`."""
    c = vold(t)
    f = 'parse/parse_skip_typescript.rs'
    t.rep(f, """            return match self.old_skip_type_script_type_with_opts::<crate::parse::old_sink::Discard>(level, opts, &mut ()) {
                Ok(()) => Ok(()),
                Err(err) => self.skip_type_after_old_failed(&mark, err, opts),
            };""", """            let read = self.old_skip_type_script_type_with_opts::<crate::parse::old_sink::Discard>(level, opts, &mut ());
            if read.is_err() | (self.log().errors != mark.errors) {
                return self.skip_type_after_old_failed(&mark, read, opts);
            }
            return Ok(());""")
    t.rep(f, """    fn skip_type_after_old_failed(&mut self, mark: &ReadMark<'a>, err: Error, opts: SkipTypeOptionsBitset) -> Result<(), Error> {
        if matches!(err, Error::StackOverflow | Error::Alloc(_)) {
            return Err(err);
        }""", """    fn skip_type_after_old_failed(&mut self, mark: &ReadMark<'a>, read: Result<(), Error>, opts: SkipTypeOptionsBitset) -> Result<(), Error> {
        if let Err(err @ (Error::StackOverflow | Error::Alloc(_))) = read {
            return Err(err);
        }""")
    t.rep(f, """        match self.old_skip_type_script_object_type() {
            Ok(()) => Ok(()),
            Err(err) => self.skip_object_type_after_old_failed(&mark, err),
        }
    }

    fn new_skip_type_script_object_type""", """        let read = self.old_skip_type_script_object_type();
        if read.is_err() | (self.log().errors != mark.errors) {
            return self.skip_object_type_after_old_failed(&mark, read);
        }
        Ok(())
    }

    fn new_skip_type_script_object_type""")
    t.rep(f, """    fn skip_object_type_after_old_failed(&mut self, mark: &ReadMark<'a>, err: Error) -> Result<(), Error> {
        if matches!(err, Error::StackOverflow | Error::Alloc(_)) {
            return Err(err);
        }""", """    fn skip_object_type_after_old_failed(&mut self, mark: &ReadMark<'a>, read: Result<(), Error>) -> Result<(), Error> {
        if let Err(err @ (Error::StackOverflow | Error::Alloc(_))) = read {
            return Err(err);
        }""")
    t.rep(f, """        match self.old_skip_type_script_object_type() {
            Ok(()) => Ok(()),
            Err(err) => self.object_type_members_after_old_failed(&mark, err),
        }""", """        let read = self.old_skip_type_script_object_type();
        if read.is_err() | (self.log().errors != mark.errors) {
            return self.object_type_members_after_old_failed(&mark, read);
        }
        Ok(())""")
    t.rep(f, """    fn object_type_members_after_old_failed(&mut self, mark: &ReadMark<'a>, err: Error) -> Result<(), Error> {
        if matches!(err, Error::StackOverflow | Error::Alloc(_)) {
            return Err(err);
        }""", """    fn object_type_members_after_old_failed(&mut self, mark: &ReadMark<'a>, read: Result<(), Error>) -> Result<(), Error> {
        if let Err(err @ (Error::StackOverflow | Error::Alloc(_))) = read {
            return Err(err);
        }""")
    t.rep(f, """        match self.old_skip_type_script_type_arguments::<IS_INSIDE_JSX_ELEMENT, IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION>() {
            Ok(has_type_arguments) => Ok(has_type_arguments),
            Err(err) => self.skip_type_arguments_after_old_failed::<IS_INSIDE_JSX_ELEMENT, IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION>(&mark, err),
        }""", """        let read = self.old_skip_type_script_type_arguments::<IS_INSIDE_JSX_ELEMENT, IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION>();
        if read.is_err() | (self.log().errors != mark.errors) {
            return self.skip_type_arguments_after_old_failed::<IS_INSIDE_JSX_ELEMENT, IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION>(&mark, read);
        }
        read""")
    t.rep(f, """(&mut self, mark: &ReadMark<'a>, err: Error) -> Result<bool, Error> {
        if matches!(err, Error::StackOverflow | Error::Alloc(_)) {
            return Err(err);
        }""", """(&mut self, mark: &ReadMark<'a>, read: Result<bool, Error>) -> Result<bool, Error> {
        if let Err(err @ (Error::StackOverflow | Error::Alloc(_))) = read {
            return Err(err);
        }""")
    return c

def vold3(t):
    """vold2 with the two conditions of the trigger added, not or-ed: LLVM splits `a | b` of two tests into two jumps
    (seen in the assembly of vold2), and cannot split a wrapping sum. errors only grows, so the sum is 0 only when both are."""
    c = vold2(t)
    f = 'parse/parse_skip_typescript.rs'
    n = 0
    s = t.read(f)
    for name in ('read',):
        old = "if read.is_err() | (self.log().errors != mark.errors) {"
        new = "if self.log().errors.wrapping_sub(mark.errors).wrapping_add(read.is_err() as u32) != 0 {"
        n = s.count(old); s = s.replace(old, new)
    assert n == 4, n
    t.write(f, s)
    return c

def f3(t):
    """Named-like cast (`type as = 1`, `interface as {}`) decided where the word of the cast is met, not before every
    statement. parse_expr_or_let_stmt hands parse_suffix the options of the statement whose first token is the operand; the
    handler of `as` / `satisfies`, inside the block that already knows the word, asks a cold function whether the operand is the
    lone name `type`, `interface`, `namespace` or `module` with the word right after it and whether the declaration is read (the
    rules of the head's parse_stmt_named_like_cast, unchanged). If so it leaves the word unread, and the flow of the base reads
    the declaration. Cost: one jump per cast. Nothing runs before or after the expression of a statement."""
    S, PS, M = 'parse/parse_stmt.rs', 'parse/parse_suffix.rs', 'parse/mod.rs'
    # 1. nothing before the expression of a statement
    t.rep(S, """        if Self::IS_TYPESCRIPT_ENABLED
            && is_identifier
            && let Some(keyword) = js_lexer::TypescriptStmtKeyword::from_bytes(name)
            && let Some(stmt) = Self::parse_stmt_named_like_cast(p, opts, loc, keyword)?
        {
            return Ok(stmt);
        }
""", '')
    # 2. the speculative reading can start on the word
    t.rep(S, """            && !Self::is_declaration_named_like_cast(p, keyword, opts.is_typescript_declare)
        {
            return Ok(None);
        }
        p.lexer.next()?;""", """            && !Self::is_declaration_named_like_cast(p, keyword, opts.is_typescript_declare, false)
        {
            return Ok(None);
        }
        p.lexer.next()?;""")
    t.rep(S, """    fn is_declaration_named_like_cast(
        p: &mut Self,
        keyword: js_lexer::TypescriptStmtKeyword,
        is_ambient: bool,
    ) -> bool {
        let old_lexer = p.lexer.snapshot();""", """    pub(crate) fn is_declaration_named_like_cast(
        p: &mut Self,
        keyword: js_lexer::TypescriptStmtKeyword,
        is_ambient: bool,
        is_at_word: bool,
    ) -> bool {
        let old_lexer = p.lexer.snapshot();""")
    t.rep(S, """            Self::read_declaration_named_like_cast(p, keyword, is_ambient).unwrap_or(false);""", """            Self::read_declaration_named_like_cast(p, keyword, is_ambient, is_at_word)
                .unwrap_or(false);""")
    t.rep(S, """        keyword: js_lexer::TypescriptStmtKeyword,
        is_ambient: bool,
    ) -> Result<bool> {
        p.lexer.next()?;
        let at_name = p.lexer.snapshot();""", """        keyword: js_lexer::TypescriptStmtKeyword,
        is_ambient: bool,
        is_at_word: bool,
    ) -> Result<bool> {
        if !is_at_word {
            p.lexer.next()?;
        }
        let at_name = p.lexer.snapshot();""")
    # 3. parse_suffix knows the statement whose first token is its operand
    t.rep(PS, """    pub(crate) fn parse_suffix(
        &mut self,
        left: &mut Expr,
        level: Level,
        mut errors: Option<&mut DeferredErrors>,
        flags: EFlags,
    ) -> Result<(), Error> {
        let p = self;
""", """    #[inline(always)]
    pub(crate) fn parse_suffix(
        &mut self,
        left: &mut Expr,
        level: Level,
        errors: Option<&mut DeferredErrors>,
        flags: EFlags,
    ) -> Result<(), Error> {
        self.parse_suffix_of(left, level, errors, flags, None)
    }

    /// `parse_suffix` after the name that starts the statement of `opts`.
    #[inline(always)]
    pub(crate) fn parse_suffix_of_statement_name(
        &mut self,
        left: &mut Expr,
        opts: &crate::parser::ParseStatementOptions<'a>,
    ) -> Result<(), Error> {
        self.parse_suffix_of(left, Level::Lowest, None, EFlags::None, Some(opts))
    }

    fn parse_suffix_of(
        &mut self,
        left: &mut Expr,
        level: Level,
        mut errors: Option<&mut DeferredErrors>,
        flags: EFlags,
        statement: Option<&crate::parser::ParseStatementOptions<'a>>,
    ) -> Result<(), Error> {
        let p = self;
""")
    t.rep(PS, "                _ => Self::sfx_handle_typescript_as(p, level, left),", "                _ => Self::sfx_handle_typescript_as(p, level, left, statement),")
    t.rep(PS, """    fn sfx_handle_typescript_as(p: &mut Self, level: Level, left: &Expr) -> CResult {
        if Self::IS_TYPESCRIPT_ENABLED
            && level.lt(Level::Compare)
            && !p.lexer.has_newline_before
            && (p.lexer.is_contextual_keyword(b"as") || p.lexer.is_contextual_keyword(b"satisfies"))
        {
""", """    /// On the word of a cast after the name that starts a statement: whether the name is "type", "interface", "namespace" or "module" with the word right after it, and the declaration of that word is what is read.
    #[cold]
    #[inline(never)]
    fn is_declaration_at_word_of_cast(
        p: &mut Self,
        left: &Expr,
        opts: &crate::parser::ParseStatementOptions<'a>,
    ) -> bool {
        use crate::js_lexer::TypescriptStmtKeyword as Keyword;
        let ExprData::EIdentifier(ident) = left.data else {
            return false;
        };
        let name = p.load_name_from_ref(ident.ref_);
        let Some(keyword) = Keyword::from_bytes(name) else {
            return false;
        };
        match keyword {
            Keyword::TsStmtType | Keyword::TsStmtInterface => {}
            Keyword::TsStmtNamespace | Keyword::TsStmtModule => {
                if opts.scope == crate::parser::StatementScope::Nested {
                    return false;
                }
            }
            Keyword::TsStmtAbstract | Keyword::TsStmtGlobal | Keyword::TsStmtDeclare => return false,
        }
        // Blanks and comments on the line are all that may stand between the name and the word.
        let contents = p.lexer.contents;
        let mut i = (left.loc.start.max(0) as usize).saturating_add(name.len());
        let end = p.lexer.start;
        while i < end {
            match contents.get(i) {
                Some(b' ' | b'\\t') => i += 1,
                Some(b'/') if contents.get(i + 1) == Some(&b'*') => {
                    i += 2;
                    while i < end
                        && !(contents.get(i) == Some(&b'*') && contents.get(i + 1) == Some(&b'/'))
                    {
                        i += 1;
                    }
                    i += 2;
                }
                _ => return false,
            }
        }
        p.is_lint_parse()
            || Self::is_declaration_named_like_cast(p, keyword, opts.is_typescript_declare, true)
    }

    fn sfx_handle_typescript_as(
        p: &mut Self,
        level: Level,
        left: &Expr,
        statement: Option<&crate::parser::ParseStatementOptions<'a>>,
    ) -> CResult {
        if Self::IS_TYPESCRIPT_ENABLED
            && level.lt(Level::Compare)
            && !p.lexer.has_newline_before
            && (p.lexer.is_contextual_keyword(b"as") || p.lexer.is_contextual_keyword(b"satisfies"))
        {
            if let Some(opts) = statement
                && Self::is_declaration_at_word_of_cast(p, left, opts)
            {
                return Ok(Continuation::Done);
            }
""")
    # 4. the one call whose operand is the name that starts a statement
    t.rep(M, """        if let js_ast::StmtOrExpr::Expr(ref mut e) = result.stmt_or_expr {
            p.parse_suffix(e, Level::Lowest, None, EFlags::None)?;
        }
        Ok(result)
    }""", """        if let js_ast::StmtOrExpr::Expr(ref mut e) = result.stmt_or_expr {
            p.parse_suffix_of_statement_name(e, opts)?;
        }
        Ok(result)
    }""")
    return {}

STATEMENT_EXPR = """
    /// `parse_expr(Level::Lowest)` for the expression that starts the statement of `opts`: its suffixes know that statement.
    pub(crate) fn parse_expr_of_statement(
        &mut self,
        opts: &ParseStatementOptions<'a>,
    ) -> Result<Expr, Error> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }
        let had_pure_comment_before =
            self.lexer.has_pure_comment_before && !self.options.ignore_dce_annotations;
        let mut expr = self.parse_prefix(Level::Lowest, None, EFlags::None)?;
        if had_pure_comment_before {
            self.parse_suffix(&mut expr, Level::Call.sub(1), None, EFlags::None)?;
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
        self.parse_suffix_of(&mut expr, Level::Lowest, None, EFlags::None, Some(opts))?;
        Ok(expr)
    }
"""

def f3b(t):
    """f3, with the statement handed down on the path that a statement starting with a name really takes: the `else` of
    parse_expr_or_let_stmt calls parse_expr(Level::Lowest) (parse/mod.rs:1603), not the tail at :1621, so f3 never ran its rule."""
    c = f3(t)
    M, PS = 'parse/mod.rs', 'parse/parse_suffix.rs'
    s = t.read(M)
    old = "                stmt_or_expr: js_ast::StmtOrExpr::Expr(p.parse_expr(Level::Lowest)?),\n"
    assert s.count(old) == 2, s.count(old)
    i = s.index(old); j = s.index(old, i + 1)
    s = s[:j] + "                stmt_or_expr: js_ast::StmtOrExpr::Expr(p.parse_expr_of_statement(opts)?),\n" + s[j + len(old):]
    k = s.index('    pub(crate) fn parse_expr_common(')
    s = s[:k] + STATEMENT_EXPR.lstrip('\n') + s[k:]
    t.write(M, s)
    t.rep(PS, "    fn parse_suffix_of(\n", "    pub(crate) fn parse_suffix_of(\n")
    return c

def v0(t): return {}
def v_nolint(t): return nolint(t)
def v_nolintbt(t):
    c = nolint(t); bt(t); return c

V = {'v0': v0, 'nolint': v_nolint, 'nolintbt': v_nolintbt, 'f1': f1, 'f1b': f1b, 'vold': vold, 'vold2': vold2, 'vold3': vold3, 'f3': f3, 'f3b': f3b}
if __name__ == '__main__':
    if '--list' in sys.argv: print(' '.join(V)); sys.exit(0)
    for tag in sys.argv[1:]:
        t = Tree(tag); print(tag, V[tag](t))
