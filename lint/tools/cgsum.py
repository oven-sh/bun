#!/usr/bin/env python3
"""Sum a cachegrind output file by symbol. Prints program totals and the share of
symbols whose name matches a pattern (default: bun_js_parser).
usage: cgsum.py <cachegrind.out> [--match REGEX] [--top N] [--json]"""
import re, sys, json, collections, argparse
ap = argparse.ArgumentParser()
ap.add_argument('file'); ap.add_argument('--match', default=r'bun_js_parser'); ap.add_argument('--top', type=int, default=0); ap.add_argument('--json', action='store_true')
a = ap.parse_args()
events = []; fn = None; per = collections.defaultdict(lambda: [0, 0, 0, 0, 0]); tot = [0, 0, 0, 0, 0]
with open(a.file, errors='replace') as f:
    for line in f:
        if line.startswith('events:'): events = line.split()[1:]; continue
        if line.startswith('fn='): fn = line[3:].rstrip('\n'); continue
        if line.startswith(('fl=', 'fi=', 'fe=', 'cmd:', 'desc:', 'summary:', 'totals:')): continue
        parts = line.split()
        if not parts or not parts[0].isdigit(): continue
        vals = [int(x) for x in parts[1:1 + len(events)]]
        vals += [0] * (5 - len(vals))
        p = per[fn]
        for i in range(5): p[i] += vals[i]; tot[i] += vals[i]
rx = re.compile(a.match)
sel = {k: v for k, v in per.items() if k and rx.search(k)}
s = [sum(v[i] for v in sel.values()) for i in range(5)]
out = {'events': events, 'total': {'Ir': tot[0], 'Bc': tot[1], 'Bi': tot[3]}, 'match': a.match, 'matched_symbols': len(sel), 'matched': {'Ir': s[0], 'Bc': s[1], 'Bi': s[3]}}
if a.json: print(json.dumps(out)); sys.exit(0)
print(f"total    Ir {tot[0]:>15,}  Bc {tot[1]:>14,}  Bi {tot[3]:>12,}")
print(f"matched  Ir {s[0]:>15,}  Bc {s[1]:>14,}  Bi {s[3]:>12,}   ({len(sel)} symbols match /{a.match}/)")
for k, v in sorted(sel.items(), key=lambda kv: -kv[1][0])[:a.top]:
    print(f"  {v[0]:>14,} {v[1]:>13,}  {k[:140]}")
