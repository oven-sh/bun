# PORT_STATUS rows of relater.go, inference.go and the normalization functions of checker.go: one row per run of one layer in file order.
from unified import *
fns = load()
def rows(file, module):
    fs = sorted([f for f in fns if f['file'] == file and (f['layer'] in MINE or file != C)], key=lambda f: f['decl'])
    if file == C: fs = [f for f in fs if f['layer'] in MINE]
    runs = []
    for f in fs:
        L = f['layer']
        if file == C and runs and f['decl'] - runs[-1][2] > 60: runs.append([L, f['start'], f['end'], [f]]); continue
        if runs and runs[-1][0] == L: runs[-1][2] = f['end']; runs[-1][3].append(f)
        else: runs.append([L, f['start'], f['end'], [f]])
    # The records declared just above a run belong to its row.
    first = {(R, 1036): 1030, (R, 2599): 2569, (I, 32): 11}
    for L, lo, hi, g in runs:
        lo = first.get((file, lo), lo)
        names = short(g[0]['name']) + (' .. ' + short(g[-1]['name']) if len(g) > 1 else '')
        own = '' if L in MINE else ' (row of its own layer)'
        print(f"internal/{file}\t{lo}-{hi}\t{L}: {names} ({len(g)}){own}\t{module}\tnot started\t89d5d5b")
print('upstream path\tlines\tgroup\tRust module\tstate\tcommit')
print('internal/checker/relater.go\t1-91\tR-REL: SignatureCheckMode, MinArgumentCountFlags, IntersectionState, RecursionFlags, ExpandingFlags, RelationComparisonResult, ErrorReporter, RecursionId (records; DiagnosticAndArguments and ErrorOutputContainer are unused upstream and not ported)\tchecker/relater.rs\tnot started\t89d5d5b')
rows(R, 'checker/relater.rs')
rows(I, 'checker/inference.rs')
rows(C, 'checker/c45_base_constraints_normalization.rs')
