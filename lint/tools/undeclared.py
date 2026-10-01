#!/usr/bin/env python3
"""Lists the .rs files of a crate that no `mod` line reaches from its root, so that cargo does not compile them.
usage: undeclared.py <crate dir> [root file, default lib.rs]   exit 1 when a file is not reached"""
import os, re, sys
crate = os.path.abspath(sys.argv[1])
root = os.path.join(crate, sys.argv[2] if len(sys.argv) > 2 else 'lib.rs')
MOD = re.compile(r'^\s*(?:#\[path\s*=\s*"([^"]+)"\]\s*)?(?:pub(?:\([^)]*\))?\s+)?mod\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)\s*;', re.M)
PATH_ATTR = re.compile(r'#\[path\s*=\s*"([^"]+)"\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)\s*;')
reached = set()
def visit(path):
    path = os.path.normpath(path)
    if path in reached or not os.path.isfile(path): return
    reached.add(path)
    text = open(path, errors='replace').read()
    here = os.path.dirname(path)
    base = os.path.basename(path)
    own = here if base in ('lib.rs', 'mod.rs', 'main.rs') else os.path.join(here, base[:-3])
    with_path = {m.group(2): m.group(1) for m in PATH_ATTR.finditer(text)}
    for m in MOD.finditer(text):
        name = m.group(2)
        if name in with_path:
            visit(os.path.join(here, with_path[name])); continue
        for cand in (os.path.join(own, name + '.rs'), os.path.join(own, name, 'mod.rs')):
            if os.path.isfile(cand): visit(cand); break
visit(root)
every = []
for d, _, files in os.walk(crate):
    if '/target' in d or '/testdata' in d or '/fixtures' in d: continue
    for f in files:
        if f.endswith('.rs'): every.append(os.path.normpath(os.path.join(d, f)))
missing = sorted(set(every) - reached)
lines = lambda p: sum(1 for _ in open(p, errors='replace'))
total = sum(lines(p) for p in every); done = sum(lines(p) for p in reached)
print(f'compiled by cargo: {len(reached)} of {len(every)} files, {done} of {total} lines')
if missing:
    by = {}
    for p in missing:
        k = os.path.relpath(p, crate).split(os.sep)[0]
        by.setdefault(k, [0, 0]); by[k][0] += 1; by[k][1] += lines(p)
    print('NOT reached from ' + os.path.relpath(root, crate) + ' (cargo does not compile these):')
    for k, (n, l) in sorted(by.items(), key=lambda kv: kv[1][1]): print(f'  {k:24} {n:4} files {l:7} lines')
    sys.exit(1)
