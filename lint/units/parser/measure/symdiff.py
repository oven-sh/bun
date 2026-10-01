#!/usr/bin/env python3
"""Compare the sizes of bun_js_parser text symbols of two bun-profile binaries by demangled name.
The " (.llvm.<hash>)" suffix of a symbol that ThinLTO promoted changes with the crate: it is cut.
The two spellings of the sink argument (<false>/<true> before the sink trait, the type after) are one name.
usage: symdiff.py <a> <b> [--all] [--match REGEX]"""
import re, subprocess, sys, collections
RX = None
for i, arg in enumerate(sys.argv):
    if arg == '--match': RX = re.compile(sys.argv[i + 1])
def load(binary):
    out = subprocess.run(['llvm-nm', '-S', '--defined-only', '-C', binary], capture_output=True, text=True, errors='replace').stdout
    d = collections.defaultdict(list)
    for line in out.splitlines():
        m = re.match(r'^([0-9a-f]+) ([0-9a-f]+) (\w) (.*)$', line)
        if not m or m.group(3) not in 'tTwW': continue
        name = m.group(4)
        if 'bun_js_parser' not in name: continue
        name = re.sub(r' \(\.llvm\.\d+\)$', '', name)
        if RX and not RX.search(name): continue
        # normalise the names of the two sink spellings
        name = name.replace('::<bun_js_parser::parse::type_sink::Discard>', '::<SINK discard>').replace('::<bun_js_parser::parse::type_sink::DecoratorMetadata>', '::<SINK metadata>')
        name = re.sub(r'(skip_type_script_(?:type_with_opts|paren_or_fn_type))::<false>', r'\1::<SINK discard>', name)
        name = re.sub(r'(skip_type_script_(?:type_with_opts|paren_or_fn_type))::<true>', r'\1::<SINK metadata>', name)
        d[name].append(int(m.group(2), 16))
    return d
a = load(sys.argv[1]); b = load(sys.argv[2])
same = diff = 0; only_a = only_b = 0; rows = []
for name in sorted(set(a) | set(b)):
    sa = sorted(a.get(name, [])); sb = sorted(b.get(name, []))
    if not sa: only_b += 1; rows.append((0, sum(sb), name)); continue
    if not sb: only_a += 1; rows.append((sum(sa), 0, name)); continue
    if sa == sb: same += 1
    else: diff += 1; rows.append((sum(sa), sum(sb), name))
ta = sum(sum(v) for v in a.values()); tb = sum(sum(v) for v in b.values())
print(f'names: same size {same}, different size {diff}, only in a {only_a}, only in b {only_b}; bytes a {ta} b {tb} delta {tb - ta:+}')
rows.sort(key=lambda r: -abs(r[1] - r[0]))
n = len(rows) if '--all' in sys.argv else 40
for x, y, name in rows[:n]:
    print(f'{x:>8} {y:>8} {y - x:>+7}  {name[:170]}')
