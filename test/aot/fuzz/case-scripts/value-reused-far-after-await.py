#!/usr/bin/env python3
"""value-reused-far-after-await.py <folder>: A value computed before a suspension is used twice after it: immediately,
where it is reloaded from the frame, and again n branches later, where it is still in a register so no second reload
is planned.
"""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
for kind in ('async', 'generator'):
    for n in (10, 2000, 20000):
        head, wait, run = ('async function f(a)', 'await null', 'f(3).then(v => console.log(v, count));') if kind == 'async' else ('function* f(a)', 'yield 1', 'const it = f(3); it.next(); console.log(it.next().value, count);')
        out = ['let count = 0;', 'function g(i) { count += i; }', head + ' {', '  let kept = a + 1;', '  ' + wait + ';', '  g(kept);']
        out += ['  if (a > %d) g(%d);' % (i, i) for i in range(n)]
        out += ['  return kept;', '}', run]
        open('%s_%d.js' % (kind, n), 'w').write('\n'.join(out) + '\n')
