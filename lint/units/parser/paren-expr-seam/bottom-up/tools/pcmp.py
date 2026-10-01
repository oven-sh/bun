#!/usr/bin/env python3
"""Compare two assembly files that run.py wrote for copies of src/js_parser, function by function, with counts.
usage: pcmp.py <a.s> <b.s> [--match REGEX] [--all] [--diff N] [--only-new]
For every function whose demangled name matches REGEX (default: every function) and whose body differs:
instructions, conditional branches and calls in a and in b. --all also lists the identical ones that match.
Functions that exist only in b are listed with their counts (the text a variant adds).
Local labels are renumbered per function, anonymous data is one name, so a moved label is not a difference."""
import re, subprocess, sys, difflib, pickle, os, hashlib
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
rx = re.compile(arg('--match', r'.')); ndiff = int(arg('--diff', 0))
JCC = re.compile(r'^(j(?!mp)[a-z]+|loop[a-z]*|jrcxz|jecxz)\b')
def load(path):
    st = os.stat(path); key = hashlib.sha1(('%s %d %d v3' % (os.path.abspath(path), st.st_size, st.st_mtime_ns)).encode()).hexdigest()
    cache = '/tmp/pes/cache/' + key + '.pkl'
    if os.path.exists(cache): return pickle.load(open(cache, 'rb'))
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
            if k.startswith(('.L__unnamed', '.Lanon', '.Lalloc', '.Lswitch.table', '.LCPI', '.Lstr', '.LJTI')): return '.Ldata'
            if k not in labels: labels[k] = '.L%d' % len(labels)
            return labels[k]
        lines = [re.sub(r'\.L[\w.$]+', lab, l) for l in body]
        lines = [l.replace('::<bun_js_parser::parse::type_sink::Discard>', '').replace('::<bun_js_parser::parse::type_sink::Discard, ', '::<') for l in lines]
        name = name.replace('::<bun_js_parser::parse::type_sink::Discard>', '').replace('::<bun_js_parser::parse::type_sink::Discard, ', '::<')
        out[name] = lines
    os.makedirs('/tmp/pes/cache', exist_ok=True); pickle.dump(out, open(cache, 'wb'))
    return out
def stats(lines):
    ins = [l for l in lines if not l.endswith(':')]
    return len(ins), sum(1 for l in ins if JCC.match(l)), sum(1 for l in ins if l.startswith('call'))
def norm(lines):
    return [l for l in lines]
a = load(sys.argv[1]); b = load(sys.argv[2])
A = {k: v for k, v in a.items() if rx.search(k)}; B = {k: v for k, v in b.items() if rx.search(k)}
same = [n for n in A if n in B and A[n] == B[n]]; diff = [n for n in A if n in B and A[n] != B[n]]
onlya = sorted(set(A) - set(B)); onlyb = sorted(set(B) - set(A))
print('functions a %d b %d; matched a %d b %d; identical %d, different %d, only a %d, only b %d' % (len(a), len(b), len(A), len(B), len(same), len(diff), len(onlya), len(onlyb)))
ti = tj = tc = 0
for n in sorted(diff):
    x = stats(A[n]); y = stats(B[n])
    d = [l for l in difflib.unified_diff(A[n], B[n], lineterm='', n=0) if not l.startswith(('---', '+++', '@@'))]
    ti += y[0] - x[0]; tj += y[1] - x[1]; tc += y[2] - x[2]
    print('DIFF  insns %5d -> %5d (%+d)  jcc %4d -> %4d (%+d)  calls %3d -> %3d (%+d)  changed lines %4d  %s' % (x[0], y[0], y[0] - x[0], x[1], y[1], y[1] - x[1], x[2], y[2], y[2] - x[2], len(d), n[:150]))
if diff: print('SUM of DIFF: insns %+d, jcc %+d, calls %+d' % (ti, tj, tc))
for n in onlya: x = stats(A[n]); print('ONLY A insns %5d jcc %4d calls %3d  %s' % (x[0], x[1], x[2], n[:150]))
ni = nj = 0
for n in onlyb: y = stats(B[n]); ni += y[0]; nj += y[1]; print('ONLY B insns %5d jcc %4d calls %3d  %s' % (y[0], y[1], y[2], n[:150]))
if onlyb: print('SUM of ONLY B: insns %d, jcc %d' % (ni, nj))
if '--all' in sys.argv:
    for n in sorted(same): x = stats(A[n]); print('SAME  insns %5d jcc %4d calls %3d  %s' % (x[0], x[1], x[2], n[:150]))
for n in sorted(diff)[:ndiff]:
    print('---', n)
    for l in list(difflib.unified_diff(A[n], B[n], lineterm='', n=2))[:int(arg('--lines', 80))]: print('   ', l)
