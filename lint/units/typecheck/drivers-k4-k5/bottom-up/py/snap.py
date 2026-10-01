# Research probe: functions entered in each phase of `tsgo --noEmit [--skipDefaultLibCheck] --singleThreaded min.ts`.
# usage: snap.py <run> summary | snap.py <run> list <phase> [package prefix] | snap.py <run> need
import sys, re, collections, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
W = '/tmp/k4drv'
PFX = 'github.com/microsoft/typescript-go/internal/'
import importlib.util
spec = importlib.util.spec_from_file_location('an', W + '/py/layermap.py'); an = importlib.util.module_from_spec(spec); spec.loader.exec_module(an)
funcs = {}
for ln in open(W + '/funcs2.tsv'):
    file, a, b, name = ln.rstrip('\n').split('\t')
    funcs[(file, int(a))] = (int(b) - int(a) + 1, name)
run = sys.argv[1]
PH = collections.OrderedDict()
for fn in sorted(os.listdir(f'{W}/snap/{run}')):
    if not fn.endswith('.func.txt'): continue
    ent = {}
    for ln in open(f'{W}/snap/{run}/{fn}'):
        m = re.match(r'(\S+):(\d+):\s+(\S+)\s+([\d.]+)%', ln)
        if not m or not m.group(1).startswith(PFX): continue
        if float(m.group(4)) > 0: ent[(m.group(1)[len(PFX):], int(m.group(2)))] = float(m.group(4))
    PH[fn[:-len('.func.txt')]] = ent
def lines(s): return sum(funcs.get(k, (0, ''))[0] for k in s)
cmd = sys.argv[2]
if cmd == 'summary':
    for ph, s in PH.items():
        by = collections.Counter(); bl = collections.Counter()
        for k in s:
            p = k[0].rsplit('/', 1)[0]; by[p] += 1; bl[p] += funcs.get(k, (0, ''))[0]
        print(f'{ph}: {len(s)} functions, {lines(s)} lines: ' + ', '.join(f'{p} {n}/{bl[p]}' for p, n in sorted(by.items(), key=lambda x: -bl[x[0]])))
elif cmd == 'list':
    s = PH[sys.argv[3]]; only = sys.argv[4] if len(sys.argv) > 4 else ''
    for k in sorted(s):
        if only and not k[0].startswith(only): continue
        print(f'{an.layer_of(*k)}\t{k[0]}:{k[1]}\t{funcs.get(k, (0, "?"))[1]}\t{funcs.get(k, (0, ""))[0]}\t{s[k]}')
elif cmd == 'need':
    # what a port needs for K4: everything entered from the bind on, by package, with the first phase that enters it
    first = {}
    for ph in ['3b-bind', '4a-preinit', '4b-init', '5-check', '9-report']:
        for k in PH.get(ph, {}):
            first.setdefault(k, ph)
    for k in sorted(first):
        print(f'{first[k]}\t{an.layer_of(*k)}\t{k[0]}:{k[1]}\t{funcs.get(k, (0, "?"))[1]}\t{funcs.get(k, (0, ""))[0]}')
