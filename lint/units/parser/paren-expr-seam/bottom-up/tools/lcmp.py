#!/usr/bin/env python3
"""Compare the bun_js_parser functions of two LINKED bun-profile binaries (outputs of fnasm.py), with counts.
usage: lcmp.py <a.json> <b.json> [--only REGEX] [--diff N] [--lines N]
For every function whose normalised disassembly differs: bytes, instructions and conditional branches in a and b.
Functions only in b are the text that b adds. A name that differs only in the spelling of the Discard sink is one name. A rip-relative data operand is compared without
its displacement and without the data symbol that objdump prints: both move when the size of the text changes."""
import json, sys, re, difflib
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
ndiff = int(arg('--diff', 0)); only = re.compile(arg('--only', '.')); nlines = int(arg('--lines', 60))
JCC = re.compile(r'^(j(?!mp)[a-z]+|loop[a-z]*|jrcxz|jecxz)\b')
RIP = re.compile(r'-?0x[0-9a-f]+\(%rip\)([^#\n]*)(#[^\n]*)?')
ANON = re.compile(r'anon\.[0-9a-f]+\.\d+')
def norm(s):
    s = s.replace('::<bun_js_parser::parse::type_sink::Discard>', '').replace('::<bun_js_parser::parse::type_sink::Discard, ', '::<')
    s = re.sub(r'\.llvm\.\d+', '', s)
    # a rip-relative operand: the displacement moves with the layout of the binary, the comment names the nearest data symbol
    s = RIP.sub(lambda m: '<rip>' + m.group(1).rstrip(), s)
    # an absolute address of static data as an immediate (the binary is not position independent)
    s = re.sub(r'\$0x[0-9a-f]{6,}\b', '$<abs>', s)
    return ANON.sub('anon', s)
def st(e):
    L = e['text'].splitlines()
    return e['size'], len(L), sum(1 for l in L if JCC.match(l.strip())), sum(1 for l in L if l.strip().startswith('call'))
A = {norm(k): v for k, v in a.items() if only.search(k)}; B = {norm(k): v for k, v in b.items() if only.search(k)}
same = [n for n in A if n in B and norm(A[n]['text']) == norm(B[n]['text'])]
diff = sorted(n for n in A if n in B and norm(A[n]['text']) != norm(B[n]['text']))
oa = sorted(set(A) - set(B)); ob = sorted(set(B) - set(A))
print('functions a %d b %d: identical %d, different %d, only a %d (%d bytes), only b %d (%d bytes)' % (len(A), len(B), len(same), len(diff), len(oa), sum(A[n]['size'] for n in oa), len(ob), sum(B[n]['size'] for n in ob)))
tb = ti = tj = 0
for n in diff:
    x = st(A[n]); y = st(B[n]); tb += y[0] - x[0]; ti += y[1] - x[1]; tj += y[2] - x[2]
    print('DIFF  bytes %6d -> %6d (%+5d)  insns %5d -> %5d (%+4d)  jcc %4d -> %4d (%+3d)  calls %3d -> %3d  %s' % (x[0], y[0], y[0] - x[0], x[1], y[1], y[1] - x[1], x[2], y[2], y[2] - x[2], x[3], y[3], n[:130]))
if diff: print('SUM of DIFF: bytes %+d, insns %+d, jcc %+d' % (tb, ti, tj))
for n in oa: x = st(A[n]); print('ONLY A bytes %6d insns %5d jcc %4d  %s' % (x[0], x[1], x[2], n[:150]))
for n in ob: y = st(B[n]); print('ONLY B bytes %6d insns %5d jcc %4d  %s' % (y[0], y[1], y[2], n[:150]))
for n in diff[:ndiff]:
    print('---', n)
    for l in list(difflib.unified_diff(norm(A[n]['text']).splitlines(), norm(B[n]['text']).splitlines(), lineterm='', n=2))[:nlines]: print('   ', l)
