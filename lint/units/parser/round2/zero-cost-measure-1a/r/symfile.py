#!/usr/bin/env python3
"""usage: symfile.py <a.cg> <b.cg> <symbol regex> <file regex> : Ir/Bc/Bi of lines of matching files inside matching symbols, b - a"""
import re, sys, collections
def load(path, srx, frx):
    fn = None; fl = None; ok = False; t = [0, 0, 0]
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fn='): fn = line[3:]; fl_ok = True; ok = bool(srx.search(fn)); continue
                if line.startswith(('fl=', 'fi=', 'fe=')): fl = line[3:]; continue
            if not c.isdigit() or not ok or not fl or not frx.search(fl): continue
            p = line.split(); t[0] += int(p[1]); t[1] += int(p[2]) if len(p) > 2 else 0; t[2] += int(p[4]) if len(p) > 4 else 0
    return t
srx = re.compile(sys.argv[3]); frx = re.compile(sys.argv[4])
a = load(sys.argv[1], srx, frx); b = load(sys.argv[2], srx, frx)
print(f'Ir {a[0]:,} -> {b[0]:,} ({b[0]-a[0]:+,})  Bc {a[1]:,} -> {b[1]:,} ({b[1]-a[1]:+,})  Bi {a[2]:,} -> {b[2]:,} ({b[2]-a[2]:+,})')
