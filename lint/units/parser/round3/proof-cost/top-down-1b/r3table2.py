#!/usr/bin/env python3
"""The five-group table of the proof of cost, by FUNCTION BODY (cgclass.py), with the executed tests of the side table.
usage: r3table2.py <dir> <tag a> <a bun-profile> <tag b> <b bun-profile> [--src TREE] [--site REGEX] [--no-raw] [--no-default]
Reads <dir>/<tag>.<group>.cg (cgbench.sh, default VEX) and <dir>/raw<tag>.<group>.cg (cgbench-raw.sh, --vex-guest-chase=no:
one Bc per executed conditional jump). A missing file prints n/a.
--src TREE: the source tree of binary b. The executed tests are the Bc of raw<tag b> on the lines of src/js_parser whose
text matches --site (default: a line that starts with `if p.lint()` or `if self.lint()`): the conditional jump of a test
carries the line of its `if`. Rows of the raw block then also give
  tests               that sum                     excess = (Bc b - a) - tests : 0 when every added jump is one test
  Ir per test         (Ir b - a) / tests: 2 when a test is one compare and one jump and nothing else changed
Passes: 20 (tsx: 2,000 parses). Input bytes: the fixed snapshot of /workspace/notes/lint/benchroot."""
import json, os, re, subprocess, sys
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
vals = {arg('--src', None), arg('--site', None)}
pos = [a for a in sys.argv[1:] if not a.startswith('--') and a not in vals]
D, TA, BA, TB, BB = pos[:5]
SRC = arg('--src', None); SITE = re.compile(arg('--site', r'^\s*if (?:p|self)\.lint\(\)'))
HERE = os.path.dirname(os.path.abspath(__file__))
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
BYTES = {'bun-types': 1076221, 'typescript-lib': 3784758, 'src-js': 3268179, 'tsx': 7003, 'js-control': 1506667}
PASSES = {'bun-types': 20, 'typescript-lib': 20, 'src-js': 20, 'tsx': 2000, 'js-control': 20}
def join(pre, g):
    a = f'{D}/{pre}{TA}.{g}.cg'; b = f'{D}/{pre}{TB}.{g}.cg'
    if not (os.path.exists(a) and os.path.exists(b)): return None
    out = subprocess.run([sys.executable, os.path.join(HERE, 'cgclass.py'), BA, a, BB, b, '--json'], capture_output=True, text=True)
    return json.loads(out.stdout) if out.returncode == 0 and out.stdout.strip() else None
def site_bc(g):
    path = f'{D}/raw{TB}.{g}.cg'
    if not SRC or not os.path.exists(path): return None
    cache = {}; tot = 0; fl = cur = None
    def text(p, ln):
        if p not in cache:
            try: cache[p] = open(p if os.path.isabs(p) else os.path.join(SRC, p), errors='replace').read().split('\n')
            except OSError: cache[p] = None
        L = cache[p]
        return L[ln - 1] if L and 0 < ln <= len(L) else ''
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fl='): fl = line[3:].rstrip('\n'); cur = fl
                elif line.startswith(('fi=', 'fe=')): cur = line[3:].rstrip('\n')
                elif line.startswith('fn='): cur = fl
                continue
            if not c.isdigit() or not cur or 'js_parser' not in cur: continue
            p = line.split()
            if len(p) > 2 and p[2] != '0' and SITE.search(text(cur, int(p[0]))): tot += int(p[2])
    return tot
def row(label, f): print(label.ljust(46) + ''.join(f(g).rjust(16) for g in G))
def num(x, signed=False): return 'n/a' if x is None else (f'{x:+,}' if signed else f'{x:,}')
print(f'{TB} against {TA}, by function body'.ljust(46) + ''.join(g.rjust(16) for g in G))
row('input bytes per pass', lambda g: f'{BYTES[g]:,}')
row('passes', lambda g: f'{PASSES[g]:,}')
modes = ([] if '--no-default' in sys.argv else [('', 'default VEX (cgbench.sh)')]) + ([] if '--no-raw' in sys.argv else [('raw', '--vex-guest-chase=no (cgbench-raw.sh)')])
for pre, name in modes:
    J = {g: join(pre, g) for g in G}
    def v(g, side, i): return None if J[g] is None else J[g]['by_class'][side][i]
    def d(g, i): return None if J[g] is None else J[g]['by_class']['b'][i] - J[g]['by_class']['a'][i]
    def pct(g, i): return 'n/a' if J[g] is None else f"{100 * d(g, i) / v(g, 'a', i):+.4f}%"
    print(f'-- {name}')
    row('parser Ir a', lambda g: num(v(g, 'a', 0)))
    row('parser Ir b - a', lambda g: num(d(g, 0), True))
    row('parser Ir b - a, percent', lambda g: pct(g, 0))
    row('parser Bc a', lambda g: num(v(g, 'a', 1)))
    row('parser Bc b - a', lambda g: num(d(g, 1), True))
    row('parser Bc b - a, percent', lambda g: pct(g, 1))
    row('parser Bi b - a', lambda g: num(d(g, 2), True))
    row('functions that differ', lambda g: num(None if J[g] is None else J[g]['classes_that_differ']))
    row('program Ir b - a (has run-to-run noise)', lambda g: num(None if J[g] is None else J[g]['program']['b'][0] - J[g]['program']['a'][0], True))
    if pre == 'raw' and SRC:
        T = {g: site_bc(g) for g in G}
        row('tests = Bc of b on the lines of the sites', lambda g: num(T[g]))
        row('excess = (Bc b - a) - tests', lambda g: num(None if T[g] is None or d(g, 1) is None else d(g, 1) - T[g], True))
        row('tests per pass (tsx: per 100 parses)', lambda g: 'n/a' if T[g] is None else f'{T[g] / 20:,.1f}')
        row('tests per KB of source', lambda g: 'n/a' if T[g] is None else f'{T[g] / PASSES[g] / (BYTES[g] / 1000):.2f}')
        row('Ir per test', lambda g: 'n/a' if not T[g] or d(g, 0) is None else f'{d(g, 0) / T[g]:.2f}')
