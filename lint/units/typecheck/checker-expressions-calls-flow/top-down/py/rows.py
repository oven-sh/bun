# Rows of PORT_STATUS.md for the twelve layers: one row per run of consecutive functions of one layer in one Rust file.
from zones import *
print('upstream path\tlines\tgroup\tRust module\tstate\tcommit')
def emit(cur):
    span = cur['first'] + (' .. ' + cur['last'] if cur['n'] > 1 else '')
    print('internal/%s\t%d-%d\t%s: %s (%d functions, %d lines)\t%s\tnot started\t89d5d5b' % (cur['file'], cur['start'], cur['end'], cur['layer'], span, cur['n'], cur['lines'], cur['mod']))
for file in [C, F]:
    cur = None
    for f in sorted([f for f in fns if f['file'] == file], key=lambda f: f['decl']):
        if not f['mine']:
            if cur: emit(cur); cur = None
            continue
        mod = 'checker/%s.rs' % f['chunk']
        if cur and cur['layer'] == f['zone'] and cur['mod'] == mod:
            cur['end'] = f['end']; cur['n'] += 1; cur['last'] = short(f); cur['lines'] += f['end'] - f['decl'] + 1
        else:
            if cur: emit(cur)
            cur = {'layer': f['zone'], 'mod': mod, 'start': f['decl'], 'end': f['end'], 'n': 1, 'first': short(f), 'last': short(f), 'file': file, 'lines': f['end'] - f['decl'] + 1}
    if cur: emit(cur)
