#!/usr/bin/env python3
"""Predicted executed tests of the side-table option per pass and per KB of source, from the construct counts of
round2/zero-cost-static-audit (count.cjs, count2.cjs) and a site list: one line per site `name: key [+ key ...]`.
usage: predict.py [sites.txt]      (without a file: the built-in list, one test per guarded TypeScript-only occurrence)"""
import re, sys
A = '/workspace/notes/lint/units/parser/round2/zero-cost-static-audit/'
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
KB = [1076221 / 1000, 3784758 / 1000, 3268179 / 1000, 7003 / 1000, 1506667 / 1000]
counts = {}
for f in ('counts.per-pass.txt', 'counts2.per-pass.txt'):
    for line in open(A + f).read().split('\n')[1:]:
        m = re.match(r'^(.*?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$', line)
        if m: counts[m.group(1).strip()] = [int(m.group(i)) for i in range(2, 7)]
DEFAULT = """
erased statement dropped from a statement list: stmt.erased(STypeScript)
interface statement: interface
type alias statement: type_alias
declare modifier: stmt.declare_modifier
namespace or module: namespace_or_module
enum: enum
type-only import or export, import equals: import.type_only + export.type_only + import_equals
annotation of a declaration: var_decl.typed
annotation of a parameter (parse_fn): fn(parse_fn).params.typed
return type (parse_fn): fn(parse_fn).return_type
this parameter: fn(parse_fn).this_param
type parameters: fn.type_params + method.type_params + class.type_params + arrow.type_params
function without a body: fn_stmt.no_body
annotation of an arrow parameter, arrow return type: arrow.params.typed + arrow.return_type
class member that is dropped: class.member.dropped
annotation of a class property: class.member.property.typed
implements clause: class.implements
annotation of a catch binding: catch.typed
as, satisfies: as + satisfies
non-null: non_null
type arguments of a call, new, JSX: lt_suffix.call_type_args + new.type_args + jsx.element.type_args
"""
text = open(sys.argv[1]).read() if len(sys.argv) > 1 else DEFAULT
tot = [0] * 5
print('site'.ljust(58) + ''.join(g.rjust(15) for g in G))
for line in text.strip().split('\n'):
    if not line.strip() or line.startswith('#'): continue
    name, keys = line.rsplit(':', 1)
    v = [0] * 5
    for k in keys.split('+'):
        k = k.strip(); sign = 1
        if k not in counts: print('  unknown key', k); continue
        for i in range(5): v[i] += counts[k][i]
    for i in range(5): tot[i] += v[i]
    print(name[:57].ljust(58) + ''.join(f'{x:,}'.rjust(15) for x in v))
print('tests per pass (tsx: per parse)'.ljust(58) + ''.join(f'{x:,}'.rjust(15) for x in tot))
print('tests per KB of source'.ljust(58) + ''.join(f'{x / kb:.2f}'.rjust(15) for x, kb in zip(tot, KB)))
print('Bc expected in a cgbench run of 20 passes (tsx 2,000)'.ljust(58) + ''.join(f'{x * (2000 if i == 3 else 20):,}'.rjust(15) for i, x in enumerate(tot)))
