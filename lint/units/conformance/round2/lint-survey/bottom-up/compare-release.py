#!/usr/bin/env python3
# usage: compare-release.py <observed/instances.tsv> <raw.jsonl> <release/observed/instances.tsv> <release/observed/raw.jsonl>
# Holds the survey of one binary against the survey of another, instance by instance: the class of the run (silent,
# diagnostic, not laid out, died, ...) with its first code and, where both printed something, the bytes of stderr.
# Made for the debug build against the release build of the same sources (release/ beside this script).
import json
import sys

table_path, raw_path, other_table_path, other_raw_path = sys.argv[1:5]


def table_of(path):
    out = {}
    for line in open(path, encoding="utf8"):
        if not line.strip():
            continue
        name, kind, case_path, outcome, cls, code, reason = (line.rstrip("\n").split("\t") + [""] * 7)[:7]
        out[name] = {"kind": kind, "class": cls, "code": code, "outcome": outcome, "reason": reason}
    return out


def raw_of(path):
    out = {}
    for line in open(path, encoding="utf8"):
        if line.strip():
            r = json.loads(line)
            out[r["name"]] = r
    return out


mine, other = table_of(table_path), table_of(other_table_path)
mine_raw, other_raw = raw_of(raw_path), raw_of(other_raw_path)
only_mine = sorted(set(mine) - set(other))
only_other = sorted(set(other) - set(mine))
print(f"instances: here {len(mine)}, there {len(other)}; only here {len(only_mine)}, only there {len(only_other)}")
differ = []
same = 0
same_bytes = 0
other_bytes = []
for name in sorted(set(mine) & set(other)):
    a, b = mine[name], other[name]
    if (a["class"], a["code"]) != (b["class"], b["code"]):
        differ.append((name, a, b))
        continue
    same += 1
    if name in mine_raw and name in other_raw:
        if mine_raw[name].get("stderr") == other_raw[name].get("stderr") and mine_raw[name].get("exitCode") == other_raw[name].get("exitCode"):
            same_bytes += 1
        else:
            other_bytes.append(name)
print(f"same class of run and first code in both: {same}; another: {len(differ)}")
for name, a, b in differ:
    print(f"  {name}: here {a['class']} {a['code']} ({a['reason'][:160]}); there {b['class']} {b['code']}")
print(f"both have a raw run: the same exit code and bytes of stderr {same_bytes}, other {len(other_bytes)}")
for name in other_bytes[:40]:
    print(f"  {name}")
    print("    here:  " + (mine_raw[name].get("stderr") or "")[:300].replace("\n", " | "))
    print("    there: " + (other_raw[name].get("stderr") or "")[:300].replace("\n", " | "))
