#!/usr/bin/env python3
# usage: compare-release.py <observed/instances.tsv> <raw.jsonl of this survey> <raw-release.jsonl of an earlier survey>
# Holds the debug build against a release build of the same sources, instance by instance: the class of the run
# (silent, diagnostic, not laid out, died) and, where both printed diagnostics, the lines of stderr.
# raw-release.jsonl is the file of round2/default-check-classification (probes/raw.ts): every run instance through
# `<release binary> --lint <operands>`, one JSON line each with exitCode, signal, stderr and notLaid.
import json
import sys

table_path, raw_path, release_path = sys.argv[1:4]
debug = {}
for line in open(table_path, encoding="utf8"):
    if not line.strip():
        continue
    name, kind, case_path, outcome, cls, code, reason = (line.rstrip("\n").split("\t") + [""] * 7)[:7]
    debug[name] = {"kind": kind, "class": cls, "code": code, "outcome": outcome, "reason": reason}
raw = {}
for line in open(raw_path, encoding="utf8"):
    if line.strip():
        r = json.loads(line)
        raw[r["name"]] = r
release = {}
for line in open(release_path, encoding="utf8"):
    if line.strip():
        r = json.loads(line)
        release[r["name"]] = r


def release_class(r):
    if "notLaid" in r:
        return "not-laid-out"
    if r.get("timedOut"):
        return "timeout"
    if r.get("signal") is not None or r.get("exitCode") not in (0, 2) or r.get("stdout"):
        return "died"
    return "diagnostic" if r.get("stderr") else "silent"


only_debug = sorted(set(debug) - set(release))
only_release = sorted(set(release) - set(debug))
print(f"instances: debug {len(debug)}, release {len(release)}; only in debug {len(only_debug)}, only in release {len(only_release)}")
differ = []
same_class = 0
same_lines = 0
other_lines = []
for name in sorted(set(debug) & set(release)):
    d = debug[name]
    rc = release_class(release[name])
    if d["class"] != rc:
        differ.append((name, d["class"], d["code"], rc, d["reason"]))
        continue
    same_class += 1
    if rc == "diagnostic" and name in raw:
        if raw[name].get("stderr") == release[name].get("stderr"):
            same_lines += 1
        else:
            other_lines.append(name)
print(f"same class of run in both builds: {same_class}; another class: {len(differ)}")
for name, cls, code, rc, reason in differ:
    print(f"  {name}: debug {cls} {code} ({reason[:160]}); release {rc}")
print(f"both printed diagnostics: the same bytes of stderr {same_lines}, other bytes {len(other_lines)}")
for name in other_lines[:40]:
    print(f"  {name}")
    print("    debug:   " + raw[name].get("stderr", "")[:300].replace("\n", " | "))
    print("    release: " + release[name].get("stderr", "")[:300].replace("\n", " | "))
