#!/usr/bin/env python3
import os
# Research probe. typescript-go's error baselines against TypeScript's: identical, differ, none, diffs, derived list; writes go-match.json.
W = os.environ.get("WORK", "/tmp/conf-research")
os.makedirs(W, exist_ok=True)
import re, subprocess, sys, collections, json

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

m = json.load(open(W + "/ts-match.json"))
stems = m["stems"]
ts_err = m["matched"]  # name -> (hit, suite, oid, size)

roots = ["submodule", "submoduleAccepted", "submoduleTriaged"]
go = {}
for r in roots:
    go[r] = lstree(GO, f"testdata/baselines/reference/{r}/conformance", f"testdata/baselines/reference/{r}/compiler")
    ext = collections.Counter()
    for p, *_ in go[r]:
        name = p.rsplit("/", 1)[1]
        mm = re.search(r"(\.errors\.txt(\.diff)?|\.types(\.diff)?|\.symbols(\.diff)?|\.js(\.diff)?|\.js\.map(\.diff)?|\.sourcemap\.txt(\.diff)?|\.trace\.json(\.diff)?|\.[^.]+)$", name)
        ext[mm.group(1)] += 1
    print(r, len(go[r]), dict(ext.most_common(30)))

# typescript-go error baselines
go_err = {}
for p, mode, typ, oid, size in go["submodule"]:
    if p.endswith(".errors.txt"):
        suite = p.split("/")[4]
        name = p.rsplit("/", 1)[1]
        assert name not in go_err, name
        go_err[name] = (suite, oid, int(size), mode, p)
print("go error baselines", len(go_err), "bytes", sum(v[2] for v in go_err.values()),
      dict(collections.Counter(v[0] for v in go_err.values())))
modes = collections.Counter(v[3] for v in go_err.values())
print("go modes", dict(modes))
# nested?
print("go err nested depth", collections.Counter(len(v[4].split("/")) for v in go_err.values()))

identical = differ = none = 0
differ_names = []
none_names = []
suite_mismatch = []
for name, (suite, oid, size, mode, p) in go_err.items():
    t = ts_err.get(name)
    if t is None:
        none += 1
        none_names.append(name)
    else:
        if t[1] != suite:
            suite_mismatch.append(name)
        if t[2] == oid:
            identical += 1
        else:
            differ += 1
            differ_names.append(name)
print("identical", identical, "differ", differ, "none", none, "suite mismatch", len(suite_mismatch))
copy = differ_names + none_names
print("to copy", len(copy), "bytes", sum(go_err[n][2] for n in copy),
      "differ bytes", sum(go_err[n][2] for n in differ_names), "none bytes", sum(go_err[n][2] for n in none_names))
print("to copy by suite", dict(collections.Counter(go_err[n][0] for n in copy)))

# do the go names all map to a stem by the exact rule?
def stem_of(name):
    core = name[: -len(".errors.txt")]
    if core in stems:
        return core, None
    for i, ch in enumerate(core):
        if ch == "(" and core.endswith(")"):
            s = core[:i]
            if s in stems:
                return s, core[i + 1 : -1]
    return None
bad = [n for n in go_err if stem_of(n) is None]
print("go error baselines with no case stem", len(bad), bad[:10])
bad_suite = [n for n in go_err if stem_of(n) and stems[stem_of(n)[0]][0] != go_err[n][0]]
print("go error baselines in a different suite than the case", len(bad_suite), bad_suite[:10])

# diffs
diffs = {}
for r in roots:
    for p, mode, typ, oid, size in go[r]:
        if p.endswith(".errors.txt.diff"):
            name = p.rsplit("/", 1)[1][: -len(".diff")]
            suite = p.split("/")[4]
            assert name not in diffs, (name, r, diffs.get(name))
            diffs[name] = (r, suite, oid, int(size), p)
print("error diffs", len(diffs), dict(collections.Counter(v[0] for v in diffs.values())))

# diffs without a go baseline: go ran, had no error, TS has a baseline
derived = sorted(n for n in diffs if n not in go_err)
print("diff but no go .errors.txt (derived list)", len(derived))
for n in derived:
    print("   ", diffs[n][0], diffs[n][1], n, "TS has:", n in ts_err)
# differing files without a diff
nodiff = sorted(n for n in copy if n not in diffs)
print("differ/none with no .diff", len(nodiff))
for n in nodiff:
    print("   ", go_err[n][0], n, "TS has:", n in ts_err)
# diff exists but go and TS are byte-identical? (should be none)
odd = sorted(n for n in diffs if n in go_err and n in ts_err and ts_err[n][2] == go_err[n][1])
print("diff exists but identical bytes", len(odd), odd[:5])

json.dump({"go_err": go_err, "diffs": diffs, "derived": derived, "nodiff": nodiff, "differ": differ_names, "none": none_names},
          open(W + "/go-match.json", "w"))
