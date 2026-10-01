# Layer model for the expression, call, contextual typing and flow layers (bottom-up pass).
# Input: fns.json as ../checker-core-scratch/run.sh makes it (default /tmp/k3a/fns.json, or $FNS), the PORT_STATUS rows of the type layers.
import json, re, sys, collections, os
FNS = os.environ.get('FNS', '/tmp/k3a/fns.json')
NOTES = '/workspace/notes/lint/units/typecheck'
REF = '/workspace/ref/typescript-go/internal/'
C = 'checker/checker.go'; F = 'checker/flow.go'
fns = json.load(open(FNS))
codes = {}
for line in open(REF + 'diagnostics/diagnostics_generated.go'):
    m = re.match(r'var (\w+) = &Message\{code: (\d+), category: Category(\w+),', line)
    if m: codes[m.group(1)] = (int(m.group(2)), m.group(3))
# sections of checker.go that the core research covers, by declaration line
CORE = [('TYPES', 1, 907), ('C-INIT', 908, 1503), ('N-DIAG', 1505, 2200), ('N-RESOLVE', 13991, 14050), ('D-SINK', 14052, 14168), ('S-MERGE', 14170, 14531),
        ('A-ALIAS', 14533, 15193), ('M-MODULE', 15195, 15828), ('Q-ENTITY', 15830, 16012), ('M-MODULE', 16014, 16347), ('A-ALIAS', 16349, 16493),
        ('T-KEYS', 17471, 17775), ('T-RSTACK', 18861, 18958), ('K-OBJ', 25126, 25394)]
src_cache = {}
def src(file):
    if file not in src_cache: src_cache[file] = open(REF + file, encoding='utf-8').read().split('\n')
    return src_cache[file]
# The twelve layers, by declaration line (inclusive).
MINE = [
 ('F-UNREACH',  C, 2398, 2477),
 ('E-CORE',     C, 7419, 7925),
 ('E-ACCESS',   C, 7927, 8064),
 ('E-LITERAL',  C, 8066, 8210),
 ('E-ACCESS',   C, 8212, 8355),
 ('E-CALL',     C, 8357, 9719),
 ('E-CALL',     C, 9739, 10131),
 ('E-CORE',     C, 10133, 10135),
 ('E-FUNC',     C, 10137, 10532),
 ('E-CORE',     C, 10707, 10892),
 ('E-OPER',     C, 10894, 11035),
 ('E-CORE',     C, 11037, 11130),
 ('E-ACCESS',   C, 11132, 12376),
 ('E-CORE',     C, 12378, 12420),
 ('E-OPER',     C, 12422, 13233),
 ('E-LITERAL',  C, 13235, 13609),
 ('E-LITERAL',  C, 13627, 13822),
 ('E-ACCESS',   C, 13824, 13964),
 ('E-LITERAL',  C, 13966, 13977),
 ('E-CORE',     C, 13979, 13989),
 ('T-RETINFER', C, 20240, 20564),
 ('T-RETINFER', C, 20649, 20720),
 ('E-ACCESS',   C, 27829, 27853),
 ('E-ACCESS',   C, 29187, 29196),
 ('E-FACTS',    C, 29229, 29253),
 ('E-CTX',      C, 29466, 30162),
 ('E-CALL',     C, 30165, 30262),
 ('E-CTX',      C, 30674, 31095),
 ('E-FACTS',    C, 31097, 31347),
 ('F-NARROW',   C, 31594, 31605),
 ('F-NARROW',   C, 31614, 31692),
 ('F-NARROW',   F, 1, 2511),
 ('F-REACH',    F, 2513, 2652),
 ('F-NARROW',   F, 2654, 2764),
]
ORDER = ['E-CORE', 'E-LITERAL', 'E-OPER', 'E-ACCESS', 'E-FACTS', 'E-FUNC', 'T-RETINFER', 'E-CALL', 'E-CTX', 'F-NARROW', 'F-REACH', 'F-UNREACH']
# type layers: the PORT_STATUS rows of checker-type-layers-topdown
TL = []
for ln in open(NOTES + '/checker-type-layers-topdown/data/port_status_rows.tsv'):
    p = ln.rstrip('\n').split('\t')
    if len(p) < 4 or not p[0].startswith('internal/'): continue
    lay = p[2].split(':')[0]
    if lay == 'LATER': continue
    a, b = p[1].split('-')
    TL.append((lay, p[0].replace('internal/', ''), int(a), int(b)))
REL = [
 ('R-REL', 1, 422), ('R-ELAB', 424, 675), ('R-REL', 677, 870), ('R-DISCRIM', 872, 950), ('R-REL', 952, 1028), ('R-DISCRIM', 1030, 1268),
 ('R-REL', 1270, 1315), ('R-VARIANCE', 1317, 1485), ('R-SIGREL', 1487, 2313), ('R-REL', 2315, 2557), ('R-SIGREL', 2559, 2567), ('R-REL', 2569, 3933),
 ('R-VARIANCE', 3935, 3999), ('R-REL', 4001, 4019), ('R-DISCRIM', 4021, 4130), ('R-REL', 4132, 4471), ('R-SIGREL', 4473, 4608), ('R-REL', 4610, 5044)]
INF = [('I-INFER', 1, 998), ('I-REVMAP', 1000, 1183), ('I-INFER', 1185, 1684)]
PRINTER = set('printer.go nodebuilder.go nodebuilderimpl.go nodebuilderscopes.go nodebuilder_hover.go nodecopy.go pseudotypenodebuilder.go symbolaccessibility.go symboltracker.go stringer_generated.go'.split())
# later sections of checker.go, by chunk, with the name of the later work
LATER_CHUNK = [
 (2202, 2396, 'X-SOURCE'), (2479, 2660, 'X-DEFERRED'), (2662, 3410, 'X-MEMBERS'), (3412, 3791, 'X-FUNCDECL'), (3793, 4284, 'X-STMT'),
 (4286, 5146, 'X-CLASS'), (5148, 5852, 'X-ENUM-MODULE'), (5854, 6183, 'X-VAR'), (6185, 6824, 'X-ITER'), (6826, 7417, 'X-ALIAS-UNUSED'),
 (10534, 10705, 'X-COLLISION'), (27988, 28248, 'R-NORMALIZE'), (28312, 29040, 'X-MARKREF'), (29042, 29122, 'X-ASYNC'), (30265, 30672, 'X-DECORATOR'),
 (31349, 31591, 'X-ASYNC'), (31704, 32296, 'API-SYMLOC')]
T21 = ["K-LIT","K-PRED","K-GENERIC","K-UNION","K-INTERSECT","T-TUPLE","T-DECLARED","T-ENUMVAL","T-TYPENODE","T-CONSTRAINT","T-BASE","T-MEMBERS","T-UIMEMBERS","T-LOOKUP","T-APPARENT","T-SIGDECL","T-SIGSHAPE","T-SIGINST","T-INSTANTIATE","T-SYMTYPE","T-WIDEN"]
T7 = ["K-KEYOF","K-INDEXED","K-SUBST","K-COND","T-MAPPED","K-TEMPLATE","K-IMPORTTYPE"]
COREL = ['TYPES','LINKS','MAPPER','UTIL','T-KEYS','K-OBJ','T-RSTACK','C-INIT','D-SINK','S-MERGE','N-RESOLVE','N-DIAG','A-ALIAS','M-MODULE','Q-ENTITY','BINDER','TRACER']
GLOBAL = COREL + T21 + ['PRINTER', 'R-REL', 'R-SIGREL', 'R-VARIANCE', 'R-DISCRIM', 'R-ELAB', 'R-NORMALIZE'] + ORDER[:8] + ['I-INFER', 'I-REVMAP'] + ORDER[8:11] + T7 + \
    ['X-ITER', 'X-ASYNC', 'X-JSX', 'X-DECORATOR', 'X-SOURCE', 'X-DEFERRED', 'X-MEMBERS', 'X-FUNCDECL', 'X-STMT', 'X-CLASS', 'X-ENUM-MODULE', 'X-VAR', 'X-ALIAS-UNUSED', 'X-COLLISION', 'X-MARKREF', 'X-JSDOC', 'F-UNREACH', 'X-GRAMMAR', 'API-SYMLOC', 'API-SERVICES', 'API-EXPORTS', 'API-EMIT', 'API-REFRESOLVER', '?']
RANK = {n: i for i, n in enumerate(GLOBAL)}
def qual(f):
    return f['name'].split('.', 1)[1]
def layer_of(f):
    file, d = f['file'], f['decl']
    for name, fl, lo, hi in MINE:
        if fl == file and lo <= d <= hi: return name
    if file == C:
        for name, lo, hi in CORE:
            if lo <= d <= hi: return name
    for name, fl, lo, hi in TL:
        if fl == file and lo <= d <= hi: return name
    base = file.split('/')[-1]
    if file == 'checker/relater.go':
        for name, lo, hi in REL:
            if lo <= d <= hi: return name
    if file == 'checker/inference.go':
        for name, lo, hi in INF:
            if lo <= d <= hi: return name
    if base in PRINTER: return 'PRINTER'
    if file == C:
        for lo, hi, name in LATER_CHUNK:
            if lo <= d <= hi: return name
        return '?'
    return {'jsx.go': 'X-JSX', 'grammarchecks.go': 'X-GRAMMAR', 'jsdoc.go': 'X-JSDOC', 'services.go': 'API-SERVICES', 'exports.go': 'API-EXPORTS',
            'emitresolver.go': 'API-EMIT', 'tracer.go': 'TRACER', 'binder.go': 'BINDER', 'nameresolver.go': 'N-RESOLVE', 'referenceresolver.go': 'API-REFRESOLVER',
            'types.go': 'TYPES', 'links.go': 'LINKS', 'mapper.go': 'MAPPER', 'utilities.go': 'UTIL'}.get(base, '?')
chunks = []
for line in open(NOTES + '/checker-core-scratch/data/split.tsv'):
    p = line.rstrip('\n').split('\t')
    if len(p) >= 5 and '-' in p[1]:
        x, y = p[1].split('-')
        chunks.append((int(x), int(y), p[4]))
def module_of(f):
    if f['file'] == C:
        for a, b, n in chunks:
            if a <= f['decl'] <= b: return 'checker/' + n
        return 'checker/?'
    return f['file'].replace('.go', '.rs')
byname = {}
for f in fns:
    for k in ('callees', 'diags', 'panics', 'asserts', 'maprange', 'program', 'tracer', 'symw', 'links', 'fields'):
        if f.get(k) is None: f[k] = []
    f['q'] = qual(f)
    byname[(f['pkg'], f['q'])] = f
for f in fns:
    f['layer'] = layer_of(f)
    f['mine'] = f['layer'] in ORDER
    f['module'] = module_of(f)
    # defer statements and type assertions are read from the source text of the function
    lines = src(f['file'])[f['decl'] - 1:f['end']]
    f['defers'] = [{'line': f['decl'] + i, 'text': l.strip()} for i, l in enumerate(lines) if re.search(r'^\s*defer\b', l)] if f['mine'] else []
    f['casts'] = [{'line': f['decl'] + i, 'text': m.group(0)} for i, l in enumerate(lines) for m in re.finditer(r'[A-Za-z_\]\)]\.\((\*?[A-Za-z_][A-Za-z_.0-9]*)\)', l) if m.group(1) != 'type'] if f['mine'] else []
def short(f):
    return f['q'].replace('Checker.', 'c.')
def loc(f):
    return '%s:%d-%d' % (f['file'].split('/')[-1], f['decl'], f['end'])
def ours(layer=None):
    r = [f for f in fns if f['mine'] and (layer is None or f['layer'] == layer)]
    return sorted(r, key=lambda f: (f['file'], f['decl']))
def diagcodes(f):
    out = []
    for d in f.get('diags') or []:
        c = codes.get(d)
        out.append(str(c[0]) if c else d)
    return sorted(set(out), key=lambda x: int(x) if x.isdigit() else 0)
def callees(f):
    for c in f['callees'] or []:
        if '.' not in c: continue
        pkg, rest = c.split('.', 1)
        t = byname.get((pkg, rest))
        if t is not None: yield t, c
if __name__ == '__main__':
    mode = sys.argv[1]
    lay = sys.argv[2] if len(sys.argv) > 2 else None
    if mode == 'summary':
        tn = tl = 0
        for l in ORDER:
            fs = ours(l); n = len(fs); ln = sum(f['end'] - f['decl'] + 1 for f in fs); tn += n; tl += ln
            print('%s\t%d\t%d' % (l, n, ln))
        print('TOTAL\t%d\t%d' % (tn, tl))
        unk = [f for f in fns if f['layer'] == '?']
        print('unclassified', len(unk), ' '.join('%s@%s' % (short(f), loc(f)) for f in unk[:40]))
    if mode == 'list':
        for f in ours(lay):
            extra = ''
            d = diagcodes(f)
            if d: extra += ' codes=' + ','.join(d)
            for k, tag in (('panics', 'PANIC'), ('asserts', 'ASSERT'), ('maprange', 'MAPRANGE'), ('defers', 'DEFER'), ('casts', 'CAST'), ('symw', 'SYMWRITE')):
                if f.get(k): extra += ' %s@%s' % (tag, ','.join(str(p['line']) for p in f[k]))
            if f.get('program'): extra += ' PROGRAM=' + ','.join(sorted(set(p['text'] for p in f['program'])))
            if f.get('closures'): extra += ' closures=%d' % f['closures']
            if f.get('links'): extra += ' links=' + ','.join(f['links'])
            print('%s\t%s\t%s\t%d\t%s%s' % (f['layer'], f['module'], loc(f), f['end'] - f['decl'] + 1, short(f), extra))
