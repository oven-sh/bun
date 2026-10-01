#!/usr/bin/env python3
"""How often the sites of the parse_paren_expr seam run in the transpiler benchmark, from the cachegrind files of the
BASE build (measure/base/cg-b/b-run1.<group>.cg, 20 passes per group; the counts of parser symbols are equal from run to run).
usage: linecounts.py [<dir with b-run1.<group>.cg>]
A line of source gives (Ir, Bc): instructions and conditional branches executed on that line inside the named function.
A site that costs k instructions and one branch per execution therefore adds k*count instructions and count branches."""
import re, sys, collections
d = sys.argv[1] if len(sys.argv) > 1 else '/workspace/notes/lint/units/parser/measure/base/cg-b'
def lines(path, want_file, rng, fnrx):
    res = collections.defaultdict(lambda: [0, 0]); fl = None; fn = None
    for line in open(path, errors='replace'):
        if line.startswith(('fl=', 'fi=', 'fe=')): fl = line[3:].strip(); continue
        if line.startswith('fn='): fn = line[3:].strip(); continue
        if fl and fl.endswith(want_file) and fn and re.search(fnrx, fn):
            p = line.split()
            if p and p[0].isdigit() and int(p[0]) in rng:
                res[int(p[0])][0] += int(p[1]); res[int(p[0])][1] += int(p[2]) if len(p) > 2 else 0
    return res
def totals(path, fnrx):
    tot = collections.defaultdict(lambda: [0, 0]); fn = None; alli = allc = pi = pc = 0
    for line in open(path, errors='replace'):
        if line.startswith('fn='): fn = line[3:].strip(); continue
        if line.startswith(('fl=', 'fi=', 'fe=')): continue
        p = line.split()
        if fn and p and p[0].isdigit():
            i = int(p[1]); c = int(p[2]) if len(p) > 2 else 0
            alli += i; allc += c
            if 'bun_js_parser' in fn: pi += i; pc += c
            if re.search(fnrx, fn): tot[fn[:100]][0] += i; tot[fn[:100]][1] += c
    return tot, (alli, allc), (pi, pc)
SITES = [
    ('parse_prefix.rs', 'js_parser/parse/parse_prefix.rs', r'parse_prefix$', [51, 57, 64, 934, 936, 965, 969, 983]),
    ('parse/mod.rs parse_paren_expr', 'js_parser/parse/mod.rs', r'parse_paren_expr$', [439, 451, 471, 473, 479, 514, 519, 571, 572, 601, 612, 615, 651, 652]),
    ('parse/mod.rs parse_async_prefix_expr', 'js_parser/parse/mod.rs', r'parse_async_prefix_expr$', [1684, 1685, 1708, 1709]),
    ('parse_skip_typescript.rs inlined into parse_paren_expr', 'js_parser/parse/parse_skip_typescript.rs', r'parse_paren_expr$', [24, 45, 1247, 1249, 1257, 1386, 1399]),
    ('parse_suffix.rs', 'js_parser/parse/parse_suffix.rs', r'parse_suffix$', [411, 414, 421, 426, 430]),
]
for g in ['js-control', 'tsx', 'src-js', 'bun-types', 'typescript-lib']:
    path = '%s/b-run1.%s.cg' % (d, g)
    tot, allt, part = totals(path, r'restore_parser_snapshot$|>::parse_paren_expr$|>::parse_prefix$|parse_async_prefix_expr$')
    print('== %s: program Ir %d Bc %d ; bun_js_parser symbols Ir %d Bc %d' % (g, allt[0], allt[1], part[0], part[1]))
    for k, v in sorted(tot.items()): print('   function %-75s Ir %11d Bc %10d' % (k, v[0], v[1]))
    for label, f, fnrx, rng in SITES:
        r = lines(path, f, set(rng), fnrx)
        if r: print('   %-52s %s' % (label, '  '.join('%d:(%d,%d)' % (k, v[0], v[1]) for k, v in sorted(r.items()))))
