#!/usr/bin/env python3
"""Patched copies of src/js_parser (head be1ebe5295) for the zero-cost measurements. Nothing is written into the worktree.
usage: variants.py <variant> [...] | --list       copies go to $ROOT/<variant>/src/js_parser (default /tmp/zcm-td/seam/root)
Build one with paren-expr-seam/run.py (OUT=/tmp/zcm-td/seam/out RELAX=1), link it with paren-expr-seam/relink.py.
  v0       the unpatched tree (its rlib must equal the one of the release build)
  nolint   every test of the side table is a constant false: `LINT_SEAM && <test>`; is_lint_parse() and sidecar_mark() too.
           The five benchmark groups never hold a side table, so what they count is what a parse pays with the tests gone.
  nolintbt nolint, and the three lexer backtrackers as they were at the base (no read of the log, no truncate)."""
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

def v0(t): return {}
def v_nolint(t): return nolint(t)
def v_nolintbt(t):
    c = nolint(t); bt(t); return c

V = {'v0': v0, 'nolint': v_nolint, 'nolintbt': v_nolintbt}
if __name__ == '__main__':
    if '--list' in sys.argv: print(' '.join(V)); sys.exit(0)
    for tag in sys.argv[1:]:
        t = Tree(tag); print(tag, V[tag](t))
