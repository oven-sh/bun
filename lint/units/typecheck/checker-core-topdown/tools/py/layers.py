import json, sys, collections
fns = json.load(open('/tmp/tcres/fns.json'))
# layer definitions: (layer, file, start, end)
L = [
 ('TYPES','checker/types.go',1,99999),
 ('LINKS','checker/links.go',1,99999),
 ('MAPPER','checker/mapper.go',1,99999),
 ('UTIL','checker/utilities.go',1,99999),
 ('C-INIT','checker/checker.go',908,1503),
 ('N-DIAG','checker/checker.go',1505,2180),
 ('N-RESOLVE','checker/checker.go',2182,2200),
 ('N-RESOLVE','checker/checker.go',13991,14050),
 ('D-SINK','checker/checker.go',14052,14168),
 ('S-MERGE','checker/checker.go',14170,14531),
 ('A-ALIAS','checker/checker.go',14533,15193),
 ('M-MODULE','checker/checker.go',15195,15828),
 ('A-ALIAS','checker/checker.go',15830,15861),
 ('Q-ENTITY','checker/checker.go',15863,16012),
 ('M-MODULE','checker/checker.go',16014,16347),
 ('A-ALIAS','checker/checker.go',16349,16493),
 ('T-KEYS','checker/checker.go',17471,17775),
 ('T-RSTACK','checker/checker.go',18861,18958),
 ('K-OBJ','checker/checker.go',25126,25394),
 ('N-RESOLVE','binder/nameresolver.go',1,99999),
]
def layer_of(file, line):
    for (l,f,s,e) in L:
        if f==file and s<=line<=e:
            return l
    return None
byname = {}
for f in fns:
    key = (f['pkg'], (f['recv'].lstrip('*').split('[')[0]+'.' if f['recv'] else '')+f['name'])
    f['key']=key
    f['layer']=layer_of(f['file'], f['start'] if f['file']!='checker/checker.go' else f['end'])
    byname[key]=f
json.dump({'%s.%s'%k: v['layer'] for k,v in byname.items()}, open('/tmp/tcres/layer_of.json','w'))
if __name__=='__main__':
    mode = sys.argv[1]
    if mode=='summary':
        cnt = collections.Counter(); lines=collections.Counter()
        for f in fns:
            if f['layer']:
                cnt[f['layer']]+=1; lines[f['layer']]+=f['end']-f['start']+1
        for k in cnt: print(k, cnt[k], lines[k])
    if mode=='list':
        lay = sys.argv[2]
        for f in sorted([f for f in fns if f['layer']==lay], key=lambda f:(f['file'],f['start'])):
            print('%s:%d-%d\t%d\t%s%s'%(f['file'].split('/')[-1], f['start'], f['end'], f['end']-f['start']+1, (f['recv']+'.' if f['recv'] else ''), f['name']))
    if mode=='standins':
        # callees in checker/binder pkg that are not in any layer, per calling layer
        lay = sys.argv[2]
        out = collections.defaultdict(list)
        for f in fns:
            if f['layer']!=lay: continue
            for c in (f['callees'] or []):
                if c['pkg'] in ('checker','binder'):
                    t = byname.get((c['pkg'], c['name']))
                    tl = t['layer'] if t else None
                    if t is None:
                        out[('?',c['pkg']+'.'+c['name'], c.get('file',''), c.get('line',0))].append(f['name'])
                    elif tl is None:
                        out[('OUT',c['pkg']+'.'+c['name'], t['file'], t['start'])].append(f['name'])
        for k in sorted(out, key=lambda k:(k[2],k[3])):
            print('%s\t%s\t%s:%d\t<- %s'%(k[0],k[1],k[2],k[3], ', '.join(sorted(set(out[k])))))
    if mode=='external':
        lay = sys.argv[2]
        out = collections.defaultdict(set)
        for f in fns:
            if f['layer']!=lay: continue
            for c in (f['callees'] or []):
                if c['pkg'] not in ('checker',) and not (c['pkg']=='binder' and byname.get(('binder',c['name']),{}).get('layer')):
                    out[c['pkg']].add(c['name'])
        for k in sorted(out):
            print(k+': '+', '.join(sorted(out[k])))
    if mode in ('panics','asserts','diags','program','tracer','symwrite','maprange','defers','casts'):
        lay = sys.argv[2]
        for f in sorted([f for f in fns if (f['layer']==lay or lay=='ALL' and f['layer'] or lay=='EVERY')], key=lambda f:(f['file'],f['start'])):
            for s in f.get(mode,[]) or []:
                print('%s:%d\t%s\t%s\t%s\t%s'%(f['file'].split('/')[-1], s['line'], f['layer'], f['name'], s.get('kind',''), s['text']))
