#!/usr/bin/env python3
"""selfcheck.py x.out: Discard and DecoratorMetadata must end at the same token with the same errors."""
import sys, re, collections
cur=None; d={}; bad=0; n=0
for line in open(sys.argv[1], encoding="utf8", errors="replace"):
    line=line.rstrip("\n")
    if line.startswith("## "): cur=line[3:]; d={}
    elif line.startswith("  "):
        mode=line[2:4]; m=re.match(r"(\S+) @(\d+) (\w+) E(\d+)", line[5:])
        d[mode]=m.groups() if m else line[5:]
        if mode=="R-":
            n+=1
            for a,b in (("t+","T+"),("t-","T-"),("r+","R+"),("r-","R-")):
                if d.get(a)!=d.get(b):
                    bad+=1
                    if bad<=8: print("MISMATCH", repr(cur), a, d.get(a), b, d.get(b))
print(sys.argv[1], "forms", n, "mismatches", bad)
