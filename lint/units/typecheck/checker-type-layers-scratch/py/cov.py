import sys, re, collections
sys.path.insert(0,"/tmp/ctl/py")
from layers import *
# covdata func lines: path:line:\tname\tpercent
fs = load_funcs()
byloc = {}
for f,doc,start,end,name in fs:
    byloc[(f,start)] = name
entered = collections.defaultdict(list)
tot = collections.Counter()
for ln in open(sys.argv[1]):
    m = re.match(r'.*/internal/(\S+?):(\d+):\s+(\S+)\s+([\d.]+)%', ln)
    if not m: continue
    f,line,name,pct = m.group(1), int(m.group(2)), m.group(3), float(m.group(4))
    l = layer_of(f,line)
    tot[l]+=1
    if pct > 0:
        entered[l].append((line,name,pct))
mode = sys.argv[2] if len(sys.argv)>2 else "mine"
for l in (ORDER if mode=="mine" else sorted(tot)):
    e = sorted(entered[l])
    print(f"## {l}: entered {len(e)}/{tot[l]}: " + ", ".join(f"{n}" for _,n,_ in e))
