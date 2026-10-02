#!/usr/bin/env python3
"""Functions of src/js_parser whose source text differs between two trees, by file and fn name.
usage: srcfn.py <base tree> <head tree>      (base tree: see mkbase.sh; head tree: /workspace/bun)
A function is the text from its `fn` line to the first later line that is `}` at the same indent; whitespace and
comment lines are ignored. Per file: `~name:first-last` the text differs, `+name:line` only in the head, `-name` only in
the base. A function of a file that is not listed has the text of the base: where its machine code still differs
(fncmp.py), the cause is outside the function (the layout of a type, a callee that was inlined or specialised)."""
import re, sys, os, collections
A, B = sys.argv[1], sys.argv[2]
def fns(path):
    try: L = open(path, errors='replace').read().split('\n')
    except OSError: return None
    out = collections.OrderedDict(); seen = collections.Counter(); i = 0
    while i < len(L):
        m = re.match(r'^(\s*)(?:pub(?:\([a-z]+\))? )?(?:const )?(?:unsafe )?(?:extern "C" )?fn (\w+)', L[i])
        if not m: i += 1; continue
        ind, name = m.group(1), m.group(2)
        if L[i].rstrip().endswith(';'): i += 1; continue
        j = i
        while j < len(L) and L[j] != ind + '}': j += 1
        body = ''.join(re.sub(r'\s+', '', x) for x in L[i:j + 1] if not x.strip().startswith('//'))
        seen[name] += 1
        out[(name, seen[name])] = (i + 1, j + 1, body)
        i = i + 1      # nested fns are found too
    return out
root = 'src/js_parser'
files = []
for d, _, fs in os.walk(os.path.join(B, root)):
    for f in fs:
        if f.endswith('.rs'): files.append(os.path.relpath(os.path.join(d, f), B))
changed = collections.OrderedDict()
for f in sorted(files):
    fa, fb = fns(os.path.join(A, f)), fns(os.path.join(B, f))
    if fa is None: changed[f] = 'NEW FILE (%d fns)' % len(fb); continue
    rows = []
    for k, (s, e, body) in fb.items():
        if k not in fa: rows.append('+%s:%d' % (k[0], s))
        elif fa[k][2] != body: rows.append('~%s:%d-%d' % (k[0], s, e))
    for k in fa:
        if k not in fb: rows.append('-%s' % k[0])
    if rows: changed[f] = rows
for f, rows in changed.items():
    if isinstance(rows, str): print(f, rows)
    else: print('%s (%d): %s' % (f, len(rows), ' '.join(rows)))
