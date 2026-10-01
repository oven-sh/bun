import os, re, sys, collections
root = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule"
codes = [2590,2799,2800,2456,1164,2452,1061,18056,2478,2477,18055,2474,1066,18033,2565,2651,4109,4110,2526,2314,2707,2315,2313,2751,2506,2507,2735,2508,2509,2310,2312,18031,18032,2577,7023,7024,2589,2700,7032,7033,7008,2502,7006,7019,7031,7011,7010,7005,7018,7022,2464,2540,2514,2493,2339,2536,2538,2537,2542,7015,7053,7052,7054,2615,1141,2694,1339,1340,2862,7051,7039,7025,7055,7012,2576,2551,8026,8027]
best = collections.defaultdict(list)
pat = re.compile(r"error TS(\d+):")
for sub in ["compiler","conformance"]:
    d = os.path.join(root, sub)
    for fn in os.listdir(d):
        if not fn.endswith(".errors.txt"): continue
        if fn.endswith(".diff"): continue
        p = os.path.join(d, fn)
        try:
            s = open(p, encoding="utf-8", errors="replace").read()
        except Exception: continue
        found = set(int(x) for x in pat.findall(s))
        size = len(s)
        allcodes = found
        for c in found:
            if c in codes:
                best[c].append((len(allcodes), size, sub+"/"+fn[:-len(".errors.txt")]))
for c in codes:
    l = sorted(best[c])[:2]
    print(c, len(best[c]), "; ".join(f"{n} ({k} codes,{s}B)" for k,s,n in l))
