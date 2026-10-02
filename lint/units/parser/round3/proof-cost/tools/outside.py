#!/usr/bin/env python3
"""Per-function difference of two cachegrind runs, five groups side by side, split by the file that defines the function.
usage: outside.py <dir> <tagA> <tagB> [--srca ROOT] [--srcb ROOT] [--ev ir|bc|bi] [--min N] [--grammar] [--strip-p] [--grammar-files a.rs,b.rs]
A symbol is of the type grammar when the function of its name is defined in one of GRAMMAR_FILES (either tree);
--grammar lists those instead of the others. --strip-p cuts the const arguments of P from the names: identical code
folding keeps one body for several instantiations and cachegrind names it by any of them (main: P<true, true>)."""
import re, sys, os, collections
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
pos = [a for a in sys.argv[1:] if not a.startswith('--') and a not in (arg('--srca', None), arg('--srcb', None), arg('--ev', None), arg('--min', None), arg('--grammar-files', None))]
D, TA, TB = pos[0], pos[1], pos[2]
SRCA = arg('--srca', '/tmp/proofcost/base-src'); SRCB = arg('--srcb', '/workspace/wt/parser')
EV = {'ir': 0, 'bc': 1, 'bi': 3}[arg('--ev', 'bc')]; MIN = int(arg('--min', '1'))
GROUPS = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
GRAMMAR_FILES = tuple(arg('--grammar-files', 'parse/parse_skip_typescript.rs,parse/type_sink.rs').split(','))
def fnfiles(root):
    m = collections.defaultdict(set)
    base = root + '/src/js_parser'
    for d, _, fs in os.walk(base):
        for f in fs:
            if not f.endswith('.rs'): continue
            p = os.path.join(d, f); rel = os.path.relpath(p, base)
            for x in re.finditer(r'\bfn (\w+)', open(p, errors='replace').read()): m[x.group(1)].add(rel)
    return m
FA, FB = fnfiles(SRCA), fnfiles(SRCB)
def home(sym):
    m = re.search(r'>::(\w+)(?:::<.*>)?(?:::\{closure.*)?$', sym) or re.search(r'::(\w+)(?:::<.*>)?$', sym)
    name = m.group(1) if m else sym
    files = FB.get(name, set()) | FA.get(name, set())
    return name, files
def load(path):
    per = collections.defaultdict(lambda: [0, 0, 0, 0, 0]); fn = None; ev = []
    with open(path, errors='replace') as f:
        for line in f:
            if line.startswith('events:'): ev = line.split()[1:]; continue
            if line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)', '', line[3:].rstrip('\n')); continue
            if not line[:1].isdigit(): continue
            parts = line.split(); p = per[fn]
            for i in range(1, min(len(parts), 6)): p[i - 1] += int(parts[i])
    return per
def norm(sym):
    # the two spellings of one function: base folds P<true,true> with P<true,false>; sink spellings
    s = sym.replace('bun_js_parser::', '').replace('parse::type_sink::', '')
    if '--strip-p' in sys.argv: s = re.sub(r'P<(true|false), ?(true|false)>', 'P', s)
    return s
rows = collections.defaultdict(lambda: [0] * 5); tot = {}
for gi, g in enumerate(GROUPS):
    a = load(f'{D}/{TA}.{g}.cg'); b = load(f'{D}/{TB}.{g}.cg')
    for n in set(a) | set(b):
        if not n or 'bun_js_parser' not in n: continue
        d = b.get(n, [0] * 5)[EV] - a.get(n, [0] * 5)[EV]
        if d: rows[norm(n)][gi] += d
out = []
for n, v in rows.items():
    name, files = home(n)
    is_grammar = bool(files) and all(f in GRAMMAR_FILES for f in files)
    out.append((is_grammar, n, v, sorted(files)))
want = '--grammar' in sys.argv
sel = [r for r in out if r[0] == want and max(abs(x) for x in r[2]) >= MIN]
sel.sort(key=lambda r: -max(abs(x) for x in r[2]))
s_in = [sum(r[2][i] for r in out if r[0]) for i in range(5)]; s_out = [sum(r[2][i] for r in out if not r[0]) for i in range(5)]
print(f"{arg('--ev', 'bc')} {TB} - {TA}".ljust(28) + ''.join(g.rjust(15) for g in GROUPS))
print('type grammar files'.ljust(28) + ''.join(f'{x:+,}'.rjust(15) for x in s_in))
print('outside'.ljust(28) + ''.join(f'{x:+,}'.rjust(15) for x in s_out))
print('all parser symbols'.ljust(28) + ''.join(f'{x + y:+,}'.rjust(15) for x, y in zip(s_in, s_out)))
for _, n, v, files in sel:
    print(''.join((f'{x:+,}' if x else '.').rjust(13) for x in v) + '  ' + n[:96] + '  [' + ','.join(f.replace('parse/', '') for f in files)[:40] + ']')
