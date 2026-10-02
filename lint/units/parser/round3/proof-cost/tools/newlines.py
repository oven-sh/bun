#!/usr/bin/env python3
"""Executed source lines of a cachegrind file that `diff` marks as added or changed against the base tree: code that a parse
without lint runs and main does not have. For js-control every such line is a defect of the parity rule.
usage: newlines.py <head.cg> [--fn REGEX] [--srcb ROOT] [--srca ROOT] [--files REGEX] [--min N] [--tests] [--tests-pattern REGEX]
--tests: leave out the lines whose text is a test of the side table (default pattern: the one of cgsites.py) and print their
sum apart: what is left is executed new code that is no test.
--fn: functions to look at (default: every symbol of bun_js_parser). --files: source files to look at (default src/js_parser/)."""
import re, sys, os, collections
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
cg = [a for a in sys.argv[1:] if not a.startswith('--')][0]
FN = re.compile(arg('--fn', 'bun_js_parser')); FILES = re.compile(arg('--files', r'^src/js_parser/'))
SRCB = arg('--srcb', '/workspace/wt/parser'); SRCA = arg('--srca', '/tmp/proofcost/base-src'); MIN = int(arg('--min', '1'))
TESTS = re.compile(arg('--tests-pattern', r'starts_for_parse_only|is_lint_parse\(\)|sidecar_mark\(\)')) if '--tests' in sys.argv else None
tests = [0, 0, 0]
cache = {}
def lines(root, p):
    k = (root, p)
    if k not in cache:
        try: cache[k] = open(os.path.join(root, p), errors='replace').read().split('\n')
        except OSError: cache[k] = None
    return cache[k]
def new_lines(p):
    # line numbers of the head file that `diff` gives as added or changed against the base file (None: no base file)
    k = ('new', p)
    if k not in cache:
        a = os.path.join(SRCA, p); b = os.path.join(SRCB, p)
        if not os.path.exists(a): cache[k] = None
        else:
            import subprocess
            out = subprocess.run(['diff', '--ignore-all-space', '--unchanged-line-format=', '--old-line-format=', '--new-line-format=%dn\n', a, b], capture_output=True, text=True).stdout
            cache[k] = set(int(x) for x in out.split())
    return cache[k]
per = collections.defaultdict(lambda: [0, 0]); fn = None; fl = None; cur = None; on = False
with open(cg, errors='replace') as f:
    for line in f:
        c = line[0]
        if c == 'f':
            if line.startswith('fl='): fl = line[3:].rstrip('\n'); cur = fl
            elif line.startswith(('fi=', 'fe=')): cur = line[3:].rstrip('\n')
            elif line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)', '', line[3:].rstrip('\n')); on = bool(FN.search(fn)); cur = fl
            continue
        if not on or not c.isdigit() or not FILES.search(cur): continue
        parts = line.split(); ln = int(parts[0])
        if ln == 0: continue
        L = lines(SRCB, cur)
        text = L[ln - 1].strip() if L and ln <= len(L) else '<line %d>' % ln
        nl = new_lines(cur)
        if nl is not None and ln not in nl: continue
        if not re.search(r'\w', text): continue
        if TESTS is not None and TESTS.search(text):
            tests[0] += int(parts[1]); tests[1] += int(parts[2]) if len(parts) > 2 else 0; tests[2] += 1
            continue
        p = per[(cur, ln, text, fn)]
        p[0] += int(parts[1]); p[1] += int(parts[2]) if len(parts) > 2 else 0
tot = [0, 0]
for (path, ln, text, fn), v in sorted(per.items(), key=lambda kv: -kv[1][0]):
    tot[0] += v[0]; tot[1] += v[1]
    if v[0] < MIN: continue
    short = re.sub(r'^<bun_js_parser::p::P<(\w+), (\w+)>>::', r'P<\1,\2>::', fn)[:44]
    print(f"{v[0]:>11,} {v[1]:>10,}  {path.replace('src/js_parser/', '')}:{ln}  [{short}]  {text[:84]}")
print(f"{tot[0]:>11,} {tot[1]:>10,}  SUM Ir, Bc on {len(per)} executed lines that the base tree does not have")
if TESTS is not None: print(f"{tests[0]:>11,} {tests[1]:>10,}  Ir, Bc left out: cost rows on lines that test the side table ({tests[2]} rows)")
