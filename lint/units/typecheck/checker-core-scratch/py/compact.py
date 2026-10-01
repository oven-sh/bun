import sys
sys.argv = ['x', 'none']
exec(open('/tmp/k3a/py/layers.py').read())
import collections
def snake(n):
    return n
order = ['T-KEYS','K-OBJ','T-RSTACK','C-INIT','D-SINK','S-MERGE','N-RESOLVE','N-DIAG','A-ALIAS','M-MODULE','Q-ENTITY']
for L in order:
    fl = [f for f in sorted(fns, key=lambda f:(f['file'], f['decl'])) if f['layer'] == L]
    parts = []
    for f in fl:
        n = short(f['name']).replace('c.','').replace('r.','NameResolver.').replace('binder.','').replace('keyBuilder.','kb.')
        parts.append(f"{f['decl']} {n}")
    print(f"{L} ({len(fl)}): " + '; '.join(parts))
    print()
