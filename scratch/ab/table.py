import collections, statistics, sys

rows = collections.defaultdict(list)  # (shape, mode, tier, build) -> [per-call]
def load(path, tiers):
    try:
        lines = open(path).read().split("\n")
    except FileNotFoundError:
        return
    for l in lines:
        p = l.split()
        if len(p) != 7:
            continue
        shape, mode, tier, build, rep, n, count = p
        if tier not in tiers:
            continue
        rows[(shape, mode, tier, build)].append(int(count) / int(n))

load("/tmp/ab/results.all.txt", {"llint"})
load("/tmp/ab/results.llint.txt", {"llint"})
load("/tmp/ab/results.jit.txt", {"jit"})
load("/tmp/ab/results.arm.llint.txt", {"llint"})
load("/tmp/ab/results.arm.jit.txt", {"jit"})

def med(key):
    v = rows.get(key)
    if not v:
        return None
    return min(v) if key[2] == "jit" else statistics.median(v)
def spread(key):
    v = rows.get(key)
    return (max(v) - min(v)) if v and len(v) > 1 else 0

labels = [
    ("plain", "raw", "plain object `{ x: 1, y: 2 }`"),
    ("classInstance", "raw", "class instance"),
    ("classInstance", "default", "class instance, default options"),
    ("nullProto", "raw", "null-prototype object"),
    ("mixed", "raw", "24 classes and 8 dictionary-mode objects in turn"),
    ("url", "raw", "URL"),
]
def cell(shape, mode, tier):
    b, f, t = (med((shape, mode, tier, x)) for x in ("base", "pr1", "arm"))
    if t is None and tier == "jit" and "--pick-fallback" in sys.argv:
        t = med((shape, mode, tier, "pick"))
    if b is None or t is None:
        return "(pending)"
    s = f"{b:,.0f} / " + (f"{f:,.0f}" if f is not None else "not run") + f" / {t:,.0f} ({t - b:+,.0f})"
    return s
print("  | value | interpreter (`BUN_JSC_useJIT=0`) | JIT |")
print("  |---|---|---|")
for shape, mode, label in labels:
    print(f"  | {label} | {cell(shape, mode, 'llint')} | {cell(shape, mode, 'jit')} |")
if "-v" in sys.argv:
    for k in sorted(rows):
        print(k, [round(x) for x in rows[k]])
