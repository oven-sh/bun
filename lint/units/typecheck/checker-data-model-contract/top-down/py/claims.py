# Which layer tables of the sibling research units claim each function of checker.go, and who calls the contested ones.
# Input: fns.json of ../../checker-core-scratch/run.sh (default /tmp/k3a/fns.json). usage: claims.py [fns.json]
import json, sys, collections, importlib.util, os
FNS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/k3a/fns.json'
N = os.path.dirname(os.path.abspath(__file__)) + '/../../..'
C = 'checker/checker.go'; R = 'checker/relater.go'
CORE = [('TYPES', C, 1, 907), ('C-INIT', C, 908, 1503), ('N-DIAG', C, 1505, 2180), ('N-RESOLVE', C, 2182, 2200), ('N-RESOLVE', C, 13991, 14050),
 ('D-SINK', C, 14052, 14168), ('S-MERGE', C, 14170, 14531), ('A-ALIAS', C, 14533, 15193), ('M-MODULE', C, 15195, 15828),
 ('A-ALIAS', C, 15830, 15861), ('Q-ENTITY', C, 15863, 16012), ('M-MODULE', C, 16014, 16347), ('A-ALIAS', C, 16349, 16493),
 ('T-KEYS', C, 17471, 17775), ('T-RSTACK', C, 18861, 18958), ('K-OBJ', C, 25126, 25394)]
TYPES = [('K-LIT', C, 25396, 25676), ('K-PRED', C, 26348, 26371), ('K-PRED', C, 26575, 26770), ('K-PRED', C, 27729, 27794), ('K-PRED', C, 27926, 27987),
 ('K-PRED', C, 28278, 28281), ('K-PRED', C, 31607, 31612), ('K-GENERIC', C, 24991, 25074), ('K-UNION', C, 25677, 26146), ('K-UNION', C, 26771, 26802),
 ('K-INTERSECT', C, 26147, 26347), ('K-INTERSECT', C, 26372, 26574), ('T-TUPLE', C, 23410, 23693), ('T-TUPLE', C, 24791, 24804), ('T-TUPLE', C, 24820, 24990),
 ('T-DECLARED', C, 17413, 17470), ('T-DECLARED', C, 23779, 24034), ('T-DECLARED', C, 24040, 24060), ('T-DECLARED', C, 24217, 24224),
 ('T-ENUMVAL', C, 24035, 24039), ('T-ENUMVAL', C, 24061, 24216), ('T-TYPENODE', C, 22913, 23409), ('T-TYPENODE', C, 23694, 23778), ('T-TYPENODE', C, 24225, 24391),
 ('T-TYPENODE', C, 24690, 24697), ('T-CONSTRAINT', C, 17141, 17412), ('T-CONSTRAINT', C, 22047, 22162), ('T-CONSTRAINT', C, 27551, 27728), ('T-CONSTRAINT', C, 29255, 29267),
 ('T-BASE', C, 17030, 17131), ('T-BASE', C, 19281, 19406), ('T-BASE', C, 19612, 19711), ('T-MEMBERS', C, 19176, 19280), ('T-MEMBERS', C, 19712, 19919),
 ('T-MEMBERS', C, 20764, 21007), ('T-MEMBERS', C, 22163, 22213), ('T-UIMEMBERS', C, 21166, 21516), ('T-UIMEMBERS', C, 21528, 21828), ('T-UIMEMBERS', C, 13611, 13626),
 ('T-UIMEMBERS', C, 27795, 27828), ('T-LOOKUP', C, 18960, 19175), ('T-LOOKUP', C, 21517, 21527), ('T-APPARENT', C, 21829, 22006), ('T-SIGDECL', C, 19920, 20239),
 ('T-SIGSHAPE', C, 27855, 27925), ('T-SIGSHAPE', C, 9721, 9738), ('T-SIGSHAPE', C, 29124, 29134), ('T-SIGSHAPE', C, 17132, 17140),
 ('T-SIGINST', C, 19407, 19611), ('T-SIGINST', C, 20722, 20763), ('T-INSTANTIATE', C, 22007, 22046), ('T-INSTANTIATE', C, 22214, 22598), ('T-INSTANTIATE', C, 22632, 22637),
 ('T-INSTANTIATE', C, 22856, 22912), ('T-INSTANTIATE', C, 24602, 24661), ('T-SYMTYPE', C, 16495, 17029), ('T-SYMTYPE', C, 17777, 18468), ('T-SYMTYPE', C, 18617, 18859),
 ('T-SYMTYPE', C, 29198, 29227), ('T-WIDEN', C, 18469, 18616), ('T-WIDEN', C, 20566, 20648), ('T-WIDEN', C, 28282, 28311), ('K-KEYOF', C, 26803, 26944),
 ('K-KEYOF', C, 26957, 27045), ('K-INDEXED', C, 27046, 27516), ('K-INDEXED', C, 28025, 28128), ('K-INDEXED', C, 28152, 28162), ('K-INDEXED', C, 29414, 29448),
 ('K-SUBST', C, 26945, 26956), ('K-SUBST', C, 27517, 27550), ('K-SUBST', C, 25075, 25125), ('K-SUBST', C, 31694, 31702), ('K-COND', C, 24392, 24601),
 ('K-COND', C, 24662, 24689), ('K-COND', C, 22599, 22631), ('K-COND', C, 28129, 28151), ('T-MAPPED', C, 21008, 21165), ('T-MAPPED', C, 22638, 22855),
 ('T-MAPPED', C, 28250, 28277), ('T-MAPPED', C, 29135, 29186), ('K-TEMPLATE', C, 29268, 29413), ('K-IMPORTTYPE', C, 24698, 24790)]
EXPR = [('F-UNREACH', C, 2398, 2477), ('E-CORE', C, 7419, 7925), ('E-ACCESS', C, 7927, 8064), ('E-LITERAL', C, 8066, 8210), ('E-ACCESS', C, 8212, 8355),
 ('E-CALL', C, 8357, 9719), ('E-CALL', C, 9739, 10131), ('E-CORE', C, 10133, 10135), ('E-FUNC', C, 10137, 10532), ('E-CORE', C, 10707, 10892),
 ('E-OPER', C, 10894, 11035), ('E-CORE', C, 11037, 11130), ('E-ACCESS', C, 11132, 12376), ('E-CORE', C, 12378, 12420), ('E-OPER', C, 12422, 13233),
 ('E-LITERAL', C, 13235, 13609), ('E-LITERAL', C, 13627, 13822), ('E-ACCESS', C, 13824, 13964), ('E-LITERAL', C, 13966, 13977), ('E-CORE', C, 13979, 13989),
 ('T-RETINFER', C, 20240, 20564), ('T-RETINFER', C, 20649, 20720), ('E-ACCESS', C, 27829, 27853), ('E-ACCESS', C, 29187, 29196), ('E-FACTS', C, 29229, 29253),
 ('E-CTX', C, 29466, 30162), ('E-CALL', C, 30165, 30262), ('E-CTX', C, 30674, 31095), ('E-FACTS', C, 31097, 31347), ('F-NARROW', C, 31594, 31605), ('F-NARROW', C, 31614, 31692)]
DECL = [('D-DRIVER', C, 2202, 2545), ('D-JSDOC', C, 2547, 2609), ('D-TYPENODE', C, 2611, 2660), ('D-FUNC', C, 2662, 2988), ('D-TYPENODE', C, 2990, 3410),
 ('D-FUNC', C, 3412, 3791), ('D-STMT', C, 3793, 4284), ('D-CLASS', C, 4286, 5146), ('D-ENUMNS', C, 5148, 5342), ('D-IMPEXP', C, 5344, 5852), ('D-VAR', C, 5854, 6110),
 ('D-DECOR', C, 6112, 6183), ('D-ITER', C, 6185, 6824), ('D-IMPEXP', C, 6826, 6964), ('D-TYPENODE', C, 6966, 6998), ('D-IMPEXP', C, 7000, 7090), ('D-TYPENODE', C, 7092, 7128),
 ('D-UNUSED', C, 7130, 7417), ('E-DECOR', C, 8833, 8888), ('E-DECOR', C, 9273, 9302), ('D-HELPERS', C, 10171, 10197), ('E-COLLIDE', C, 10534, 10705),
 ('E-AWAIT', C, 10935, 10943), ('T-JSDECL', C, 18151, 18350), ('U-ALIASMARK', C, 28312, 28697), ('D-HELPERS', C, 28699, 28807), ('U-ALIASMARK', C, 28809, 29040),
 ('E-AWAIT', C, 29042, 29133), ('E-DECOR', C, 29924, 29930), ('E-DECOR', C, 30265, 30672), ('E-AWAIT', C, 31355, 31591), ('Z-SERVICES', C, 31704, 32296)]
REL = [('R-REL', C, 11995, 12037), ('R-REL', C, 13208, 13219), ('R-REL', C, 27988, 28023), ('R-REL', C, 28163, 28248)]
TABLES = [('core', CORE), ('types', TYPES), ('expr', EXPR), ('decl', DECL), ('rel', REL)]
spec = importlib.util.spec_from_file_location('layermap', N + '/drivers-k4-k5/bottom-up/py/layermap.py')
lm = importlib.util.module_from_spec(spec); spec.loader.exec_module(lm)
fns = json.load(open(FNS))
byname = {f['name']: f for f in fns}
callers = collections.defaultdict(set)
for f in fns:
    for c in f.get('callees') or []:
        callers[c].add(f['name'])
def claims(f):
    out = []
    for unit, table in TABLES:
        for lay, fl, a, b in table:
            if fl == f['file'] and a <= f['decl'] <= b: out.append((unit, lay))
    return out
def short(n): return n.replace('checker.Checker.', 'c.').replace('checker.Relater.', 'r.').replace('checker.', '')
def merged(f): return lm.layer_of(f['file'], f['decl'])
double, none = [], []
for f in sorted((f for f in fns if f['file'] == C), key=lambda f: f['decl']):
    cl = claims(f)
    if len(cl) > 1: double.append((f, cl))
    if not cl: none.append(f)
print('# functions of checker.go: %d, claimed twice: %d, claimed by no table: %d' % (sum(1 for f in fns if f['file'] == C), len(double), len(none)))
print('# decl\tend\tfunction\tclaims\tlayermap.py\tcallers by merged layer\tcallees by merged layer')
for f, cl in double:
    cs = collections.Counter(merged(byname[c]) for c in callers[f['name']] if c in byname)
    ce = collections.Counter(merged(byname[c]) for c in (f.get('callees') or []) if c in byname and byname[c]['pkg'] == 'checker')
    print('%d\t%d\t%s\t%s\t%s\t%s\t%s' % (f['decl'], f['end'], short(f['name']), ' | '.join(u + ':' + l for u, l in cl), merged(f),
          ' '.join('%s=%d' % kv for kv in sorted(cs.items())), ' '.join('%s=%d' % kv for kv in sorted(ce.items()))))
print('# claimed by no table (layermap.py gives):')
for f in none:
    print('%d\t%d\t%s\t%s' % (f['decl'], f['end'], short(f['name']), merged(f)))
