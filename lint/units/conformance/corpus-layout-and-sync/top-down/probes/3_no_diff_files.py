#!/usr/bin/env python3
import os
# Research probe. The byte-different baselines that have no .diff: equal after the harness removes './' from the header lines.
W = os.environ.get("WORK", "/tmp/conf-research")
os.makedirs(W, exist_ok=True)
import json, subprocess

TS = os.environ.get("TS", "/workspace/ref/typescript-go/_submodules/TypeScript")
GO = os.environ.get("GO", "/workspace/ref/typescript-go")
g = json.load(open(W + "/go-match.json"))
t = json.load(open(W + "/ts-match.json"))
go_err = g["go_err"]
ts_err = t["matched"]

def blob(repo, oid):
    return subprocess.run(["git", "-C", repo, "cat-file", "blob", oid], check=True, capture_output=True).stdout

def fixup_old(old: bytes) -> bytes:
    out = []
    for line in old.split(b"\n"):
        if line.startswith(b"==== ./"):
            line = b"==== " + line[len(b"==== ./"):]
        out.append(line)
    return b"\n".join(out)

print("the 16 without a diff:")
for n in g["nodiff"]:
    a = blob(TS, ts_err[n][2])
    b = blob(GO, go_err[n][1])
    fx = fixup_old(a)
    cnt = sum(1 for l in a.split(b"\n") if l.startswith(b"==== ./"))
    print("  ", n, "equal after fixup:", fx == b, "header lines with ./ :", cnt, "size ts", len(a), "go", len(b))

# Across all 552 differing: how many TS files contain '==== ./' headers at all
n_with = 0
for n in g["differ"]:
    a = blob(TS, ts_err[n][2])
    if any(l.startswith(b"==== ./") for l in a.split(b"\n")):
        n_with += 1
print("differing TS baselines with a './' header:", n_with, "of", len(g["differ"]))

# Across ALL TS top-level baselines
tot = 0
for n, v in ts_err.items():
    a = blob(TS, v[2])
    if b"\n==== ./" in a or a.startswith(b"==== ./"):
        tot += 1
print("all TS error baselines with a './' header:", tot, "of", len(ts_err))
