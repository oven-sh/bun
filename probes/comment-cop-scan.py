#!/usr/bin/env python3
"""What .github/workflows/comment-cop.yml flags on a PR: every group of 2 or more consecutive
ADDED comment lines in a source file under src/ (groups with SAFETY: excepted).

usage: comment-cop-scan.py [base ref, default origin/main]     (run in the repo)
Exit 1 if a group is found.
"""
import re
import subprocess
import sys

base = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
SRC_EXT = re.compile(r"\.(rs|c|cc|cpp|h|hpp|m|mm|ts|tsx|mts|cts|js|jsx|mjs|cjs)$")
diff = subprocess.run(["git", "diff", f"{base}...HEAD", "--", "src/"], capture_output=True, text=True, check=True).stdout


def is_comment(line):
    t = line.lstrip()
    return t.startswith("//") or t.startswith("/*") or t in ("*", "*/") or t.startswith("* ")


groups = []
singles = 0
path = None
cur = None
new = 0


def flush():
    global cur, singles
    if cur:
        if len(cur["lines"]) >= 2 and "SAFETY:" not in "\n".join(cur["lines"]):
            groups.append(cur)
        elif len(cur["lines"]) == 1:
            singles += 1
    cur = None


for raw in diff.split("\n"):
    if raw.startswith("diff --git"):
        flush()
    elif raw.startswith("+++ b/"):
        flush()
        path = raw[6:]
    elif raw.startswith("+++ ") or raw.startswith("--- ") or raw.startswith("index "):
        pass
    elif raw.startswith("@@"):
        flush()
        m = re.search(r"\+(\d+)", raw)
        new = int(m.group(1)) if m else 1
    elif raw.startswith("+"):
        text = raw[1:]
        if path and SRC_EXT.search(path) and is_comment(text):
            if cur:
                cur["end"] = new
                cur["lines"].append(text)
            else:
                cur = {"path": path, "start": new, "end": new, "lines": [text]}
        else:
            flush()
        new += 1
    elif raw.startswith("-"):
        flush()
    elif raw.startswith("\\"):
        pass
    else:
        flush()
        new += 1
flush()

print(f"groups of 2+ added comment lines under src/: {len(groups)} (single added comment lines: {singles})")
for g in groups:
    print(f"  {g['path']}:{g['start']}-{g['end']}")
    for line in g["lines"]:
        print("     |", line.strip()[:150])
sys.exit(1 if groups else 0)
