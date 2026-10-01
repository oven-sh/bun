# Research probe: functions entered per package and per checker layer, from "go tool covdata func" lists.
# usage: an.py <variant> [<base variant>]     prints counts; writes <variant>.entered.tsv (layer, file, line, name, percent)
import sys, re, collections
sys.path.insert(0, "/workspace/notes/lint/units/typecheck/checker-type-layers-scratch/py")
from layers import layer_of, rank

def load(v):
    out = {}
    for ln in open(f"/tmp/e2e/cov/{v}.func.txt"):
        m = re.match(r'.*typescript-go/(\S+?):(\d+):\s+(\S+)\s+([\d.]+)%', ln)
        if not m:
            continue
        f, line, name, pct = m.group(1), int(m.group(2)), m.group(3), float(m.group(4))
        out[(f, line, name)] = pct
    return out

def pkg_of(f):
    f = f.replace("internal/", "")
    return f.rsplit("/", 1)[0]

v = sys.argv[1]
cur = load(v)
base = load(sys.argv[2]) if len(sys.argv) > 2 else None
tot = collections.Counter()
ent = collections.Counter()
rows = []
for (f, line, name), pct in cur.items():
    p = pkg_of(f)
    tot[p] += 1
    if pct > 0 and (base is None or base.get((f, line, name), 0) == 0):
        ent[p] += 1
        lay = layer_of(f.replace("internal/", ""), line) if p == "checker" else p
        rows.append((lay, f.replace("internal/", ""), line, name, pct))
print(f"# variant {v}" + (f" minus {sys.argv[2]}" if base else "") + f": entered {sum(ent.values())} of {sum(tot.values())} functions")
for p, n in sorted(ent.items(), key=lambda x: -x[1]):
    print(f"{n:5d} / {tot[p]:5d}  {p}")
lay = collections.Counter(r[0] for r in rows if r[1].startswith("checker/"))
print("# checker by layer (sibling layer names, rank order)")
for l, n in sorted(lay.items(), key=lambda x: (rank(x[0]), x[0])):
    print(f"{n:5d}  {l}")
name = v + ("-minus-" + sys.argv[2] if base else "")
with open(f"/tmp/e2e/cov/{name}.entered.tsv", "w") as o:
    for r in sorted(rows, key=lambda r: (0 if r[1].startswith("checker/") else 1, rank(r[0]) if r[1].startswith("checker/") else 0, r[1], r[2])):
        o.write("\t".join(str(x) for x in r) + "\n")
