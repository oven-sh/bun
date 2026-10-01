#!/usr/bin/env python3
# The check of .github/workflows/comment-cop.yml on whole files: a run of two or more comment lines without `SAFETY:`.
# usage: python3 comment-runs.py <file>...   exit 1 when a run is found
import sys
def is_comment(line):
    t = line.lstrip()
    return t.startswith("//") or t.startswith("/*") or t in ("*", "*/") or t.startswith("* ")
bad = 0
for path in sys.argv[1:]:
    run = []
    for number, line in enumerate(open(path, encoding="utf-8").read().split("\n") + [""], 1):
        if is_comment(line):
            run.append((number, line))
            continue
        if len(run) >= 2 and "SAFETY:" not in "\n".join(l for _, l in run):
            bad += 1
            print(f"{path}:{run[0][0]}-{run[-1][0]}: {len(run)} comment lines in a row")
        run = []
sys.exit(1 if bad else 0)
