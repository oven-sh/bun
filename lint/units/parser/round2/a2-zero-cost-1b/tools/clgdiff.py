#!/usr/bin/env python3
"""Calls into the functions matching --callee, by caller, of two callgrind files side by side.
usage: clgdiff.py <a.clg> <b.clg> --callee REGEX [--min N]"""
import re, sys, collections, argparse
ap = argparse.ArgumentParser(); ap.add_argument('a'); ap.add_argument('b'); ap.add_argument('--callee', required=True); ap.add_argument('--min', type=int, default=1)
o = ap.parse_args()
def load(path):
    names = {}
    def name(tok):
        m = re.match(r'\((\d+)\)(?: (.*))?$', tok)
        if not m: return tok
        if m.group(2) is not None: names[m.group(1)] = m.group(2)
        return names.get(m.group(1), '?' + m.group(1))
    calls = collections.Counter(); fn = None; cfn = None
    rx = re.compile(o.callee)
    for line in open(path, errors='replace'):
        if line.startswith('fn='): fn = name(line[3:].rstrip('\n')); continue
        if line.startswith('cfn='): cfn = name(line[4:].rstrip('\n')); continue
        if line.startswith('calls=') and cfn and rx.search(cfn):
            k = re.sub(r" \(\.llvm\.\d+\)|'\d+$", '', fn).replace('bun_js_parser::', '').replace('parse::type_sink::', '')
            calls[k] += int(line[6:].split()[0])
    return calls
A = load(o.a); B = load(o.b)
print(f"total a {sum(A.values()):,}  b {sum(B.values()):,}  delta {sum(B.values())-sum(A.values()):+,}")
rows = sorted(((B[k] - A[k], A[k], B[k], k) for k in set(A) | set(B)), key=lambda r: -abs(r[0]))
for d, x, y, k in rows:
    if abs(d) >= o.min: print(f"{d:>+8,} {x:>8,} {y:>8,}  {k[:140]}")
