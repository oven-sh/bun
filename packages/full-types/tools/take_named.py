#!/usr/bin/env python3
"""take_named.py <given_candidates.json> <given_roles.json> <extra.json>: what the checker names at a read of a reused parameter (probe_given.py) is a member of that variable's union. Prints how many were new."""
import json, os, sys
candidates, answers = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
extra = json.load(open(sys.argv[3])) if os.path.exists(sys.argv[3]) else {}
new = 0
for k, _, base, _, fn in candidates:
    t = answers.get(str(k))
    if isinstance(t, str) and t not in extra.setdefault('%s/%s' % (fn, base), []): extra['%s/%s' % (fn, base)].append(t); new += 1
json.dump({k: v for k, v in extra.items() if v}, open(sys.argv[3], 'w'), indent=1)
print(new)
