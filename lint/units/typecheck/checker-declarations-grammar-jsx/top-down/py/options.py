# Compiler options, cached option fields and program calls that the layers read, by layer and function.
# usage: options.py <fns.json>
import json, re, sys, collections
src = open('/workspace/notes/lint/units/typecheck/checker-declarations-grammar-jsx/bottom-up/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1]); ORDER = ns['ORDER']
ROOT = '/workspace/ref/typescript-go/internal/'
lines = {}
def text(f):
    if f['file'] not in lines: lines[f['file']] = open(ROOT + f['file']).read().split('\n')
    return lines[f['file']][f['decl']-1:f['end']]
CACHED = ['languageVersion', 'moduleKind', 'moduleResolutionKind', 'legacyDecorators', 'emitStandardClassFields', 'allowSyntheticDefaultImports',
          'strictNullChecks', 'strictFunctionTypes', 'strictBindCallApply', 'strictPropertyInitialization', 'strictBuiltinIteratorReturn',
          'noImplicitAny', 'noImplicitThis', 'useUnknownInCatchVariables', 'exactOptionalPropertyTypes', 'canCollectSymbolAliasAccessibilityData',
          'arrayVariances', 'noUncheckedSideEffectImports', 'isolatedModulesLikeFlagName']
pats = [('option', re.compile(r'c\.compilerOptions\.(\w+)')), ('cached', re.compile(r'\bc\.(' + '|'.join(CACHED) + r')\b')),
        ('program', re.compile(r'c\.program\.(\w+)')), ('minimum target', re.compile(r'LanguageFeatureMinimumTarget\.(\w+)')),
        ('script target', re.compile(r'core\.ScriptTarget(\w+)')), ('module kind', re.compile(r'core\.ModuleKind(\w+)'))]
agg = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(set)))
for f in fns:
    if not f['layer']: continue
    for i, ln in enumerate(text(f)):
        for kind, p in pats:
            for m in p.finditer(ln):
                agg[kind][m.group(1)][f['layer']].add(f"{ns['short'](f['name']).replace('c.', '')}@{f['decl'] + i}")
print('kind\tname\tlayer\tsites')
for kind, _ in pats:
    for name in sorted(agg[kind]):
        for L in ORDER:
            if L in agg[kind][name] and L != 'Z-SERVICES':
                s = sorted(agg[kind][name][L], key=lambda x: int(x.split('@')[1]))
                print(f"{kind}\t{name}\t{L}\t{', '.join(s)}")
