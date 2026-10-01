# Counts the functions and body lines of the type printer family per file.
# usage: python3 count.py <fns.json>
import json,sys,collections
fns=json.load(open(sys.argv[1]))
CHK={'printer.go','nodebuilder.go','nodebuilderimpl.go','nodebuilderscopes.go','nodebuilder_hover.go','nodecopy.go','symbolaccessibility.go','pseudotypenodebuilder.go','symboltracker.go'}
PK={'printer','nodebuilder','pseudochecker','modulespecifiers'}
def fam(f):
    pkg=f['pkg']; base=f['file'].split('/')[-1]
    if pkg=='checker' and base in CHK: return 'checker/'+base
    if pkg in PK: return f['file']
    return None
per=collections.OrderedDict()
for f in fns:
    k=fam(f)
    if not k: continue
    a=per.setdefault(k,[0,0,0])
    a[0]+=1; a[1]+=f['lines']; a[2]+=len(f.get('panics',[]))
tot=[0,0,0]; totc=[0,0,0]
for k,v in per.items():
    print("%-45s fns=%4d lines=%5d panics=%3d"%(k,*v))
    for i in range(3):
        tot[i]+=v[i]
        if k.startswith('checker/'): totc[i]+=v[i]
print("checker files total",totc)
print("family total",tot)
