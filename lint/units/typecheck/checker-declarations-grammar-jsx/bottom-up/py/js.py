# JavaScript and JSDoc specific reads, by function, over the whole checker and binder. usage: js.py <fns.json>
import json, re, sys, collections
src = open('/tmp/cdg/py/layers.py').read().replace('\nmain()\n', '\n')
ns = {}; exec(compile(src, 'layers', 'exec'), ns)
fns = ns['load'](sys.argv[1])
ROOT = '/workspace/ref/typescript-go/internal/'
lines = {}
def text(f):
    if f['file'] not in lines: lines[f['file']] = open(ROOT + f['file']).read().split('\n')
    return lines[f['file']][f['decl']-1:f['end']]
P = re.compile(r'(IsInJSFile|IsSourceFileJS|JSDeclarationKind\w+|GetAssignmentDeclarationKind|CommonJSModuleIndicator|NodeFlagsJavaScriptFile|IsCheckJSEnabledForFile|IsPlainJSFile|KindJSTypeAliasDeclaration|KindJSExportAssignment|KindCommonJSExport|KindJSImportDeclaration|IsJSTypeAliasDeclaration|IsTypeOrJSTypeAliasDeclaration|IsImportDeclarationOrJSImportDeclaration|IsBindableObjectDefinePropertyCall|IsVariableDeclarationInitializedToRequire|IsRequireCall|isCommonJSRequire|FullSignature|NodeFlagsReparsed|NodeFlagsJSDoc\b|KindJSDoc\w*|IsJSDoc\w+|GetJSDoc\w+|EagerJSDoc|\.JSDoc\(|SymbolFlagsModuleExports|SymbolFlagsAssignment|IsModuleExportsAccessExpression|IsInJsonFile|JsonFile|isUncheckedJS\w*|GetHostSignatureFromJSDoc|IsJSDocNameReferenceContext|GetReparsedNodeForNode|IsExternalOrCommonJSModule|thisExpando\w+|IsThisProperty\w*|ExpandoInitializer|getExpando\w+|isExpando\w+)')
rows = []
for f in fns:
    if f['pkg'] != 'checker': continue
    hits = collections.Counter()
    for ln in text(f):
        for m in P.finditer(ln): hits[m.group(1)] += 1
    if hits:
        rows.append((f['file'], f['decl'], f['end'], f['layer'] or f['module'], ns['short'](f['name']), ','.join(sorted(hits))))
rows.sort()
for r in rows:
    print(f"{r[0].split('/')[-1]}\t{r[1]}-{r[2]}\t{r[3]}\t{r[4]}\t{r[5]}")
