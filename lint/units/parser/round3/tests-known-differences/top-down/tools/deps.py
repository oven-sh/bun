# What a lint parse needs to read each row as tsc does, after a parse without lint is main's again.
# Reads base.rows.json, tsc.rows.json, rows.class.json, rows.sites.json. Writes rows.table.tsv and prints the dependency table.
import json, re, sys
from collections import Counter, defaultdict
S = sys.argv[1] if len(sys.argv) > 1 else '/tmp/r4'
base = json.load(open(S + '/base.rows.json')); tsc = json.load(open(S + '/tsc.rows.json'))
cls = json.load(open(S + '/rows.class.json')); sites = json.load(open(S + '/rows.sites.json'))
F = {'typescript-grammar.test.ts': 'tg', 'typescript-grammar-expressions.test.ts': 'tg-expr', 'typescript-grammar-statements.test.ts': 'tg-stmt', 'typescript-grammar-decorator-metadata.test.ts': 'tg-meta'}
IDENT_ARROW = {108, 111, 201, 202, 203, 204, 205, 206, 207, 208, 209, 212, 213, 231}
def expr_dep(i, src):
    # The true branch (or the operand) that ends with the parenthesis before the colon: what reads it.
    if i in IDENT_ARROW: return ['E-IDENT-ARROW']
    m = re.search(r'\?\s*(b \? c : )?(async\b)?\s*(<)?', src)
    out = []
    if re.search(r'(^|[^\w$.])async\s*[(<]|async \w+ =>|async =>', src): out.append('E-ASYNC')
    if re.search(r'(^|[\s(\[?:+\-!]|typeof |await )<[\w ,]', src) and 'async <' not in src and 'async<' not in src: out.append('E-LT')
    if not out: out.append('P1')
    if re.search(r'=> \(', src) or re.search(r'=> \(\{', src): out.append('TWIN-BODY-FLAGS')
    return out
DEP_OF_SITE = {
    'variable annotation': 'V', 'declare var annotation': 'V', 'type alias: right side': 'G1', 'interface: heritage and members': 'G2',
    'as': 'AS', 'satisfies': 'AS', 'type assertion <T>x': 'D1', 'arrow return type': 'TWIN', 'arrow parameter annotation': 'TWIN',
    'type parameter of ArrowFunction': 'D1', 'type parameter of FunctionDeclaration': 'TP', 'type parameter of FunctionExpression': 'TP',
    'FunctionDeclaration return type': 'RT', 'MethodDeclaration return type': 'RT', 'type arguments in extends of ClassDeclaration': 'EXT',
    'class implements': 'IMPL', 'class index signature': 'G3', 'class property annotation': 'V', 'MethodDeclaration parameter annotation': 'V',
    'FunctionDeclaration parameter annotation': 'V', 'Constructor parameter annotation': 'V', 'type arguments of CallExpression': 'TARGS',
    'type parameter of InterfaceDeclaration': 'TPD', 'type parameter of TypeAliasDeclaration': 'TPD',
}
def deps(i):
    b = base[i]; c = cls[i]; s = sites[i]['sites']; fam = c['family']; src = b['src']
    d = []
    if c['class'] == 'M':
        return ['BUILD']  # the type alone, read with the Build sink
    if c['class'] in ('T',):
        d.append('BUILD')
        for site in s:
            x = DEP_OF_SITE.get(site)
            if x and x not in d: d.append(x)
        # An arrow function that starts at "(" is read by the twin only where "(" leads to it.
        if 'TWIN' in d and not re.search(r'=\s*(async\s*)?<', src): d.append('P1')
        # In a .tsx file type parameters are decided by is_ts_arrow_fn_jsx, which is main's.
        if b['loader'] == 'tsx' and 'D1' in d and not re.search(r'async', src): d[d.index('D1')] = 'TSX-ARROW'
        return d
    if c['class'] == 'X' or fam == 'as or satisfies names a declaration':
        d.append('S-AS')
        if 'type alias: right side' in s: d.append('G1')
        if 'interface: heritage and members' in s: d.append('G2')
        return d
    m = {'abstract declare class': 'S-ABS', 'enum member name in brackets': 'S-ENUM', 'import expression in a namespace': 'S-NSIMPORT', 'import attributes on the next line': 'S-WITH',
         'a class implements an expression': 'IMPL', 'a modifier before a parameter of a function': 'P-MOD', 'a modifier before a parameter of a method': 'P-MOD',
         'a comma follows the rest parameter of a signature of a declared class': 'P-REST', 'a comma ends an index signature of a class': 'G3', 'accessor is a modifier without standard decorators': 'M-ACC'}
    if fam in m: return [m[fam]]
    if c['class'] == 'O-expr': return expr_dep(i, src)
    return ['?']
out = []
table = Counter(); by = defaultdict(list)
for i, (b, t, c) in enumerate(zip(base, tsc, cls)):
    d = deps(i)
    tt = t['tsc']
    if b['res'][0] == 'e':
        e = b['res'][1]; main = 'R ' + e[0][0] + f' ({e[0][1]}:{e[0][2]})' + (f' +{len(e)-1}' if len(e) > 1 else '')
    elif b.get('key'):
        main = 'A design:' + b['key'] + '=' + re.sub(r'\s+', ' ', str(b.get('value')))
    else:
        main = 'A prints ' + json.dumps(b['res'][1])
    if tt['parse']: v = 'PARSE ' + ','.join(f"TS{x[0]}@{x[1]}" for x in tt['parse'])
    elif tt['chk']: v = 'CHK ' + ','.join(f"TS{x[0]}" for x in tt['chk'])
    else: v = 'valid'
    oth = ','.join('TS' + str(x) for x in (tt['oth'] or []))
    tscv = ''
    if b.get('key'): tscv = 'design:' + b['key'] + '=' + str(tt.get('tscTag')) + ' | raw ' + str(tt.get('tscValue'))
    out.append('\t'.join([str(i), F[b['file']], b['group'], b['loader'], c['class'], c['family'], json.dumps(b['src']), main, v, oth, tscv, ';'.join(sites[i]['sites']), '+'.join(d)]))
    for x in d: by[x].append(i)
    table[(c['class'], '+'.join(d))] += 1
open(S + '/rows.table.tsv', 'w').write('i\tfile\tgroup\tloader\tclass\tfamily\tsource\tmain f4d755a9cf\ttsc 6.0.2\ttsc other codes\ttsc metadata (strictNullChecks off)\tsites of TypeScript syntax (tsc tree)\tneeds in a lint parse\n' + '\n'.join(out) + '\n')
for k, v in sorted(table.items()): print(v, k)
print()
for k in sorted(by): print(k, len(by[k]), by[k] if len(by[k]) <= 40 else str(by[k][:40]) + '...')
