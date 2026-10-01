# The K4 run (const x: number = "s";) inside the layers: functions entered in upstream order, and the callees they name that the run does not enter.
# usage: k4.py <fns.json> <min.func.txt>
import json, re, sys, collections
src = open('/workspace/notes/lint/units/typecheck/checker-declarations-grammar-jsx/bottom-up/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1]); ORDER = ns['ORDER']
pat = re.compile(r'internal/(checker/\w+\.go):(\d+):\s+(\S+)\s+([\d.]+)%')
entered = {}
for ln in open(sys.argv[2]):
    m = pat.search(ln)
    if m and float(m.group(4)) > 0: entered[(m.group(1), int(m.group(2)))] = float(m.group(4))
by = {}
for f in fns: by.setdefault(f['name'], f)
short = lambda n: ns['short'](n).replace('c.', '')
mine = [f for f in fns if f['layer'] and (f['file'], f['decl']) in entered]
mine.sort(key=lambda f: (f['file'], f['decl']))
print('# entered, in upstream order: layer, where, function, percent of statements run')
for f in mine:
    print(f"{f['layer']}\t{f['file'].split('/')[-1]}:{f['decl']}-{f['end']}\t{short(f['name'])}\t{entered[(f['file'], f['decl'])]}")
need = collections.defaultdict(lambda: collections.defaultdict(set))
for f in mine:
    for c in f['callees']:
        t = by.get(c)
        if t is None or t['pkg'] != 'checker': continue
        if (t['file'], t['decl']) in entered: continue
        need[t['layer'] or t['module']][short(c)].add(short(f['name']))
print('# callees named by those functions that the run does not enter (stand-ins for a K4-only port): layer or module, callee <- callers')
for L in sorted(need, key=lambda x: (ORDER.index(x) if x in ORDER else 99, x)):
    for c in sorted(need[L]):
        print(f"{L}\t{c}\t{', '.join(sorted(need[L][c]))}")
allk4 = [f for f in fns if f['pkg'] == 'checker' and (f['file'], f['decl']) in entered]
print(f"# whole run: {len(allk4)} checker functions entered, {len(mine)} of them in these layers")
