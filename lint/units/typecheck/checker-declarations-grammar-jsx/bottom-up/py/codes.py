# For every code of the layers: number of upstream error baselines that contain it and the two smallest ones.
# usage: codes.py   (reads data/diags.tsv, writes to stdout)
import os, re, collections
root = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule"
rows = [l.rstrip('\n').split('\t') for l in open('/tmp/cdg/data/diags.tsv')][1:]
layer_of = collections.OrderedDict()
for L, code, category, msg, fns in rows:
    layer_of.setdefault(int(code), []).append(L)
regex = [1005,1161,1369,1499,1500,1501,1502,1503,1504,1505,1506,1507,1508,1509,1510,1511,1512,1513,1514,1515,1516,1517,1518,1519,1520,1521,1522,1523,1524,1525,1526,1527,1528,1529,1530,1531,1532,1533,1534,18062,18063]
for c in regex: layer_of.setdefault(c, []).append('G-GRAMMAR(regex scanner)')
best = collections.defaultdict(list)
pat = re.compile(r"error TS(\d+):")
n = 0
for sub in ["compiler", "conformance"]:
    d = os.path.join(root, sub)
    for fn in os.listdir(d):
        if not fn.endswith(".errors.txt"): continue
        s = open(os.path.join(d, fn), encoding="utf-8", errors="replace").read()
        found = set(int(x) for x in pat.findall(s))
        n += 1
        for c in found:
            if c in layer_of:
                best[c].append((len(found), len(s), sub + "/" + fn[:-len(".errors.txt")]))
print(f"# error baselines read: {n}; columns: code, layers, baselines with the code, two smallest (codes in the file, bytes)")
for c in sorted(layer_of):
    l = sorted(best[c])[:2]
    print(f"{c}\t{','.join(sorted(set(layer_of[c])))}\t{len(best[c])}\t" + "; ".join(f"{nm} ({k} codes,{s}B)" for k, s, nm in l))
