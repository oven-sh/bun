#!/usr/bin/env python3
import os
# Research probe. Instances whose compiled units name /.lib/, and which of them typescript-go ran; writes lib-instances.json.
W = os.environ.get("WORK", "/tmp/conf-research")
os.makedirs(W, exist_ok=True)
import json, re, subprocess, collections

TS = os.environ.get("TS", "/workspace/ref/typescript-go/_submodules/TypeScript")
GO = os.environ.get("GO", "/workspace/ref/typescript-go")
inst = json.load(open(W + "/instances.json"))
inst = [i for i in inst if not i["by_name"]]
print("instances", len(inst))

# every typescript-go baseline name under submodule/<suite>/ (any kind), to decide which instances ran
out = subprocess.run(["git", "-C", GO, "ls-tree", "-r", "-z", "--name-only", "HEAD", "--",
                      "testdata/baselines/reference/submodule/conformance", "testdata/baselines/reference/submodule/compiler",
                      "testdata/baselines/reference/submoduleAccepted/conformance", "testdata/baselines/reference/submoduleAccepted/compiler",
                      "testdata/baselines/reference/submoduleTriaged/conformance", "testdata/baselines/reference/submoduleTriaged/compiler"],
                     check=True, capture_output=True).stdout
names = collections.defaultdict(set)
for p in out.split(b"\0"):
    if not p:
        continue
    p = p.decode()
    parts = p.split("/")
    suite = parts[4]
    names[suite].add("/".join(parts[5:]))
KINDS = [".errors.txt", ".types", ".symbols", ".js", ".js.map", ".sourcemap.txt", ".trace.json"]
def ran(i):
    for k in KINDS:
        if i["name"] + k in names[i["suite"]] or i["name"] + k + ".diff" in names[i["suite"]]:
            return True
    return False

n_ran = sum(1 for i in inst if ran(i))
print("instances with any typescript-go baseline (ran):", n_ran, "without:", len(inst) - n_ran)

def libfiles(i):
    v = i["cfg"].get("libfiles")
    if not v:
        return []
    return [x.strip() for x in v.split(",") if x.strip()]

by_file = collections.OrderedDict()
for i in inst:
    lf = libfiles(i)
    nolib = i["cfg"].get("nolib", "").lower() == "true"
    effective = [x for x in lf if not (x == "lib.d.ts" and not nolib)]
    reads = bool(effective) or i["lib_in_content"]
    i["reads_lib"] = reads
    i["libfiles"] = lf
    i["effective"] = effective
    if reads:
        by_file.setdefault(i["path"], []).append(i)
reads = [i for i in inst if i["reads_lib"]]
print("instances that mount /.lib:", len(reads), "in", len(by_file), "case files")
print("   of these ran:", sum(1 for i in reads if ran(i)), "did not run:", sum(1 for i in reads if not ran(i)))
print("   by suite:", dict(collections.Counter(i["suite"] for i in reads)))
print("   by reason:", dict(collections.Counter(("libfiles" if i["effective"] else "") + ("+" if i["effective"] and i["lib_in_content"] else "") + ("content" if i["lib_in_content"] else "") for i in reads)))
c = collections.Counter()
for i in reads:
    for x in i["effective"]:
        c[x] += 1
print("   libFiles values (instances):", dict(c))
# which files under /.lib are named in content
rx = re.compile(r"/\.lib/([\w./-]+)")
c2 = collections.Counter()
for path in by_file:
    raw = open(f"{TS}/{path}", "rb").read().decode("utf-8", "replace")
    for m in set(rx.findall(raw)):
        c2[m] += 1
print("   /.lib/ paths named in content (case files):", dict(c2))
# libFiles naming lib.d.ts only (skipped by the harness unless noLib)
only_libdts = [i for i in inst if i["libfiles"] and not i["effective"] and not i["lib_in_content"]]
print("instances whose libFiles is only lib.d.ts without noLib (nothing mounted):", len(only_libdts), "files", len({i['path'] for i in only_libdts}))
missing = [i for i in reads if any(x not in ("react.d.ts", "react16.d.ts", "react18/global.d.ts", "react18/react18.d.ts") for x in i["effective"])]
print("instances that name a libFiles entry which tests/lib does not have:", len(missing), sorted({(i['path'], tuple(i['effective'])) for i in missing})[:20])
json.dump([{"name": i["name"], "suite": i["suite"], "path": i["path"], "ran": ran(i)} for i in reads], open(W + "/lib-instances.json", "w"))
