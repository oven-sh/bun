#!/usr/bin/env python3
"""Counts of a cachegrind file on the source lines whose text matches a pattern (default: the tests of the side table).
usage: cgsites.py <file.cg> [--src ROOT] [--pat REGEX] [--min N]
Prints per line: Ir, Bc, the function that holds it, file:line, text. The sum is a lower bound of what the tests cost:
a compare can be attributed to a neighbouring line."""
import re, sys, collections, argparse, os
ap = argparse.ArgumentParser()
ap.add_argument('cg'); ap.add_argument('--src', default='/workspace/wt/parser'); ap.add_argument('--min', type=int, default=1)
ap.add_argument('--pat', default=r'starts_for_parse_only|is_lint_parse\(\)|sidecar_mark\(\)|lint_logged|fn is_lint_parse|matches!\(&self\.starts_for_parse_only')
o = ap.parse_args()
rx = re.compile(o.pat); cache = {}
def text(p, ln):
    if p not in cache:
        q = p if os.path.isabs(p) else os.path.join(o.src, p)
        try: cache[p] = open(q, errors='replace').read().split('\n')
        except OSError: cache[p] = None
    L = cache[p]
    return L[ln - 1].strip() if L and 0 < ln <= len(L) else ''
per = collections.defaultdict(lambda: [0, 0, 0, 0, 0]); fn = None; fl = None; cur = None
with open(o.cg, errors='replace') as f:
    for line in f:
        c = line[0]
        if c == 'f':
            if line.startswith('fl='): fl = line[3:].rstrip('\n'); cur = fl
            elif line.startswith(('fi=', 'fe=')): cur = line[3:].rstrip('\n')
            elif line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)', '', line[3:].rstrip('\n')); cur = fl
            continue
        if not c.isdigit() or 'js_parser' not in cur: continue
        parts = line.split(); ln = int(parts[0])
        if not rx.search(text(cur, ln)): continue
        p = per[(cur, ln, fn)]
        for i in range(1, min(len(parts), 6)): p[i - 1] += int(parts[i])
tot = [0, 0]
for (path, ln, fn), v in sorted(per.items(), key=lambda kv: -kv[1][1]):
    tot[0] += v[0]; tot[1] += v[1]
    if v[1] < o.min and v[0] < o.min: continue
    short = re.sub(r'^<bun_js_parser::p::P<(\w+), (\w+)>>::', r'P<\1,\2>::', fn)[:60]
    print(f"{v[0]:>11,} {v[1]:>10,}  {path.replace('src/js_parser/', '')}:{ln}  [{short}]  {text(path, ln)[:90]}")
print(f"{tot[0]:>11,} {tot[1]:>10,}  SUM Ir, Bc on {len(per)} (line, function) pairs")
