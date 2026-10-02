#!/usr/bin/env python3
"""Difference of two cachegrind files per FUNCTION BODY, robust against identical code folding.
usage: cgclass.py <a bun-profile> <a.cg> <b bun-profile> <b.cg> [--match REGEX] [--top N] [--json] [--rows] [--names]
                  [--src TREE [--site REGEX]]
The linker keeps one body for functions with the same bytes, and cachegrind names it by ONE of its symbols; which one
depends on the other symbols at that address, so the same body can carry another name in the other binary, and a sum over
names that match a pattern can move without a change of code. Here every text symbol of a binary that shares an address
is one class, and a class of a and one of b that share a name are one class. A class is of the parser when one of its
names, in either binary, matches --match (default: bun_js_parser).
Prints: program totals; the sums over the names that match (what cgsum.py prints); the sums over the classes of the
parser; the classes whose Ir, Bc or Bi differ. --names lists the cachegrind names that no symbol of the binary has.
--src TREE (the sources of b; the .cg files must be of cgbench-raw.sh): per class also `tests`, the Bc of b on the lines of
src/js_parser whose text matches --site (default: a line that starts with `if p.lint()` or `if self.lint()`), and a verdict:
  ok       Bc b - a = tests and Ir b - a = 2 x tests (one compare and one jump per executed test, nothing else)
  IR       Bc b - a = tests, the instructions differ by something else too: explain line by line (cglinediff.py)
  BC       Bc b - a is not the number of executed tests: a conditional jump that is no test was added or removed
  NO-SITE  no test ran in the function and its counts differ: it pays on a path that reaches no site"""
import os, re, subprocess, sys, collections, json
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
RX = re.compile(arg('--match', 'bun_js_parser')); TOP = int(arg('--top', '40'))
SRC = arg('--src', None); SITE = re.compile(arg('--site', r'^\s*if (?:p|self)\.lint\(\)'))
pos = [a for a in sys.argv[1:] if not a.startswith('--') and a not in (arg('--match', None), arg('--top', None), SRC, arg('--site', None))]
BA, CA, BB, CB = pos[:4]
def clean(n):
    n = re.sub(r' \(\.llvm\.\d+\)', '', n)
    # the two spellings of the sink argument of the skipper are one name: <false>/<true> on main, the sink type after
    n = n.replace('::<bun_js_parser::parse::type_sink::Discard>', '::<SINK discard>').replace('::<bun_js_parser::parse::type_sink::DecoratorMetadata>', '::<SINK metadata>')
    n = re.sub(r'(skip_type_script_(?:type_with_opts|paren_or_fn_type))::<false>', r'\1::<SINK discard>', n)
    return re.sub(r'(skip_type_script_(?:type_with_opts|paren_or_fn_type))::<true>', r'\1::<SINK metadata>', n)
parent = {}
def find(x):
    while parent.setdefault(x, x) != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
def union(a, b):
    a, b = find(a), find(b)
    if a != b: parent[max(a, b)] = min(a, b)
def symbols(path):
    nm = subprocess.run(['llvm-nm', '--defined-only', '-C', path], capture_output=True, text=True, errors='replace').stdout
    at = collections.defaultdict(list); names = set()
    for line in nm.splitlines():
        m = re.match(r'^([0-9a-f]+) (\w) (.*)$', line)
        if not m or m.group(2) not in 'tTwW': continue
        n = clean(m.group(3)); at[m.group(1)].append(n); names.add(n)
    for ns in at.values():
        for n in ns[1:]: union(ns[0], n)
    return names
_src = {}
def is_site(path, ln):
    if path not in _src:
        try: _src[path] = open(path if os.path.isabs(path) else os.path.join(SRC, path), errors='replace').read().split('\n')
        except OSError: _src[path] = None
    L = _src[path]
    return bool(L and 0 < ln <= len(L) and SITE.search(L[ln - 1]))
def load(path, sites=None):
    per = collections.defaultdict(lambda: [0, 0, 0]); fn = None; fl = cur = None
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fn='): fn = clean(line[3:].rstrip('\n')); cur = fl
                elif line.startswith('fl='): fl = line[3:].rstrip('\n'); cur = fl
                elif line.startswith(('fi=', 'fe=')): cur = line[3:].rstrip('\n')
                continue
            if not c.isdigit(): continue
            p = line.split(); v = per[fn]
            v[0] += int(p[1])
            if len(p) > 2: v[1] += int(p[2])
            if len(p) > 4: v[2] += int(p[4])
            if sites is not None and len(p) > 2 and p[2] != '0' and cur and 'js_parser' in cur and is_site(cur, int(p[0])): sites[fn] += int(p[2])
    return per
na = symbols(BA); nb = symbols(BB)
site_by_name = collections.Counter() if SRC else None
a = load(CA); b = load(CB, site_by_name)
members = collections.defaultdict(set)
for n in na | nb | set(a) | set(b): members[find(n)].add(n)
def by_class(per):
    out = collections.defaultdict(lambda: [0, 0, 0])
    for n, v in per.items():
        c = out[find(n)]
        for i in range(3): c[i] += v[i]
    return out
ca, cb = by_class(a), by_class(b)
tot = lambda d: [sum(v[i] for v in d.values()) for i in range(3)]
name_sum = lambda d: [sum(v[i] for n, v in d.items() if n and RX.search(n)) for i in range(3)]
parser = {c for c, ms in members.items() if any(RX.search(m) for m in ms)}
class_sum = lambda d: [sum(v[i] for c, v in d.items() if c in parser) for i in range(3)]
def label(c):
    ms = sorted(members[c], key=lambda m: (not RX.search(m), len(m), m))
    return ms[0] + (' [+%d names]' % (len(ms) - 1) if len(ms) > 1 else '')
tests = collections.Counter()
if SRC:
    for n, k in site_by_name.items(): tests[find(n)] += k
rows = []
for c in set(ca) | set(cb):
    if c not in parser: continue
    x = ca.get(c, [0, 0, 0]); y = cb.get(c, [0, 0, 0])
    if x != y or tests[c]: rows.append((y[0] - x[0], y[1] - x[1], y[2] - x[2], x[0], c))
rows.sort(key=lambda r: -abs(r[0]))
res = {'tests': sum(tests.values()), 'program': {'a': tot(a), 'b': tot(b)}, 'by_name': {'a': name_sum(a), 'b': name_sum(b)}, 'by_class': {'a': class_sum(ca), 'b': class_sum(cb)},
       'classes_that_differ': len(rows)}
if '--json' in sys.argv: print(json.dumps(res)); sys.exit(0)
if '--rows' in sys.argv:
    # for other tools: one line per class that differs, `Ir<TAB>Bc<TAB>Bi<TAB>name`
    for dI, dC, dB, base, c in rows: print('%d\t%d\t%d\t%s' % (dI, dC, dB, label(c)))
    sys.exit(0)
def line(tag, x, y): print('%-26s Ir %15s -> %15s (%+d)  Bc %14s -> %14s (%+d)  Bi %12s -> %12s (%+d)' % (tag, f'{x[0]:,}', f'{y[0]:,}', y[0] - x[0], f'{x[1]:,}', f'{y[1]:,}', y[1] - x[1], f'{x[2]:,}', f'{y[2]:,}', y[2] - x[2]))
line('program', tot(a), tot(b))
line('names that match', name_sum(a), name_sum(b))
line('classes of the parser', class_sum(ca), class_sum(cb))
print('%d classes of the parser differ' % len(rows))
bad = 0; verdicts = collections.Counter()
for k, (dI, dC, dB, base, c) in enumerate(rows):
    extra = ''
    if SRC:
        t = tests[c]
        v = 'ok     ' if (dC == t and dI == 2 * t and dB == 0) else 'NO-SITE' if t == 0 else 'BC     ' if dC != t or dB else 'IR     '
        bad += 0 if v == 'ok     ' else 1; verdicts[v.strip()] += 1
        extra = '  tests %9d  %s' % (t, v)
    if k < TOP: print('  Ir %+12d  Bc %+11d  Bi %+9d%s  (a Ir %s)  %s' % (dI, dC, dB, extra, f'{base:,}', label(c)[:150]))
if SRC:
    print('tests %d (Bc of b on the lines of the sites); Bc b - a of the parser %+d; functions: %s' % (sum(tests.values()), class_sum(cb)[1] - class_sum(ca)[1], ', '.join('%s %d' % kv for kv in sorted(verdicts.items())) or 'none differ'))
if '--names' in sys.argv:
    for tag, per, names in (('a', a, na), ('b', b, nb)):
        miss = sorted((v[0], n) for n, v in per.items() if n and n not in names and RX.search(n))
        print('%s: %d cachegrind names that match and that no symbol of the binary has' % (tag, len(miss)))
        for ir, n in miss[-10:]: print('     %12d  %s' % (ir, n[:160]))
