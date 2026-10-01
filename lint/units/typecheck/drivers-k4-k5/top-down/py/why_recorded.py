# Research probe: why a run instance needs a recorded program (the reasons overlap).
# usage: python3 why_recorded.py
import collections
from common import rows, fmt_by_ext
why = collections.Counter(); triv = 0; R = rows()
for r in R:
    reasons = set(); files = r['files'] or []
    if [f['n'] for f in files] != (r['roots'] or []): reasons.add('files are not the roots in order')
    for f in files:
        if f.get('pjt') or f.get('pjd'): reasons.add('package.json scope')
        if f['fmt'] != fmt_by_ext(f['n']): reasons.add('implied format not by extension')
        if f.get('jsx'): reasons.add('jsx runtime import')
        if f.get('helpers'): reasons.add('importHelpers import')
        if f.get('ext'): reasons.add('file of an external library')
        if any(len(x) > 3 and x[2] for x in f.get('res', [])): reasons.add('resolved module')
        elif f.get('res'): reasons.add('(module names that do not resolve: no record needed)')
        if any(t for _, t in f.get('reflist', [])): reasons.add('reference path')
        if f.get('typelist'): reasons.add('type reference directive')
        if f.get('liblist'): reasons.add('reference lib in a non-lib file')
    if r.get('autotypes'): reasons.add('automatic type directives')
    if r.get('libfiles'): reasons.add('lib file with non-lib inputs')
    if r.get('symlinks'): reasons.add('links')
    if not r['caseSensitive']: reasons.add('file names without case')
    if not [x for x in reasons if not x.startswith('(')]: triv += 1
    for x in reasons: why[x] += 1
print('instances', len(R), 'trivial', triv, 'recorded', len(R) - triv)
for k, v in why.most_common(): print(' ', v, k)
