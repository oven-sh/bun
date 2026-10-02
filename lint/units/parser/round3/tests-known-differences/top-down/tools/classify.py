# The class and the family of each of the 366 rows, from the group of its test and what main says. Writes rows.class.json.
#   T         syntax that main's type skipper rejects and tsc takes
#   O-stmt, O-member, O-param, O-class, O-expr    the same, decided outside the skipper
#   M         decorator metadata: main accepts and writes another value than tsc
#   X         other output: main accepts and reads another program
# usage: python3 classify.py <scratch dir>    reads base.rows.json, tsc.rows.json
import json, re, sys
from collections import Counter
S = sys.argv[1] if len(sys.argv) > 1 else '/tmp/r4'
base = json.load(open(S + '/base.rows.json')); tsc = json.load(open(S + '/tsc.rows.json'))
def fam(b):
    s = b['src']; g = b['group']; f = b['file']
    if b.get('key'): return ('M', 'metadata')
    if b['res'][0] == 'o': return ('X', 'other output: cast read where tsc reads a declaration')
    e = b['res'][1][0][0]
    if f.endswith('statements.test.ts') or 'module syntax' in g or (g.startswith('object types') and re.match(r'^(declare |export )?(type|interface) (as|satisfies)\b', s)):
        if 'with' in g or 'attributes' in g or s.startswith('import A from "x"\nwith'): return ('O-stmt', 'import attributes on the next line')
        if re.search(r'\babstract\s+declare\b', s): return ('O-stmt', 'abstract declare class')
        if 'enum' in s and '[' in s and e.startswith('Expected identifier but found "["'): return ('O-stmt', 'enum member name in brackets')
        if re.search(r'import\s*[.(]', s) and 'namespace' in s: return ('O-stmt', 'import expression in a namespace')
        return ('O-stmt', 'as or satisfies names a declaration')
    if 'expressions' in f or g.startswith('expressions'):
        if 'The modifier' in e: return ('T', 'out or in names a type or a type parameter')
        if e.startswith('Unexpected =') and re.search(r'(as|satisfies) T <=', s): return ('T', 'a comparison follows the type after as and satisfies')
        if re.match(r'^Unexpected (if|class|enum|var)$', e) or s == 'const v = (): if => x;': return ('T', 'a reserved word is the name of a type reference')
        if e == 'Unexpected :': return ('O-expr', 'a colon follows an operand that ends with a parenthesis')
        if e.startswith('Expected ":" but found'): return ('O-expr', 'a colon follows parentheses between ? and : of a conditional')
        return ('?', '?')
    if g.startswith('class members'):
        if 'accessor' in s: return ('O-member', 'accessor is a modifier without standard decorators')
        if 'implements' in s: return ('O-class', 'a class implements an expression')
        if 'public a' in s: return ('O-param', 'a modifier before a parameter of a method')
        return ('O-member', 'a comma ends an index signature of a class')
    if g.startswith('signatures'):
        if 'The modifier' in e: return ('T', 'out or in names a type or a type parameter')
        if s.startswith('declare class'): return ('O-param', 'a comma follows the rest parameter of a signature of a declared class')
        if s.startswith('function f(public'): return ('O-param', 'a modifier before a parameter of a function')
        if 'public' in s: return ('T', 'a modifier stands before a parameter of a signature')
        if ', ,' in s: return ('T', 'a binding pattern of a signature has a hole')
        return ('T', 'a parameter of a signature has an initializer')
    if g.startswith('object types'):
        if 'extends a' in s: return ('T', 'an interface extends an expression')
        if 'public' in s: return ('T', 'a modifier stands before a parameter of a signature')
        return ('T', 'a parameter of a signature has an initializer')
    if g.startswith('type forms'):
        if '...' in s: return ('T', 'a reserved word is the label of a rest element of a tuple')
        if 'import(' in s: return ('T', 'an import type takes type arguments and an expression in an attribute')
        if 'asserts' in s: return ('T', 'the type of an assertion predicate starts on the next line')
        return ('T', 'a reserved word is the name of a type reference')
    return ('?', '?')
rows = [fam(b) for b in base]
json.dump([{'i': i, 'class': c, 'family': f} for i, (c, f) in enumerate(rows)], open(S + '/rows.class.json', 'w'))
agg = {}
for (c, f), b, t in zip(rows, base, tsc):
    a = agg.setdefault((c, f), [0, set(), 0, 0]); a[0] += 1; a[1].add((b['loader'], b['src'])); a[2] += b['res'][0] == 'e'; a[3] += t['tsc']['valid']
print('class\trows\tdistinct (loader, source)\tmain rejects\tvalid for tsc\tfamily')
for k, a in sorted(agg.items()): print(f"{k[0]}\t{a[0]}\t{len(a[1])}\t{a[2]}\t{a[3]}\t{k[1]}")
print(dict(Counter(c for c, _ in rows)), len(rows))
