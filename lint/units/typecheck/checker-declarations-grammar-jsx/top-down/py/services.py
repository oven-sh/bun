# The service functions that corpus diagnostics execute: callers outside the service layer, and service callees that stay stand-ins.
# usage: services.py <fns.json> <cover.diag.out>
import json, sys, collections, bisect
src = open('/workspace/notes/lint/units/typecheck/checker-declarations-grammar-jsx/bottom-up/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1])
PFX = 'github.com/microsoft/typescript-go/internal/'
byfile = collections.defaultdict(list)
for f in fns: byfile[f['file']].append(f)
for v in byfile.values(): v.sort(key=lambda f: f['start'])
starts = {k: [f['start'] for f in v] for k, v in byfile.items()}
cov = collections.Counter()
for ln in open(sys.argv[2]):
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
by = {}
for f in fns: by.setdefault(f['name'], f)
callers = collections.defaultdict(set)
for f in fns:
    for c in f['callees']:
        if c != f['name']: callers[c].add(f['name'])
sv = [f for f in fns if f['layer'] == 'Z-SERVICES' and cov[f['name']] > 0]
short = ns['short']
print('function\twhere\tcallers that corpus diagnostics execute (layer or module)\tservice callees that corpus diagnostics never execute')
for f in sorted(sv, key=lambda f: (f['file'], f['decl'])):
    cs = []
    for cn in sorted(callers[f['name']]):
        cf = by[cn]
        if cov[cn] == 0: continue
        cs.append(f"{short(cn)}[{cf['layer'] or cf['module']}]")
    dead = [short(c) for c in f['callees'] if c in by and by[c]['layer'] == 'Z-SERVICES' and cov[c] == 0]
    print(f"{short(f['name'])}\t{f['file'].split('/')[-1]}:{f['decl']}-{f['end']}\t{', '.join(cs)}\t{', '.join(sorted(set(dead)))}")
