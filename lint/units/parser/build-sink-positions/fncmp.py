#!/usr/bin/env python3
"""Compare two outputs of fnasm.py by function name.
usage: fncmp.py <a.json> <b.json> [--diff N] [--only REGEX]
A name that differs only in the spelling of the Discard sink is one name, in symbols and in call targets."""
import json, sys, re, difflib
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
ndiff = int(arg('--diff', 0)); only = re.compile(arg('--only', '.'))
def norm(s):
    s = s.replace('::<bun_js_parser::parse::type_sink::Discard>', '')
    s = s.replace('::<bun_js_parser::parse::type_sink::Discard, ', '::<')
    return s
A = {norm(k): v for k, v in a.items() if only.search(k)}; B = {norm(k): v for k, v in b.items() if only.search(k)}
same = []; diff = []; only_a = sorted(set(A) - set(B)); only_b = sorted(set(B) - set(A))
for n in sorted(set(A) & set(B)):
    (same if norm(A[n]['text']) == norm(B[n]['text']) else diff).append(n)
print('identical %d, different %d, only in a %d (%d bytes), only in b %d (%d bytes)' % (
    len(same), len(diff), len(only_a), sum(A[n]['size'] for n in only_a), len(only_b), sum(B[n]['size'] for n in only_b)))
for n in diff: print('DIFF   %6d -> %6d  %s' % (A[n]['size'], B[n]['size'], n[:170]))
for n in only_a: print('ONLY A %6d  %s' % (A[n]['size'], n[:170]))
for n in only_b: print('ONLY B %6d  %s' % (B[n]['size'], n[:170]))
for n in diff[:ndiff]:
    print('---', n)
    for l in list(difflib.unified_diff(norm(A[n]['text']).splitlines(), norm(B[n]['text']).splitlines(), lineterm='', n=2))[:80]: print(l)
sys.exit(1 if diff else 0)
