#!/usr/bin/env python3
"""Like cmpasm.py, but labels are erased: shows only instruction differences of one function."""
import re, sys, subprocess, difflib
exec(open('cmpasm.py').read().split("a = load(sys.argv[1])")[0])
a = load(sys.argv[1]); b = load(sys.argv[2]); pat = re.compile(sys.argv[3])
da = demangle(list(a)); db = demangle(list(b))
def key(n):
    n = re.sub(r'\[[0-9a-f]+\]', '', n); n = re.sub(r'::<model::Discard>', '', n); n = re.sub(r'::<model::Discard, ', '::<', n); return n
def symnorm(fns):
    toks = set()
    for body in fns.values():
        for l in body: toks.update(re.findall(r'_R[\w$]+', l))
    toks = sorted(toks); d = demangle(toks) if toks else {}
    rx = re.compile(r'_R[\w$]+')
    return {k: [rx.sub(lambda m: '<' + key(d.get(m.group(0), m.group(0))) + '>', l) for l in body] for k, body in fns.items()}
a = symnorm(a); b = symnorm(b)
def erase(body):
    out = []
    for l in body:
        if re.match(r'^\.L[\w.]+:$', l): continue
        l = re.sub(r'\.Lanon\.[0-9a-f]+\.\d+', '.Lanon', l)
        out.append(re.sub(r'\.L[A-Za-z_]*\d+(?:_\d+)?', '.L', l))
    return out
A = {key(da[k]): erase(v) for k, v in a.items()}; B = {key(db[k]): erase(v) for k, v in b.items()}
for n in sorted(A):
    if n in B and pat.search(n):
        d = list(difflib.unified_diff(A[n], B[n], lineterm='', n=3))
        print('---', n, len(A[n]), '->', len(B[n]), 'diff lines', len(d))
        for l in d[:int(sys.argv[4]) if len(sys.argv) > 4 else 200]: print(l)
