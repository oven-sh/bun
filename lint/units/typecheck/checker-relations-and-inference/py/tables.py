# Tables of the relation and inference layers with the ownership reconciled with the type layers.
# Input: fns.json made by ../../checker-core-scratch/run.sh (default /tmp/k3a/fns.json), codes.json next to it,
# and the layer ranges of ../../checker-type-layers-topdown/py/layers.py.
# usage: tables.py <out dir> [fns.json]
import json, sys, os, re, collections

OUT = sys.argv[1]
FNS = sys.argv[2] if len(sys.argv) > 2 else '/tmp/k3a/fns.json'
HERE = os.path.dirname(os.path.abspath(__file__))
R = 'checker/relater.go'; I = 'checker/inference.go'; C = 'checker/checker.go'

# (layer, file, first declaration line, last declaration line). "prior X": the type layer X lands the range first.
FINAL = [
    ('R-REL', R, 18, 87), ('prior T-CONSTRAINT', R, 89, 96), ('R-REL', R, 98, 422), ('R-ELAB', R, 424, 675),
    ('R-REL', R, 677, 808), ('prior T-CONSTRAINT', R, 810, 870), ('R-DISCRIM', R, 872, 950), ('R-REL', R, 952, 1028),
    ('R-DISCRIM', R, 1030, 1268), ('R-REL', R, 1270, 1315), ('R-VARIANCE', R, 1317, 1485), ('R-SIGREL', R, 1487, 1705),
    ('prior T-SIGSHAPE', R, 1707, 1913), ('prior T-TUPLE', R, 1915, 1945), ('prior T-SIGSHAPE', R, 1947, 2047),
    ('prior T-SIGSHAPE or K-PRED', R, 2049, 2143), ('prior T-SIGSHAPE', R, 2145, 2150), ('R-SIGREL', R, 2152, 2313),
    ('R-REL', R, 2315, 2352), ('later K-TEMPLATE', R, 2354, 2557), ('R-SIGREL', R, 2559, 2567), ('R-REL', R, 2569, 3933),
    ('R-VARIANCE', R, 3935, 3999), ('R-REL', R, 4001, 4019), ('R-DISCRIM', R, 4021, 4130), ('R-REL', R, 4132, 4471),
    ('R-SIGREL', R, 4473, 4608), ('R-REL', R, 4610, 5026), ('omitted: tracing only', R, 5028, 5044),
    ('I-INFER', I, 11, 998), ('I-REVMAP', I, 1000, 1183), ('I-INFER', I, 1185, 1684),
    ('R-REL', C, 11995, 12037), ('R-REL', C, 13208, 13219), ('R-REL', C, 27988, 28023), ('R-REL', C, 28163, 28248),
]
ORDER = ['R-REL', 'R-SIGREL', 'R-VARIANCE', 'R-DISCRIM', 'R-ELAB', 'I-INFER', 'I-REVMAP']
CORE = [
    ('MAPPER', 'checker/mapper.go', 1, 99999), ('UTIL', 'checker/utilities.go', 1, 99999),
    ('LINKS', 'checker/links.go', 1, 99999), ('TYPES', 'checker/types.go', 1, 99999),
    ('T-KEYS', C, 17471, 17775), ('K-OBJ', C, 25126, 25394), ('T-RSTACK', C, 18861, 18958),
    ('C-INIT', C, 908, 1503), ('D-SINK', C, 14052, 14168), ('S-MERGE', C, 14170, 14531),
    ('N-RESOLVE', 'binder/nameresolver.go', 1, 99999), ('N-RESOLVE', C, 2182, 2200), ('N-RESOLVE', C, 13991, 14050),
    ('N-DIAG', C, 1505, 2180), ('A-ALIAS', C, 14533, 15193), ('A-ALIAS', C, 15830, 15861), ('A-ALIAS', C, 16349, 16493),
    ('M-MODULE', C, 15195, 15828), ('M-MODULE', C, 16014, 16347), ('Q-ENTITY', C, 15863, 16012),
]
src = open(HERE + '/../../checker-type-layers-topdown/py/layers.py').read()
TYPE_LAYERS = eval('[' + re.search(r"MINE = \[(.*?)\n\]", src, re.S).group(1) + ']', {'C': C, 'R': R})
# Type layers that land after inference in the order of typecheck.md.
POST = ['K-KEYOF', 'K-INDEXED', 'K-SUBST', 'K-COND', 'T-MAPPED', 'K-TEMPLATE', 'K-IMPORTTYPE']
SPLIT = []
for m in re.finditer(r"\((\d+), '(\w+)'\)", open(HERE + '/layers.py').read()):
    SPLIT.append((int(m.group(1)), m.group(2)))

fns = json.load(open(FNS))
codes = json.load(open(os.path.dirname(FNS) + '/codes.json'))['codes']

def pick(table, f):
    for row in table:
        if f['file'] == row[1] and row[2] <= f['decl'] <= row[3]:
            return row[0]
    return None

def section(f):
    if f['file'] != C:
        return f['file'].split('/')[-1]
    name = None
    for start, n in SPLIT:
        if f['decl'] >= start:
            name = n
    return name

def short(n):
    return n.replace('checker.Checker.', 'c.').replace('checker.Relater.', 'r.').replace('checker.', '')

by = {}
for f in fns:
    for k in ('callees', 'diags', 'panics', 'asserts'):
        if f.get(k) is None:
            f[k] = []
    f['my'] = pick(FINAL, f)
    f['own'] = f['my'] if f['my'] in ORDER else None
    f['other'] = pick(TYPE_LAYERS + CORE, f)
    if f['my'] and f['my'].startswith('prior '):
        f['other'] = f['my'][6:].split(' or ')[0]
    if f['my'] and f['my'].startswith('later '):
        f['other'] = f['my'][6:]
    f['sec'] = section(f)
    by.setdefault(f['name'], f)

def where(f):
    return f"{f['file'].split('/')[-1]}:{f['decl']}"

def w(name, lines):
    open(os.path.join(OUT, name), 'w').write('\n'.join(lines) + '\n')

# functions.tsv: every function of the two files and the claimed checker.go helpers, in upstream order
rows = ['layer\tfile\tlines\tfunction\tclosures\tcodes\tpanic lines']
for f in sorted([f for f in fns if f['my']], key=lambda f: ({R: 0, I: 1, C: 2}[f['file']], f['decl'])):
    d = sorted(set(str(codes[n][0]) if n in codes else n for n in f['diags']), key=lambda x: (len(x), x))
    rows.append(f"{f['my']}\t{f['file'].split('/')[-1]}\t{f['start']}-{f['end']}\t{short(f['name'])}\t{f['closures']}\t{','.join(d)}\t{','.join(str(p['line']) for p in f['panics'])}")
w('functions.tsv', rows)

# port_status_rows.tsv
rows = ['upstream path\tlines\tgroup\tRust module\tstate\tcommit']
for L, file, lo, hi in FINAL:
    fs = sorted([f for f in fns if f['file'] == file and lo <= f['decl'] <= hi], key=lambda f: f['decl'])
    names = (short(fs[0]['name']) + (' .. ' + short(fs[-1]['name']) if len(fs) > 1 else '')) if fs else 'types and constants'
    module = {R: 'checker/relater.rs', I: 'checker/inference.rs', C: 'checker/' + section({'file': C, 'decl': lo}) + '.rs'}[file]
    rows.append(f"internal/{file}\t{lo}-{hi}\t{L}: {names} ({len(fs)})\t{module}\tnot started\t89d5d5b")
w('port_status_rows.tsv', rows)

# summary
rows = []
for L in ORDER + sorted(set(x[0] for x in FINAL) - set(ORDER)):
    fs = [f for f in fns if f['my'] == L]
    rows.append(f"{L}\tfunctions {len(fs)}\tlines {sum(f['end'] - f['start'] + 1 for f in fs)}\tclosures {sum(f['closures'] for f in fs)}\tdiagnostic references {sum(len(f['diags']) for f in fs)}")
w('summary.tsv', rows)

# standins_in.txt: callees outside the own layers, per layer, by the layer that owns the callee
EARLY = ['TYPES', 'LINKS', 'MAPPER', 'UTIL', 'T-KEYS', 'K-OBJ', 'T-RSTACK', 'C-INIT', 'D-SINK', 'S-MERGE', 'N-RESOLVE', 'N-DIAG',
         'A-ALIAS', 'M-MODULE', 'Q-ENTITY', 'K-LIT', 'K-PRED', 'K-GENERIC', 'K-UNION', 'K-INTERSECT', 'T-TUPLE', 'T-DECLARED',
         'T-ENUMVAL', 'T-TYPENODE', 'T-CONSTRAINT', 'T-BASE', 'T-MEMBERS', 'T-UIMEMBERS', 'T-LOOKUP', 'T-APPARENT', 'T-SIGDECL',
         'T-SIGSHAPE', 'T-SIGINST', 'T-INSTANTIATE', 'T-SYMTYPE', 'T-WIDEN']
rows = []
for L in ORDER:
    out = collections.defaultdict(dict)
    for f in fns:
        if f['own'] != L:
            continue
        for cal in f['callees']:
            t = by.get(cal)
            if t is None or t['own'] or not (cal.startswith('checker.') or cal.startswith('binder.')):
                continue
            out[t['other'] or ('later:' + t['sec'])][short(cal)] = (t['file'], t['decl'])
    rows.append(f"== {L}")
    for label, keys in (('before', EARLY), ('AFTER (type layer that lands after inference)', POST),
                        ('AFTER', sorted(k for k in out if k.startswith('later:')))):
        for k in keys:
            if k in out:
                rows.append(f"  {label} {k}: " + ' '.join(f"{n}@{fl.split('/')[-1][:3] if fl != C else ''}{d}" for n, (fl, d) in sorted(out[k].items(), key=lambda x: (x[1][0] != C, x[1][1]))))
w('standins_in.txt', rows)

# standins_out.tsv: own functions that code outside the own layers calls
callers = collections.defaultdict(lambda: collections.defaultdict(set))
for f in fns:
    if f['own']:
        continue
    for cal in f['callees']:
        t = by.get(cal)
        if t is not None and t['own']:
            callers[cal][f['other'] or ('later:' + f['sec'])].add(short(f['name']))
rows = ['where\tfunction\tlayer\tcallers in layers that land before\tcallers in later layers']
for cal in sorted(callers, key=lambda n: ({R: 0, I: 1, C: 2}[by[n]['file']], by[n]['decl'])):
    t = by[cal]; m = callers[cal]
    early = sorted(k for k in m if not k.startswith('later:') and k not in POST)
    late = sorted(k.replace('later:', '') for k in m if k.startswith('later:') or k in POST)
    rows.append(f"{where(t)}\t{short(cal)}\t{t['own']}\t{','.join(early)}\t{','.join(late)}")
w('standins_out.tsv', rows)

# cross.txt: calls between the seven layers
rows = []
for L in ORDER:
    out = collections.defaultdict(dict)
    for f in fns:
        if f['own'] != L:
            continue
        for cal in f['callees']:
            t = by.get(cal)
            if t is not None and t['own'] and t['own'] != L:
                out[t['own']].setdefault(short(cal) + '@' + str(t['decl']), set()).add(short(f['name']))
    for to in ORDER:
        if to in out:
            rows.append(f"{L} -> {to}: " + '; '.join(f"{k} <- {', '.join(sorted(v))}" for k, v in sorted(out[to].items(), key=lambda x: int(x[0].split('@')[1]))))
w('cross.txt', rows)

# panics.tsv
rows = []
for f in fns:
    if f['own']:
        for p in f['panics']:
            rows.append(f"{f['own']}\t{f['file'].split('/')[-1]}:{p['line']}\t{short(f['name'])}\tpanic\t{p['text']}")
        for p in f['asserts']:
            rows.append(f"{f['own']}\t{f['file'].split('/')[-1]}:{p['line']}\t{short(f['name'])}\tassert\t{p['text']}")
w('panics.tsv', rows)
print('tables written to', OUT)
