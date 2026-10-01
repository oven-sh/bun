import re, sys, collections
sys.argv = ['x', 'none']
exec(open('/tmp/k3a/py/layers.py').read())
src = open('/workspace/ref/typescript-go/internal/checker/checker.go').read().split('\n')
fields = []
for i in range(585, 905):
    line = src[i]
    m = re.match(r'\t(\w+)\s+(.*?)(\s*//.*)?$', line)
    if not m: continue
    fields.append((i+1, m.group(1), m.group(2).strip()))
# init lines in NewChecker
init = {}
for i in range(908, 1122):
    m = re.match(r'\tc\.(\w+) = (.*)$', src[i])
    if m and m.group(1) not in init:
        init[m.group(1)] = i+1
for i in range(1252, 1300):
    m = re.match(r'\tc\.(\w+) = (.*)$', src[i])
    if m and m.group(1) not in init:
        init[m.group(1)] = i+1
for i in range(1302, 1390):
    m = re.match(r'\tc\.(\w+) = (.*)$', src[i])
    if m and m.group(1) not in init:
        init[m.group(1)] = i+1
use = collections.defaultdict(set)
for f in fns:
    if f['pkg'] != 'checker': continue
    L = f['layer']
    for fld in f['fields']:
        use[fld].add(L if L else '-')
simple = {
 '*Type':'TypeId','*ast.Symbol':'SymbolId','*ast.Node':'NodeId','*Signature':'SignatureId','*IndexInfo':'IndexInfoId',
 '*TypePredicate':'TypePredicateId','*TypeMapper':'TypeMapperId','*ast.FlowNode':'FlowNodeId','bool':'bool','uint32':'u32','int':'isize',
 'string':"Text<'a>",'ast.SymbolTable':'SymbolTableId','ast.NodeFlags':'NodeFlags','ast.ModifierFlags':'ModifierFlags',
 'func() *Type':'Memo<TypeId>','func() *ast.Symbol':'Memo<SymbolId>','func(*Type) bool':'method','TypeComparer':'method',
}
def conv(t):
    if t in simple: return simple[t]
    m = re.match(r'map\[(.*?)\](.*)$', t)
    if m:
        return f"Map<{conv(m.group(1))}, {conv(m.group(2))}>"
    m = re.match(r'\[\](.*)$', t)
    if m:
        return f"Vec<{conv(m.group(1))}>"
    m = re.match(r'core\.LinkStore\[(.*?), (.*)\]$', t)
    if m:
        return f"LinkStore<{conv(m.group(1))}, {m.group(2)}>"
    m = re.match(r'nodeLinkStore\[(.*)\]$', t)
    if m: return f"LinkStore<NodeId, {m.group(1)}>"
    m = re.match(r'symbolArenaLinkStore\[(.*)\]$', t)
    if m: return f"LinkStore<u64, {m.group(1)}>"
    m = re.match(r'collections\.Set\[(.*)\]$', t)
    if m: return f"Set<{conv(m.group(1))}>"
    t2 = t.replace('*ast.SourceFile','NodeId').replace('jsnum.','').replace('core.','').replace('ast.NodeId','NodeId')
    return t2.lstrip('*')
inscope = {'C-INIT','D-SINK','S-MERGE','N-RESOLVE','N-DIAG','A-ALIAS','M-MODULE','Q-ENTITY','T-KEYS','K-OBJ','T-RSTACK','MAPPER','UTIL','LINKS','TYPES'}
mode = sys.argv[1] if len(sys.argv) > 1 else ''
out = []
for ln, name, typ in fields:
    u = sorted(x for x in use.get(name, []) if x in inscope)
    other = '-' in use.get(name, [])
    out.append((ln, name, typ, conv(typ), init.get(name), u, other))
import json
json.dump(out, open('/tmp/k3a/fields.json','w'))
for ln, name, typ, rt, ini, u, other in out:
    print(f"{ln}\t{name}\t{typ}\t{rt}\t{ini or ''}\t{','.join(u)}")
print(len(out))
