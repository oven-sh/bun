#!/usr/bin/env python3
"""tools/declare_fields.py <typed text, rewritten in place> [--check]: a class field that the typed text ADDS (between markers, behind the class's `{`) is written `declare x: T;`. Without `declare` it is a definition: `x;` is emitted and the property is created before the constructor's own store: harmless only where the constructor stores every field in that order. With it nothing is emitted and the layouts are the same."""
import re, sys
p = sys.argv[1]; t = open(p).read(); n = [0, 0]
def f(m):
    out = []
    for x in m.group(2).split(';'):
        if not x.strip(): continue
        n[0] += 1
        if not x.strip().startswith('declare '): n[1] += 1; x = 'declare ' + x.strip()
        out.append(x.strip() + ';')
    return m.group(1) + '/*$*/' + ' '.join(out) + '/*$*/'
u = re.sub(r'(\bclass(?: [\w$]+)?(?: extends [\w$.]+)? \{ ?)/\*\$\*/([^*]*?)/\*\$\*/', f, t)
if '--check' in sys.argv: print('declare_fields: %d added fields, %d without `declare`' % tuple(n)); sys.exit(1 if n[1] else 0)
open(p, 'w').write(u); print('declare_fields: %d added fields, %d got `declare`' % tuple(n))
