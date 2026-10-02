#!/usr/bin/env python3
"""Calls and jumps from the functions of one instantiation into code of the lint parse, read from a linked bun-profile.
usage: lintcalls.py <bun-profile> [--inst REGEX] [--callee REGEX]
Default --inst: P<false, (false|true)>: a row is a place where the code that JavaScript runs holds a path of the lint parse,
so a test of the side table guards it. Default --callee: the modules and helpers of the side table."""
import re, sys, collections, importlib.util, io, contextlib, os
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
binary = [a for a in sys.argv[1:] if not a.startswith('--')][0]
inst = arg('--inst', r'P<false, ?(false|true)>')
CALLEE = re.compile(arg('--callee', r'parse::(erased|wrappers|attached|generics|syntax_errors)::|::lint_\w+|_for_lint\b|StartsForParseOnly>::(mark|rewind)|rewind_sidecar|type_sink::Build|::build_\w+'))
spec = importlib.util.spec_from_file_location('fncmp', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fncmp.py'))
old = sys.argv; sys.argv = [old[0], binary, binary, '--inst', inst]
with contextlib.redirect_stdout(io.StringIO()):
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sys.argv = old
n = 0
for name in sorted(m.A):
    size, lines = m.A[name]
    hits = collections.Counter()
    for l in lines:
        x = re.match(r'^(call\w*|j\w+) (.*)$', l)
        if x and not re.match(r'^L\d+$', x.group(2)) and CALLEE.search(x.group(2)): hits[x.group(2)] += 1
    if hits:
        print(re.sub(r'bun_js_parser::(p::)?', '', name)[:110])
        for t, k in sorted(hits.items()): print('      %2d x %s' % (k, re.sub(r'bun_js_parser::(p::)?', '', t)[:140])); n += k
print(f'{n} calls into lint code from functions matching /{inst}/')
