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
dep = collections.defaultdict(set)
for ln in open("/tmp/ctl/out/edges.tsv"):
    f,caller,callee,line = ln.rstrip("\n").split("\t")
    lc = layer_of(f,int(line))
    le = lay(callee)
    if lc in ORDER and le.startswith("PRE"):
        dep[le].add(callee.replace("(*Checker).",""))
for k in sorted(dep):
    print(k, len(dep[k]), ":", ", ".join(sorted(dep[k])))
print()
ext = collections.defaultdict(set)
for ln in open("/tmp/ctl/out/extcalls.tsv"):
    f,caller,callee,line = ln.rstrip("\n").split("\t")
    lc = layer_of(f,int(line))
    if lc in ORDER:
        pkg = callee.split(".")[0]
        ext[pkg].add(callee[len(pkg)+1:])
for k in sorted(ext):
    print("EXT", k, len(ext[k]), ":", ", ".join(sorted(ext[k])))
