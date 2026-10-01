# Node flags, token flags and list facts that the layers read, by function. usage: flags.py <fns.json>
import json, re, sys, collections
src = open('/tmp/cdg/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1])
ROOT = '/workspace/ref/typescript-go/internal/'
lines = {}
def text(f):
    if f['file'] not in lines: lines[f['file']] = open(ROOT + f['file']).read().split('\n')
    return lines[f['file']][f['decl']-1:f['end']]
pats = [
 ('nodeflag', re.compile(r'ast\.NodeFlags([A-Z]\w*)')),
 ('tokenflag', re.compile(r'ast\.TokenFlags([A-Z]\w*)')),
 ('listfact', re.compile(r'\.(HasTrailingComma)\(\)')),
 ('listpos', re.compile(r'(\w+)\.(Pos|End)\(\)')),
 ('scanner', re.compile(r'scanner\.(\w+)\(')),
 ('combined', re.compile(r'(getCombinedNodeFlagsCached|GetCombinedNodeFlags|getCombinedModifierFlagsCached|GetCombinedModifierFlags)\(')),
]
agg = collections.defaultdict(lambda: collections.defaultdict(set))
for f in fns:
    if not f['layer']: continue
    for i, ln in enumerate(text(f)):
        for kind, p in pats:
            if kind == 'listpos': continue
            for m in p.finditer(ln):
                agg[kind][m.group(1)].add((f['layer'], ns['short'](f['name']), f['decl'] + i))
for kind in agg:
    for name in sorted(agg[kind]):
        by = collections.defaultdict(list)
        for L, fn, line in sorted(agg[kind][name], key=lambda x: (ns['ORDER'].index(x[0]), x[2])):
            by[L].append(f"{fn}@{line}")
        for L in by:
            print(f"{kind}\t{name}\t{L}\t{', '.join(by[L])}")
