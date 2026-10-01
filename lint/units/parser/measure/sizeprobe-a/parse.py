#!/usr/bin/env python3
# usage: parse.py <probes.rs> <cargo json messages> ; prints "<value>\t<probe expression>" per probe line, in order
import json, re, sys
probes = open(sys.argv[1]).read().split("\n")
found = {}
other = []
for line in open(sys.argv[2], errors="replace"):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        m = json.loads(line)
    except ValueError:
        continue
    msg = m.get("message")
    if m.get("reason") != "compiler-message" or not isinstance(msg, dict):
        continue
    if msg.get("level") != "error":
        continue
    hit = False
    for sp in msg.get("spans", []):
        lab = sp.get("label") or ""
        g = re.search(r"found one with a size of (\d+)", lab)
        if g and sp.get("file_name", "").endswith("lib.rs"):
            found[sp["line_start"]] = int(g.group(1))
            hit = True
    if not hit and msg.get("code"):
        other.append(msg.get("rendered", "").strip())
n = 0
for i, text in enumerate(probes, 1):
    g = re.search(r"core::mem::(size_of|align_of)::<(.*)>\(\)\];", text)
    if not g:
        continue
    n += 1
    v = found.get(i)
    print("%s\t%s %s" % ("?" if v is None else v, g.group(1), g.group(2)))
if other:
    print("# %d other errors:" % len(other))
    for o in other:
        print("# " + o.replace("\n", "\n# "))
sys.exit(0 if n == len(found) and not other else 1)
