#!/usr/bin/env python3
"""fx.py FILE LINE OLD NEW [SPAN]: replace OLD with NEW once, searching from LINE-SPAN to LINE+SPAN (default 3)."""
import sys
path, line, old, new = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
span = int(sys.argv[5]) if len(sys.argv) > 5 else 3
old = old.encode().decode('unicode_escape') if '\\n' in old else old
new = new.encode().decode('unicode_escape') if '\\n' in new else new
root = '/workspace/bun/'
lines = open(root + path).read().split('\n')
lo, hi = max(0, line - 1 - span), min(len(lines), line + span)
chunk = '\n'.join(lines[lo:hi])
n = chunk.count(old)
if n != 1:
    print(f'FAIL {path}:{line}: {n} matches of {old!r}'); print(chunk); sys.exit(1)
chunk = chunk.replace(old, new)
lines[lo:hi] = chunk.split('\n')
open(root + path, 'w').write('\n'.join(lines))
print(f'ok {path}:{line}')
