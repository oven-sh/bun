# Picks, for each class of argument text, the smallest error baselines of the submodule whose hardest argument
# is of that class, and writes one regular expression of case names per class.
# usage: python3 stages.py <texts dir> <out file> [cases per class, default 4]
import sys,os,csv,collections,re
R='/workspace/ref/typescript-go/'
d=sys.argv[1]; out=sys.argv[2]; n=int(sys.argv[3]) if len(sys.argv)>3 else 4
rows=list(csv.DictReader(open(d+'/baseline-hardest-class.tsv'),delimiter='\t'))
per=collections.defaultdict(list)
for r in rows:
    b=r['baseline']
    if '(' in b: continue
    name=b[:-len('.errors.txt')]
    src=None
    for sub in ('compiler','conformance'):
        p=R+'testdata/baselines/reference/submodule/'+sub+'/'+b
        if os.path.exists(p):
            for ext in ('.ts','.tsx'):
                for root,_,files in os.walk(R+'_submodules/TypeScript/tests/cases/'+sub):
                    if name+ext in files:
                        src=os.path.join(root,name+ext); break
                if src: break
            if src:
                txt=open(src,encoding='utf-8',errors='replace').read()
                if re.search(r'@filename|@declaration|@incremental|@composite|@lib|@module|@jsx|@allowjs|@checkjs',txt,re.I): src=None; continue
                per[r['hardest class']].append((os.path.getsize(p),os.path.basename(src)))
            break
with open(out,'w') as o:
    for c in sorted(per):
        per[c].sort()
        names=[x[1] for x in per[c][:n]]
        o.write(c+'\t^('+'|'.join(re.escape(x) for x in names)+')$\t'+' '.join(names)+'\n')
        print(c,names)
