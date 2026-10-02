#!/usr/bin/env python3
"""Every parser function whose machine code differs between the reference binary and the head binary, explained or not.
usage: tsdiff.py <ref bun-profile> <head bun-profile> [--lint REGEX] [--trees REFTREE,HEADTREE] [--may REGEX] [--off 0xNNN]
--trees: a function whose name is defined only in files of HEADTREE/src/js_parser that REFTREE lacks is lint-only too
(the name of the module of an impl block is not in the symbol of a method of P, so the method name has to tell).
Loads every symbol of bun_js_parser through fncmp.py (--inst .). Per name that is not IDENT:
  SITES k   the head stream has k more reads of the side-table option, at least k more conditional jumps (the others are
            in the cold blocks), new calls into lint-only code only, and no call of the reference is gone
  MOVED     a call of the reference is gone or a call to code that is not lint-only is new: inlining moved
  OTHER     anything else
  NEW/GONE  the name is in one binary only (NEW lint-only names are counted, not listed)
A name outside --may (default: P<true, false>, ::<true, false>, _parse::<true>, lint-only code) must not differ at all:
it is printed as SHARED with the class of fncmp.py (OFFSETS: only a displacement differs) and fails the check.
--except REGEX: names that are accepted exceptions; they are printed as EXCEPT with what differs and do not fail.
Exit status 1 when a SHARED, MOVED, OTHER or GONE row is left."""
import re, sys, os, io, contextlib, difflib, importlib.util
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
LINT = re.compile(arg('--lint', r'parse::(lint\w*|erased|wrappers|attached|generics|syntax_errors)::|ForLint|for_lint|type_sink::Build|::lint_\w+'))
MAY = re.compile(arg('--may', r'P<true, ?false>|::<true, ?false>|_parse::<true>'))
EXC = re.compile(arg('--except', r'$^'))
vals = {arg('--lint', None), arg('--may', None), arg('--off', None), arg('--trees', None), arg('--except', None)}
if arg('--trees', None):
    rt, ht = arg('--trees', None).split(',')
    def fnnames(tree):
        out = {}
        for d, _, fs in os.walk(os.path.join(tree, 'src/js_parser')):
            for f in fs:
                if f.endswith('.rs'):
                    rel = os.path.relpath(os.path.join(d, f), os.path.join(tree, 'src/js_parser'))
                    out[rel] = set(re.findall(r'\bfn (\w+)', open(os.path.join(d, f), errors='replace').read()))
        return out
    fr, fh = fnnames(rt), fnnames(ht)
    shared = set().union(*[v for k, v in fh.items() if k in fr]) | set().union(*fr.values())
    only = sorted(set().union(*[v for k, v in fh.items() if k not in fr] or [set()]) - shared)
    if only: LINT = re.compile(LINT.pattern + r'|::(?:' + '|'.join(only) + r')(?![A-Za-z0-9_])')
paths = [a for a in sys.argv[1:] if not a.startswith('-') and a not in vals]
here = '/workspace/notes/lint/units/parser/round3/proof-cost/tools/fncmp.py'
spec = importlib.util.spec_from_file_location('fncmp', here)
old = sys.argv; sys.argv = [old[0], paths[0], paths[1], '--inst', '.']
with contextlib.redirect_stdout(io.StringIO()):
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sys.argv = old
A, B = m.A, m.B
off = arg('--off', None)
if not off:
    probe = next((v[1] for k, v in B.items() if k.endswith('P<true, false>>::parse_async_prefix_expr')), [])
    for l in probe[:40]:
        x = re.match(r'^cmpq \$-?(?:0x)?[0-9a-f]+, (0x[0-9a-f]+)\(%r\w+\)', l) or re.match(r'^movq (0x[0-9a-f]+)\(%r\w+\), %r\w+$', l)
        if x and int(x.group(1), 16) > 0x400: off = x.group(1); break
OPT = re.compile(r'(?<![0-9a-fx])' + re.escape(off or '0xffffffff') + r'\(%r')
short = lambda n: re.sub(r'bun_js_parser::(p::)?', '', n)[:120]
def calls(lines): return [l.split(' ', 1)[1] for l in lines if l.startswith('call') and ' ' in l]
rows = []; bad = 0; new_lint = 0
for n in sorted(set(A) | set(B)):
    may = bool(MAY.search(n) or LINT.search(n))
    if n not in A:
        if LINT.search(n): new_lint += 1; continue
        rows.append(('NEW' if may else 'SHARED new', n, '')); bad += 0 if may else 1; continue
    if n not in B:
        rows.append(('GONE' if may else 'SHARED gone', n, '')); bad += 1; continue
    la, lb = A[n][1], B[n][1]
    if la == lb: continue
    if EXC.search(n):
        k = 'OFFSETS' if m.offsets(la) == m.offsets(lb) else 'CONSTS' if m.loose(la) == m.loose(lb) else 'DIFF'
        rows.append(('EXCEPT ' + k, n, 'bytes %d -> %d' % (A[n][0], B[n][0]))); continue
    if not may:
        k = 'OFFSETS' if m.offsets(la) == m.offsets(lb) else 'CONSTS' if m.loose(la) == m.loose(lb) else 'DIFF'
        rows.append(('SHARED ' + k, n, 'bytes %d -> %d' % (A[n][0], B[n][0]))); bad += 1; continue
    xa, xb = m.loose(la), m.loose(lb)
    d = list(difflib.unified_diff(xa, xb, n=0, lineterm=''))
    minus = [l[1:] for l in d if l.startswith('-') and not l.startswith('---')]
    plus = [l[1:] for l in d if l.startswith('+') and not l.startswith('+++')]
    ca, cb = calls(xa), calls(xb)
    gone = sorted(set(ca) - set(cb)); added = sorted(set(cb) - set(ca))
    lint_calls = sum(1 for c in cb if LINT.search(c)) - sum(1 for c in ca if LINT.search(c))
    jcc = sum(1 for l in xb if m.CC.match(l)) - sum(1 for l in xa if m.CC.match(l))
    reads = sum(1 for l in lb if OPT.search(l)) - sum(1 for l in la if OPT.search(l))
    ins = len([l for l in xb if not re.match(r'^L\d+:$', l)]) - len([l for l in xa if not re.match(r'^L\d+:$', l)])
    note = 'option reads %+d, jcc %+d, lint calls %+d, insns %+d, bytes %+d' % (reads, jcc, lint_calls, ins, B[n][0] - A[n][0])
    if gone or any(not LINT.search(c) for c in added):
        kind = 'MOVED'; bad += 1
        note += '; gone: ' + ', '.join(short(c)[:60] for c in gone[:3]) + '; new: ' + ', '.join(short(c)[:60] for c in added if not LINT.search(c))[:200]
    elif reads > 0 and jcc >= reads and lint_calls >= 1:
        kind = 'SITES %d' % reads
    else:
        kind = 'OTHER'; bad += 1
    rows.append((kind, n, note))
print('offset of the option in P<true, false>:', off)
for kind, n, note in sorted(rows): print('%-12s %s   %s' % (kind, short(n), note))
print('%d names differ, %d lint-only names are new, %d rows fail' % (len(rows), new_lint, bad))
print('PASS' if not bad else 'FAIL')
sys.exit(1 if bad else 0)
