# Checker fields and link stores that the layers touch, by layer, with the functions. usage: state.py <fns.json>
import json, sys, collections
src = open('/workspace/notes/lint/units/typecheck/checker-declarations-grammar-jsx/bottom-up/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1]); ORDER = ns['ORDER']
COMMON = {'compilerOptions', 'program', 'tracer', 'languageVersion', 'moduleKind', 'strictNullChecks', 'noImplicitAny', 'legacyDecorators',
          'anyType', 'errorType', 'unknownType', 'undefinedType', 'nullType', 'voidType', 'neverType', 'stringType', 'numberType', 'unknownSymbol',
          'emptyObjectType', 'silentNeverType', 'missingType', 'bigintType', 'booleanType', 'autoType', 'emptyGenericType', 'assignableRelation',
          'undefinedWideningType', 'esSymbolType', 'anyArrayType', 'anyReadonlyArrayType', 'comparableRelation', 'identityRelation', 'strictSubtypeRelation', 'subtypeRelation'}
print('kind\tname\tlayer\tfunctions')
for kind in ('links', 'fields'):
    agg = collections.defaultdict(lambda: collections.defaultdict(set))
    for f in fns:
        if not f['layer'] or f['layer'] == 'Z-SERVICES': continue
        for x in f[kind]:
            if kind == 'fields' and x in COMMON: continue
            agg[x][f['layer']].add(ns['short'](f['name']).replace('c.', ''))
    for x in sorted(agg):
        for L in ORDER:
            if L in agg[x]:
                print(f"{kind[:-1]}\t{x}\t{L}\t{', '.join(sorted(agg[x][L]))}")
