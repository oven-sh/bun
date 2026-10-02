#!/usr/bin/env python3
"""Executed tests of the side-table option by site, per pass and per KB of source, from the runs of a counting build.
usage: sitetable.py <sites.tsv> <dir with <group>.err> [--min N]
<group>.err is the stderr of `BUN_LINT_TEST_COUNT=1 <counting bun-profile> transpiler-typescript.mjs --iterations=1 --group=<group>`.
The first `lint-tests` line of a run is the parse of the bench script itself (JavaScript): it is subtracted from the last."""
import sys
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
KB = {'bun-types': 1076.221, 'typescript-lib': 3784.758, 'src-js': 3268.179, 'tsx': 700.3, 'js-control': 1506.667}
sites = [l.rstrip('\n').split('\t') for l in open(sys.argv[1])]
MIN = int(sys.argv[sys.argv.index('--min') + 1]) if '--min' in sys.argv else 1
cols = {}; script = {}
for g in G:
    rows = [l.split()[1:] for l in open('%s/%s.err' % (sys.argv[2], g)) if l.startswith('lint-tests')]
    first = [int(x) for x in rows[0]]; last = [int(x) for x in rows[-1]]
    cols[g] = [b - a for a, b in zip(first, last)]; script[g] = sum(first)
print('%8s %8s %8s %8s %8s  site' % tuple(g[:8] for g in G))
order = sorted(range(len(sites)), key=lambda i: -sum(cols[g][i] for g in G))
for i in order:
    if sum(cols[g][i] for g in G) < MIN: continue
    print('%8d %8d %8d %8d %8d  %s [%s] %s' % (tuple(cols[g][i] for g in G) + (sites[i][1], sites[i][2], sites[i][3][:70])))
tot = {g: sum(cols[g]) for g in G}
print('%8d %8d %8d %8d %8d  executed tests per pass (tsx: 100 parses)' % tuple(tot[g] for g in G))
print('%8.2f %8.2f %8.2f %8.2f %8.2f  per KB of source' % tuple(tot[g] / KB[g] for g in G))
print('%8d %8d %8d %8d %8d  in the parse of the bench script (JavaScript, 5,471 bytes)' % tuple(script[g] for g in G))
print('%d of %d sites ran' % (sum(1 for i in range(len(sites)) if sum(cols[g][i] for g in G)), len(sites)))
