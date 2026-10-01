import os
D=os.environ.get("LEAF_OUT","/tmp/leafuse")
import json,sys
decls=json.load(open(D+'/decls.json'))
use=json.load(open(D+'/use_cbe.json'))
plus=json.load(open(D+'/use_dw.json'))
f=sys.argv[1]
mode=sys.argv[2] if len(sys.argv)>2 else 'all'
def key(e): return (e['file'],e['name'],e['line'])
u={key(e):e for e in use if e['kind'] in('func','method')}
p={key(e):e for e in plus if e['kind'] in('func','method')}
rows=[d for d in decls if d['file']==f and d['kind'] in('func','method')]
rows.sort(key=lambda d:d['line'])
n_in=0;n_out=0;lines_in=0;lines_out=0
for d in rows:
    k=key(d)
    tag='-'
    if k in u:
        e=u[k]
        if e['direct']:
            tag=''.join(sorted(x[0].upper() for x in e['directBy']))
        else: tag='t'
    elif k in p:
        e=p[k]
        tag='P' if e['direct'] else 'pt'
    L=d['end']-d['line']+1
    if tag in('-',): n_out+=1; lines_out+=L
    else: n_in+=1; lines_in+=L
    pn=' !panic%d'%d['panics'] if d.get('panics') else ''
    if mode=='all' or (mode=='out' and tag=='-') or (mode=='in' and tag!='-') or (mode=='panic' and d.get('panics')):
        print('%s %d-%d [%s]%s'%(d['name'],d['line'],d['end'],tag,pn))
print('# in closure: %d funcs %d lines; not in closure: %d funcs %d lines'%(n_in,lines_in,n_out,lines_out))
