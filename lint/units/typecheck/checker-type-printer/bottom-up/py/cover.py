# Joins Go coverage profiles with the function list of goanal and writes one row per family function.
# usage: python3 cover.py <fns.json> <out.tsv> <name>=<cover profile>...
import json,sys,collections,bisect
fns=json.load(open(sys.argv[1]))
out=sys.argv[2]
profiles=[a.split('=',1) for a in sys.argv[3:]]
PFX='github.com/microsoft/typescript-go/internal/'
CHK={'printer.go','nodebuilder.go','nodebuilderimpl.go','nodebuilderscopes.go','nodebuilder_hover.go','nodecopy.go','symbolaccessibility.go','pseudotypenodebuilder.go','symboltracker.go','emitresolver.go'}
PK={'printer','nodebuilder','pseudochecker','modulespecifiers'}
def fam(f):
    pkg=f['pkg']; base=f['file'].split('/')[-1]
    if pkg=='checker' and base in CHK: return True
    return pkg in PK
byfile=collections.defaultdict(list)
for f in fns:
    byfile[f['file']].append(f)
for v in byfile.values():
    v.sort(key=lambda f:f['start'])
def owner(file,line):
    v=byfile.get(file)
    if not v: return None
    i=bisect.bisect_right([f['start'] for f in v],line)-1
    if i<0: return None
    f=v[i]
    return f if line<=f['end'] else None
res={}
for name,path in profiles:
    blocks={}
    for ln in open(path):
        if ln.startswith('mode:'): continue
        loc,n,c=ln.rsplit(' ',2)
        file,rng=loc.rsplit(':',1)
        file=file[len(PFX):] if file.startswith(PFX) else file
        a,b=rng.split(',')
        sl=int(a.split('.')[0]); el=int(b.split('.')[0])
        key=(file,rng)
        prev=blocks.get(key)
        blocks[key]=(sl,el,int(n),max(int(c),prev[3] if prev else 0))
    for (file,rng),(sl,el,n,c) in blocks.items():
        f=owner(file,sl)
        if f is None: continue
        d=res.setdefault(f['id'],{})
        t=d.setdefault(name,[0,0,set(),set()])
        t[0]+=n
        if c>0: t[1]+=n
        for l in range(sl,el+1):
            t[2].add(l)
            if c>0: t[3].add(l)
rows=[]
for f in fns:
    if not fam(f): continue
    d=res.get(f['id'],{})
    row=[f['id'],f['file'],str(f['start']),str(f['end']),str(f['lines']),str(len(f.get('panics',[])))]
    for name,_ in profiles:
        t=d.get(name,[0,0,set(),set()])
        row+= [str(t[0]),str(t[1]),str(len(t[3]))]
    rows.append(row)
hdr=['id','file','start','end','lines','panics']
for name,_ in profiles: hdr+=[name+'_stmts',name+'_covered',name+'_covlines']
with open(out,'w') as o:
    o.write('\t'.join(hdr)+'\n')
    for r in rows: o.write('\t'.join(r)+'\n')
# summary
for i,(name,_) in enumerate(profiles):
    per=collections.OrderedDict()
    for r in rows:
        base=r[1] if not r[1].startswith('checker/') else r[1]
        a=per.setdefault(base,[0,0,0,0,0])
        a[0]+=1; a[1]+=int(r[4])
        cov=int(r[7+3*i])
        if cov>0:
            a[2]+=1; a[3]+=int(r[4]); a[4]+=int(r[8+3*i])
    print('== profile',name)
    tot=[0]*5
    for k,v in per.items():
        print("%-40s fns=%4d lines=%5d | entered fns=%4d their lines=%5d covered lines=%5d"%(k,*v))
        for j in range(5): tot[j]+=v[j]
    print("TOTAL",tot)
