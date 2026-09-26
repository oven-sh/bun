#!/usr/bin/env python3
"""text_by_archive.py <lld map> : bytes of executable input sections per archive / object group (from the .text output section)."""
import sys, re, json, collections
mapfile = sys.argv[1]
line_re = re.compile(r"^\s*([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+(\d+) (.*)$")
cur_out = None
by = collections.Counter()
with open(mapfile, errors="replace") as f:
    next(f)
    for line in f:
        m = line_re.match(line.rstrip("\n"))
        if not m: continue
        size = int(m.group(3), 16)
        rest = m.group(5)
        indent = len(rest) - len(rest.lstrip(" "))
        text = rest.strip()
        if indent == 0:
            cur_out = text
        elif 8 <= indent < 16 and cur_out == ".text":
            mm = re.match(r"^(.*):\(([^()]*)\)$", text)
            if not mm: continue
            obj = mm.group(1)
            a = re.match(r"^(.*?)([^/]+\.a)\((.*)\)$", obj)
            key = a.group(2) if a else obj.split("/")[-1]
            by[key] += size
total = sum(by.values())
out = {"text_total_from_map": total, "by_archive": dict(by.most_common())}
print(json.dumps(out, indent=1))
