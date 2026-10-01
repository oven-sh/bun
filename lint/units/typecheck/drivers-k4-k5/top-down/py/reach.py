# Research probe: how many run instances a program stand-in with resolved inputs can reach, and which need a recorded program.
# usage: python3 reach.py
import collections
from common import rows, cls, trivial, out_of_reach
R = rows()
tot = collections.Counter(cls(r) for r in R)
reach = collections.Counter(); excl = collections.Counter(); split = collections.Counter(); one = collections.Counter(); libs = collections.Counter()
for r in R:
    why = out_of_reach(r)
    for w in why: excl[(w, cls(r))] += 1
    if why: continue
    reach[cls(r)] += 1
    t = trivial(r)
    split[(cls(r), 'trivial' if t else 'recorded')] += 1
    if t and len(r['files'] or []) == 1: one[cls(r)] += 1
    libs[len(r['libs'].split(',')) if r['libs'] else 0] += 1
print('run instances', dict(tot))
print('trivial program', sum(1 for r in R if trivial(r)), 'needs a recorded program', sum(1 for r in R if not trivial(r)))
print('within reach', dict(reach), sum(reach.values()))
for (w, c), v in sorted(excl.items()): print('  out of reach', w, c, v)
print('within reach by program kind', dict(split))
print('within reach, trivial, one non-lib file', dict(one))
print('lib files per program among those within reach', sorted(libs.items(), key=lambda x: -x[1])[:8])
