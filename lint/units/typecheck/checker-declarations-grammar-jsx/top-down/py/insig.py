# Functions of the layers that earlier layers call, with their upstream signature: the stand-ins that the earlier layers need until these layers land.
# usage: insig.py <fns.json>
import json, sys, collections, re
src = open('/workspace/notes/lint/units/typecheck/checker-declarations-grammar-jsx/bottom-up/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1]); ORDER = ns['ORDER']
ROOT = '/workspace/ref/typescript-go/internal/'
lines = {}
def sig(f):
    if f['file'] not in lines: lines[f['file']] = open(ROOT + f['file']).read().split('\n')
    s = lines[f['file']][f['decl']-1]
    i = f['decl']
    while not s.rstrip().endswith('{') and i < f['end']:
        s += ' ' + lines[f['file']][i].strip(); i += 1
    s = s.strip().rstrip('{').strip()
    m = re.match(r'func (\([^)]*\) )?(\w+)\((.*)\)\s*(.*)$', s)
    return (m.group(3), m.group(4)) if m else (s, '?')
by = {}
for f in fns: by.setdefault(f['name'], f)
callers = collections.defaultdict(set)
for f in fns:
    if f['layer']: continue
    for c in f['callees']:
        t = by.get(c)
        if t is not None and t['layer'] and t['layer'] != 'Z-SERVICES': callers[c].add(f['module'])
print('layer\tfunction\twhere\tparameters\tresult\tcaller modules')
for L in ORDER:
    for f in sorted([f for f in fns if f['layer'] == L and f['name'] in callers], key=lambda f: (f['file'], f['decl'])):
        p, r = sig(f)
        print(f"{L}\t{ns['short'](f['name'])}\t{f['file'].split('/')[-1]}:{f['decl']}\t{p}\t{r or '-'}\t{', '.join(sorted(callers[f['name']]))}")
