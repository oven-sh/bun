#!/usr/bin/env python3
"""A copy of src/js_parser in which every test of the side-table option that the reference lacks counts its executions
(sitecount.py of ../tools; the body of the predicate itself is left alone, so that a site counts once).
usage: sitecount2.py <out root> [--head DIR] [--ref DIR] [--pred REGEX] [--nolint]
  <out root>/src/js_parser is the copy; <out root>/sites.tsv lists `id  file:line  function  text`.
  --head   tree to copy (default /workspace/wt/parser)      --ref  reference text (default /tmp/costproof/root/ref, mkref.sh)
  --pred   regex of the test at a site. Default: the shapes of the round-1 tree and `(p|self).lint()`.
  --nolint the tests are a constant false instead (no counter): Bc(head) - Bc(nolint), --vex-guest-chase=no, is the
           number of executed tests, and nolint against the reference is what the parse pays that is no test.
Only lines that `diff` marks as new against the reference are touched: the three tests of main stay as they are.
The counting binary prints `lint-tests <count of id 0> <count of id 1> ...` on stderr each time a parser is dropped when
BUN_LINT_TEST_COUNT is set; the last line is the total of the process. Build it with r3cycle.sh <tag> <out root>; run
  BUN_LINT_TEST_COUNT=1 BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 <bun-profile> transpiler-typescript.mjs --iterations=1 --group=<g>
and read the table with sitetable.py. A counting build is for counts only: its own cost is not the cost of the tree."""
import os, re, shutil, subprocess, sys
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
OUT = sys.argv[1]; HEAD = arg('--head', '/workspace/wt/parser'); REF = arg('--ref', '/tmp/costproof/root/ref')
NOLINT = '--nolint' in sys.argv
WHO = r'\b(?:p|self)'
EXPR = arg('--pred', None) or (WHO + r'\.lint\(\)|' + WHO + r'\s*\.\s*starts_for_parse_only\s*\.\s*is_(?:some|none)\(\)|' + WHO + r'\.is_lint_parse\(\)|' + WHO + r'\.sidecar_mark\(\)')
LET = r'(\bif|&&) (let (?:Some\(\w+\)|\(Some\(\w+\), Some\(\w+\)\)) = (?:&mut |&)?(?:' + WHO + r'\.starts_for_parse_only\b|\())'
src = os.path.join(HEAD, 'src/js_parser'); dst = os.path.join(OUT, 'src/js_parser')
if os.path.exists(OUT): shutil.rmtree(OUT)
shutil.copytree(src, dst)
def new_lines(rel):
    a = os.path.join(REF, 'src/js_parser', rel)
    if not os.path.exists(a): return None
    out = subprocess.run(['diff', '--unchanged-line-format=', '--old-line-format=', '--new-line-format=%dn\n', a, os.path.join(src, rel)], capture_output=True, text=True).stdout
    return set(int(x) for x in out.split())
sites = []
def fn_of(lines, i):
    for k in range(i, -1, -1):
        m = re.match(r'^\s*(?:pub(?:\([a-z]+\))? )?(?:const )?(?:unsafe )?fn (\w+)', lines[k])
        if m: return m.group(1)
    return '-'
for d, _, fs in os.walk(dst):
    for f in sorted(fs):
        if not f.endswith('.rs') or f.endswith('_tests.rs') or f == 'native_test_shims.rs': continue
        path = os.path.join(d, f); rel = os.path.relpath(path, dst); nl = new_lines(rel)
        lines = open(path).read().split('\n'); intest = False
        for i, line in enumerate(lines):
            if line.strip() == '#[cfg(test)]' and i + 1 < len(lines) and re.match(r'^\s*mod \w+ \{', lines[i + 1]): intest = True
            if intest or (nl is not None and (i + 1) not in nl) or line.strip().startswith('//'): continue
            if re.search(r'\bfn (lint|is_lint_parse|sidecar_mark)\b', line): continue
            # the body of the predicate is no site: every site would count twice
            if fn_of(lines, i) in ('lint', 'is_lint_parse', 'sidecar_mark'): continue
            def site(text):
                sites.append((rel, i + 1, fn_of(lines, i), text.strip())); return len(sites) - 1
            def sub_let(m):
                k = site(line)
                return m.group(1) + (' false && ' if NOLINT else ' crate::p::seam_count::hit(%d) && ' % k) + m.group(2)
            def sub_expr(m):
                k = site(line); e = m.group(0)
                if NOLINT:
                    if e.endswith('is_none()'): return 'true'
                    if e.endswith('sidecar_mark()'): return 'None'
                    return 'false'
                return '{ crate::p::seam_count::hit(%d); %s }' % (k, e)
            new = re.sub(LET, sub_let, line)
            if new == line: new = re.sub(EXPR, sub_expr, line)
            lines[i] = new
        open(path, 'w').write('\n'.join(lines))
p = os.path.join(dst, 'p.rs'); s = open(p).read()
if not NOLINT:
    n = max(len(sites), 1)
    mod = '''
/// Measurement only: executions of each test of the side table, by site.
pub(crate) mod seam_count {
    use core::sync::atomic::{AtomicU64, Ordering};
    pub(crate) static COUNTS: [AtomicU64; %d] = [const { AtomicU64::new(0) }; %d];
    #[inline(always)]
    pub(crate) fn hit(id: usize) -> bool {
        COUNTS[id].fetch_add(1, Ordering::Relaxed);
        true
    }
    pub(crate) fn dump() {
        if std::env::var_os("BUN_LINT_TEST_COUNT").is_none() {
            return;
        }
        let mut line = String::from("lint-tests");
        for count in COUNTS.iter() {
            line.push(' ');
            line.push_str(&count.load(Ordering::Relaxed).to_string());
        }
        eprintln!("{line}");
    }
}
''' % (n, n)
    i = s.index('\nimpl<'); s = s[:i] + mod + s[i:]
    a = "> Drop for P<'a, TYPESCRIPT, SCAN_ONLY> {\n    fn drop(&mut self) {\n"
    assert a in s, 'Drop for P not found'
    s = s.replace(a, a + '        seam_count::dump();\n')
    open(p, 'w').write(s)
with open(os.path.join(OUT, 'sites.tsv'), 'w') as f:
    for k, (rel, ln, fn, text) in enumerate(sites): f.write('%d\t%s:%d\t%s\t%s\n' % (k, rel, ln, fn, text[:160]))
per = {}
for rel, *_ in sites: per[rel] = per.get(rel, 0) + 1
print(('nolint' if NOLINT else 'count'), len(sites), 'sites:', ' '.join('%s %d' % kv for kv in sorted(per.items())))
