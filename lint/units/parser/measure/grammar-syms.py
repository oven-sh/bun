#!/usr/bin/env python3
"""Every text symbol of the type grammar in a bun-profile binary: size, address, demangled name.
A symbol belongs to the grammar when its name has skip_type_script, skip_typescript or type_sink.
Symbols that share an address are one function (identical code folding): they are printed together.
usage: grammar-syms.py <bun-profile> [--json]"""
import json, re, subprocess, sys

binary = sys.argv[1]
out = subprocess.run(['llvm-nm', '-S', '--defined-only', '-C', binary], capture_output=True, text=True, errors='replace').stdout
by_addr = {}
for line in out.splitlines():
    m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
    if not m or m.group(3) not in 'tTwW':
        continue
    name = m.group(4)
    if 'bun_js_parser' not in name:
        continue
    by_addr.setdefault(int(m.group(1), 16), []).append((int(m.group(2), 16), name))
rows = []
for addr, syms in by_addr.items():
    if not any(re.search(r'skip_type_?script|type_sink', n) for _, n in syms):
        continue
    rows.append({'size': max(s for s, _ in syms), 'addr': addr, 'names': sorted(n for _, n in syms)})
rows.sort(key=lambda r: (r['names'][0], r['addr']))


def group(name):
    if 'DecoratorMetadata' in name:
        sink = 'DecoratorMetadata'
    elif 'Discard' in name:
        sink = 'Discard'
    elif 'Build' in name:
        sink = 'Build'
    else:
        sink = '-'
    m = re.search(r'P<(true|false), ?(true|false)>', name)
    return (m.group(0).replace(' ', '') if m else '-', sink)


totals = {}
for r in rows:
    key = group(r['names'][0])
    n, b = totals.get(key, (0, 0))
    totals[key] = (n + 1, b + r['size'])
if '--json' in sys.argv:
    print(json.dumps({'symbols': rows, 'totals': {'%s %s' % k: v for k, v in sorted(totals.items())}}))
    sys.exit(0)
for r in rows:
    print('%8d  %x  %s' % (r['size'], r['addr'], r['names'][0]))
    for n in r['names'][1:]:
        print('%8s  %s  = %s' % ('', ' ' * len('%x' % r['addr']), n))
print()
for k, (n, b) in sorted(totals.items()):
    print('total %-14s %-18s %4d symbols %9d bytes' % (k[0], k[1], n, b))
print('total %-33s %4d symbols %9d bytes' % ('type grammar', len(rows), sum(r['size'] for r in rows)))
