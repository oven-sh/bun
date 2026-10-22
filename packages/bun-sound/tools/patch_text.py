#!/usr/bin/env python3
"""patch_text.py <text> <patches.json>: replaces [old, new] pairs, each of which must occur exactly once. What no tool decides is written down there, by hand."""
import json, sys
path, patches = sys.argv[1:3]
t = open(path).read()
bad = 0
for old, new in json.load(open(patches)):
    n = t.count(old)
    if n != 1: print('patch_text: %d times: %r' % (n, old[:100])); bad += 1; continue
    t = t.replace(old, new)
open(path, 'w').write(t)
sys.exit(1 if bad else 0)
