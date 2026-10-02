#!/usr/bin/env python3
"""Pre-check without cachegrind, by size only: the parser symbols that JavaScript runs against the ones of the base.
usage: jscheck.py <base bun-profile> <head bun-profile> [--inst REGEX] [--all]
Compares, by demangled name (the ThinLTO suffix cut), the set and the sizes of the text symbols of bun_js_parser whose
name matches --inst (default: P<false, false> and P<false, true>). A name in one binary only, or another size, is code
that differs. The same size is not the same code: fncmp.py compares the instructions and tells a moved field from a change."""
import re, subprocess, sys, collections
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
RX = re.compile(arg('--inst', r'P<false, ?(false|true)>'))
paths = [a for a in sys.argv[1:] if not a.startswith('--') and a != arg('--inst', None)]
def load(binary):
    out = subprocess.run(['llvm-nm', '-S', '--defined-only', '-C', binary], capture_output=True, text=True, errors='replace').stdout
    d = collections.defaultdict(list)
    for line in out.splitlines():
        m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
        if not m or m.group(3) not in 'tTwW': continue
        name = re.sub(r' \(\.llvm\.\d+\)', '', m.group(4))
        if 'bun_js_parser' not in name or not RX.search(name): continue
        d[name].append(int(m.group(2), 16))
    return d
a = load(paths[0]); b = load(paths[1])
def grp(name):
    m = re.search(r'P<(true|false), ?(true|false)>', name)
    return m.group(0).replace(' ', '') if m else 'no P<..>'
rows = []; stat = collections.defaultdict(lambda: [0, 0, 0, 0, 0, 0])
for name in sorted(set(a) | set(b)):
    sa = sorted(a.get(name, [])); sb = sorted(b.get(name, [])); st = stat[grp(name)]
    st[4] += sum(sa); st[5] += sum(sb)
    if not sa: st[3] += 1; rows.append((grp(name), 0, sum(sb), 'NEW ', name))
    elif not sb: st[2] += 1; rows.append((grp(name), sum(sa), 0, 'GONE', name))
    elif sa == sb: st[0] += 1
    else: st[1] += 1; rows.append((grp(name), sum(sa), sum(sb), 'SIZE', name))
for g, st in sorted(stat.items()):
    print(f'{g:16} same size {st[0]:4}  other size {st[1]:4}  only base {st[2]:4}  only head {st[3]:4}  bytes {st[4]:,} -> {st[5]:,} ({st[5] - st[4]:+,})')
rows.sort(key=lambda r: (r[0], -abs(r[2] - r[1])))
for g, x, y, kind, name in rows[:len(rows) if '--all' in sys.argv else 60]:
    print(f'  {g:16} {kind} {x:>7} {y:>7} {y - x:>+7}  {name[:150]}')
print('PASS' if not rows else f'FAIL: {len(rows)} symbols differ')
