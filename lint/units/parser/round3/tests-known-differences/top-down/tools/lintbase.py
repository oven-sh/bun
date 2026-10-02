# Index: source -> what the lint parse of be1ebe5295 did with it (ts, tsx), from the baseline files of round 2.
import json, gzip, sys
ND='/workspace/notes/lint/units/parser'
B=ND+'/round2/lint-parse-differential/bottom-up/results/baseline'
def expand(corpus):
    out=[]
    for f in corpus['forms']:
        for ctx,tpl in corpus['contexts'].items():
            out.append(tpl.replace('%T%', f['t'],1) if False else tpl.replace('%T%', f['t']))
    for s in corpus['sources']: out.append(s['src'])
    return out
def load(name, corpus_path):
    srcs=expand(json.load(open(corpus_path)))
    res={}
    with gzip.open(f'{B}/lint.{name}.be1ebe5295.tsv.gz','rt') as f:
        for line in f:
            parts=line.rstrip('\n').split('\t')
            idx,dial=parts[0].split('.')
            res[(int(idx),dial)]=parts[1:]
    return srcs,res
index={}
for name,path in [('small',ND+'/grammar-diff/corpus.small.json'),('targeted',ND+'/grammar-diff/corpus.targeted.json'),('targeted09',B+'/corpus.targeted09.json')]:
    srcs,res=load(name,path)
    n=0
    for i,s in enumerate(srcs):
        for d in ('ts','tsx'):
            r=res.get((i,d))
            if r is not None:
                index.setdefault(s,{})[d]=r; n+=1
    print(name,len(srcs),'sources',n,'records',file=sys.stderr)
json.dump(index,open('/tmp/r4/lintbase.index.json','w'))
print(len(index),'distinct sources',file=sys.stderr)
