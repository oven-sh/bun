#!/usr/bin/env python3
"""Compare two rustc --emit=asm files function by function. Labels are renumbered per function."""
import re, sys, subprocess, difflib
def load(path):
    fns = {}; cur = None; body = []
    for line in open(path):
        line = line.rstrip('\n')
        m = re.match(r'^(_R[\w$.]+|_ZN[\w$.]+):', line)
        if m:
            cur = m.group(1); body = []; continue
        if cur is None: continue
        if line.strip().startswith('.cfi_endproc'):
            fns[cur] = body; cur = None; continue
        s = re.sub(r'\s+#.*$', '', line.strip())
        if not s or s.startswith(('.cfi', '.p2align', '.file', '.loc', '#')): continue
        body.append(s)
    return fns
def demangle(names):
    out = subprocess.run(['llvm-cxxfilt'], input='\n'.join(names), capture_output=True, text=True).stdout.splitlines()
    return dict(zip(names, out))
def norm(body):
    # renumber local labels in order of first appearance
    seen = {}
    def lab(m):
        k = m.group(0)
        if k not in seen: seen[k] = '.L%d' % len(seen)
        return seen[k]
    return [re.sub(r'\.L[A-Za-z_]*\d+(?:_\d+)?', lab, l) for l in body]
a = load(sys.argv[1]); b = load(sys.argv[2])
da = demangle(list(a)); db = demangle(list(b))
def key(n):
    n = re.sub(r'\[[0-9a-f]+\]', '', n)       # crate disambiguators
    n = re.sub(r'::<model::Discard>', '', n)  # helpers that became generic over the part sink
    n = re.sub(r'::<model::Discard, ', '::<', n)
    return n
def symnorm(fns):
    toks = set()
    for body in fns.values():
        for l in body: toks.update(re.findall(r'_R[\w$]+', l))
    toks = sorted(toks); d = demangle(toks) if toks else {}
    rx = re.compile(r'_R[\w$]+')
    return {k: [rx.sub(lambda m: '<' + key(d.get(m.group(0), m.group(0))) + '>', l) for l in body] for k, body in fns.items()}
def anon(body):
    return [re.sub(r'\.Lanon\.[0-9a-f]+\.\d+', '.Lanon', l) for l in body]
a = symnorm(a); b = symnorm(b)
A = {key(da[k]): norm(anon(v)) for k, v in a.items()}; B = {key(db[k]): norm(anon(v)) for k, v in b.items()}
same = [n for n in A if n in B and A[n] == B[n]]
diff = [n for n in A if n in B and A[n] != B[n]]
print('identical %d, different %d, only in a %d, only in b %d' % (len(same), len(diff), len(set(A) - set(B)), len(set(B) - set(A))))
for n in sorted(same): print('  SAME   %5d insns  %s' % (len(A[n]), n))
for n in sorted(diff): print('  DIFF   %5d -> %5d  %s' % (len(A[n]), len(B[n]), n))
for n in sorted(set(A) - set(B)): print('  ONLY A %5d  %s' % (len(A[n]), n))
for n in sorted(set(B) - set(A)): print('  ONLY B %5d  %s' % (len(B[n]), n))
if '--diff' in sys.argv:
    for n in sorted(diff):
        print('---', n)
        for l in list(difflib.unified_diff(A[n], B[n], lineterm='', n=2))[:120]: print(l)
