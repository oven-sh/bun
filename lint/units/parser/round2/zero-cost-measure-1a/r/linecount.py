#!/usr/bin/env python3
"""usage: linecount.py <file.cg> <fl regex> <line> [<line>...] : Ir/Bc summed over all symbols for these lines"""
import re, sys, collections
path, flrx = sys.argv[1], re.compile(sys.argv[2]); want = set(int(x) for x in sys.argv[3:])
fl = None; agg = collections.defaultdict(lambda: [0, 0])
with open(path, errors='replace') as f:
    for line in f:
        c = line[0]
        if c == 'f':
            if line.startswith(('fl=', 'fi=', 'fe=')): fl = line[3:].rstrip('\n')
            continue
        if not c.isdigit() or not fl or not flrx.search(fl): continue
        parts = line.split()
        n = int(parts[0])
        if n in want:
            agg[n][0] += int(parts[1]); agg[n][1] += int(parts[2]) if len(parts) > 2 else 0
for n in sorted(agg): print(f'  line {n}: Ir {agg[n][0]:,} Bc {agg[n][1]:,}')
