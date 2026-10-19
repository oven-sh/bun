import sys, json, collections
sys.path.insert(0, '/tmp/codemod')
import load
crates, impls, calls, obligs = load.load(['/tmp/oracle-f0/linux', '/tmp/oracle-f0/win', '/tmp/oracle-f0/mac'])
WRAP = set(json.load(open('/tmp/codemod/overrides.json')).keys())

def keys(tree, out=None, precise=True):
    out = out if out is not None else []
    k = tree['k']
    if k == 'local':
        out.append((tree['krate'], tree['path']))
        if not precise or (tree['krate'] + tree['path']) in WRAP:
            for t in tree.get('targs', []): keys(t, out, precise)
    elif k == 'wrap': keys(tree['inner'], out, precise)
    elif k == 'tuple':
        for t in tree['items']: keys(t, out, precise)
    elif k == 'array': keys(tree['elem'], out, precise)
    elif k == 'extern':
        targs = tree.get('targs', [])
        name = tree['name']
        if not precise:
            for t in targs: keys(t, out, precise)
        elif name == 'HashMap' and len(targs) > 2: keys(targs[2], out, precise)
        elif name == 'HashSet' and len(targs) > 1: keys(targs[1], out, precise)
        elif name == 'EnumMap' and len(targs) > 1: keys(targs[1], out, precise)
        elif name == 'Range' and targs: keys(targs[0], out, precise)
    return out

def live(precise):
    types = {}
    for i in impls:
        a = i.get('adt')
        if a and a.get('workspace'):
            types.setdefault((a['krate'], a['path']), []).append(i)
    refs = collections.defaultdict(set); roots = set()
    for rec in list(calls) + list(obligs):
        ks = keys(rec['init'], precise=precise)
        owner = rec.get('owner_default_impl_of')
        if owner and (owner['krate'], owner['path']) in types:
            refs[(owner['krate'], owner['path'])].update(ks)
        else:
            roots.update(ks)
    for k, recs in types.items():
        for i in recs:
            for f in i.get('fields', []):
                refs[k].update(keys(f['init'], precise=precise))
    seen = set(); stack = [k for k in roots if k in types]
    while stack:
        k = stack.pop()
        if k in seen: continue
        seen.add(k); stack.extend(r for r in refs[k] if r in types and r not in seen)
    return seen, types

coarse, types = live(False)
fine, _ = live(True)
extra = sorted(coarse - fine)
print('coarse live', len(coarse), 'precise live', len(fine), 'over-approximated', len(extra))
rows = []
for k in extra:
    i = types[k][0]
    a = i['adt']
    kind = 'derived-' + a.get('kind', '?') if i['derived'] else 'manual'
    sp = i.get('derive_span') if i['derived'] else i['impl_span']
    rows.append({'krate': k[0], 'path': k[1], 'name': a['name'], 'kind': kind, 'file': (sp or {}).get('file'), 'vis': a.get('vis')})
json.dump(rows, open('/tmp/codemod/overlive.json', 'w'), indent=1)
c = collections.Counter((r['kind'], r['vis']) for r in rows)
print(c)
for r in rows[:25]: print(r)
