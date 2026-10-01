import sys, collections
sys.path.insert(0,"/tmp/ctl/py")
from layers import *
fs = load_funcs()
where = {}
for f,doc,start,end,name in fs:
    where[name] = (f,start)
def lay(name):
    if name not in where: return "?"
    f,s = where[name]
    return layer_of(f,s)
out = collections.defaultdict(lambda: collections.defaultdict(set))
inn = collections.defaultdict(set)
for ln in open("/tmp/ctl/out/edges.tsv"):
    f,caller,callee,line = ln.rstrip("\n").split("\t")
    lc = layer_of(f,int(line)); le = lay(callee)
    if lc == le or le=="?": continue
    if lc in ORDER and rank(le) > rank(lc):
        out[lc][le].add(callee.replace("(*Checker).",""))
    if le in ORDER and rank(lc) < rank(le):
        inn[le].add(callee.replace("(*Checker).",""))
for l in ORDER:
    print("##", l)
    print("  IN:", ", ".join(sorted(inn[l])) or "-")
    parts=[]
    for tl in sorted(out[l], key=lambda x:(rank(x),x)):
        parts.append(f"{tl}[{', '.join(sorted(out[l][tl]))}]")
    print("  OUT:", "; ".join(parts) or "-")
