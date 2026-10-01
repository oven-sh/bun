# Functions of the layers that a probe run entered. usage: cov.py <fns.json> <name>.func.txt... ; prints per run and the union
import json, re, sys, collections, os
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'layers.py')).read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1])
bykey = {}
for f in fns:
    if f['pkg'] == 'checker': bykey[(f['file'], f['decl'])] = f
pat = re.compile(r'internal/(checker/\w+\.go):(\d+):\s+(\S+)\s+([\d.]+)%')
union = collections.defaultdict(set)
mine_total = collections.Counter(f['layer'] for f in fns if f['layer'])
for path in sys.argv[2:]:
    per = collections.defaultdict(list)
    n_all = 0
    for ln in open(path):
        m = pat.search(ln)
        if not m or float(m.group(4)) == 0: continue
        n_all += 1
        f = bykey.get((m.group(1), int(m.group(2))))
        if f is None or not f['layer']: continue
        per[f['layer']].append(ns['short'](f['name']).replace('c.', ''))
        union[f['layer']].add(f['name'])
    name = os.path.basename(path).replace('.func.txt', '')
    tot = sum(len(v) for v in per.values())
    print(f"== {name}: entered {n_all} checker functions, {tot} in these layers")
    for L in ns['ORDER']:
        if L in per: print(f"  {L}[{len(per[L])}]: {' '.join(per[L])}")
print("== union over the runs")
for L in ns['ORDER']:
    print(f"  {L}: {len(union[L])} of {mine_total[L]}")
if os.environ.get('MISSING'):
    for L in ns['ORDER']:
        miss = [ns['short'](f['name']).replace('c.', '') for f in fns if f['layer'] == L and f['name'] not in union[L]]
        print(f"  not entered {L}[{len(miss)}]: {' '.join(miss)}")
