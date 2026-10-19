import json, glob, collections, os, sys

TRAIT_FN_NAMES = {}

def load(dirs=('/tmp/oracle-out',)):
    impls = {}; calls = {}; obligs = {}; crates = []
    global TRAIT_FN_NAMES
    TRAIT_FN_NAMES = {}
    for d in dirs:
        for p in sorted(glob.glob(os.path.join(d, '*.jsonl'))):
            for line in open(p):
                r = json.loads(line)
                k = r['rec']
                if k == 'crate':
                    crates.append(r); continue
                if k == 'traitfn':
                    a = r['adt']
                    TRAIT_FN_NAMES.setdefault((a['krate'], a['path']), set()).add(r['name'])
                    continue
                if k == 'impl':
                    sp = r['impl_span']
                    key = (sp.get('file'), sp.get('lo'), sp.get('hi'), r['self_ty'])
                    prev = impls.get(key)
                    if prev is None:
                        impls[key] = r
                    else:
                        # the same impl seen for another target: another cfg can add inherent items and fields
                        pa, ra = prev.get('adt') or {}, r.get('adt') or {}
                        have = {n['name'] for n in pa.get('inherent', [])}
                        for n in ra.get('inherent', []):
                            if n['name'] not in have:
                                pa.setdefault('inherent', []).append(n); have.add(n['name'])
                        if 'fields' in prev and 'fields' in r:
                            names = {f['name'] for f in prev['fields']}
                            extra = [f for f in r['fields'] if f['name'] not in names]
                            if extra:
                                prev['fields'].extend(extra)
                                prev['fields'].sort(key=lambda f: (f.get('ty_span') or {}).get('lo', 0))
                elif k == 'call':
                    sp = r['span']
                    key = (sp.get('file'), sp.get('lo'), sp.get('hi'), r['ty'])
                    calls.setdefault(key, r)
                elif k == 'oblig':
                    sp = r['span']
                    key = (sp.get('file'), sp.get('lo'), sp.get('hi'), r['callee'], r['ty'], r.get('param'))
                    obligs.setdefault(key, r)
    return crates, list(impls.values()), list(calls.values()), list(obligs.values())

def tree_kinds(t, acc=None):
    acc = acc if acc is not None else []
    k = t['k']
    acc.append(t)
    if k == 'wrap': tree_kinds(t['inner'], acc)
    elif k == 'tuple':
        for i in t['items']: tree_kinds(i, acc)
    elif k == 'array': tree_kinds(t['elem'], acc)
    elif k == 'local':
        for i in t.get('targs', []): tree_kinds(i, acc)
    return acc

def all_nodes(t, acc=None):
    """Like tree_kinds, and also walks into the type arguments of foreign types."""
    acc = acc if acc is not None else []
    acc.append(t)
    k = t['k']
    if k == 'wrap': all_nodes(t['inner'], acc)
    elif k == 'tuple':
        for i in t['items']: all_nodes(i, acc)
    elif k == 'array': all_nodes(t['elem'], acc)
    elif k in ('local', 'extern'):
        for i in t.get('targs', []): all_nodes(i, acc)
    return acc

if __name__ == '__main__':
    crates, impls, calls, obligs = load()
    print('crate records', len(crates), 'impls', len(impls), 'calls', len(calls), 'obligs', len(obligs))
    c = collections.Counter()
    for i in impls:
        adt = i.get('adt') or {}
        kind = 'derived' if i['derived'] else 'manual'
        if i.get('non_adt'): kind += '-nonadt'
        else: kind += '-' + adt.get('kind', '?')
        if i['impl_span'].get('exp') and not i['derived']: kind += '-inmacro'
        if not i['derived'] and i.get('manual', {}).get('delegate'): kind += '-delegate:' + i['manual']['delegate_kind']
        if i.get('default_bounds'): kind += '-bounded'
        if i.get('derive_span', {}).get('exp'): kind += '-derive-in-macro'
        c[kind] += 1
    print('--- impls'); [print(f'  {v:5d} {k}') for k, v in c.most_common()]
    c = collections.Counter(); mc = collections.Counter()
    for x in calls:
        t = x['init']
        form = x['form'] + ('' if x['is_call'] else '-value') + ('-update' if x.get('update') else '') + ('-EXP' if x['span'].get('exp') else '')
        c[(form, t['k'])] += 1
        for n in tree_kinds(t):
            if n['k'] == 'manual': mc[n['why'][:70]] += 1
            if n['k'] == 'extern': mc['extern ' + n['krate'] + '::' + n['name']] += 1
            if n['k'] == 'local' and not n.get('site_ok', True) and x['form'] == 'bare' and not x.get('update'): mc['UNSURE-PATH'] += 1
    print('--- calls by form/kind'); [print(f'  {v:5d} {k}') for k, v in c.most_common()]
    print('--- call manual reasons'); [print(f'  {v:5d} {k}') for k, v in mc.most_common(60)]
    c = collections.Counter(); mc = collections.Counter()
    for x in obligs:
        ks = {n['k'] for n in tree_kinds(x['init'])}
        cat = 'local' if 'local' in ks else ('manual' if 'manual' in ks else 'std-only')
        c[(x['callee_name'], x['form'], cat, 'ws-callee' if x['callee_workspace'] else 'ext', 'EXP' if x['span'].get('exp') else '')] += 1
        for n in tree_kinds(x['init']):
            if n['k'] == 'manual': mc[n['why'][:70]] += 1
    print('--- obligations'); [print(f'  {v:5d} {k}') for k, v in c.most_common(80)]
    print('--- oblig manual reasons'); [print(f'  {v:5d} {k}') for k, v in mc.most_common(40)]
