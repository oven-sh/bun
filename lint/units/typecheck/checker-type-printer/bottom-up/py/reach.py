# Static reachability inside the printer family from the entry points that the checker's diagnostics call.
# usage: python3 reach.py <fns.json> <out.json>
import json,sys,collections
fns=json.load(open(sys.argv[1]))
CHK={'printer.go','nodebuilder.go','nodebuilderimpl.go','nodebuilderscopes.go','nodebuilder_hover.go','nodecopy.go','symbolaccessibility.go','pseudotypenodebuilder.go','symboltracker.go','emitresolver.go'}
PK={'printer','nodebuilder','pseudochecker','modulespecifiers'}
def fam(f):
    pkg=f['pkg']; base=f['file'].split('/')[-1]
    if pkg=='checker' and base in CHK: return True
    return pkg in PK
byid={f['id']:f for f in fns}
ROOTS=['checker.Checker.typeToStringEx','checker.Checker.symbolToStringEx','checker.Checker.signatureToStringEx','checker.Checker.typePredicateToStringEx',
 'checker.Checker.TypeToString','checker.Checker.typeToString','checker.Checker.symbolToString','checker.Checker.signatureToString','checker.Checker.typePredicateToString','checker.Checker.valueToString']
seen={}
q=collections.deque()
for r in ROOTS:
    assert r in byid, r
    seen[r]=None; q.append(r)
while q:
    x=q.popleft()
    for c in byid[x].get('calls',[]):
        if c.startswith('iface:'): continue
        f=byid.get(c)
        if f is None or not fam(f): continue
        if c not in seen:
            seen[c]=x; q.append(c)
json.dump(seen,open(sys.argv[2],'w'),indent=0)
per=collections.Counter(); lines=collections.Counter()
for k in seen:
    f=byid[k]; per[f['file']]+=1; lines[f['file']]+=f['lines']
for k in sorted(per): print("%-40s %4d fns %6d lines"%(k,per[k],lines[k]))
print('total',len(seen),sum(lines.values()))
