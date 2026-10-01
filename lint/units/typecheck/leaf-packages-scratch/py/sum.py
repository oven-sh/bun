import json,sys,collections
d=json.load(open(sys.argv[1]))
by=collections.defaultdict(lambda: collections.Counter())
for e in d:
    k=(e['pkg'],e['kind'])
    by[k]['all']+=1
    if e['direct']>0: by[k]['direct']+=1
    else: by[k]['trans']+=1
pk=sorted(set(k[0] for k in by))
for p in pk:
    print(p)
    for k in sorted(by):
        if k[0]==p:
            print('   %-8s all=%4d direct=%4d transitive-only=%4d'%(k[1],by[k]['all'],by[k]['direct'],by[k]['trans']))
# names directly used per package (any kind), unique names
for p in pk:
    names=set(e['name'] for e in d if e['pkg']==p and e['direct']>0)
    print(p,'direct unique names',len(names))
