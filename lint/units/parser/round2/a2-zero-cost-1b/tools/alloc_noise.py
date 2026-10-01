import re,sys,collections
def load(path):
    per=collections.Counter(); fn=None
    for line in open(path,errors='replace'):
        c=line[0]
        if c=='f':
            if line.startswith('fn='): fn=line[3:].rstrip('\n')
            continue
        if not c.isdigit(): continue
        p=line.split()
        if len(p)>2: per[fn]+=int(p[2])
    return per
rx=re.compile(r'^_?mi_|mimalloc|AstAlloc|bun_alloc|MimallocArena')
def tot(d): return sum(v for k,v in d.items() if k and rx.search(k))
a=load(sys.argv[1]); b=load(sys.argv[2])
print(f"{sys.argv[3]:34} allocator Bc {tot(a):>12,} -> {tot(b):>12,}  ({tot(b)-tot(a):+,})")
