# Lists what the diagnostics-executed functions of the printer family call outside the family.
# usage: python3 deps.py <fns.json> <family.tsv> <out prefix>
import json,sys,collections,csv
fns=json.load(open(sys.argv[1]))
byid={f['id']:f for f in fns}
rows=list(csv.DictReader(open(sys.argv[2]),delimiter='\t'))
famids={r['id'] for r in rows}
D={r['id'] for r in rows if int(r['diag_covered'])>0}
ext=collections.defaultdict(set)
std=collections.defaultdict(set)
for i in D:
    f=byid[i]
    for c in f.get('calls',[]):
        if c.startswith('iface:'):
            ext[c].add(i); continue
        if c in famids: continue
        ext[c].add(i)
    for s in f.get('std',[]):
        std[s].add(i)
bypkg=collections.defaultdict(list)
for c,callers in ext.items():
    g=byid.get(c)
    pkg=c.split('.')[0] if not c.startswith('iface:') else 'iface'
    bypkg[pkg].append((c,len(callers),g['file'] if g else '',g['start'] if g else 0,g['lines'] if g else 0))
with open(sys.argv[3]+'.external-callees.tsv','w') as o:
    o.write('callee\tpkg\tfile\tstart\tlines\tcallers_in_family\tcallers\n')
    for pkg in sorted(bypkg):
        for c,n,file,start,lines in sorted(bypkg[pkg],key=lambda x:(x[2],x[3])):
            o.write('\t'.join([c,pkg,file,str(start),str(lines),str(n),','.join(sorted(ext[c]))[:300]])+'\n')
with open(sys.argv[3]+'.std-callees.tsv','w') as o:
    for s in sorted(std):
        o.write(s+'\t'+str(len(std[s]))+'\t'+','.join(sorted(std[s]))[:200]+'\n')
for pkg in sorted(bypkg):
    print(pkg,len(bypkg[pkg]))
print('std',len(std))
