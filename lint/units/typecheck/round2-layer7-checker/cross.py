#!/usr/bin/env python3
"""Free functions, types, constants and variables of checker.go that a range of another module (or another file) of upstream uses."""
import re, os, sys
up = '/workspace/ref/typescript-go/internal/checker'
split = []
for line in open('/workspace/notes/lint/units/typecheck/checker-core-scratch/data/split.tsv'):
    p = line.rstrip('\n').split('\t')
    if len(p) < 5 or not p[0].isdigit(): continue
    a, b = p[1].split('-')
    split.append((int(a), int(b), p[4][:-3]))
def owner(n):
    for a, b, m in split:
        if a <= n <= b: return m
    return '?'
src = open(os.path.join(up, 'checker.go')).read().split('\n')
decls = {}  # name -> (line, kind)
inblock = None
for i, l in enumerate(src, 1):
    m = re.match(r'^func ([A-Za-z_][A-Za-z0-9_]*)\s*[\(\[]', l)
    if m: decls[m.group(1)] = (i, 'func'); continue
    m = re.match(r'^type ([A-Za-z_][A-Za-z0-9_]*)\b', l)
    if m: decls[m.group(1)] = (i, 'type'); continue
    m = re.match(r'^(const|var) ([A-Za-z_][A-Za-z0-9_]*)\b', l)
    if m: decls[m.group(2)] = (i, m.group(1)); continue
    m = re.match(r'^(const|var) \($', l)
    if m: inblock = m.group(1); continue
    if inblock:
        if l.startswith(')'): inblock = None; continue
        m = re.match(r'^\t([A-Za-z_][A-Za-z0-9_]*)\b', l)
        if m: decls[m.group(1)] = (i, inblock)
files = {f: open(os.path.join(up, f)).read().split('\n') for f in os.listdir(up) if f.endswith('.go') and not f.endswith('_test.go')}
want = set(sys.argv[1:])
out = {}
for name, (line, kind) in sorted(decls.items(), key=lambda kv: kv[1][0]):
    home = owner(line)
    if want and home not in want: continue
    pat = re.compile(r'(?<![A-Za-z0-9_.])' + re.escape(name) + r'(?![A-Za-z0-9_])')
    users = set()
    for f, lines in files.items():
        for j, l in enumerate(lines, 1):
            if f == 'checker.go' and j == line: continue
            code = l.split('//')[0]
            if pat.search(code):
                users.add(owner(j) if f == 'checker.go' else f[:-3])
    users.discard(home)
    if users: out.setdefault(home, []).append((line, kind, name, sorted(users)))
for home, items in out.items():
    print(home)
    for line, kind, name, users in items: print(f'   {line:6} {kind:5} {name:55} used by {" ".join(users)}')
