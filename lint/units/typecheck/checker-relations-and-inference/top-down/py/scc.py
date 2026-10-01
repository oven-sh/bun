# Recursion of the seven layers: membership in the strongly connected components of the call graph, and guard candidates.
from unified import *
import sys
sys.setrecursionlimit(100000)
fns = load()
byname = {}
for f in fns: byname.setdefault(f['name'], f)
names = list(byname)
idx = {n: i for i, n in enumerate(names)}
adj = [[idx[c] for c in byname[n]['callees'] if c in idx] for n in names]
def sccs(adj, removed=frozenset()):
    n = len(adj); index = [None]*n; low = [0]*n; on = [False]*n; st = []; out = []; counter = [0]
    for root in range(n):
        if index[root] is not None or root in removed: continue
        work = [(root, 0)]
        index[root] = low[root] = counter[0]; counter[0] += 1; st.append(root); on[root] = True
        while work:
            v, i = work[-1]
            if i < len(adj[v]):
                work[-1] = (v, i+1)
                w = adj[v][i]
                if w in removed: continue
                if index[w] is None:
                    index[w] = low[w] = counter[0]; counter[0] += 1; st.append(w); on[w] = True
                    work.append((w, 0))
                elif on[w]:
                    low[v] = min(low[v], index[w])
            else:
                work.pop()
                if work:
                    u = work[-1][0]; low[u] = min(low[u], low[v])
                if low[v] == index[v]:
                    comp = []
                    while True:
                        w = st.pop(); on[w] = False; comp.append(w)
                        if w == v: break
                    out.append(comp)
    return out
comps = sccs(adj)
big = max(comps, key=len)
bigset = set(big)
print('functions', len(names), 'largest component', len(big))
selfrec = {i for i in range(len(names)) if i in adj[i]}
for L in MINE:
    mine = [i for i, n in enumerate(names) if byname[n]['layer'] == L]
    inside = [i for i in mine if i in bigset]
    print(f"== {L}: {len(inside)} of {len(mine)} inside the largest component")
    print('  outside:', ' '.join(short(names[i]) for i in sorted(mine, key=lambda i:(byname[names[i]]['file'], byname[names[i]]['decl'])) if i not in bigset))
    print('  self recursive:', ' '.join(short(names[i]) for i in mine if i in selfrec))
    small = [c for c in comps if len(c) > 1 and c is not big and any(byname[names[i]]['layer'] == L for i in c)]
    for c in small:
        print('  small component:', ' '.join(short(names[i]) for i in c))
# guard candidates: remove hubs and see which functions of the unit stay on cycles made only of functions of the unit
unit = {i for i, n in enumerate(names) if byname[n]['layer'] in MINE}
sub = [[w for w in adj[v] if w in unit] if v in unit else [] for v in range(len(names))]
def cyc(removed):
    cs = sccs(sub, removed)
    res = [c for c in cs if len(c) > 1 or (c[0] in sub[c[0]])]
    return [c for c in res if all(x in unit for x in c)]
base = cyc(frozenset())
print('cycles inside the unit alone: components', [(len(c)) for c in base])
for c in base:
    print('  ', ' '.join(short(names[i]) for i in sorted(c, key=lambda i:(byname[names[i]]['file'], byname[names[i]]['decl']))))
hubs = ['checker.Relater.isRelatedToEx', 'checker.Checker.inferFromTypes', 'checker.Checker.compareSignaturesRelated', 'checker.Checker.getVariancesWorker', 'checker.Checker.elaborateError', 'checker.Checker.checkTypeRelatedToEx', 'checker.Checker.getInferredType', 'checker.Checker.inferReverseMappedType', 'checker.Checker.getNormalizedType']
rem = frozenset(idx[h] for h in hubs)
left = cyc(rem)
print('after removing hubs', [short(h) for h in hubs])
for c in left:
    print('  left:', ' '.join(short(names[i]) for i in sorted(c, key=lambda i:(byname[names[i]]['file'], byname[names[i]]['decl']))))
