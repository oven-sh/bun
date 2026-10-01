# Sites of the layers by kind: writes to a type, signature, symbol or link after creation; nil comparisons of slices and maps;
# arguments of core.IfElse, core.OrElse and core.Coalesce that hold a call (both branches are evaluated upstream).
import re, sys
from layers import *
mode = sys.argv[1]
FIELDS = ('objectFlags|flags|alias|symbol|Flags|CheckFlags|Declarations|Parent|ValueDeclaration|Members|resolved\\w+|declared\\w+|'
 'baseTypesResolved|thisType|allTypeParameters|outerTypeParameterCount|instantiations|target|mapper|typeParameters|typeParameter|'
 'constraint|constraintType|nameType|templateType|modifiersType|containsError|origin|regularType|freshType|'
 'uniqueLiteralFilledInstantiation|isolatedSignatureType|composite|thisParameter|properties|signatures|callSignatureCount|'
 'indexInfos|members|writeType|containingType|keyType|syntheticOrigin|parent|constituents|writeConstituents|declaration|node|'
 'isThisType|elementInfos|minLength|fixedLength|combinedFlags|readonly|value|lateSymbol|propertyType|mappedType|typeArguments|'
 'outerTypeParameters|siblings|widenedTypes|childContexts|name|hasName')
WRITE = re.compile(r'^\s*([A-Za-z_][\w\.\(\)\[\]]*)\.(' + FIELDS + r')\s*(\|=|&\^=|&=|=)[^=]')
if mode == 'writes':
    for L in ORDER:
        for f in mine(L):
            src = source(f['file'])
            for i in range(f['decl'], f['end'] + 1):
                m = WRITE.match(src[i - 1])
                if m and m.group(1) != 'c':
                    print('%s\t%s:%d\t%s\t%s' % (L, f['file'].split('/')[-1], i, short(f['name']), src[i - 1].strip()[:120]))
if mode == 'nil':
    rows = [l.rstrip('\n').split('\t') for l in open(os.path.dirname(os.path.abspath(__file__)) + '/../../conventions-scratch/data/nilcmp.tsv')]
    for r in rows:
        m = re.match(r'(checker/\w+\.go):(\d+)', r[0])
        if not m: continue
        for f in fns:
            if f['file'] == m.group(1) and f['decl'] <= int(m.group(2)) <= f['end'] and f['layer'] in IDX:
                print('%s\t%s\t%s\t%s\t%s\t%s' % (f['layer'], r[0].split('/')[-1], short(f['name']), r[2], r[3], r[4]))
if mode == 'eager':
    for L in ORDER:
        for f in mine(L):
            src = source(f['file'])
            for i in range(f['decl'], f['end'] + 1):
                l = src[i - 1]
                for m in re.finditer(r'core\.(IfElse|OrElse|Coalesce)\(', l):
                    if re.search(r'\bc\.\w+\(|[a-z]\w*\(', l[m.end():]):
                        print('%s\t%s:%d\t%s\t%s' % (L, f['file'].split('/')[-1], i, short(f['name']), l.strip()[:150]))
