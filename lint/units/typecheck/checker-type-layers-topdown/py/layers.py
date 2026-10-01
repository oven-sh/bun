# Layer definitions of the type construction and resolution layers, over the call graph of ../checker-core-scratch/goanal.
import json, os, re, collections
W = os.environ.get('TCL_WORK', '/tmp/tcl')
REF = '/workspace/ref/typescript-go/internal/'
C = 'checker/checker.go'
R = 'checker/relater.go'
fns = json.load(open(W + '/fns.json'))
# Layers of the core units, in the ranges of ../checker-core-scratch/py/layers.py.
CORE = [
 ('MAPPER', 'checker/mapper.go', 1, 99999), ('UTIL', 'checker/utilities.go', 1, 99999),
 ('LINKS', 'checker/links.go', 1, 99999), ('TYPES', 'checker/types.go', 1, 99999),
 ('T-KEYS', C, 17471, 17775), ('K-OBJ', C, 25126, 25394), ('T-RSTACK', C, 18861, 18958),
 ('C-INIT', C, 908, 1503), ('D-SINK', C, 14052, 14168), ('S-MERGE', C, 14170, 14531),
 ('N-RESOLVE', 'binder/nameresolver.go', 1, 99999), ('N-RESOLVE', C, 2182, 2200), ('N-RESOLVE', C, 13991, 14050),
 ('N-DIAG', C, 1505, 2180), ('A-ALIAS', C, 14533, 15193), ('A-ALIAS', C, 15830, 15861), ('A-ALIAS', C, 16349, 16493),
 ('M-MODULE', C, 15195, 15828), ('M-MODULE', C, 16014, 16347), ('Q-ENTITY', C, 15863, 16012),
]
# The 28 layers of this unit: (layer, file, first declaration line, last declaration line).
MINE = [
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
 ('T-SYMTYPE', C, 16495, 17029), ('T-SYMTYPE', C, 17777, 18468), ('T-SYMTYPE', C, 18617, 18859), ('T-SYMTYPE', C, 29198, 29227),
 ('T-WIDEN', C, 18469, 18616), ('T-WIDEN', C, 20566, 20648), ('T-WIDEN', C, 28282, 28311),
 ('K-KEYOF', C, 26803, 26944), ('K-KEYOF', C, 26957, 27045),
 ('K-INDEXED', C, 27046, 27516), ('K-INDEXED', C, 28025, 28128), ('K-INDEXED', C, 28152, 28162), ('K-INDEXED', C, 29414, 29448),
 ('K-SUBST', C, 26945, 26956), ('K-SUBST', C, 27517, 27550), ('K-SUBST', C, 25075, 25125), ('K-SUBST', C, 31694, 31702),
 ('K-COND', C, 24392, 24601), ('K-COND', C, 24662, 24689), ('K-COND', C, 22599, 22631), ('K-COND', C, 28129, 28151),
 ('T-MAPPED', C, 21008, 21165), ('T-MAPPED', C, 22638, 22855), ('T-MAPPED', C, 28250, 28277), ('T-MAPPED', C, 29135, 29186),
 ('K-TEMPLATE', C, 29268, 29413), ('K-TEMPLATE', R, 2354, 2558),
 ('K-IMPORTTYPE', C, 24698, 24790),
]
ORDER = ['K-LIT', 'K-PRED', 'K-GENERIC', 'K-UNION', 'K-INTERSECT', 'T-TUPLE', 'T-DECLARED', 'T-ENUMVAL', 'T-TYPENODE',
         'T-CONSTRAINT', 'T-BASE', 'T-MEMBERS', 'T-UIMEMBERS', 'T-LOOKUP', 'T-APPARENT', 'T-SIGDECL', 'T-SIGSHAPE',
         'T-SIGINST', 'T-INSTANTIATE', 'T-SYMTYPE', 'T-WIDEN', 'K-KEYOF', 'K-INDEXED', 'K-SUBST', 'K-COND', 'T-MAPPED',
         'K-TEMPLATE', 'K-IMPORTTYPE']
# The split of checker.go into files, from ../checker-core-scratch/py/split.py.
SPLIT = []
for m in re.finditer(r"\((\d+), '(\w+)', '([^']*)'\)", open(os.path.dirname(os.path.abspath(__file__)) + '/../../checker-core-scratch/py/split.py').read()):
    SPLIT.append((int(m.group(1)), m.group(2)))
def chunk(file, line):
    if file != C:
        return file[:-3] + '.rs'
    idx = 0; name = None
    for i, (s, n) in enumerate(SPLIT):
        if s <= line: idx = i + 1; name = n
    return 'checker/c%02d_%s.rs' % (idx, name)
def layer_of(f):
    for n, fl, a, b in MINE + CORE:
        if f['file'] == fl and a <= f['decl'] <= b: return n
    return None
byname = {}
for f in fns:
    f['layer'] = layer_of(f)
    f['chunk'] = chunk(f['file'], f['decl'])
    for k in ('callees', 'diags', 'panics', 'asserts', 'maprange', 'symw', 'links', 'fields'):
        if f.get(k) is None: f[k] = []
    byname[f['name']] = f
CORESET = set(n for n, _, _, _ in CORE)
IDX = {L: i for i, L in enumerate(ORDER)}
def short(n): return n.replace('checker.Checker.', 'c.').replace('checker.', '')
def mine(L): return sorted([f for f in fns if f['layer'] == L], key=lambda f: (f['file'], f['decl']))
def codes():
    out = {}
    for l in open(REF + 'diagnostics/diagnostics_generated.go', encoding='utf-8'):
        m = re.match(r'^var (\w+) = &Message\{code: (\d+), category: Category(\w+),', l)
        if m: out[m.group(1)] = (int(m.group(2)), m.group(3))
    return out
_src = {}
def source(file):
    if file not in _src: _src[file] = open(REF + file, encoding='utf-8').read().split('\n')
    return _src[file]
