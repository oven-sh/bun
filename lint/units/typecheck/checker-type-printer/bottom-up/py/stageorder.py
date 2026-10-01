# From the per-class coverage profiles, prints which family functions each class executes first (a work order).
# usage: python3 stageorder.py <fns.json> <stages dir> <class>...   (classes in the order of the plan)
import json,sys,collections,bisect,os
fns=json.load(open(sys.argv[1])); d=sys.argv[2]; classes=sys.argv[3:]
PFX='github.com/microsoft/typescript-go/internal/'
CHK={'printer.go','nodebuilder.go','nodebuilderimpl.go','nodebuilderscopes.go','nodebuilder_hover.go','nodecopy.go','symbolaccessibility.go','pseudotypenodebuilder.go','symboltracker.go','emitresolver.go'}
PK={'printer','nodebuilder','pseudochecker','modulespecifiers'}
def fam(f):
    pkg=f['pkg']; base=f['file'].split('/')[-1]
    return (pkg=='checker' and base in CHK) or pkg in PK
byfile=collections.defaultdict(list)
for f in fns:
    if fam(f): byfile[f['file']].append(f)
for v in byfile.values(): v.sort(key=lambda f:f['start'])
starts={k:[f['start'] for f in v] for k,v in byfile.items()}
def entered(path):
    res={}
    for ln in open(path):
        if ln.startswith('mode:'): continue
        loc,n,c=ln.rsplit(' ',2)
        if int(c)==0: continue
        file,rng=loc.rsplit(':',1)
        file=file[len(PFX):] if file.startswith(PFX) else file
        v=byfile.get(file)
        if not v: continue
        sl=int(rng.split(',')[0].split('.')[0])
        i=bisect.bisect_right(starts[file],sl)-1
        if i>=0 and sl<=v[i]['end']: res[v[i]['id']]=v[i]
    return res
seen={}
for c in classes:
    p=d+'/'+c+'.out'
    if not os.path.exists(p): continue
    e=entered(p)
    new=[f for i,f in e.items() if i not in seen]
    for f in new: seen[f['id']]=c
    new.sort(key=lambda f:(f['file'],f['start']))
    print("## %s: executes %d family functions, %d of them new (%d lines)"%(c,len(e),len(new),sum(f['lines'] for f in new)))
    per=collections.OrderedDict()
    for f in new:
        name=f['id'].split('.',1)[1]
        for pfx in ('NodeBuilderImpl.','Printer.','EmitContext.','PseudoChecker.'):
            if name.startswith(pfx): name=name[len(pfx):]
        if name.startswith('Checker.'): name='c.'+name[8:]
        per.setdefault(f['file'],[]).append(name)
    for k,v in per.items(): print('  '+k+': '+' '.join(v))
print('total',len(seen))
