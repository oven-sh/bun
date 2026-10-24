#!/usr/bin/env python3
"""births.py > births.txt   (run inside a project folder; reads ./original.js)

For whoever writes the shapes: every place where the file creates an object.
 1. object literals with at least one member, grouped by their members in the order written, with the lines they stand at and the function around each
 2. constructor functions: the stores to `this`, in the order of the text (a chain `this.a = this.b = null` stores b first)
 3. parameters that are stored to (a minified bundle reuses them for values of other types)"""
import re, collections
L = open('original.js').read().split('\n'); T = '\n'.join(L)
fn = [None] * len(L); cur = None
for i, l in enumerate(L):
    m = re.match(r'(?:async )?function\*? ?(\w+)\(', l) or re.match(r'(?:var|let|const) (\w+) = (?:class|function|\()', l) or re.match(r'class (\w+)', l)
    if m: cur = m.group(1)
    fn[i] = cur
pos2line = []; 
for i, l in enumerate(L): pos2line += [i] * (len(l) + 1)
def members(body):
    out, depth, i, start = [], 0, 0, 0; s = None
    while i < len(body):
        c = body[i]
        if s:
            if c == '\\': i += 1
            elif c == s: s = None
        elif c in '"\'`': s = c
        elif c in '([{': depth += 1
        elif c in ')]}': depth -= 1
        elif c == ',' and depth == 0: out.append(body[start:i]); start = i + 1
        i += 1
    out.append(body[start:]); names = []
    for p in out:
        m = re.match(r'\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::|\(|$)', p)
        if p.strip().startswith('...'): names.append('...')
        elif m: names.append(m.group(1) or m.group(2))
        elif p.strip(): return None
    return names
G = collections.OrderedDict()
for m in re.finditer(r'(=|return|\(|,|:|\?|\[|&&|\|\|)\s*\{', T):
    a = m.end() - 1; depth = 0; i = a; s = None
    while i < len(T):
        c = T[i]
        if s:
            if c == '\\': i += 1
            elif c == s: s = None
        elif c in '"\'`': s = c
        elif c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: break
        i += 1
    body = T[a + 1:i]
    if re.search(r'^\s*(var|if|for|return|switch|try|throw|while|do|function|case|break|continue)\b', body) or ';' in re.sub(r'"[^"]*"|\'[^\']*\'|\{[^{}]*\}|function[^{]*\{.*?\}', '', body, flags=re.S)[:400]: continue
    n = members(body)
    if not n: continue
    line = pos2line[a]; G.setdefault(tuple(n), []).append((line + 1, fn[line], L[line].strip()[:60]))
print('# OBJECT LITERALS, BY THEIR MEMBERS IN THE ORDER WRITTEN: %d sets, %d births' % (len(G), sum(len(v) for v in G.values())))
for n, v in sorted(G.items(), key=lambda kv: kv[1][0][0]):
    print('{ %s }' % ', '.join(n)); print('      ' + ' . '.join('%d %s' % (l, f) for l, f, _ in v[:14]) + (' ..' if len(v) > 14 else ''))
print('\n# CONSTRUCTOR FUNCTIONS: the stores to `this`, in the order of the text (a chain stores its LAST name first)')
for i, l in enumerate(L):
    m = re.match(r'function (\w+)\(', l)
    if not m: continue
    j = i + 1; names = []
    while j < len(L) and not L[j].startswith('}'):
        names += re.findall(r'\bthis\.([A-Za-z_$][\w$]*)\s*=(?!=)', L[j]); j += 1
    if len(names) >= 2: print('%d %s: %s' % (i + 1, m.group(1), ', '.join(names)))
print('\n# PARAMETERS THAT ARE STORED TO (name: function at line)')
tot = par = 0
for m in re.finditer(r'^(?:function (\w+)|exports\.(\w+) = function)\s*\(([^)]*)\)\s*\{', T, re.M | re.S):
    a = m.end(); e = T.find('\n}', a); body = T[a:e]; P = [p.strip() for p in m.group(3).split(',') if p.strip()]; par += len(P)
    R = [p for p in P if re.search(r'(?<![\w$.])' + re.escape(p) + r'\s*=(?!=)', body)]
    if R: tot += len(R); print('%d %s: %s' % (pos2line[m.start()] + 1, m.group(1) or m.group(2), ', '.join(R)))
print('# %d of %d parameters of the top-level functions are stored to' % (tot, par))
