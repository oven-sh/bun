# Recursion in the layers: membership in call cycles of the whole checker, direct self calls, and recursive local closures.
# usage: recursion.py <fns.json>
import json, sys, re, collections
sys.setrecursionlimit(200000)
src = open('/workspace/notes/lint/units/typecheck/checker-declarations-grammar-jsx/bottom-up/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1]); ORDER = ns['ORDER']
by = {}
for f in fns: by.setdefault(f['name'], f)
graph = {n: set(c for c in f['callees'] if c in by) for n, f in by.items()}
index = {}; low = {}; st = []; on = set(); comps = []; n = [0]
def sc(v):
    # iterative Tarjan
    work = [(v, iter(graph[v]))]
    index[v] = low[v] = n[0]; n[0] += 1; st.append(v); on.add(v)
    while work:
        node, it = work[-1]
        adv = False
        for w in it:
            if w not in index:
                index[w] = low[w] = n[0]; n[0] += 1; st.append(w); on.add(w)
                work.append((w, iter(graph[w]))); adv = True; break
            elif w in on:
                low[node] = min(low[node], index[w])
        if adv: continue
        work.pop()
        if work: low[work[-1][0]] = min(low[work[-1][0]], low[node])
        if low[node] == index[node]:
            comp = []
            while True:
                w = st.pop(); on.discard(w); comp.append(w)
                if w == node: break
            comps.append(comp)
for v in graph:
    if v not in index: sc(v)
comp_of = {}
for c in comps:
    for x in c: comp_of[x] = c
big = max(comps, key=len)
ROOT = '/workspace/ref/typescript-go/internal/'
lines = {}
def text(f):
    if f['file'] not in lines: lines[f['file']] = open(ROOT + f['file']).read().split('\n')
    return lines[f['file']][f['decl']-1:f['end']]
short = lambda x: ns['short'](x).replace('c.', '')
print(f"# the largest call cycle of the checker has {len(big)} functions; a layer function in it can re-enter itself through any of them")
print('layer\tfunction\twhere\tkind')
for L in ORDER:
    if L == 'Z-SERVICES': continue
    for f in sorted([f for f in fns if f['layer'] == L], key=lambda f: (f['file'], f['decl'])):
        kinds = []
        c = comp_of[f['name']]
        if c is big: kinds.append('in the large cycle')
        elif len(c) > 1: kinds.append('cycle with ' + ', '.join(sorted(short(x) for x in c if x != f['name'])))
        if f['name'] in graph[f['name']]: kinds.append('calls itself')
        body = '\n'.join(text(f))
        for m in re.finditer(r'var (\w+) (?:func\([^)]*\)[^\n]*|ast\.Visitor)\n', body):
            v = m.group(1)
            if re.search(r'ForEachChild\(' + v + r'\)|\b' + v + r'\(', body[m.end():]): kinds.append(f'recursive closure {v} over the tree')
        if re.search(r'ForEachChild\((c\.)?' + re.escape(f['name'].split('.')[-1]) + r'\)', body): kinds.append('walks the tree through ForEachChild with itself')
        if kinds: print(f"{L}\t{short(f['name'])}\t{f['file'].split('/')[-1]}:{f['decl']}\t{'; '.join(dict.fromkeys(kinds))}")
