# Counts, for each Go file of internal/ast, the functions whose name (underscores and case aside) some Rust file of src/typecheck/ast has.
# usage: python3 names.py <file.go> ...   (reads /workspace/ref/typescript-go/internal/ast and /workspace/wt/typecheck/src/typecheck)
import re, sys, os, glob
GO = '/workspace/ref/typescript-go/internal/ast'
RS = '/workspace/wt/typecheck/src/typecheck'
gofunc = re.compile(r'^func\s+(?:\(\s*\w+\s+\*?([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\s*\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[\[(]', re.M)
rsfn = re.compile(r'\bfn\s+([a-z_][a-z0-9_]*)')
def norm(s): return s.replace('_', '').lower()
def rust_names(paths):
    names = {}
    for p in paths:
        for m in rsfn.finditer(open(p, errors='replace').read()):
            names.setdefault(norm(m.group(1)), set()).add(os.path.relpath(p, RS))
    return names
ast_all = rust_names(glob.glob(RS + '/ast/*.rs'))
tree_all = rust_names([p for p in glob.glob(RS + '/**/*.rs', recursive=True)])
for gofile in sys.argv[1:]:
    text = open(os.path.join(GO, gofile)).read()
    funcs = [(m.group(1), m.group(2), text.count('\n', 0, m.start()) + 1) for m in gofunc.finditer(text)]
    missing_ast, elsewhere = [], []
    for recv, name, line in funcs:
        n = norm(name)
        if n in ast_all: continue
        if n in tree_all: elsewhere.append((recv, name, line, sorted(tree_all[n])[:2]))
        else: missing_ast.append((recv, name, line))
    print(f'== {gofile}: {len(funcs)} funcs, {len(funcs)-len(missing_ast)-len(elsewhere)} have a name in ast/, {len(elsewhere)} only elsewhere in the tree, {len(missing_ast)} nowhere')
    for recv, name, line, where in elsewhere: print(f'   elsewhere {line}: {(recv + "." if recv else "") + name} -> {where}')
    for recv, name, line in missing_ast: print(f'   nowhere   {line}: {(recv + "." if recv else "") + name}')
