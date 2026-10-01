# Research probe: which functions of typescript-go the check of min.ts enters, by phase, package and layer.
# Inputs: /tmp/k4drv/cov/<run>.func.txt (go tool cover -func) and /tmp/k4drv/funcs.tsv (file, func line, last line, name).
# usage: analyze.py summary|layers|list <phase>|pkg <phase>
import sys, re, collections
W = '/tmp/k4drv'
PFX = 'github.com/microsoft/typescript-go/internal/'
C = 'checker/checker.go'; R = 'checker/relater.go'; I = 'checker/inference.go'; F = 'checker/flow.go'
LAYERS = [
 # type layers (checker-type-layers-topdown)
 ('K-LIT', C, 25396, 25676),
 ('K-PRED', C, 26348, 26371), ('K-PRED', C, 26575, 26770), ('K-PRED', C, 27729, 27794), ('K-PRED', C, 27926, 27987),
 ('K-PRED', C, 28278, 28281), ('K-PRED', C, 31607, 31612),
 ('K-GENERIC', C, 24991, 25074),
 ('K-UNION', C, 25677, 26146), ('K-UNION', C, 26771, 26802),
 ('K-INTERSECT', C, 26147, 26347), ('K-INTERSECT', C, 26372, 26574),
 ('T-TUPLE', C, 23410, 23693), ('T-TUPLE', C, 24791, 24804), ('T-TUPLE', C, 24820, 24990), ('T-TUPLE', R, 1915, 1946),
 ('T-DECLARED', C, 17413, 17470), ('T-DECLARED', C, 23779, 24034), ('T-DECLARED', C, 24040, 24060), ('T-DECLARED', C, 24217, 24224),
 ('T-ENUMVAL', C, 24035, 24039), ('T-ENUMVAL', C, 24061, 24216),
 ('T-TYPENODE', C, 22913, 23409), ('T-TYPENODE', C, 23694, 23778), ('T-TYPENODE', C, 24225, 24391), ('T-TYPENODE', C, 24690, 24697),
 ('T-CONSTRAINT', C, 17141, 17412), ('T-CONSTRAINT', C, 22047, 22162), ('T-CONSTRAINT', C, 27551, 27728), ('T-CONSTRAINT', C, 29255, 29267),
 ('T-BASE', C, 17030, 17131), ('T-BASE', C, 19281, 19406), ('T-BASE', C, 19612, 19711),
 ('T-MEMBERS', C, 19176, 19280), ('T-MEMBERS', C, 19712, 19919), ('T-MEMBERS', C, 20764, 21007), ('T-MEMBERS', C, 22163, 22213),
 ('T-UIMEMBERS', C, 21166, 21516), ('T-UIMEMBERS', C, 21528, 21828), ('T-UIMEMBERS', C, 13611, 13626), ('T-UIMEMBERS', C, 27795, 27828),
 ('T-LOOKUP', C, 18960, 19175), ('T-LOOKUP', C, 21517, 21527),
 ('T-APPARENT', C, 21829, 22006),
 ('T-SIGDECL', C, 19920, 20239),
 ('T-SIGSHAPE', R, 1708, 1914), ('T-SIGSHAPE', R, 1947, 2151), ('T-SIGSHAPE', C, 27855, 27925), ('T-SIGSHAPE', C, 9721, 9738),
 ('T-SIGSHAPE', C, 29124, 29134), ('T-SIGSHAPE', C, 17132, 17140),
 ('T-SIGINST', C, 19407, 19611), ('T-SIGINST', C, 20722, 20763),
 ('T-INSTANTIATE', C, 22007, 22046), ('T-INSTANTIATE', C, 22214, 22598), ('T-INSTANTIATE', C, 22632, 22637),
 ('T-INSTANTIATE', C, 22856, 22912), ('T-INSTANTIATE', C, 24602, 24661),
 ('T-SYMTYPE', C, 16495, 17029), ('T-SYMTYPE', C, 17777, 18150), ('T-JSDECL', C, 18151, 18350), ('T-SYMTYPE', C, 18351, 18468),
 ('T-SYMTYPE', C, 18617, 18859), ('T-SYMTYPE', C, 29198, 29227),
 ('T-WIDEN', C, 18469, 18616), ('T-WIDEN', C, 20566, 20648), ('T-WIDEN', C, 28282, 28311),
 ('K-KEYOF', C, 26803, 26944), ('K-KEYOF', C, 26957, 27045),
 ('K-INDEXED', C, 27046, 27516), ('K-INDEXED', C, 28025, 28128), ('K-INDEXED', C, 28152, 28162), ('K-INDEXED', C, 29414, 29448),
 ('K-SUBST', C, 26945, 26956), ('K-SUBST', C, 27517, 27550), ('K-SUBST', C, 25075, 25125), ('K-SUBST', C, 31694, 31702),
 ('K-COND', C, 24392, 24601), ('K-COND', C, 24662, 24689), ('K-COND', C, 22599, 22631), ('K-COND', C, 28129, 28151),
 ('T-MAPPED', C, 21008, 21165), ('T-MAPPED', C, 22638, 22855), ('T-MAPPED', C, 28250, 28277), ('T-MAPPED', C, 29135, 29186),
 ('K-TEMPLATE', C, 29268, 29413), ('K-TEMPLATE', R, 2354, 2558),
 ('K-IMPORTTYPE', C, 24698, 24790),
 # relations and inference (checker-relations-and-inference)
 ('R-REL', R, 1, 422), ('R-ELAB', R, 424, 675), ('R-REL', R, 677, 870), ('R-DISCRIM', R, 872, 950), ('R-REL', R, 952, 1028),
 ('R-DISCRIM', R, 1030, 1268), ('R-REL', R, 1270, 1315), ('R-VARIANCE', R, 1317, 1485), ('R-SIGREL', R, 1487, 1707),
 ('R-SIGREL', R, 2152, 2313), ('R-REL', R, 2315, 2353), ('R-SIGREL', R, 2559, 2567), ('R-REL', R, 2569, 3933),
 ('R-VARIANCE', R, 3935, 3999), ('R-REL', R, 4001, 4019), ('R-DISCRIM', R, 4021, 4130), ('R-REL', R, 4132, 4471),
 ('R-SIGREL', R, 4473, 4608), ('R-REL', R, 4610, 5044),
 ('R-REL', C, 27988, 28023), ('R-REL', C, 28163, 28248),
 ('I-INFER', I, 1, 998), ('I-REVMAP', I, 1000, 1183), ('I-INFER', I, 1185, 1684),
 # expressions, calls, flow (checker-expressions-calls-flow)
 ('F-UNREACH', C, 2398, 2477),
 ('E-CORE', C, 7419, 7925), ('E-ACCESS', C, 7927, 8064), ('E-LITERAL', C, 8066, 8210), ('E-ACCESS', C, 8212, 8355),
 ('E-CALL', C, 8357, 8832), ('E-DECOR', C, 8833, 8888), ('E-CALL', C, 8889, 9272), ('E-DECOR', C, 9273, 9302), ('E-CALL', C, 9303, 9719),
 ('E-CALL', C, 9739, 10131), ('E-CORE', C, 10133, 10135), ('E-FUNC', C, 10137, 10170), ('D-HELPERS', C, 10171, 10197),
 ('E-FUNC', C, 10198, 10532), ('E-COLLIDE', C, 10534, 10705),
 ('E-CORE', C, 10707, 10892), ('E-OPER', C, 10894, 10934), ('E-AWAIT', C, 10935, 10943), ('E-OPER', C, 10944, 11035), ('E-CORE', C, 11037, 11130),
 ('E-ACCESS', C, 11132, 12376), ('E-CORE', C, 12378, 12420), ('E-OPER', C, 12422, 13233), ('E-LITERAL', C, 13235, 13609),
 ('E-LITERAL', C, 13627, 13822), ('E-ACCESS', C, 13824, 13964), ('E-LITERAL', C, 13966, 13977), ('E-CORE', C, 13979, 13989),
 ('T-RETINFER', C, 20240, 20564), ('T-RETINFER', C, 20649, 20720),
 ('E-ACCESS', C, 27829, 27853), ('E-ACCESS', C, 29187, 29196), ('E-FACTS', C, 29229, 29253),
 ('E-CTX', C, 29466, 29923), ('E-DECOR', C, 29924, 29930), ('E-CTX', C, 29931, 30162), ('E-CALL', C, 30165, 30262), ('E-DECOR', C, 30265, 30672),
 ('E-CTX', C, 30674, 31095), ('E-FACTS', C, 31097, 31347), ('E-AWAIT', C, 31355, 31591),
 ('F-NARROW', C, 31594, 31605), ('F-NARROW', C, 31614, 31692),
 ('F-NARROW', F, 1, 2511), ('F-REACH', F, 2513, 2652), ('F-NARROW', F, 2654, 2764),
 # declarations, grammar, jsx (checker-declarations-grammar-jsx)
 ('D-DRIVER', C, 2202, 2397), ('D-DRIVER', C, 2478, 2545), ('D-JSDOC', C, 2547, 2609), ('D-TYPENODE', C, 2611, 2660), ('D-FUNC', C, 2662, 2988),
 ('D-TYPENODE', C, 2990, 3410), ('D-FUNC', C, 3412, 3791), ('D-STMT', C, 3793, 4284), ('D-CLASS', C, 4286, 5146),
 ('D-ENUMNS', C, 5148, 5342), ('D-IMPEXP', C, 5344, 5852), ('D-VAR', C, 5854, 6110), ('D-DECOR', C, 6112, 6183),
 ('D-ITER', C, 6185, 6824), ('D-IMPEXP', C, 6826, 6964), ('D-TYPENODE', C, 6966, 6998), ('D-IMPEXP', C, 7000, 7090),
 ('D-TYPENODE', C, 7092, 7128), ('D-UNUSED', C, 7130, 7417),
 ('U-ALIASMARK', C, 28312, 28697), ('D-HELPERS', C, 28699, 28807), ('U-ALIASMARK', C, 28809, 29040), ('E-AWAIT', C, 29042, 29123),
 ('Z-SERVICES', C, 31704, 32296),
 # core layers (checker-core-scratch)
 ('TYPES', C, 1, 907), ('C-INIT', C, 908, 1503), ('N-DIAG', C, 1505, 2180), ('N-RESOLVE', C, 2182, 2200), ('N-RESOLVE', C, 13991, 14050),
 ('D-SINK', C, 14052, 14168), ('S-MERGE', C, 14170, 14531), ('A-ALIAS', C, 14533, 15193), ('M-MODULE', C, 15195, 15828),
 ('A-ALIAS', C, 15830, 15861), ('Q-ENTITY', C, 15863, 16012), ('M-MODULE', C, 16014, 16347), ('A-ALIAS', C, 16349, 16493),
 ('T-KEYS', C, 17471, 17775), ('T-RSTACK', C, 18861, 18958), ('K-OBJ', C, 25126, 25394),
]
FILES = {
 'checker/mapper.go': 'MAPPER', 'checker/utilities.go': 'UTIL', 'checker/links.go': 'LINKS', 'checker/types.go': 'TYPES',
 'checker/printer.go': 'P-PRINT', 'checker/nodebuilder.go': 'P-PRINT', 'checker/nodebuilderimpl.go': 'P-PRINT',
 'checker/nodebuilderscopes.go': 'P-PRINT', 'checker/symbolaccessibility.go': 'P-PRINT', 'checker/pseudotypenodebuilder.go': 'P-PRINT',
 'checker/grammarchecks.go': 'G-GRAMMAR', 'checker/jsx.go': 'X-JSX', 'checker/jsdoc.go': 'D-JSDOC', 'checker/services.go': 'Z-SERVICES',
 'checker/emitresolver.go': 'Z-SERVICES', 'checker/exports.go': 'Z-SERVICES', 'binder/nameresolver.go': 'N-RESOLVE',
}
def layer_of(file, line):
    for lay, f, a, b in LAYERS:
        if f == file and a <= line <= b: return lay
    if file in FILES: return FILES[file]
    if file.startswith('checker/'): return 'checker:' + file.split('/')[1]
    return 'pkg:' + file.rsplit('/', 1)[0]
funcs = {}
for ln in open(W + '/funcs.tsv'):
    file, a, b, name = ln.rstrip('\n').split('\t')
    funcs[(file, int(a))] = (int(b) - int(a) + 1, name)
def load(run):
    ent = {}
    for ln in open(f'{W}/cov/{run}.func.txt'):
        m = re.match(r'(\S+):(\d+):\s+(\S+)\s+([\d.]+)%', ln)
        if not m or not m.group(1).startswith(PFX): continue
        pct = float(m.group(4))
        if pct > 0: ent[(m.group(1)[len(PFX):], int(m.group(2)))] = pct
    return ent
RUNS = ['listonly', 'nocheck', 'skiplib', 'skiplib1', 'noemit', 'default']
E = {r: load(r) for r in RUNS}
PH = collections.OrderedDict()
PH['P parse+bind (listFilesOnly)'] = set(E['listonly'])
PH['I checker init (noCheck)'] = set(E['nocheck']) - set(E['listonly'])
sk = set(E['skiplib']) | set(E['skiplib1'])
PH['C check min.ts (skipDefaultLibCheck)'] = sk - set(E['nocheck']) - set(E['listonly'])
PH['L check default libs (noEmit)'] = set(E['noemit']) - sk - set(E['nocheck']) - set(E['listonly'])
PH['E emit (default)'] = set(E['default']) - set(E['noemit']) - sk - set(E['nocheck']) - set(E['listonly'])
def lines(s): return sum(funcs.get(k, (0, ''))[0] for k in s)
def name(k): return funcs.get(k, (0, '?'))[1]
cmd = sys.argv[1] if len(sys.argv) > 1 else 'summary'
if cmd == 'summary':
    for r in RUNS:
        s = set(E[r]); ch = {k for k in s if k[0].startswith('checker/')}; bi = {k for k in s if k[0].startswith('binder/')}
        print(f'{r}\tfunctions {len(s)}\tlines {lines(s)}\tchecker {len(ch)} / {lines(ch)}\tbinder {len(bi)} / {lines(bi)}')
    print()
    for ph, s in PH.items():
        by = collections.Counter(); bl = collections.Counter()
        for k in s:
            p = k[0].rsplit('/', 1)[0]; by[p] += 1; bl[p] += funcs.get(k, (0, ''))[0]
        print(f'{ph}: {len(s)} functions, {lines(s)} lines')
        for p, n in sorted(by.items(), key=lambda x: -bl[x[0]]): print(f'    {p}\t{n}\t{bl[p]}')
elif cmd == 'layers':
    tot = collections.Counter(); totl = collections.Counter()
    for k, (n, nm) in funcs.items():
        if k[0].startswith('checker/') or k[0].startswith('binder/'):
            L = layer_of(*k); tot[L] += 1; totl[L] += n
    rows = collections.OrderedDict()
    for ph, s in PH.items():
        for k in s:
            if not (k[0].startswith('checker/') or k[0].startswith('binder/')): continue
            L = layer_of(*k); rows.setdefault(L, collections.Counter())[ph] += 1
            rows[L][ph + ' lines'] += funcs.get(k, (0, ''))[0]
    print('layer\tfunctions in layer\tlines\t' + '\t'.join(p.split(' ')[0] + ' fn\t' + p.split(' ')[0] + ' ln' for p in PH))
    for L in sorted(tot, key=lambda L: -tot[L]):
        r = rows.get(L, {})
        print(f'{L}\t{tot[L]}\t{totl[L]}\t' + '\t'.join(f"{r.get(p, 0)}\t{r.get(p + ' lines', 0)}" for p in PH))
elif cmd == 'list':
    key = sys.argv[2]
    s = [v for p, v in PH.items() if p.startswith(key)][0]
    only = sys.argv[3] if len(sys.argv) > 3 else ''
    for k in sorted(s):
        if only and not k[0].startswith(only): continue
        pct = max(E[r].get(k, 0) for r in RUNS)
        print(f'{layer_of(*k)}\t{k[0]}:{k[1]}\t{name(k)}\t{funcs.get(k, (0,""))[0]}\t{pct}')
