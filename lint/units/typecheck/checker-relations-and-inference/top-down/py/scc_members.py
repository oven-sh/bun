# Names of the functions inside the largest strongly connected component of the call graph.
import sys
def members(fns):
    byname = {}
    for f in fns: byname.setdefault(f['name'], f)
    names = list(byname); idx = {n: i for i, n in enumerate(names)}
    adj = [[idx[c] for c in byname[n]['callees'] if c in idx] for n in names]
    n = len(adj); index = [None]*n; low = [0]*n; on = [False]*n; st = []; out = []; counter = 0
    for root in range(n):
        if index[root] is not None: continue
        work = [(root, 0)]; index[root] = low[root] = counter; counter += 1; st.append(root); on[root] = True
        while work:
            v, i = work[-1]
            if i < len(adj[v]):
                work[-1] = (v, i+1); w = adj[v][i]
                if index[w] is None:
                    index[w] = low[w] = counter; counter += 1; st.append(w); on[w] = True; work.append((w, 0))
                elif on[w]: low[v] = min(low[v], index[w])
            else:
                work.pop()
                if work: u = work[-1][0]; low[u] = min(low[u], low[v])
                if low[v] == index[v]:
                    comp = []
                    while True:
                        w = st.pop(); on[w] = False; comp.append(w)
                        if w == v: break
                    out.append(comp)
    big = max(out, key=len)
    return {names[i] for i in big}
