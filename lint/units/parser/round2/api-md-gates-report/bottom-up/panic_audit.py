#!/usr/bin/env python3
"""Lists the lines that the parser work added outside test code and that can panic: unwrap, expect of an Option or Result, panic!, unreachable!, todo!, unimplemented!.
`lexer.expect(T::..)` is the token check of the lexer and is not listed.
usage: panic_audit.py <repo root> [base revision, default e3566be889]"""
import re, subprocess, sys, os
root = sys.argv[1]; base = sys.argv[2] if len(sys.argv) > 2 else 'e3566be889'
d = subprocess.run(['git', '-C', root, 'diff', '--unified=0', base + '..HEAD', '--', 'src/js_parser', 'src/ast/ts.rs', 'src/ast/ts_nodes.rs'],
                   capture_output=True, text=True, errors='replace').stdout
def test_start(path):
    try: lines = open(os.path.join(root, path), errors='replace').read().split('\n')
    except OSError: return 10**9
    for i, l in enumerate(lines):
        if l.startswith('#[cfg(test)]') and i + 1 < len(lines) and lines[i + 1].startswith('mod '): return i + 1
    return 10**9
cur = None; ln = 0; start = {}; hits = []
for l in d.split('\n'):
    if l.startswith('+++ b/'):
        cur = l[6:]; start[cur] = test_start(cur); continue
    if l.startswith('+++'):
        cur = None; continue
    if l.startswith('@@'):
        ln = int(re.search(r'\+(\d+)', l).group(1)) - 1; continue
    if l.startswith('+') and cur:
        ln += 1
        if cur.endswith('_tests.rs') or cur.endswith('native_test_shims.rs') or ln >= start[cur]: continue
        t = l[1:]
        if t.lstrip().startswith('//'): continue
        t2 = re.sub(r'lexer\.expect\(', 'lexer.EXPECT(', t)
        if re.search(r'\.unwrap\(\)|\.expect\(|panic!|unreachable!|todo!|unimplemented!', t2):
            hits.append((cur, ln, t.strip()[:120]))
print(f'{len(hits)} added lines outside tests that can panic ({base}..HEAD)')
for f, n, t in hits: print(f'  {f}:{n} {t}')
