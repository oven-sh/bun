#!/usr/bin/env python3
"""Call counts of a callgrind file: calls into the functions whose name matches, by caller.
usage: clgcalls.py <file.clg> --callee REGEX [--top N]      also: --fncalls REGEX  (total calls into each matching function)"""
import re, sys, collections, argparse
ap = argparse.ArgumentParser(); ap.add_argument('f'); ap.add_argument('--callee'); ap.add_argument('--fncalls'); ap.add_argument('--top', type=int, default=40)
o = ap.parse_args()
names = {}
def name(tok):
    m = re.match(r'\((\d+)\)(?: (.*))?$', tok)
    if not m: return tok
    if m.group(2) is not None: names[m.group(1)] = m.group(2)
    return names.get(m.group(1), '?' + m.group(1))
calls = collections.Counter(); incl = collections.Counter(); total = collections.Counter(); self_ir = collections.Counter()
fn = None; cfn = None; pending = None
for line in open(o.f, errors='replace'):
    if line.startswith('fn='): fn = name(line[3:].rstrip('\n')); cfn = None; continue
    if line.startswith('cfn='): cfn = name(line[4:].rstrip('\n')); continue
    if line.startswith(('fl=', 'fi=', 'fe=', 'cfi=', 'cfl=', 'ob=', 'cob=')):
        # file/object names share no id space with fn names
        continue
    if line.startswith('calls='):
        pending = int(line[6:].split()[0]); continue
    if pending is not None:
        parts = line.split()
        c = int(parts[1]) if len(parts) > 1 else 0
        calls[(fn, cfn)] += pending; incl[(fn, cfn)] += c; total[cfn] += pending; pending = None; continue
    if line[:1].isdigit() or line[:1] in '+-':
        parts = line.split()
        if len(parts) > 1 and fn: self_ir[fn] += int(parts[1])
def short(n):
    n = re.sub(r' \(\.llvm\.\d+\)', '', n or '')
    return n.replace('bun_js_parser::', '').replace('parse::type_sink::', '')
if o.fncalls:
    rx = re.compile(o.fncalls)
    for n, c in sorted(total.items(), key=lambda kv: -kv[1]):
        if n and rx.search(n): print(f"{c:>10,}  self Ir {self_ir[n]:>12,}  {short(n)[:150]}")
if o.callee:
    rx = re.compile(o.callee)
    rows = [(c, k) for k, c in calls.items() if k[1] and rx.search(k[1])]
    rows.sort(key=lambda r: -r[0])
    print(f"total calls {sum(r[0] for r in rows):,}")
    for c, (a, b) in rows[:o.top]:
        print(f"{c:>10,}  incl Ir {incl[(a, b)]:>12,}  {short(a)[:110]}  ->  {short(b)[:60]}")
