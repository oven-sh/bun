#!/usr/bin/env python3
"""Patched copies of src/js_parser for the proof of cost. Nothing is written into the worktree.
usage: [ROOT=/tmp/r3/seam/root] r3variants.py <variant> [...]      copies go to $ROOT/<variant>/src/js_parser
  v0      the unpatched tree: its rlib must equal the one of the release build (cmp of the .rcgu.o member)
  nolint  every test of the side table that main does not have is a constant false. The five benchmark groups never hold
          a side table, so Bc(head) - Bc(nolint) with --vex-guest-chase=no is the number of executed tests, and
          nolint against the base is what the parse pays that is no test.
  count   the same places count instead: BUN_LINT_TEST_COUNT=1 <bun-profile> transpiler-typescript.mjs --iterations=1
          --group=<g> prints `lint-tests <n>` on stderr at the end of every parse; the last line is the total.
Only lines that `diff` marks as new against the base tree (/tmp/proofcost/base-src, see mkbase.sh) are patched: the three
tests of main (class element, async arrow, arrow body) stay as they are.
Build a copy with paren-expr-seam/run.py (OUT=$S/out RELAX=1), link it with paren-expr-seam/relink.py <tag> <rlib> full."""
import os, re, shutil, subprocess, sys
SRC = '/workspace/bun/src/js_parser'
BASE = os.environ.get('BASE_SRC', '/tmp/proofcost/base-src') + '/src/js_parser'
ROOT = os.environ.get('ROOT', '/tmp/r3/seam/root')
SEAM = 'crate::p::lint_seam()'
WHO = r'\b(?:p|self)\b'
PATTERNS = [
    ('is_some', r'(' + WHO + r'\s*\.\s*starts_for_parse_only\s*\.\s*is_some\(\))', r'(' + SEAM + r' && \1)'),
    ('is_none', r'(' + WHO + r'\s*\.\s*starts_for_parse_only\s*\.\s*is_none\(\))', r'(!' + SEAM + r' || \1)'),
    ('&& let', r'&& let Some\((\w+)\) = &mut (' + WHO + r')\.starts_for_parse_only', r'&& ' + SEAM + r' && let Some(\1) = &mut \2.starts_for_parse_only'),
    ('if let', r'\bif let Some\((\w+)\) = &mut (' + WHO + r')\.starts_for_parse_only', r'if ' + SEAM + r' && let Some(\1) = &mut \2.starts_for_parse_only'),
    ('tuple', r'\bif let \(Some\(starts\), Some\(mark\)\) = ', r'if ' + SEAM + r' && let (Some(starts), Some(mark)) = '),
]
DEFS = {
    'nolint': '\n/// Measurement only: false compiles every added test of the side table out.\n#[inline(always)]\npub(crate) const fn lint_seam() -> bool {\n    false\n}\n',
    'count': '\n/// Measurement only: counts every added test of the side table.\npub(crate) static LINT_TESTS: core::sync::atomic::AtomicU64 = core::sync::atomic::AtomicU64::new(0);\n#[inline(always)]\npub(crate) fn lint_seam() -> bool {\n    LINT_TESTS.fetch_add(1, core::sync::atomic::Ordering::Relaxed);\n    true\n}\n',
}
def new_lines(rel):
    a = os.path.join(BASE, rel); b = os.path.join(SRC, rel)
    if not os.path.exists(a): return None
    out = subprocess.run(['diff', '--ignore-all-space', '--unchanged-line-format=', '--old-line-format=', '--new-line-format=%dn\n', a, b], capture_output=True, text=True).stdout
    return set(int(x) for x in out.split())
def patch(tag):
    assert os.path.isdir(BASE), 'run mkbase.sh first'
    d = ROOT + '/' + tag + '/src/js_parser'
    if os.path.exists(ROOT + '/' + tag): shutil.rmtree(ROOT + '/' + tag)
    shutil.copytree(SRC, d)
    if tag == 'v0': return {}
    counts = {}
    for dirpath, _, files in os.walk(d):
        for f in files:
            if not f.endswith('.rs'): continue
            path = os.path.join(dirpath, f); rel = os.path.relpath(path, d); s = open(path).read(); nl = new_lines(rel)
            for name, rx, to in PATTERNS:
                def sub(m):
                    ln = s.count('\n', 0, m.start()) + 1
                    if nl is not None and ln not in nl: counts[name + ' kept (main)'] = counts.get(name + ' kept (main)', 0) + 1; return m.group(0)
                    counts[name] = counts.get(name, 0) + 1
                    return m.expand(to)
                s = re.sub(rx, sub, s)
            open(path, 'w').write(s)
    p = d + '/p.rs'; s = open(p).read()
    a = 'pub(crate) fn is_lint_parse(&self) -> bool {\n        matches!('
    if a in s: s = s.replace(a, 'pub(crate) fn is_lint_parse(&self) -> bool {\n        ' + SEAM + ' && matches!('); counts['is_lint_parse'] = 1
    a = 'pub(crate) fn sidecar_mark(&self) -> Option<SidecarMark> {\n'
    if a in s: s = s.replace(a, a + '        if !' + SEAM + ' {\n            return None;\n        }\n'); counts['sidecar_mark'] = 1
    i = s.index('\nimpl<'); s = s[:i] + DEFS[tag] + s[i:]
    if tag == 'count':
        a = "> Drop for P<'a, TYPESCRIPT, SCAN_ONLY> {\n    fn drop(&mut self) {\n"
        assert a in s, 'Drop for P not found'
        s = s.replace(a, a + '        if std::env::var_os("BUN_LINT_TEST_COUNT").is_some() {\n            eprintln!("lint-tests {}", LINT_TESTS.load(core::sync::atomic::Ordering::Relaxed));\n        }\n')
    open(p, 'w').write(s)
    return counts
if __name__ == '__main__':
    for tag in sys.argv[1:]:
        assert tag in ('v0', 'nolint', 'count'), tag
        print(tag, patch(tag))
