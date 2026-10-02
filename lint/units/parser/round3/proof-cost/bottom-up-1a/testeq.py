#!/usr/bin/env python3
"""Are the added conditional branches of the head the executed tests of the side-table option, and nothing else?
usage: testeq.py <dir> <ref tag> <head tag> [--site REGEX] [--src ROOT] [--count DIR] [--passes N] [--all]
Reads <dir>/raw<tag>.<group>.cg (cgbench-raw.sh: one Bc per executed conditional jump). Per group and per function:
  dBc    Bc(head) - Bc(ref) of the function (names with the const arguments of P kept)
  tests  Bc of the head, in that function, on the source lines of src/js_parser whose text matches --site
         (default: a call of the predicate, `p.lint()` or `self.lint()`): cachegrind puts the compare and the jump of an
         #[inline(always)] predicate on the line of the call, so this is the count of executed tests, site by site
A function where dBc != tests is marked; with --all every function whose Ir or Bc differs is printed. --count: the totals
of a counting build (the <group>.err files that sitetable.py reads) times the passes are printed beside the sums.
Exit status 1 when dBc != tests in a group."""
import re, sys, os, collections
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
vals = {arg(k, None) for k in ('--site', '--src', '--count', '--passes')}
pos = [a for a in sys.argv[1:] if not a.startswith('--') and a not in vals]
D, REF, HEAD = pos[0], pos[1], pos[2]
SITE = re.compile(arg('--site', r'\b(?:p|self)\.lint\(\)')); SRC = arg('--src', '/workspace/wt/parser')
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
PASSES = int(arg('--passes', '20'))
cache = {}
def is_site(path, ln):
    if 'src/js_parser/' not in path: return False
    if path not in cache:
        q = path if os.path.isabs(path) else os.path.join(SRC, path)
        try: cache[path] = open(q, errors='replace').read().split('\n')
        except OSError: cache[path] = []
    L = cache[path]
    return 0 < ln <= len(L) and bool(SITE.search(L[ln - 1])) and not L[ln - 1].lstrip().startswith('//')
def load(path, sites):
    per = collections.defaultdict(lambda: [0, 0]); on = collections.defaultdict(int); persite = collections.defaultdict(int)
    fn = None; cur = None; fl = None
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fl='): fl = line[3:].rstrip('\n'); cur = fl
                elif line.startswith(('fi=', 'fe=')): cur = line[3:].rstrip('\n')
                elif line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)', '', line[3:].rstrip('\n')); cur = fl
                continue
            if not c.isdigit() or not fn or 'bun_js_parser' not in fn: continue
            p = line.split(); bc = int(p[2]) if len(p) > 2 else 0
            per[fn][0] += int(p[1]); per[fn][1] += bc
            if sites and bc and is_site(cur, int(p[0])):
                on[fn] += bc; persite[(cur.replace('src/js_parser/', ''), int(p[0]))] += bc
    return per, on, persite
count = None
if arg('--count', None):
    count = {}
    for g in G:
        rows = [l.split()[1:] for l in open('%s/%s.err' % (arg('--count', None), g)) if l.startswith('lint-tests')]
        count[g] = sum(int(x) for x in rows[-1]) - sum(int(x) for x in rows[0])
bad = 0; allsites = collections.defaultdict(lambda: [0] * 5); totals = []
KB = {'bun-types': 1076.221, 'typescript-lib': 3784.758, 'src-js': 3268.179, 'tsx': 700.3, 'js-control': 1506.667}
for gi, g in enumerate(G):
    a, _, _ = load('%s/raw%s.%s.cg' % (D, REF, g), False); b, on, persite = load('%s/raw%s.%s.cg' % (D, HEAD, g), True)
    for k, v in persite.items(): allsites[k][gi] = v
    dbc = sum(v[1] for v in b.values()) - sum(v[1] for v in a.values()); dir_ = sum(v[0] for v in b.values()) - sum(v[0] for v in a.values())
    tests = sum(on.values())
    extra = '' if count is None else '   counting build x passes %s' % format(count[g] * PASSES, ',')
    print('%-15s parser dBc %+11s   tests on the site lines %11s   dIr %+12s%s   %s' % (g, format(dbc, ','), format(tests, ','), format(dir_, ','), extra, 'EQUAL' if dbc == tests else 'DIFFER'))
    if dbc != tests: bad += 1
    totals.append((tests, dbc, dir_))
    for n in sorted(set(a) | set(b)):
        x = a.get(n, [0, 0]); y = b.get(n, [0, 0]); d = y[1] - x[1]; t = on.get(n, 0)
        if d != t or ('--all' in sys.argv and (y[0] - x[0]) != 0):
            mark = '' if d == t else '   <-- dBc != tests'
            print('      dBc %+10s  tests %10s  dIr %+11s  %s%s' % (format(d, ','), format(t, ','), format(y[0] - x[0], ','), re.sub(r'bun_js_parser::(p::)?', '', n)[:110], mark))
print('%-34s' % '' + ''.join(g.rjust(16) for g in G))
print('%-34s' % 'executed tests per pass' + ''.join(('%.1f' % (t[0] / PASSES)).rjust(16) for t in totals))
print('%-34s' % 'executed tests per KB of source' + ''.join(('%.2f' % (t[0] / PASSES / KB[g])).rjust(16) for t, g in zip(totals, G)))
print('%-34s' % 'added Bc per executed test' + ''.join(('%.3f' % (t[1] / t[0]) if t[0] else 'n/a').rjust(16) for t in totals))
print('%-34s' % 'added Ir per executed test' + ''.join(('%.2f' % (t[2] / t[0]) if t[0] else 'n/a').rjust(16) for t in totals))
print('executed tests by site line (Bc of the whole run):')
for k, v in sorted(allsites.items(), key=lambda kv: -sum(kv[1])): print('   ' + ''.join('%11s' % format(x, ',') for x in v) + '  %s:%d' % k)
print('PASS' if not bad else 'FAIL: %d groups' % bad)
sys.exit(1 if bad else 0)
