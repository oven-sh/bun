# Packages other than checker that the layer functions of the K4 run name. usage: k4ext.py <fns.json> <min.func.txt>
import json, re, sys, collections
src = open('/workspace/notes/lint/units/typecheck/checker-declarations-grammar-jsx/bottom-up/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1])
pat = re.compile(r'internal/(checker/\w+\.go):(\d+):\s+(\S+)\s+([\d.]+)%')
entered = set()
for ln in open(sys.argv[2]):
    m = pat.search(ln)
    if m and float(m.group(4)) > 0: entered.add((m.group(1), int(m.group(2))))
mine = [f for f in fns if f['layer'] and (f['file'], f['decl']) in entered]
ext = collections.defaultdict(set)
for f in mine:
    for c in f['callees']:
        pkg = c.split('.')[0]
        if pkg != 'checker': ext[pkg].add(c[len(pkg) + 1:])
print(f"# packages other than checker that the {len(mine)} layer functions of the K4 run name (whole functions, so more than the run executes)")
for pkg in sorted(ext): print(f"{pkg} ({len(ext[pkg])}): {' '.join(sorted(ext[pkg]))}")
