# Research probe: the load order of the non-lib files of every instance, recomputed from the reference's own per-file
# lists (reference paths, type references, imports with their resolutions) with the algorithm of filesparser.go
# (collectFiles: sub tasks first, then the file), compared with the program that the reference built.
import json, collections, sys
rows = [json.loads(l) for l in open('/tmp/k4drv/k5/out/manifest.jsonl')]
TS_EXT = ('.ts', '.tsx', '.d.ts', '.mts', '.cts', '.d.mts', '.d.cts', '.json')
def is_js(name): return not name.endswith(TS_EXT)
ok = 0; bad = []; kinds = collections.Counter()
for r in rows:
    o = r['options']
    files = {f['n']: f for f in (r['files'] or [])}
    low = {k.lower(): k for k in files}
    def find(name):
        if name in files: return name
        return low.get(name.lower())
    seen = set(); order = []
    def visit(name, via):
        key = find(name)
        if key is None or key in seen: return
        seen.add(key)
        f = files[key]
        if o['noResolve'] != 2:
            for nm, target in f.get('reflist', []):
                if target: visit(target, 'ref')
            for nm, mode, target, ext in f.get('typelist', []):
                if target: visit(target, 'type')
        res = {}
        for x in f.get('res', []):
            if len(x) > 3: res.setdefault(x[0], x[2])
        if f.get('helpers') and 'tslib' in res: visit(res['tslib'], 'helpers')
        if f.get('jsx') and f['jsx'] in res: visit(res[f['jsx']], 'jsx')
        for text, mode, target, ext, jsdoc, injs in f.get('implist', []):
            if not target or o['noResolve'] == 2: continue
            if is_js(target) and not o['allowJs']: continue
            if not (injs or not jsdoc): continue
            visit(target, 'import')
        order.append(key)
    for root in r['roots'] or []: visit(root, 'root')
    for a in r.get('autotypes', []):
        if a[1]: visit(a[1], 'auto')
    got = [f['n'] for f in (r['files'] or [])]
    if order == got: ok += 1
    else:
        why = 'missing' if set(got) - set(order) else ('extra' if set(order) - set(got) else 'order')
        kinds[why] += 1
        bad.append((r['suite'] + '/' + r['name'], why, [x for x in got if x not in order][:3], [x for x in order if x not in got][:3]))
print('load order recomputed equals the program:', ok, 'of', len(rows), 'differs:', len(bad), dict(kinds))
for b in bad[:40]: print(' ', b)
multi = [r for r in rows if len(r['files'] or []) > 1]
print('instances with more than one non-lib file:', len(multi))
print('instances where a lib file has non-lib inputs (reference path, import):', sum(1 for r in rows if r.get('libfiles')))
print('instances with automatic type directives:', sum(1 for r in rows if r.get('autotypes')), 'resolved:', sum(1 for r in rows if any(a[1] for a in r.get('autotypes', []))))
print('instances with a reference path:', sum(1 for r in rows if any(f.get('reflist') for f in (r['files'] or []))), 'type reference:', sum(1 for r in rows if any(f.get('typelist') for f in (r['files'] or []))), 'reference lib in a non-lib file:', sum(1 for r in rows if any(f.get('liblist') for f in (r['files'] or []))))
