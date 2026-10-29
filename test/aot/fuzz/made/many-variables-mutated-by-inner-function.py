#!/usr/bin/env python3
"""many-variables-mutated-by-inner-function.py <folder>: A function with n variables that an inner function changes: an environment of n fields, and no object of n properties."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
for n in (100, 5000, 30000):
    out = ['declare const console: any;', 'function outer(): () => number {']
    out += ['  let ' + ', '.join('v%d = %d' % (i, i) for i in range(k, min(k + 100, n))) + ';' for k in range(0, n, 100)]
    out += ['  return function (): number {'] + ['    ' + ' '.join('v%d++;' % i for i in range(k, min(k + 100, n))) for k in range(0, n, 100)] + ['    return v0 + v%d;' % (n - 1), '  };', '}', 'const f = outer(); f(); console.log(f());']
    open('variables_%d.ts' % n, 'w').write('\n'.join(out) + '\n')
