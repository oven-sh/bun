#!/usr/bin/env python3
"""tools/clean_lay.py <formed .ts> <out .ts>: what is published carries no working notes: (1) the markers /*$*/ go (they only tell the gates what was added) (2) from the first line of the appended shapes on, every comment goes and every line left empty. The package's own code and its own comments above that line are not touched; no line of it moves."""
import re, sys
L = open(sys.argv[1]).read().replace('/*$*/', '').split('\n')
T = next((i for i, l in enumerate(L) if re.match(r'(// [a-z]{2}-shapes|// ---- the shapes|namespace [A-Z]{2} \{)', l)), len(L))
s = '\n'.join(L[T:]); out = []; i = 0; n = len(s)
while i < n:
    c = s[i]
    if c in '"\'`':
        j = i + 1
        while j < n and s[j] != c: j += 2 if s[j] == '\\' else 1
        out.append(s[i:j + 1]); i = j + 1
    elif s.startswith('//', i): i = s.find('\n', i) if s.find('\n', i) >= 0 else n
    elif s.startswith('/*', i): i = s.index('*/', i) + 2
    else: out.append(c); i += 1
tail = [l.rstrip() for l in ''.join(out).split('\n') if l.strip()]
open(sys.argv[2], 'w').write('\n'.join(L[:T] + tail) + '\n'); print('clean_lay: the shapes begin at line %d: %d lines of %d are kept' % (T + 1, len(tail), len(L) - T))
