import os
D=os.environ.get("LEAF_OUT","/tmp/leafuse")
import json,sys,re
decls=json.load(open(D+'/decls.json'))
use=json.load(open(D+'/use_cbe.json'))
plus=json.load(open(D+'/use_dw.json'))
def key(e): return (e['file'],e['name'],e['line'])
u={key(e) for e in use if e['kind'] in('func','method')}
p={key(e) for e in plus if e['kind'] in('func','method')}
root='/workspace/ref/typescript-go/internal/'
src={}
pk=sys.argv[1].split(',')
pat=re.compile(r'\bpanic\(|debug\.(Assert|Fail|AssertNever|FailBadSyntaxKind|AssertIsDefined|Check)\w*\(')
tot=0
for d in sorted(decls,key=lambda d:(d['file'],d['line'])):
    if d['pkg'] not in pk or d['kind'] not in('func','method'): continue
    k=key(d)
    if k not in u and k not in p: continue
    if d['file'] not in src: src[d['file']]=open(root+d['file']).read().split('\n')
    hits=[]
    for i in range(d['line']-1,d['end']):
        l=src[d['file']][i]
        if pat.search(l) and not l.strip().startswith('//'):
            hits.append('%d: %s'%(i+1,l.strip()[:110]))
    if hits:
        tot+=len(hits)
        print('%s %s %d-%d %s'%(d['file'],d['name'],d['line'],d['end'],'' if k in u else '[printer-only]'))
        for h in hits: print('      '+h)
print('total sites',tot)
