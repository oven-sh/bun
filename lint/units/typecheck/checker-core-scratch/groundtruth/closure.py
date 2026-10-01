import os, re, sys
ROOT = '/workspace/ref/typescript-go/'
MOD = 'github.com/microsoft/typescript-go/'
seen = {}; third = {}
def imports(pkgdir):
    out = set()
    for fn in os.listdir(pkgdir):
        if not fn.endswith('.go') or fn.endswith('_test.go'): continue
        base = fn[:-3]
        if any(base.endswith('_' + o) for o in ('windows','darwin','js','wasm','freebsd','plan9','wasip1')): continue
        src = open(os.path.join(pkgdir, fn), encoding='utf-8', errors='replace').read()
        m = re.search(r'^import \((.*?)^\)', src, re.S | re.M)
        block = m.group(1) if m else ''
        for l in block.split('\n'):
            mm = re.search(r'"([^"]+)"', l)
            if mm: out.add(mm.group(1))
        for mm in re.finditer(r'^import (?:\w+ )?"([^"]+)"', src, re.M):
            out.add(mm.group(1))
    return out
def visit(p):
    if p in seen: return
    seen[p] = True
    d = ROOT + p[len(MOD):]
    for i in imports(d):
        if i.startswith(MOD): visit(i)
        elif '.' in i.split('/')[0]: third.setdefault(i, set()).add(p[len(MOD):])
for s in sys.argv[1:]:
    visit(MOD + s)
print('\n'.join(sorted(x[len(MOD):] for x in seen)))
print('--third')
for k, v in sorted(third.items()): print(k, sorted(v)[:4])
