#!/usr/bin/env python3
"""commentcop.py <old file> <new file>: runs of two or more ADDED comment lines, as .github/workflows/comment-cop.yml counts them."""
import sys, subprocess
diff = subprocess.run(["diff", "-U3", sys.argv[1], sys.argv[2]], capture_output=True, text=True).stdout
def is_comment(line):
    t = line.lstrip()
    return t.startswith("//") or t.startswith("/*") or t == "*" or t == "*/" or t.startswith("* ")
groups = []; cur = []
for raw in diff.split("\n"):
    if raw.startswith("+++") or raw.startswith("---"): continue
    if raw.startswith("@@"):
        if len(cur) >= 2: groups.append(cur)
        cur = []
    elif raw.startswith("+"):
        if is_comment(raw[1:]): cur.append(raw[1:])
        else:
            if len(cur) >= 2: groups.append(cur)
            cur = []
    else:
        if len(cur) >= 2: groups.append(cur)
        cur = []
if len(cur) >= 2: groups.append(cur)
groups = [g for g in groups if "SAFETY:" not in "\n".join(g)]
print("comment groups:", len(groups))
for g in groups: print("\n".join(g), "\n--")
import re
added = [l[1:] for l in diff.split("\n") if l.startswith("+") and not l.startswith("+++")]
for l in added:
    if re.search(r"\b(TODO|FIXME|XXX|HACK)\b", l): print("MARKER:", l)
    if re.search(r"\b(unwrap|expect|panic!|unreachable!|todo!)\b", l) and "lexer.expect" not in l and "self.lexer.expected" not in l: print("CHECK:", l)
print("added lines:", len(added), "longest:", max(len(l) for l in added))
