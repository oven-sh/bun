import collections, layers
fns = layers.fns; byname = layers.byname
inscope = set(k for k,f in byname.items() if f['layer'])
# all stand-in candidates = out-of-scope checker/binder callees of in-scope functions
cands = collections.defaultdict(set)
for f in fns:
    if not f['layer']: continue
    for c in (f['callees'] or []):
        k = (c['pkg'], c['name'])
        t = byname.get(k)
        if t and not t['layer'] and c['pkg']=='checker':
            cands[k].add(f['layer'])
def out_callees(k):
    f = byname[k]
    res = []
    for c in (f['callees'] or []):
        kk = (c['pkg'], c['name'])
        t = byname.get(kk)
        if t and not t['layer'] and c['pkg'] in ('checker',) and kk != k:
            res.append(kk[1])
    return res
print('%d distinct out-of-scope callees' % len(cands))
for k in sorted(cands, key=lambda k:(byname[k]['file'], byname[k]['start'])):
    f = byname[k]
    oc = out_callees(k)
    fields = ''
    print('%s:%d-%d\t%s\t%s\t%s' % (f['file'].split('/')[-1], f['start'], f['end'], k[1], ','.join(sorted(cands[k])), ('LEAF' if not oc else 'needs: ' + ', '.join(sorted(set(oc))[:8]) + (' ...' if len(set(oc))>8 else ''))))
