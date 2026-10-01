# Rows of PORT_STATUS.md for the files that the layers touch: one row per run of functions of one layer in one Rust file.
from layers import *
print('upstream path\tlines\tgroup\tRust module\tstate\tcommit')
def emit(cur):
    tag = cur['layer'] if cur['layer'] else 'LATER'
    span = cur['first'] + (' .. ' + cur['last'] if cur['n'] > 1 else '')
    print('internal/%s\t%d-%d\t%s: %s (%d)\t%s\tnot started\t89d5d5b' % (cur['file'], cur['start'], cur['end'], tag, span, cur['n'], cur['chunk']))
for file in [C, R]:
    fl = sorted([f for f in fns if f['file'] == file], key=lambda f: f['decl'])
    cur = None
    for f in fl:
        L = f['layer'] if f['layer'] in IDX else None
        inspan = file == C and 16495 <= f['decl'] <= 29448 and f['layer'] not in CORESET
        if L is None and not inspan:
            if cur: emit(cur); cur = None
            continue
        if cur and cur['layer'] == L and cur['chunk'] == f['chunk']:
            cur['end'] = f['end']; cur['n'] += 1; cur['last'] = short(f['name'])
        else:
            if cur: emit(cur)
            cur = {'layer': L, 'chunk': f['chunk'], 'start': f['decl'], 'end': f['end'], 'n': 1, 'first': short(f['name']), 'last': short(f['name']), 'file': file}
    if cur: emit(cur)
