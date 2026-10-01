#!/usr/bin/env python3
import os
# Research probe. TypeScript's top-level error baselines matched to case stems by exact name; writes ts-match.json.
W = os.environ.get("WORK", "/tmp/conf-research")
os.makedirs(W, exist_ok=True)
import re, subprocess, sys, collections

TS = os.environ.get("TS", "/workspace/ref/typescript-go/_submodules/TypeScript")
GO = os.environ.get("GO", "/workspace/ref/typescript-go")

def lstree(repo, *paths, recursive=True):
    args = ["git", "-C", repo, "ls-tree", "-l", "-z"]
    if recursive:
        args.append("-r")
    args += ["HEAD", "--", *paths]
    out = subprocess.run(args, check=True, capture_output=True).stdout
    res = []
    for rec in out.split(b"\0"):
        if not rec:
            continue
        meta, path = rec.split(b"\t", 1)
        mode, typ, oid, size = meta.split()
        res.append((path.decode("utf-8", "surrogateescape"), mode.decode(), typ.decode(), oid.decode(), size.decode()))
    return res

cases = lstree(TS, "tests/cases/conformance", "tests/cases/compiler")
print("case files", len(cases), "bytes", sum(int(c[4]) for c in cases))
stems = {}
for path, mode, typ, oid, size in cases:
    m = re.search(r"\.tsx?$", path)
    if not m:
        print("  not enumerated:", path)
        continue
    base = path.rsplit("/", 1)[1]
    stem = re.sub(r"\.tsx?$", "", base)
    suite = path.split("/")[2]
    assert stem not in stems, stem
    stems[stem] = (suite, path)
print("stems", len(stems))

bl = lstree(TS, "tests/baselines/reference/", recursive=False)
top_err = [b for b in bl if b[2] == "blob" and b[0].endswith(".errors.txt")]
print("top-level error baselines", len(top_err), "bytes", sum(int(b[4]) for b in top_err))

exact = collections.Counter()
unmatched = []
by_suite = collections.Counter()
by_suite_bytes = collections.Counter()
glob_only = []
rx = re.compile(r"^(.*?)(\((.*)\))?\.errors\.txt$")
matched_names = {}
for path, mode, typ, oid, size in top_err:
    name = path.rsplit("/", 1)[1]
    core = name[: -len(".errors.txt")]
    hit = None
    if core in stems:
        hit = (core, None)
    else:
        # try every '(' split point, so that a stem containing '(' is handled
        for i, ch in enumerate(core):
            if ch == "(" and core.endswith(")"):
                s = core[:i]
                if s in stems:
                    hit = (s, core[i + 1 : -1])
                    break
    if hit is None:
        unmatched.append(name)
        continue
    exact["plain" if hit[1] is None else "config"] += 1
    suite = stems[hit[0]][0]
    by_suite[suite] += 1
    by_suite_bytes[suite] += int(size)
    matched_names[name] = (hit, suite, oid, int(size))
print("matched", sum(exact.values()), dict(exact))
print("unmatched", len(unmatched), unmatched[:20])
print("by suite", dict(by_suite), dict(by_suite_bytes))

# The glob <stem>*.errors.txt: how many files does it match that the exact rule assigns to ANOTHER stem
names = sorted(n for n in matched_names)
import bisect
wrong = 0
wrong_examples = []
stems_sorted = sorted(stems)
for name, (hit, suite, oid, size) in matched_names.items():
    core = name[: -len(".errors.txt")]
    # stems that are a proper prefix of name and differ from the exact stem
    for L in range(1, len(core) + 1):
        p = core[:L]
        if p in stems and p != hit[0]:
            wrong += 1
            if len(wrong_examples) < 10:
                wrong_examples.append((p, name, hit[0]))
print("glob '<stem>*.errors.txt' false matches (file, other stem) pairs:", wrong)
for w in wrong_examples:
    print("   glob of stem", w[0], "also matches", w[1], "which belongs to", w[2])

# stems containing parentheses
print("stems with '(':", [s for s in stems if "(" in s or ")" in s])
# config names
cfgs = collections.Counter()
for name, (hit, suite, oid, size) in matched_names.items():
    if hit[1] is not None:
        for kv in hit[1].split(","):
            cfgs[kv.split("=")[0]] += 1
print("config keys in TS baseline names:", dict(cfgs))

import json
json.dump({"stems": stems, "matched": matched_names}, open(W + "/ts-match.json", "w"))
