#!/usr/bin/env python3
"""Static count of the reads of the side-table option (P::starts_for_parse_only) per function of a linked bun-profile.
usage: optsites.py <bun-profile> [--off 0xNNN] [--inst REGEX]
The field is found by its offset in P: without --off it is read from the start of P<false, false>::parse_async_prefix_expr,
whose first memory operand on the parser is the option (main: `cmpq $-0x1, 0x900(%rsi)`, boxed: `movq 0xce0(%rsi), %r14`).
A row is a function that reads or compares the field: on main these are parse_async_prefix_expr, parse_arrow_body,
parse_class, init, the drop glue and the entries of parse_only. Any other row of P<false, ..> is a test that JavaScript pays."""
import re, sys, subprocess, importlib.util, io, contextlib, os, collections
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
binary = [a for a in sys.argv[1:] if not a.startswith('--') and a not in (arg('--off', None), arg('--inst', None))][0]
inst = arg('--inst', r'P<false, ?(false|true)>')
spec = importlib.util.spec_from_file_location('fncmp', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fncmp.py'))
old = sys.argv; sys.argv = [old[0], binary, binary, '--inst', inst + '|P<false, false>>::parse_async_prefix_expr$']
with contextlib.redirect_stdout(io.StringIO()):
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sys.argv = old
off = arg('--off', None)
if not off:
    probe = next(v[1] for k, v in m.A.items() if k.endswith('P<false, false>>::parse_async_prefix_expr'))
    for l in probe[:30]:
        x = re.match(r'^cmpq \$-?(?:0x)?[0-9a-f]+, (0x[0-9a-f]+)\(%rsi\)', l) or re.match(r'^movq (0x[0-9a-f]+)\(%rsi\), %r\w+$', l)
        if x and int(x.group(1), 16) > 0x400: off = x.group(1); break
print('offset of the option in P:', off)
rx = re.compile(r'(?<![0-9a-fx])' + re.escape(off) + r'\(%r')
rows = []
RXI = re.compile(inst)
for name in sorted(m.A):
    if not RXI.search(name): continue
    c = collections.Counter()
    for l in m.A[name][1]:
        if rx.search(l): c[l.split(' ', 1)[0]] += 1
    if c: rows.append((sum(c.values()), name, dict(c)))
for n, name, c in sorted(rows, key=lambda r: r[1]):
    print('%3d  %-70s %s' % (n, re.sub(r'bun_js_parser::(p::)?', '', name)[:70], ' '.join('%s:%d' % kv for kv in sorted(c.items()))))
print(f'{sum(r[0] for r in rows)} reads of the field in {len(rows)} functions matching /{inst}/')
