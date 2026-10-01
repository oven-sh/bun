# The zone of every function of checker and binder, in the order of typecheck.md (K3).
# The layer model is the one of the bottom-up pass of this research (../../bottom-up/py/layers.py: the twelve layers by line range,
# the earlier layers of the other researches, the later chunks), over the call graph of checker-core-scratch/goanal
# (/tmp/k3a/fns.json, or $FNS). This module only renames what the tables of this pass read.
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE + '/../../bottom-up/py')
import layers as bu
REF = bu.REF
C = bu.C; F = bu.F
ORDER = bu.ORDER
RANK = dict(bu.RANK)
LATER_RANK = len(bu.GLOBAL)
fns = bu.fns
byname = bu.byname
for f in fns:
    f['zone'] = f['layer']
    f['rank'] = RANK.get(f['layer'], LATER_RANK)
    f['chunk'] = f['module'].split('/')[-1][:-3]
    f['callees'] = [{'pkg': c.split('.')[0], 'name': c.split('.', 1)[1]} for c in (f.get('callees') or []) if '.' in c]
    f['cfields'] = f['fields']
def short(f): return f['q'].replace('Checker.', 'c.')
def loc(f): return '%s:%d-%d' % (f['file'].split('/')[-1], f['decl'], f['end'])
def mine(L): return sorted([f for f in fns if f['zone'] == L], key=lambda f: (f['file'] != C, f['decl']))
def target(c): return byname.get((c['pkg'], c['name']))
def codes(): return bu.codes
