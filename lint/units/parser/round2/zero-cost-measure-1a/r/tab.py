#!/usr/bin/env python3
"""usage: tab.py <base.summary> <x.summary> ... : matched Ir/Bc/Bi deltas per group against the first file"""
import sys, json
def load(p):
    d = {}
    for line in open(p):
        parts = line.split(' ', 2)
        if len(parts) < 3 or not parts[2].startswith('{'): continue
        d[parts[1]] = json.loads(parts[2])
    return d
base = load(sys.argv[1])
print(f'{"":14}' + ''.join(f'{g:>16}' for g in base))
print(f'{"base Bc":14}' + ''.join(f'{base[g]["matched"]["Bc"]:>16,}' for g in base))
print(f'{"base Ir":14}' + ''.join(f'{base[g]["matched"]["Ir"]:>16,}' for g in base))
for p in sys.argv[2:]:
    x = load(p); tag = p.split('/')[-1].replace('.summary.txt', '').replace('cg.', '')
    for ev in ('Bc', 'Ir', 'Bi'):
        print(f'{tag + " d" + ev:14}' + ''.join(f'{x[g]["matched"][ev] - base[g]["matched"][ev]:>+16,}' if g in x else f'{"-":>16}' for g in base))
