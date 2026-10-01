# Reads an lcov export of the scratch tests and prints, for the files of steps 6 to 8, the lines that ran and the functions that no test entered.
# usage: coverage.py <tc.lcov> <file with the function names, one per line>
import re, sys
fns = open(sys.argv[2]).read().split()
cur = None; counts = {}; lines = {}
FILES = ('c04_name_resolution_hooks.rs', 'c21_resolved_symbols_diagnostics.rs', 'c22_symbols_merge.rs', 'c23_alias_targets.rs', 'c24_external_modules.rs', 'c25_entity_names.rs', 'c26_exports_late_binding.rs', 'c27_resolve_alias.rs', 'module/types.rs', 'module/util.rs', 'binder/nameresolver.rs', 'core/nodemodules.rs')
mine = lambda f: '/src/typecheck/' in f and f.endswith(FILES)
for l in open(sys.argv[1]):
    l = l.strip()
    if l.startswith('SF:'): cur = l[3:]
    elif cur and mine(cur) and l.startswith('FNDA:'):
        cnt, name = l[5:].split(',', 1)
        key = (cur.split('/')[-1], name)
        counts[key] = counts.get(key, 0) + int(cnt)
    elif cur and mine(cur) and l.startswith('DA:'):
        ln, cnt = l[3:].split(',')[:2]
        d = lines.setdefault(cur, {})
        d[int(ln)] = d.get(int(ln), 0) + int(cnt)
for f in sorted(lines):
    d = lines[f]; tot = len(d); hit = sum(1 for v in d.values() if v > 0)
    print(f"{f.split('/src/typecheck/')[1]:48} lines {hit}/{tot} ({100 * hit // max(tot, 1)}%)")
hit = set(); seen = set()
for (f, mangled), cnt in counts.items():
    if not f.startswith('c'): continue
    best = None
    for fn in fns:
        if f"{len(fn)}{fn}" in mangled and (best is None or len(fn) > len(best)): best = fn
    if best:
        seen.add(best)
        if cnt > 0: hit.add(best)
print("functions of checker.go in steps 6 to 8:", len(fns), "entered by the tests:", len(hit))
print("not entered:", ' '.join(sorted(fn for fn in fns if fn not in hit)))
