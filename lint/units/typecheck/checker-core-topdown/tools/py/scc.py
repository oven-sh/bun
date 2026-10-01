import sys, collections
sys.setrecursionlimit(100000)
import layers
fns = layers.fns; byname = layers.byname
def key(f): return f['key']
graph = collections.defaultdict(set)
for f in fns:
    for c in (f['callees'] or []):
        k = (c['pkg'], c['name'])
        if k in byname:
            graph[key(f)].add(k)
def sccs(nodes, graph):
    index = {}; low = {}; stack = []; on = set(); out = []; counter = [0]
    def strong(v):
        # iterative tarjan
        work = [(v, iter(sorted(graph.get(v, ()))))]
        index[v] = low[v] = counter[0]; counter[0]+=1; stack.append(v); on.add(v)
        while work:
            node, it = work[-1]
            advanced = False
            for w in it:
                if w not in nodes: continue
                if w not in index:
                    index[w] = low[w] = counter[0]; counter[0]+=1; stack.append(w); on.add(w)
                    work.append((w, iter(sorted(graph.get(w, ())))))
                    advanced = True
                    break
                elif w in on:
                    low[node] = min(low[node], index[w])
            if advanced: continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[node])
            if low[node] == index[node]:
                comp = []
                while True:
                    w = stack.pop(); on.discard(w); comp.append(w)
                    if w == node: break
                out.append(comp)
    for v in sorted(nodes):
        if v not in index: strong(v)
    return out
allnodes = set(byname.keys())
comps = sccs(allnodes, graph)
big = max(comps, key=len)
print('total functions', len(allnodes), 'SCCs', len(comps), 'largest SCC size', len(big))
bigset = set(big)
inscope = [f for f in fns if f['layer']]
print('in-scope functions', len(inscope))
# in-scope members of the giant SCC
m = [f for f in inscope if key(f) in bigset]
print('in-scope functions inside the largest SCC:', len(m))
bylayer = collections.defaultdict(list)
for f in m: bylayer[f['layer']].append(f['name'])
for l in bylayer: print('  ', l, len(bylayer[l]), ', '.join(sorted(bylayer[l])))
# other nontrivial SCCs touching in-scope
for comp in comps:
    if comp is big: continue
    if len(comp) > 1 and any(byname[k]['layer'] for k in comp):
        print('small SCC:', [k[1] for k in comp])
# self recursive in scope
print('self-recursive in scope:')
for f in inscope:
    if key(f) in graph[key(f)]:
        print('  ', f['layer'], f['file'].split('/')[-1], f['start'], f['name'])
# cycles restricted to in-scope nodes only
insc = set(key(f) for f in inscope)
comps2 = sccs(insc, graph)
print('cycles inside the in-scope subgraph:')
for comp in comps2:
    if len(comp) > 1:
        print('  ', sorted('%s(%s)' % (k[1], byname[k]['layer']) for k in comp))
