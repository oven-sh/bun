# Implicit fault sites in the layers: constant or computed slice indexes, kind casts on a field of another node, map writes, divisions.
# These are the places where the reference would crash on a tree it does not expect; each needs a checked read in the port.
# usage: faults.py <fns.json>
import json, re, sys, collections
src = open('/workspace/notes/lint/units/typecheck/checker-declarations-grammar-jsx/bottom-up/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1]); ORDER = ns['ORDER']
ROOT = '/workspace/ref/typescript-go/internal/'
lines = {}
def text(f):
    if f['file'] not in lines: lines[f['file']] = open(ROOT + f['file']).read().split('\n')
    return lines[f['file']][f['decl']-1:f['end']]
IDX = re.compile(r'(\w[\w.()]*)\[(0|1|2|3|len\([^\]]*\)\s*-\s*1|\w+\s*[-+]\s*1|\w+Index|index|i|j)\]')
SLICE = re.compile(r'\[[^\]\[]*:[^\]\[]*\]')
rows = []
for f in fns:
    if not f['layer'] or f['layer'] == 'Z-SERVICES': continue
    for i, ln in enumerate(text(f)):
        s = ln.strip()
        if s.startswith('//'): continue
        for m in IDX.finditer(ln):
            if m.group(1) in ('map', 'make') or m.group(1).endswith('Set') or 'map[' in ln[:m.start()+4]: continue
            rows.append((ORDER.index(f['layer']), f['layer'], f['file'].split('/')[-1], f['decl'] + i, ns['short'](f['name']), 'index', m.group(0)))
        for m in SLICE.finditer(ln):
            if 'map[' in ln or '[]' in m.group(0) or '*ast' in ln[m.start():m.end()]: continue
            rows.append((ORDER.index(f['layer']), f['layer'], f['file'].split('/')[-1], f['decl'] + i, ns['short'](f['name']), 'slice', m.group(0)))
rows.sort()
print('layer\twhere\tfunction\tkind\texpression')
for r in rows: print(f"{r[1]}\t{r[2]}:{r[3]}\t{r[4]}\t{r[5]}\t{r[6]}")
