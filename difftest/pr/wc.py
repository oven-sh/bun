#!/usr/bin/env python3
"""Counts the words of the visible part of a PR body (everything before <details>), without headings and bullet markers."""
import re, sys
text = open(sys.argv[1]).read().split("<details>")[0]
words = 0
for line in text.splitlines():
    if line.startswith("#"):
        continue
    line = re.sub(r"^\s*-\s+", "", line)
    words += len(line.split())
print("visible words:", words)
for tell in ("—", "–", ";"):
    n = open(sys.argv[1]).read().count(tell)
    if n: print("FOUND %r x%d" % (tell, n))
