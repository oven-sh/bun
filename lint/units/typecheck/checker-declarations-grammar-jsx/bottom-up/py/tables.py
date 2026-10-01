# Per layer: FN lines (functions in upstream order by range) with marks, codes, panic lines, and the later-layer callees.
# marks: * a caller outside the layer lands earlier (other section, or a layer earlier in ORDER), + entered by the K4 run, ! has panic or assert
# usage: tables.py <fns.json> <min.func.txt>
import json, re, sys, collections, os
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'layers.py')).read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1]); ORDER = ns['ORDER']; LAYERS = ns['LAYERS']; codes = ns['load_codes']()
byname = {}
for f in fns: byname.setdefault(f['name'], f)
k4 = set()
pat = re.compile(r'internal/(checker/\w+\.go):(\d+):\s+(\S+)\s+([\d.]+)%')
for ln in open(sys.argv[2]):
    m = pat.search(ln)
    if m and float(m.group(4)) > 0: k4.add((m.group(1), int(m.group(2))))
callers = collections.defaultdict(set)
for f in fns:
    for cal in f['callees']:
        if cal != f['name']: callers[cal].add(f['name'])
def early(f):
    L = f['layer']
    for cn in callers[f['name']]:
        cf = byname[cn]
        if cf['layer'] == L: continue
        if cf['layer'] is None:
            if cf['pkg'] == 'checker': return True
            continue
        if cf['layer'] == 'Z-SERVICES': continue
        if ORDER.index(cf['layer']) < ORDER.index(L): return True
    return False
for L in ORDER:
    fs = [f for f in fns if f['layer'] == L]
    if L == 'Z-SERVICES':
        fs = [f for f in fs if f['file'] == 'checker/checker.go']
    nlines = sum(f['end'] - f['decl'] + 1 for f in fs)
    print(f"### {L} ({len(fs)} fn, {nlines} l)")
    for (name, file, lo, hi) in LAYERS:
        if name != L: continue
        part = sorted([f for f in fs if f['file'] == file and lo <= f['decl'] <= hi], key=lambda f: f['decl'])
        if not part: continue
        items = []
        for f in part:
            n = ns['short'](f['name']).replace('c.', '')
            mark = ('*' if early(f) else '') + ('+' if (f['file'], f['decl']) in k4 else '') + ('!' if f['panics'] or f['asserts'] else '')
            items.append(n + mark)
        rng = f"{part[0]['decl']}-{part[-1]['end']}"
        print(f"FN {file.split('/')[-1]} {rng}: {' '.join(items)}")
    later = collections.OrderedDict()
    for f in fs:
        for cal in f['callees']:
            t = byname.get(cal)
            if t is None or not t['layer'] or t['layer'] == L: continue
            if ORDER.index(t['layer']) > ORDER.index(L):
                later.setdefault(t['layer'], set()).add(ns['short'](cal).replace('c.', ''))
    if later:
        print("OUT(later layers) " + '; '.join(f"{k}[{', '.join(sorted(v))}]" for k, v in later.items()))
    cs = sorted(set(codes[n][0] for f in fs for n in f['diags'] if n in codes))
    print(f"CODES({len(cs)}) " + ' '.join(map(str, cs)))
    ps = [f"{p['line']}" for f in fs for p in f['panics']] ; asr = [f"{p['line']}" for f in fs for p in f['asserts']]
    if ps or asr: print("PANIC " + ' '.join(ps) + (" ASSERT " + ' '.join(asr) if asr else ''))
    pg = sorted(set(p['text'] for f in fs for p in f['program']))
    if pg: print("PROGRAM " + ' '.join(pg))
    mr = [f"{ns['short'](f['name']).replace('c.','')}@{p['line']}" for f in fs for p in f['maprange']]
    if mr: print("MAPRANGE " + ' '.join(mr))
    print()
