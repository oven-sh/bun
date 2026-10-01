#!/usr/bin/env python3
# usage: ts8-baselines.py > ts8-baselines.txt : the error baselines of typescript-go that hold a code of checkJSSyntax.
import os, re
PARSER = {8002,8003,8004,8005,8006,8008,8009,8010,8011,8012,8013,8016,8017,8037,8038}
root = '/workspace/ref/typescript-go/testdata/baselines/reference'
rows = []
for sub in ['submodule/compiler', 'submodule/conformance', 'compiler', 'conformance']:
    d = os.path.join(root, sub)
    for f in sorted(os.listdir(d)):
        if not f.endswith('.errors.txt'): continue
        t = open(os.path.join(d, f), encoding='utf-8', errors='replace').read()
        codes = sorted(set(int(c) for c in re.findall(r'error TS(8\d\d\d)', t)) & PARSER)
        if not codes: continue
        n = len(re.findall(r'^!!! error TS(?:%s):' % '|'.join(map(str, sorted(PARSER))), t, re.M))
        total = len(re.findall(r'^!!! error TS\d+:', t, re.M))
        rows.append((sub, f[:-len('.errors.txt')], codes, n, total))
print('# Error baselines of typescript-go (89d5d5b) that hold a code of checkJSSyntax (parser.go:6765-6850).')
print('# directory<TAB>test<TAB>codes<TAB>diagnostics with such a code<TAB>all diagnostics of the baseline')
for r in rows:
    print('%s\t%s\t%s\t%d\t%d' % (r[0], r[1], ','.join('TS%d' % c for c in r[2]), r[3], r[4]))
print('# baselines: %d; diagnostics with a checkJSSyntax code: %d' % (len(rows), sum(r[3] for r in rows)))
