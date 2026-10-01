# PORT_STATUS rows of the layers: upstream path, line range, layer with first and last function, Rust module, state, commit.
# usage: rows.py <fns.json>
import sys, os
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'layers.py')).read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1])
print('upstream path\tlines\tgroup\tRust module\tstate\tcommit')
for (L, file, lo, hi) in ns['LAYERS']:
    fs = sorted([f for f in fns if f['file'] == file and lo <= f['decl'] <= hi], key=lambda f: f['decl'])
    if not fs: continue
    first, last = ns['short'](fs[0]['name']).replace('c.', ''), ns['short'](fs[-1]['name']).replace('c.', '')
    mod = 'checker/' + (fs[0]['module'] if file == 'checker/checker.go' else file.split('/')[-1].replace('.go', '')) + '.rs'
    names = first if len(fs) == 1 else f"{first} .. {last}"
    state = 'out of scope (see the exception list)' if L == 'Z-SERVICES' and file != 'checker/checker.go' else 'not started'
    print(f"internal/{file}\t{fs[0]['decl']}-{fs[-1]['end']}\t{L}: {names} ({len(fs)} functions)\t{mod}\t{state}\t89d5d5b")
