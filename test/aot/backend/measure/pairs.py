#!/usr/bin/env python3
"""pairs.py <rows.tsv> [<rows.tsv> ..]: for columns that lived side by side (measure.py: $CONTINUOUS, $TOGETHER): requests a second of one column against another of its group, fresh start by fresh
start: the middle of the differences, how many starts have its sign, the differences, and both columns' rates. $PAIRS (base:other,base:other ..) says which. A Markdown table."""
import os, statistics as st, sys
rows = {}
for p in sys.argv[1:]:
    for l in open(p):
        f = l.rstrip('\n').split('\t')
        if f[0] == 'ROW' and len(f) > 6: rows[(int(f[3]), f[1], f[2])] = dict(x.split('=', 1) for x in f[4:])
PAIRS = [x.split(':') for x in os.environ.get('PAIRS', 'aot:aot.previous,aot:released,aot:jit,aot.2:go,aot.2:rust').split(',')]
T = ['plaintext', 'json', 'db', 'queries5', 'queries20', 'fortunes', 'updates20', 'quote']
print('| cores | test | column | against | the middle | starts with its sign | start by start, % | its requests a second | the other\'s |\n|---:|---|---|---|---:|---:|---|---|---|')
for cores in sorted(set(k[0] for k in rows)):
    for a, b in PAIRS:
        for t in T:
            x, y = rows.get((cores, t, a)), rows.get((cores, t, b))
            if not x or not y or 'start_requests_a_second' not in x or 'start_requests_a_second' not in y or 'yes' in (x.get('void'), y.get('void')):
                continue
            d = [(float(p) / float(q) - 1) * 100 for p, q in zip(x['start_requests_a_second'].split(), y['start_requests_a_second'].split())]
            m = st.median(d)
            print('| %d | %s | %s | %s | %+.1f%% | %d of %d | %s | %s | %s |' % (cores, t, a, b, m, sum(1 for v in d if (v > 0) == (m > 0)), len(d), ' '.join('%+.1f' % v for v in d),
                  ' '.join('{:,.0f}'.format(float(v)) for v in x['start_requests_a_second'].split()), ' '.join('{:,.0f}'.format(float(v)) for v in y['start_requests_a_second'].split())))
