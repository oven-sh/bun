# Lists the panic and assert sites of the printer family with the mark of the enclosing function.
# usage: python3 panics.py <fns.json> <family.tsv> <out.tsv>
import json,sys,csv,re
fns=json.load(open(sys.argv[1]))
byid={f['id']:f for f in fns}
rows=list(csv.DictReader(open(sys.argv[2]),delimiter='\t'))
ROOT='/workspace/ref/typescript-go/internal/'
src={}
def line(file,n):
    if file not in src: src[file]=open(ROOT+file,encoding='utf-8').read().split('\n')
    return src[file][n-1].strip()
out=[]
for r in rows:
    f=byid[r['id']]
    mark='D' if int(r['diag_covered'])>0 else ('E' if int(r['full_covered'])>0 else 'N')
    for p in f.get('panics',[]):
        kind,ln=p.split('@'); ln=int(ln)
        out.append((r['file'],ln,mark,r['id'],kind,line(r['file'],ln)[:160]))
out.sort()
with open(sys.argv[3],'w') as o:
    o.write('file\tline\tmark\tfunction\tkind\ttext\n')
    for x in out: o.write('\t'.join(map(str,x))+'\n')
import collections
c=collections.Counter((x[2]) for x in out)
print(c)
