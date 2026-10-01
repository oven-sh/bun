#!/usr/bin/env python3
"""Counts of one harness run, alone and against the tsc oracle.
usage: gdstats.py <run.jsonl.gz> [<oracle.jsonl.gz>] [--list=N] [--api=t.ts.plain]
Per api: accepted, rejected, crashed. With the oracle, per api of kind transformSync:
AA bun accepts, tsc parses; AR bun accepts, tsc rejects; RA bun rejects, tsc parses; RR both reject.
--list prints the first N sources of class RA (and AR) of --api, grouped by production."""
import gzip, json, sys, collections
args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = {a.split('=')[0][2:]: (a.split('=') + ['1'])[1] for a in sys.argv[1:] if a.startswith('--')}
def load(path):
    with gzip.open(path, 'rt', encoding='utf8') as f:
        lines = [json.loads(l) for l in f if l.strip()]
    return lines[0], lines[1:]
header, recs = load(args[0])
apis = header['apis']
oracle = {}
if len(args) > 1:
    oh, orecs = load(args[1])
    oracle = {r['src']: r for r in orecs}
print(f"run: bun {header['version']} {header['revision'][:10]} corpus {header['corpus']} inputs {header['count']} apis {len(apis)} records {header['count'] * len(apis)}")
crash = sum(1 for r in recs if 'crash' in r)
print(f"sources {len(recs)} distinct {len(set(r['src'] for r in recs))} crashes {crash}")
per = collections.OrderedDict((a, collections.Counter()) for a in apis)
cls = collections.OrderedDict((a, collections.Counter()) for a in apis)
lists = collections.defaultdict(list)
for r in recs:
    if 'crash' in r:
        for a in apis: per[a]['crash'] += 1
        continue
    o = oracle.get(r['src'])
    for i, a in enumerate(apis):
        v = r['vals'][r['res'][i]]
        acc = v[0] != 'e'
        per[a]['accept' if acc else 'reject'] += 1
        if o is not None:
            tsc_ok = len(o['tsx' if '.tsx.' in a else 'ts']) == 0
            c = ('A' if acc else 'R') + ('A' if tsc_ok else 'R')
            cls[a][c] += 1
            if a == opt.get('api', 't.ts.plain') and c in ('RA', 'AR'):
                lists[c].append((r.get('prod'), r.get('ctx'), r['src'], v if not acc else None, o['ts'][:1] if not tsc_ok else None))
print(f"{'api':18}{'accept':>9}{'reject':>9}{'crash':>7}" + (f"{'AA':>9}{'AR':>9}{'RA':>9}{'RR':>9}" if oracle else ''))
for a in apis:
    p = per[a]; c = cls[a]
    print(f"{a:18}{p['accept']:>9}{p['reject']:>9}{p['crash']:>7}" + (f"{c['AA']:>9}{c['AR']:>9}{c['RA']:>9}{c['RR']:>9}" if oracle else ''))
n = int(opt.get('list', 0))
if n and oracle:
    for c, title in (('RA', 'bun rejects, tsc parses'), ('AR', 'bun accepts, tsc rejects')):
        rows = lists[c]
        by = collections.Counter((p, x) for p, x, *_ in rows)
        print(f"\n{c} ({title}) for {opt.get('api', 't.ts.plain')}: {len(rows)} sources; by production and context:")
        for (p, x), k in sorted(by.items(), key=lambda kv: -kv[1])[:40]:
            print(f"  {k:6}  {p}  {x if x else ''}")
        for p, x, src, v, t in rows[:n]:
            print(f"    [{p}] {json.dumps(src)[:150]}")
            if v: print(f"        bun: {json.dumps(v[1][:1])[:150]}")
            if t: print(f"        tsc: {json.dumps(t)[:150]}")
