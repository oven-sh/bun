# The merged layer table (../../drivers-k4-k5/bottom-up/py/layermap.py) with the settlements of this pass put in front: first match wins.
# usage: settled.py [fns.json]      prints the layer of every function that two tables claimed or none did, before and after
import json, sys, os, importlib.util
FNS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/k3a/fns.json'
N = os.path.dirname(os.path.abspath(__file__)) + '/../../..'
spec = importlib.util.spec_from_file_location('layermap', N + '/drivers-k4-k5/bottom-up/py/layermap.py')
lm = importlib.util.module_from_spec(spec); spec.loader.exec_module(lm)
C = lm.C
SETTLED = [
    # called by the relater (propertyRelatedTo, reportRelationError, elaborateElement), every callee is of an earlier layer
    ('R-REL', C, 11995, 12038), ('R-REL', C, 13208, 13219),
    # the prototype property and the symbol constructor test are entered for every class and every variable
    ('T-SYMTYPE', C, 18151, 18162), ('T-SYMTYPE', C, 18346, 18350),
    # getTypeFromTypeNode is getConditionalFlowTypeOfType(getTypeFromTypeNodeWorker(node), node)
    ('T-TYPENODE', C, 25075, 25124),
    # its one caller is getSymbolAtLocation
    ('Z-SERVICES', C, 24805, 24818),
]
def layer_before(f): return lm.layer_of(f['file'], f['decl'])
def layer_after(f):
    for lay, fl, a, b in SETTLED:
        if fl == f['file'] and a <= f['decl'] <= b: return lay
    return layer_before(f)
RANGES = [(2398, 2477), (8833, 8888), (9273, 9302), (10171, 10197), (10935, 10943), (11995, 12038), (13208, 13219), (18151, 18350),
          (29124, 29133), (29924, 29930), (24805, 24818), (25075, 25124)]
fns = json.load(open(FNS))
print('# decl\tend\tfunction\tlayermap.py\tsettled')
moved = 0
for f in sorted((f for f in fns if f['file'] == C), key=lambda f: f['decl']):
    if any(a <= f['decl'] <= b for a, b in RANGES):
        before, after = layer_before(f), layer_after(f)
        moved += before != after
        print('%d\t%d\t%s\t%s\t%s' % (f['decl'], f['end'], f['name'].replace('checker.Checker.', 'c.').replace('checker.', ''), before, after))
print('# functions whose layer changes against layermap.py: %d' % moved)
