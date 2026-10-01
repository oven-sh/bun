# Turns the dump of the roots program into the vector file: one JSON object per instance, gzip.
# usage: to_vectors.py <dump.jsonl> <out.jsonl.gz> [nontrivial]
import gzip, json, sys
reduce = len(sys.argv) > 3 and sys.argv[3] == "nontrivial"
lines = []
# the reference walks Go maps, so the order of the instances of one case changes from run to run: sort them by name
rows = [json.loads(l) for l in open(sys.argv[1])]
order = {}
for r in rows:
    order.setdefault((r["suite"], r["casePath"]), len(order))
rows.sort(key=lambda r: (order[(r["suite"], r["casePath"])], r["configuredName"].encode()))
for r in rows:
    o = {"suite": r["suite"], "name": r["configuredName"], "casePath": r["casePath"]}
    if r.get("stop"):
        o["stop"] = r["stop"]
    else:
        o.update({
            "currentDirectory": r["currentDirectory"], "hasNonDtsFiles": r["hasNonDtsFiles"], "configFiles": r["configFiles"], "roots": r["roots"], "otherFiles": r["otherFiles"],
            "programFileNames": r["programFileNames"], "includeLibDir": r["includeLibDir"], "useCaseSensitiveFileNames": r["useCaseSensitiveFileNames"],
            "symlinks": dict(sorted(r["symlinks"].items())), "configFileNames": r["configFileNames"], "configOptions": r.get("configOptions"),
            "extendedSourceFiles": r.get("extendedSourceFiles") or [],
            "entries": [[e["path"], e["link"]] if e.get("isLink") else [e["path"], e["size"], e["sha"]] for e in r["entries"]],
        })
        if r.get("vfsPanic"):
            o["vfsPanic"] = r["vfsPanic"]
        if r.get("skip"):
            o["skip"] = r["skip"]
    # a row is trivial when the rule for a case of one unit gives it: one root /.src/<case file>, nothing else
    trivial = (not r.get("stop") and not r["hasConfig"] and r["currentDirectory"] == "/.src" and len(r["roots"]) == 1 and not r["otherFiles"]
               and r["programFileNames"] == r["roots"] and not r["includeLibDir"] and r["useCaseSensitiveFileNames"] and not r["symlinks"]
               and r["roots"][0] == "/.src/" + r["casePath"].split("/")[-1] and not r.get("vfsPanic"))
    if reduce and trivial:
        continue
    lines.append(json.dumps(o, ensure_ascii=False, separators=(",", ":")))
open(sys.argv[2], "wb").write(gzip.compress(("\n".join(lines) + "\n").encode(), 9, mtime=0))
print("rows", len(lines))
