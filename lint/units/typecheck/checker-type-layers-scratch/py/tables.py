import sys, collections
sys.path.insert(0,"/tmp/ctl/py")
from layers import *
fs = load_funcs()
by = collections.defaultdict(list)
for f,doc,start,end,name in fs:
    l = layer_of(f,start)
    by[l].append((f,start,end,doc,name))
def short(n):
    return n.replace("(*Checker).","").replace("(*TupleNormalizer).","TupleNormalizer.").replace("(*WideningContext).","WideningContext.")
tot=0
for l in ORDER + ["PRE:keys","PRE:util","PRE:resolution","PRE:objects","PRE:globals","MID:returns"]:
    items = sorted(by[l], key=lambda x:(x[0],x[1]))
    if l.startswith("PRE") or l.startswith("MID"):
        items = [x for x in items if x[0]=="checker/checker.go" and 16495 <= x[1] <= 29447]
    lines = sum(e-d+1 for f,s,e,d,n in items)
    tot += lines if l in ORDER else 0
    print(f"## {l}: {len(items)} functions, {lines} lines")
    # group contiguous runs
    runs=[]; cur=None
    for f,s,e,d,n in items:
        tag = "R:" if f.endswith("relater.go") else ""
        if cur and cur["f"]==f and d - cur["end"] <= 12:
            cur["end"]=e; cur["names"].append(f"{short(n)}@{s}")
        else:
            cur={"f":f,"start":d,"end":e,"names":[f"{short(n)}@{s}"]}; runs.append(cur)
    for r in runs:
        fn = r["f"].replace("checker/","")
        print(f"  [{fn}:{r['start']}-{r['end']}] " + ", ".join(r["names"]))
print("total", tot)
