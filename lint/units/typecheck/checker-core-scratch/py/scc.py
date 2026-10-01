import sys
sys.setrecursionlimit(100000)
sys.argv = ['x', 'none']
exec(open('/tmp/k3a/py/layers.py').read())
inscope = [f for f in fns if f['layer'] and f['layer'] not in ('UTIL','TYPES','LINKS')]
names = {f['name'] for f in inscope}
# hook edges: NameResolver callbacks wired in createNameResolver
hooks = {
 'binder.NameResolver.lookup': ['checker.Checker.getSymbol', 'checker.Checker.getSuggestionForSymbolNameLookup'],
 'binder.NameResolver.getSymbolOfDeclaration': ['checker.Checker.getSymbolOfDeclaration'],
 'binder.NameResolver.error': ['checker.Checker.error'],
 'binder.NameResolver.Resolve': ['checker.Checker.symbolReferenced','checker.Checker.checkAndReportErrorForInvalidInitializer','checker.Checker.onFailedToResolveSymbol','checker.Checker.onSuccessfullyResolvedSymbol'],
 'binder.NameResolver.useOuterVariableScopeInParameter': ['checker.Checker.getRequiresScopeChangeCache','checker.Checker.setRequiresScopeChangeCache'],
}
graph = {}
for f in inscope:
    es = set(c for c in f['callees'] if c in names)
    for h in hooks.get(f['name'], []):
        es.add(h)
    graph[f['name']] = es
# resolveName / resolveNameForSymbolSuggestion are fields: add edges from users of those fields to Resolve
for f in inscope:
    if 'resolveName' in f['fields'] or 'resolveNameForSymbolSuggestion' in f['fields']:
        if f['name'] != 'checker.NewChecker':
            graph[f['name']].add('binder.NameResolver.Resolve')
    if 'compareSymbols' in f['fields']:
        pass
index = {}; low = {}; st = []; on = set(); out = []; n = [0]
def sc(v):
    index[v] = low[v] = n[0]; n[0] += 1; st.append(v); on.add(v)
    for w in graph.get(v, ()):
        if w not in index:
            sc(w); low[v] = min(low[v], low[w])
        elif w in on:
            low[v] = min(low[v], index[w])
    if low[v] == index[v]:
        comp = []
        while True:
            w = st.pop(); on.discard(w); comp.append(w)
            if w == v: break
        out.append(comp)
for v in graph:
    if v not in index: sc(v)
for comp in sorted(out, key=lambda comp: sorted(comp)):
    if len(comp) > 1 or comp[0] in graph[comp[0]]:
        print(len(comp), ', '.join(sorted(short(x) for x in comp)))
