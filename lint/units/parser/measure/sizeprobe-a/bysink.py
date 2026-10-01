#!/usr/bin/env python3
# usage: bysink.py <bun-profile>  ; text bytes of bun_js_parser symbols by parser instantiation and by type sink, counted once per address
import re, subprocess, sys, collections
out = subprocess.run(['llvm-nm', '-S', '--defined-only', '-C', sys.argv[1]], capture_output=True, text=True, errors='replace').stdout
by_addr = {}
for line in out.splitlines():
    m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
    if not m or m.group(3) not in 'tTwW' or 'bun_js_parser' not in m.group(4): continue
    by_addr.setdefault(int(m.group(1), 16), []).append((int(m.group(2), 16), m.group(4)))
tab = collections.defaultdict(lambda: [0, 0])
for addr, v in by_addr.items():
    size = max(s for s, _ in v)
    names = [n for _, n in v]
    insts = sorted({m.group(0) for n in names for m in re.finditer(r'P<(true|false), ?(true|false)>', n)}) or ['(no P)']
    sinks = sorted({m.group(1) for n in names for m in re.finditer(r'type_sink::(Build|Discard|DecoratorMetadata)\b', n)}) or ['(no sink in name)']
    key = ('+'.join(insts) if len(insts) > 1 else insts[0], '+'.join(sinks))
    tab[key][0] += 1; tab[key][1] += size
print('%-34s %-34s %6s %10s' % ('instantiation', 'sink named in the symbol', 'syms', 'bytes'))
for k in sorted(tab):
    print('%-34s %-34s %6d %10s' % (k[0], k[1], tab[k][0], format(tab[k][1], ',')))
print('%-34s %-34s %6d %10s' % ('total', '', len(by_addr), format(sum(max(s for s, _ in v) for v in by_addr.values()), ',')))
