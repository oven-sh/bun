#!/usr/bin/env python3
"""take_suggestions.py <output of fix_reads.py> <extra.json>: what is stored to a variable and is not in its union (the last SUGGESTED line) goes into extra.json. Prints how many were new."""
import json, sys, os
lines = [l for l in open(sys.argv[1]) if l.startswith('SUGGESTED ')]
extra = json.load(open(sys.argv[2])) if os.path.exists(sys.argv[2]) else {}
new = 0
for key, types in json.loads(lines[-1][10:]).items() if lines else []:
    for t in types:
        if t not in extra.setdefault(key, []): extra[key].append(t); new += 1
json.dump(extra, open(sys.argv[2], 'w'), indent=1)
print(new)
