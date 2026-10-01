# Classes of the service layer functions by what the reference's corpus executes.
# D = checker diagnostics, X = only with declaration diagnostics (declaration transform), E = only emit or the type and symbol baselines, N = never.
# usage: svc_classes.py <fns.json> <cover.diag.out> <cover.diagdecl.out> <cover.full.out>
import json, sys, collections, bisect
src = open('/workspace/notes/lint/units/typecheck/checker-declarations-grammar-jsx/bottom-up/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1])
PFX = 'github.com/microsoft/typescript-go/internal/'
byfile = collections.defaultdict(list)
for f in fns: byfile[f['file']].append(f)
for v in byfile.values(): v.sort(key=lambda f: f['start'])
starts = {k: [f['start'] for f in v] for k, v in byfile.items()}
def covered(path):
    cov = collections.Counter()
    for ln in open(path):
        if ln.startswith('mode:'): continue
        loc, n, c = ln.rsplit(' ', 2)
        if int(c) == 0: continue
        file, rng = loc.rsplit(':', 1)
        if file.startswith(PFX): file = file[len(PFX):]
        sl = int(rng.split(',')[0].split('.')[0])
        v = byfile.get(file)
        if not v: continue
        i = bisect.bisect_right(starts[file], sl) - 1
        if i >= 0 and sl <= v[i]['end']: cov[v[i]['name']] += int(n)
    return cov
d, x, e = covered(sys.argv[2]), covered(sys.argv[3]), covered(sys.argv[4])
zs = sorted([f for f in fns if f['layer'] == 'Z-SERVICES'], key=lambda f: (f['file'], f['decl']))
def mark(f):
    n = f['name']
    return 'D' if d[n] else 'X' if x[n] else 'E' if e[n] else 'N'
tot = collections.defaultdict(lambda: collections.Counter()); lines = collections.defaultdict(lambda: collections.Counter())
rows = []
for f in zs:
    m = mark(f); file = f['file'].split('/')[-1]
    tot[file][m] += 1; lines[file][m] += f['end'] - f['decl'] + 1
    rows.append(f"{m}\t{file}:{f['decl']}-{f['end']}\t{ns['short'](f['name'])}")
print('# per file: functions/lines by class')
for file in sorted(tot):
    print('# ' + file + ': ' + ' '.join(f"{m} {tot[file][m]}/{lines[file][m]}" for m in 'DXEN'))
print('class\twhere\tfunction')
for r in rows: print(r)
