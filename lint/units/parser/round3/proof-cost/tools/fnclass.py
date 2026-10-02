#!/usr/bin/env python3
"""For every DIFF function of fncmp.py: changed lines of the loose streams and the calls that were added or removed.
usage: fnclass.py <base> <head> [--inst REGEX]"""
import re, sys, difflib, importlib.util, io, contextlib
spec = importlib.util.spec_from_file_location('fncmp', __import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'fncmp.py'))
argv = sys.argv[:]
sys.argv = [argv[0]] + argv[1:]
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
A, B = m.A, m.B
for n in sorted(set(A) & set(B)):
    la, lb = m.loose(A[n][1]), m.loose(B[n][1])
    if la == lb: continue
    d = list(difflib.unified_diff(la, lb, n=0, lineterm=''))
    minus = [l[1:] for l in d if l.startswith('-') and not l.startswith('---')]
    plus = [l[1:] for l in d if l.startswith('+') and not l.startswith('+++')]
    cm = sorted(set(l.split(' ', 1)[1] for l in minus if l.startswith('call')) - set(l.split(' ', 1)[1] for l in plus if l.startswith('call')))
    cp = sorted(set(l.split(' ', 1)[1] for l in plus if l.startswith('call')) - set(l.split(' ', 1)[1] for l in minus if l.startswith('call')))
    jm = sum(1 for l in minus if m.CC.match(l)); jp = sum(1 for l in plus if m.CC.match(l))
    short = re.sub(r'bun_js_parser::(p::)?', '', n)[:70]
    print(f"{short:70} -{len(minus):4} +{len(plus):4} jcc -{jm} +{jp}")
    for c in cm: print('      - call', re.sub(r'bun_js_parser::(p::)?', '', c)[:150])
    for c in cp: print('      + call', re.sub(r'bun_js_parser::(p::)?', '', c)[:150])
