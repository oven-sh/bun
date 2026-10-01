#!/usr/bin/env python3
"""Compare the functions of two assembly files that rustc wrote for the same crate (run.py).
usage: scmp.py <a.s> <b.s> [--match REGEX] [--diff N]
Names are demangled, local labels are numbered by order of first use inside the function, anonymous data is one name.
A name that differs only in the spelling of the Discard sink is one name."""
import re, subprocess, sys, difflib
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
rx = re.compile(arg('--match', r'skip_type_?script|skip_typescript|type_sink')); ndiff = int(arg('--diff', 0))
def load(path):
    text = subprocess.run(['llvm-cxxfilt'], stdin=open(path), capture_output=True, text=True, errors='replace').stdout
    fns = {}; cur = None; body = []
    for line in text.splitlines():
        m = re.match(r'^\t\.type\t(.*),@function$', line)
        if m: cur = m.group(1); body = []; continue
        if cur is None: continue
        if line.startswith('\t.size\t') or line.startswith('\t.cfi_endproc'):
            if cur not in fns: fns[cur] = body
            cur = None; continue
        s = line.strip()
        if not s or s.startswith(('.cfi', '.loc', '.file', '#', '.p2align', '.section', '.globl', '.hidden', '.weak', '.type')): continue
        if s.endswith(':') and not s.startswith('.L'): continue
        body.append(s)
    out = {}
    for name, body in fns.items():
        labels = {}
        def lab(m):
            k = m.group(0)
            if k.startswith(('.L__unnamed', '.Lanon', '.Lalloc', '.Lswitch.table', '.LCPI', '.Lstr')): return '.Ldata'
            if k not in labels: labels[k] = '.L%d' % len(labels)
            return labels[k]
        text = '\n'.join(re.sub(r'\.L[\w.$]+', lab, l) for l in body)
        text = text.replace('::<bun_js_parser::parse::type_sink::Discard>', '').replace('::<bun_js_parser::parse::type_sink::Discard, ', '::<')
        name = name.replace('::<bun_js_parser::parse::type_sink::Discard>', '').replace('::<bun_js_parser::parse::type_sink::Discard, ', '::<')
        out[name] = text
    return out
a = load(sys.argv[1]); b = load(sys.argv[2])
A = {k: v for k, v in a.items() if rx.search(k)}; B = {k: v for k, v in b.items() if rx.search(k)}
same = [n for n in A if n in B and A[n] == B[n]]; diff = [n for n in A if n in B and A[n] != B[n]]
print('functions a %d b %d; matched a %d b %d; identical %d, different %d, only a %d, only b %d' % (len(a), len(b), len(A), len(B), len(same), len(diff), len(set(A) - set(B)), len(set(B) - set(A))))
for n in sorted(diff):
    x = A[n].splitlines(); y = B[n].splitlines()
    d = [l for l in difflib.unified_diff(x, y, lineterm='', n=0) if not l.startswith(('---', '+++', '@@'))]
    print('DIFF  %5d -> %5d insns, %4d changed lines  %s' % (len(x), len(y), len(d), n[:160]))
for n in sorted(set(A) - set(B)): print('ONLY A %5d insns  %s' % (len(A[n].splitlines()), n[:160]))
for n in sorted(set(B) - set(A)): print('ONLY B %5d insns  %s' % (len(B[n].splitlines()), n[:160]))
for n in sorted(diff)[:ndiff]:
    print('---', n)
    for l in list(difflib.unified_diff(A[n].splitlines(), B[n].splitlines(), lineterm='', n=1))[:70]: print('   ', l)
if '--list' in sys.argv:
    for n in sorted(same): print('SAME  %5d insns  %s' % (len(A[n].splitlines()), n[:160]))
