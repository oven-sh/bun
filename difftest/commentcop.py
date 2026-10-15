#!/usr/bin/env python3
"""Lists added comment groups of 2+ lines under src/ (the comment rule of the repo), working tree against a base."""
import re, subprocess, sys
base = sys.argv[1]
diff = subprocess.run(["git", "diff", "-U0", base, "--", "src/"], capture_output=True, text=True, cwd="/workspace/bun").stdout
groups = 0; run = []; cur = None
def flush():
    global groups, run
    if len(run) >= 2 and not any("SAFETY:" in l for l in run):
        groups += 1; print("GROUP in", cur, ":", run[0][:90])
    run = []
for line in diff.splitlines():
    if line.startswith("+++ "):
        flush(); cur = line[6:]; continue
    if line.startswith("@@"):
        flush(); continue
    if line.startswith("+") and re.match(r"^\+\s*(//|/\*|\*)", line):
        run.append(line)
    else:
        flush()
flush()
print("groups:", groups)
