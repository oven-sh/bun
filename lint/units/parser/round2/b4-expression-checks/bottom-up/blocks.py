#!/usr/bin/env python3
# usage: blocks.py <head .s> <proto .s>   (outputs of disfn.py)
# Splits each function into basic blocks (a label starts one; a jump or a return ends one), reduces a block to its sequence of
# mnemonics, and compares the two multisets: blocks only in head, blocks only in the prototype.
import sys, collections, re
def blocks(path):
    out = []; cur = []
    for line in open(path):
        line = line.rstrip("\n")
        if line.endswith(":") and not line.startswith("\t"):
            if cur: out.append(tuple(cur)); cur = []
            continue
        text = line.strip()
        if not text: continue
        mnem = text.split()[0]
        if mnem.startswith("call"):
            mnem = "call " + (text.split("-> ")[1] if "-> " in text else "?")
        cur.append(mnem)
        if mnem.startswith("j") or mnem.startswith("ret") or mnem == "ud2":
            out.append(tuple(cur)); cur = []
    if cur: out.append(tuple(cur))
    return collections.Counter(out)
h = blocks(sys.argv[1]); p = blocks(sys.argv[2])
only_h = h - p; only_p = p - h
print(f"blocks head {sum(h.values())} proto {sum(p.values())}; only in head {sum(only_h.values())} ({sum(len(b)*n for b,n in only_h.items())} instructions), only in proto {sum(only_p.values())} ({sum(len(b)*n for b,n in only_p.items())} instructions)")
if len(sys.argv) > 3:
    for name, side in (("HEAD ONLY", only_h), ("PROTO ONLY", only_p)):
        print(name)
        for b, n in sorted(side.items(), key=lambda kv: -len(kv[0])):
            print(f"  x{n} [{len(b)}] " + " ".join(b)[:260])
