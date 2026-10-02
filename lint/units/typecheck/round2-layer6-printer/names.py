# Counts, for each Go file of internal/printer (or another package), the functions whose name (underscores and case aside) some Rust file of the matching directory of src/typecheck has.
# usage: python3 names.py [--pkg printer] <file.go> ...   (reads /workspace/ref/typescript-go/internal/<pkg> and /workspace/wt/typecheck/src/typecheck/<pkg>)
import re, sys, os, glob
args = sys.argv[1:]
pkg = 'printer'
if args and args[0] == '--pkg':
    pkg = args[1]; args = args[2:]
GO = '/workspace/ref/typescript-go/internal/' + pkg
RS = '/workspace/wt/typecheck/src/typecheck'
gofunc = re.compile(r'^func\s+(?:\(\s*\w+\s+\*?([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\s*\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[\[(]', re.M)
rsfn = re.compile(r'\bfn\s+([a-z_][a-z0-9_]*)')
def norm(s):
    s = s.replace('_', '').lower()
    return s[:-8] if s.endswith('exported') else s
def rust_names(paths):
    names = {}
    for p in paths:
        for m in rsfn.finditer(open(p, errors='replace').read()):
            names.setdefault(norm(m.group(1)), set()).add(os.path.relpath(p, RS))
    return names
own = rust_names(glob.glob(RS + '/' + pkg + '/*.rs'))
tree = rust_names(glob.glob(RS + '/**/*.rs', recursive=True))
show = '--list' in args
for gofile in [a for a in args if a != '--list']:
    text = open(os.path.join(GO, gofile)).read()
    funcs = [(m.group(1), m.group(2), text.count('\n', 0, m.start()) + 1) for m in gofunc.finditer(text)]
    missing, elsewhere = [], []
    for recv, name, line in funcs:
        n = norm(name)
        if n in own: continue
        if n in tree: elsewhere.append((recv, name, line, sorted(tree[n])[:2]))
        else: missing.append((recv, name, line))
    print(f'== {pkg}/{gofile}: {len(funcs)} funcs, {len(funcs)-len(missing)-len(elsewhere)} have a name in {pkg}/, {len(elsewhere)} only elsewhere in the tree, {len(missing)} nowhere')
    if show:
        for recv, name, line, where in elsewhere: print(f'   elsewhere {line}: {(recv + "." if recv else "") + name} -> {where}')
        for recv, name, line in missing: print(f'   nowhere   {line}: {(recv + "." if recv else "") + name}')
