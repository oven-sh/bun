#!/usr/bin/env python3
"""For each module of src/typecheck/checker: the functions of its upstream range, and how many have a Rust fn of their name
(underscores and case aside, the suffix _exported aside) in the module's file, only in another file of checker/, or nowhere.
It compares names, not receivers and not bodies.
usage: ranges.py [--list] [module ...]   (default: the 15 modules that had no file at c73680fe1d and the 14 of the look-ahead's section B)"""
import os, re, sys
GO = '/workspace/ref/typescript-go/internal/checker'
RS = '/workspace/wt/typecheck/src/typecheck/checker'
SPLIT = '/workspace/notes/lint/units/typecheck/checker-core-scratch/data/split.tsv'
WHOLE = ['emitresolver', 'flow', 'grammarchecks', 'inference', 'jsdoc', 'jsx', 'links', 'mapper', 'nodebuilder', 'nodebuilderimpl',
         'nodebuilderscopes', 'nodecopy', 'printer', 'pseudotypenodebuilder', 'relater', 'stringer_generated',
         'symbolaccessibility', 'symboltracker', 'types', 'utilities']
NOFILE = ['c03_init', 'c14_expressions', 'c16_function_expressions_collisions', 'c18_identifiers_property_access_this',
          'c19_assertions_binary_operators', 'c30_type_keys', 'c32_type_resolution', 'c41_new_types', 'c44_index_indexed_access',
          'c50_contextual_properties_inference_context', 'c52_symbol_at_location', 'emitresolver', 'grammarchecks', 'inference',
          'utilities']
PART = ['c04_name_resolution_hooks', 'c15_calls', 'c17_unary_meta_yield', 'c20_object_literals_spread',
        'c21_resolved_symbols_diagnostics', 'c34_return_types', 'c35_resolve_members', 'c37_instantiation',
        'c40_type_nodes_conditional_tuples', 'c45_base_constraints_normalization', 'c47_promised_mapped_template',
        'c48_contextual_types', 'c49_call_arguments_decorator_signatures', 'c51_type_facts_awaited']
gofunc = re.compile(r'^func\s+(?:\(\s*\w+\s+\*?([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\s*\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[\[(]', re.M)
rsfn = re.compile(r'\bfn\s+(?:r#)?([a-z_][a-z0-9_]*)')
def norm(s):
    s = s.replace('_', '').lower()
    return s[:-8] if s.endswith('exported') else s
def go_funcs(path, lo=1, hi=10**9):
    text = open(path).read()
    out = []
    for m in gofunc.finditer(text):
        line = text.count('\n', 0, m.start()) + 1
        if lo <= line <= hi: out.append((m.group(1), m.group(2), line))
    return out
ranges = {}
for row in open(SPLIT):
    p = row.rstrip('\n').split('\t')
    if len(p) >= 5 and p[0].isdigit():
        a, b = p[1].split('-'); ranges[p[4][:-3]] = (int(a), int(b))
rust = {}
for f in sorted(os.listdir(RS)):
    if f.endswith('.rs'):
        rust[f[:-3]] = {norm(m.group(1)) for m in rsfn.finditer(open(os.path.join(RS, f), errors='replace').read())}
args = [a for a in sys.argv[1:] if a != '--list']
show = '--list' in sys.argv[1:]
total = [0, 0, 0, 0]
for mod in (args or NOFILE + PART):
    if mod in ranges:
        lo, hi = ranges[mod]; funcs = go_funcs(os.path.join(GO, 'checker.go'), lo, hi); where = f'checker.go {lo}-{hi}'
    elif mod in WHOLE:
        funcs = go_funcs(os.path.join(GO, mod + '.go')); where = mod + '.go'
    else:
        print(f'{mod}: not a module of the cut'); continue
    path = os.path.join(RS, mod + '.rs')
    lines = sum(1 for _ in open(path, errors='replace')) if os.path.isfile(path) else 0
    own = rust.get(mod, set())
    others = set().union(*[v for k, v in rust.items() if k != mod]) if rust else set()
    here = [f for f in funcs if norm(f[1]) in own]
    elsewhere = [f for f in funcs if norm(f[1]) not in own and norm(f[1]) in others]
    nowhere = [f for f in funcs if norm(f[1]) not in own and norm(f[1]) not in others]
    state = f'{lines} lines' if lines else 'NO FILE'
    print(f'{mod:48} {where:26} {len(funcs):4} functions: {len(here):4} in the file, {len(elsewhere):3} only elsewhere in checker/, {len(nowhere):4} nowhere   ({state})')
    total[0] += len(funcs); total[1] += len(here); total[2] += len(elsewhere); total[3] += len(nowhere)
    if show:
        for recv, name, line in elsewhere: print(f'      elsewhere {line}: {(recv + "." if recv else "") + name}')
        for recv, name, line in nowhere: print(f'      nowhere   {line}: {(recv + "." if recv else "") + name}')
print(f'total: {total[0]} functions, {total[1]} in their file, {total[2]} only elsewhere in checker/, {total[3]} nowhere')
