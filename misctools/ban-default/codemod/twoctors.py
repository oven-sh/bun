import sys, json, collections, re
sys.path.insert(0, '/tmp/codemod')
import load
crates, impls, calls, obligs = load.load(['/tmp/oracle-f0/linux', '/tmp/oracle-f0/win', '/tmp/oracle-f0/mac'])
NAMES = ['new', 'init', 'empty']
types = {}
for i in impls:
    a = i.get('adt')
    if a and a.get('workspace'):
        types.setdefault((a['krate'], a['path']), []).append(i)
rows = []
for k, recs in types.items():
    inh = {}
    for i in recs:
        for n in i['adt'].get('inherent', []): inh[n['name']] = n['kind']
    taken = set(inh) | set(load.TRAIT_FN_NAMES.get(k, ()))
    # types that got a generated/renamed fn
    i0 = recs[0]
    is_fn = (i0['derived'] and i0['adt'].get('kind') == 'struct') or (not i0['derived'] and not (i0.get('manual') or {}).get('delegate'))
    if not is_fn: continue
    name = next((n for n in NAMES if n not in taken), None)
    zero = [n for n in ('new', 'init', 'empty', 'default') if inh.get(n) == 'fn/0']
    if name and name != 'new' and zero:
        sp = i0.get('derive_span') if i0['derived'] else i0['impl_span']
        rows.append({'krate': k[0], 'path': k[1], 'name': i0['adt']['name'], 'ctor': name, 'zero_arg_ctors': zero, 'file': (sp or {}).get('file'), 'derived': i0['derived']})
json.dump(rows, open('/tmp/codemod/twoctors.json', 'w'), indent=1)
print(len(rows))
for r in rows: print(f"{r['krate']}{r['path']:60s} got {r['ctor']:6s} already had {r['zero_arg_ctors']}  {'derived' if r['derived'] else 'manual'}  {r['file']}")
