#!/usr/bin/env python3
"""splits1.py <typed text (.cts | .ts)> <a work folder> [<front end>]: IS EVERY SPLIT OF A VARIABLE INTO ROLES THE BUNDLE's OWN PROGRAM?
WHY: `verify` strips the suffixes `$given` and `$as<Role>` and compares with npm's bytes: IT CANNOT SEE A WRONG SPLIT: a read written `x$asA` where the bundle's one `x` holds what was stored as `x$asB` strips to the same text and RUNS ANOTHER PROGRAM, in silence. Typed Fizz has 87 such role variables.
WHAT IS DUE: at every read of a variant, on every path, THE LAST STORE TO ANY VARIANT OF THAT BASE WAS A STORE TO THIS VARIANT (or a plain copy of it), and the base is a variable OF THAT FUNCTION (a role of an outer variable would make it local).
HOW, WITHOUT A PARSER OF MY OWN FOR THE FLOW: THE TYPE CHECKER's FLOW ANALYSIS DOES IT. The typed text is printed as JavaScript with its devices kept (`bun build --no-bundle`); in every function that has variants of a base b they are MERGED BACK into one untyped variable `b$V` (an "auto" variable: the checker types each read by the stores that reach it); a store to variant k becomes `b$V = $tag("k", <value>)`, of type { k: 1 }; a read of variant k becomes `$is("k", b$V)`, which takes { k: 1 } alone; a copy `b = b$given` yields { plain: 1, given: 1 }. A READ THAT A STORE TO ANOTHER VARIANT CAN REACH IS A TYPE ERROR (TS2345) ON A LINE WITH `$is$`. (ONE PLAIN FUNCTION A TAG: with generic helpers the checker inferred the tag from the VALUE too and found nothing: THE SABOTAGE SHOWED IT.) All other errors of that text are passed over.
BLIND, AND SAID: a variant that a NESTED function reads or stores (the checker gives up on a captured auto variable: TS7034): listed as CAPTURED: to be read by hand.
PRINTS: functions with variants, bases, variants; WRONG: function, base, variant, the printed line; NOT LOCAL; CAPTURED. Exit 1 if anything is wrong or not local.
THE SABOTAGE (run it when this file changes): splits1_sabotage.sh: five wrong splits laid into a good text: each must be found."""
import os, re, subprocess, sys
src, W = sys.argv[1], sys.argv[2]; SEMA = sys.argv[3] if len(sys.argv) > 3 else os.environ['SEMA']; BUN = os.environ.get('BUN', 'bun')
os.makedirs(W, exist_ok=True)
text = re.sub(r'^\s*///\s*<reference[^\n]*$', '', open(src).read(), flags=re.M)
# the names that MARKED var statements declare are no declarations of the bundle's: said to the printed text by a call `$$added("a", "b")` behind each, which stays in its function
def added(m):
    depth = 0; cur = ''; parts = []
    for c in m.group(2):
        if c in '<([{': depth += 1
        elif c in '>)]}' and depth: depth -= 1
        if c == ',' and depth == 0: parts.append(cur); cur = ''
        else: cur += c
    names = [g.group(1) for g in (re.match(r'\s*([A-Za-z_$][\w$]*)', d) for d in parts + [cur]) if g]
    return m.group(1) + 'var ' + m.group(2) + '; $$added(' + ', '.join('"%s"' % x for x in names) + ');'
text = re.sub(r'/\*\$\*/(.*?)/\*\$\*/', lambda r: '/*$*/' + re.sub(r'(^\s*|;\s*)var ([^;]*?);', added, r.group(1)) + '/*$*/', text, flags=re.S)  # the markers go in pairs: what stands BETWEEN them alone
open(W + '/in.cts' if src.endswith('.cts') else W + '/in.ts', 'w').write(text)
name = 'in.cts' if src.endswith('.cts') else 'in.ts'
r = subprocess.run([BUN, 'build', '--no-bundle', '--target=bun', name], cwd=W, capture_output=True, text=True)
if r.returncode or not r.stdout.strip(): sys.exit('splits1: the text does not print: ' + r.stderr[:400])
js = r.stdout
# Bun's printer folds `a = X.a, b = X.b` of a var statement into `{ a, b } = X`: laid back, so that every declarator is a name and a value
ENTRY = r'[A-Za-z_$][\w$]*(?:: [A-Za-z_$][\w$]*)?'
js = re.sub(r'(?<=var |.., )\{ ((?:' + ENTRY + r', )*' + ENTRY + r') \} = ([A-Za-z_$][\w$.]*)(?=[,;])', lambda m: ', '.join('%s = %s.%s' % (x.split(': ')[-1], m.group(2), x.split(': ')[0]) for x in m.group(1).split(', ')), js)
open(W + '/printed.js', 'w').write(js)

# ---- tokens
KEY_BEFORE_REGEX = {'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else'}
PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**']
T = []  # (kind, text)
i = 0; n = len(js); last = None
while i < n:
    c = js[i]
    if c.isspace():
        j = i
        while j < n and js[j].isspace(): j += 1
        T.append(('ws', js[i:j])); i = j; continue
    if js.startswith('//', i):
        j = js.find('\n', i); j = n if j < 0 else j; T.append(('ws', js[i:j])); i = j; continue
    if js.startswith('/*', i):
        j = js.find('*/', i) + 2; T.append(('ws', js[i:j])); i = j; continue
    if c in '"\'':
        j = i + 1
        while js[j] != c: j += 2 if js[j] == '\\' else 1
        T.append(('str', js[i:j + 1])); last = T[-1]; i = j + 1; continue
    if c == '`':
        j = i + 1; depth = 0
        while True:
            if js[j] == '\\': j += 2; continue
            if depth == 0 and js[j] == '`': break
            if js.startswith('${', j): depth += 1; j += 2; continue
            if depth and js[j] == '{': depth += 1
            if depth and js[j] == '}': depth -= 1
            j += 1
        T.append(('str', js[i:j + 1])); last = T[-1]; i = j + 1; continue
    if c == '/' and (last is None or (last[0] == 'punct' and last[1] not in (')', ']', '}')) or (last[0] == 'id' and last[1] in KEY_BEFORE_REGEX)):
        j = i + 1; cls = False
        while True:
            if js[j] == '\\': j += 2; continue
            if js[j] == '[': cls = True
            elif js[j] == ']': cls = False
            elif js[j] == '/' and not cls: break
            j += 1
        j += 1
        while j < n and (js[j].isalnum()): j += 1
        T.append(('str', js[i:j])); last = T[-1]; i = j; continue
    m = re.compile(r'[A-Za-z_$][\w$]*').match(js, i)
    if m: T.append(('id', m.group(0))); last = T[-1]; i = m.end(); continue
    m = re.compile(r'(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)n?').match(js, i)
    if m and m.group(0): T.append(('num', m.group(0))); last = T[-1]; i = m.end(); continue
    for p in PUNCT:
        if js.startswith(p, i): T.append(('punct', p)); break
    else: T.append(('punct', c))
    last = T[-1]; i += len(T[-1][1])
S = [k for k, t in enumerate(T) if t[0] != 'ws']  # the significant ones
pos = {k: a for a, k in enumerate(S)}
def nxt(k, d=1):
    a = pos[k] + d; return S[a] if 0 <= a < len(S) else None
match = {}; stack = []; inside = {}
for k in S:
    t = T[k]; inside[k] = stack[-1] if stack else None
    if t[0] == 'punct' and t[1] in '([{': stack.append(k)
    elif t[0] == 'punct' and t[1] in ')]}':
        o = stack.pop(); match[o] = k; match[k] = o
line_of = []; l = 1
for t in T: line_of.append(l); l += t[1].count('\n')

# ---- functions
F = []  # dict(name, p0, p1, b0, b1)
for k in S:
    if T[k] == ('id', 'function') and not (nxt(k, -1) is not None and T[nxt(k, -1)][1] == '.'):
        a = nxt(k); nm = '(anonymous)'
        if T[a][1] == '*': a = nxt(a)
        if T[a][0] == 'id': nm = T[a][1]; a = nxt(a)
        if T[a][1] != '(': continue
        p0, p1 = a, match[a]; b0 = nxt(p1)
        if T[b0][1] != '{': continue
        F.append(dict(name=nm, p0=p0, p1=p1, b0=b0, b1=match[b0], line=line_of[k]))
owner = {}
for f in sorted(F, key=lambda f: f['b1'] - f['p0'], reverse=True):  # the innermost last
    for k in range(f['p0'], f['b1'] + 1): owner[k] = f
def split(name):
    m = re.match(r'^([A-Za-z_$][\w$]*?)(\$given|\$as[A-Z]\w*)$', name)
    return (m.group(1), m.group(2)[1:]) if m else (name, 'plain')
ASSIGN = {'=', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '<<=', '>>=', '>>>=', '**=', '&&=', '||=', '??='}
def is_name_only(k):  # a property's name, an object's key, a label
    p, q = nxt(k, -1), nxt(k)
    if p is not None and T[p][1] in ('.', '?.'): return True
    if p is not None and T[p] in (('id', 'break'), ('id', 'continue')): return True
    if q is not None and T[q][1] == ':' and p is not None and T[p][1] in ('{', ',', ';', '}', ')'):
        return True
    return False
def end_of_expression(a):  # the last significant token of the AssignmentExpression that begins at a
    k = a; tern = 0; prev = None
    while True:
        t = T[k]
        if t[0] == 'punct' and t[1] in '([{': prev = match[k]; k = nxt(prev); continue
        if t[0] == 'punct' and (t[1] in (',', ';', ')', ']', '}')): return prev
        if t[0] == 'punct' and t[1] == '?': tern += 1
        if t[0] == 'punct' and t[1] == ':':
            if tern == 0: return prev
            tern -= 1
        prev = k; k = nxt(k)
rep, pre, post = {}, {}, {}
def add(d, k, s, front=False): d[k] = (s + d.get(k, '')) if front else (d.get(k, '') + s)
report = []; wrong = 0; functions = bases_n = variants_n = 0; captured = []; counter = 0; where = {}
for f in F:
    own = [k for k in S if f['p0'] <= k <= f['b1'] and owner.get(k) is f]
    B = {}
    for k in own:
        if T[k][0] == 'id':
            b, v = split(T[k][1])
            if v != 'plain': B.setdefault(b, set()).add(v)
    if not B: continue
    functions += 1
    ADDED = set()
    for k in own:
        if T[k] == ('id', '$$added'):
            x = nxt(k)
            for y in range(x, match[x]):
                if T[y][0] == 'str': ADDED.add(T[y][1][1:-1])
    for b, V in sorted(B.items()):
        bases_n += 1; variants_n += len(V)
        mine = [k for k in own if T[k][0] == 'id' and split(T[k][1])[0] == b and not (split(T[k][1])[1] == 'plain' and is_name_only(k))]
        params = [k for k in mine if f['p0'] < k < f['p1']]
        declared = bool(params) or any(T[k][1] == b and (lambda p: p is not None and (T[p] == ('id', 'var') or (T[p][1] == ',' and True)))(nxt(k, -1)) and any(T[x] == ('id', 'var') for x in own if x < k) for k in mine)
        plain_var = any(T[k][1] == b and in_var for k, in_var in [(k, False) for k in mine])
        # is plain b declared by a `var` of this function? walk the var statements
        decl = set()
        for k in own:
            if T[k] == ('id', 'var'):
                a = nxt(k)
                while True:
                    if T[a][0] == 'id': decl.add(a)
                    q = nxt(a)
                    if T[q][1] == '=': e = end_of_expression(nxt(q)); q = nxt(e)
                    if T[q][1] == ',': a = nxt(q); continue
                    break
        local = bool(params) or any(T[k][1] not in ADDED for k in decl if k in mine)
        if not local:
            report.append('NOT LOCAL: %s (printed line %d): `%s` has roles %s, and the bundle declares no `%s` in this function: a role of an outer variable makes it local' % (f['name'], f['line'], b, ' '.join(sorted(V)), b)); wrong += 1; continue
        inner = [k for k in S if f['b0'] < k < f['b1'] and owner.get(k) is not f and T[k][0] == 'id' and split(T[k][1])[0] == b and (split(T[k][1])[1] != 'plain')]
        inner_plain = [k for k in S if f['b0'] < k < f['b1'] and owner.get(k) is not f and T[k] == ('id', b) and not is_name_only(k)]
        def shadows(k):  # a nested function that declares the base itself
            g = owner.get(k)
            while g is not None and g is not f:
                if any(T[x][0] == 'id' and split(T[x][1])[0] == b for x in S if g['p0'] < x < g['p1']): return True
                g = next((h for h in sorted(F, key=lambda h: h['b1'] - h['p0']) if h['p0'] < g['p0'] and g['b1'] < h['b1']), None)
            return False
        cap = [k for k in inner + inner_plain if not shadows(k)]
        if cap: captured.append('%s (printed line %d): `%s`: a nested function reads or stores it at printed lines %s' % (f['name'], f['line'], b, ' '.join(sorted({str(line_of[k]) for k in cap}))))
        X = b + '$V'; init = 'var %s; ' % X
        for k in params:
            rep[k] = b + '$P'; init += '%s = $tag("%s", %s$P); ' % (X, split(T[k][1])[1], b)
        add(post, f['b0'], ' ' + init)
        for k in mine:
            if k in params: continue
            v = split(T[k][1])[1]; p, q = nxt(k, -1), nxt(k); where[k] = (f['name'], b, v)
            if k in decl:
                counter += 1
                if T[q][1] == '=':
                    e = end_of_expression(nxt(q)); sig = [x for x in S if nxt(q) <= x <= e]
                    rep[k] = '%s$D%d = $v(%s' % (b, counter, X)
                    if len(sig) == 1 and T[sig[0]][0] == 'id' and split(T[sig[0]][1])[0] == b and sig[0] in mine: add(pre, nxt(q), '$both("%s", "%s", ' % (v, split(T[sig[0]][1])[1]), True)
                    else: add(pre, nxt(q), '$tag("%s", ' % v, True)
                    add(post, e, '))')
                elif T[q] in (('id', 'in'), ('id', 'of')):
                    rep[p] = ''; rep[k] = X; rep[q] = 'of'; close = match[nxt(p, -1)]; add(pre, nxt(q), '$keys("%s", ' % v, True); add(post, nxt(close, -1), ')')
                else: rep[k] = '%s$D%d' % (b, counter)
                continue
            if T[q][0] == 'punct' and T[q][1] in ASSIGN:
                e = end_of_expression(nxt(q)); sig = [x for x in S if nxt(q) <= x <= e]; rep[k] = '$v(' + X  # the store's own value is `any`: a tag is an object, always truthy, and `a || (x = ..)` would make the false arm unreachable: THE SABOTAGE s7 SHOWED IT
                if T[q][1] == '=':
                    if len(sig) == 1 and T[sig[0]][0] == 'id' and split(T[sig[0]][1])[0] == b and sig[0] in mine: add(pre, nxt(q), '$both("%s", "%s", ' % (v, split(T[sig[0]][1])[1]), True)
                    else: add(pre, nxt(q), '$tag("%s", ' % v, True)
                    add(post, e, '))')
                else:
                    rep[q] = '='; add(pre, nxt(q), '$tag("%s", ($is("%s", %s), ' % (v, v, X), True); add(post, e, ')))')
                continue
            if T[q][1] in ('++', '--') : rep[k] = '$v(%s = $tag("%s", $is("%s", %s)))' % (X, v, v, X); rep[q] = ''; continue
            if p is not None and T[p][1] in ('++', '--'): rep[k] = '$v(%s = $tag("%s", $is("%s", %s)))' % (X, v, v, X); rep[p] = ''; continue
            if T[q] == ('id', 'in') and p is not None and T[p][1] == '(' and T[nxt(p, -1)] == ('id', 'for'):
                rep[k] = X; rep[q] = 'of'; close = match[p]; add(pre, nxt(q), '$keys("%s", ' % v, True); add(post, nxt(close, -1), ')'); continue
            if inside.get(k) is not None and T[inside[k]][1] == '{' and T[p][1] in ('{', ',') and T[q][1] in (',', '}'):  # Bun's printer writes `{ x: x }` as `{ x }`
                rep[k] = '%s: $is("%s", %s)' % (T[k][1], v, X); continue
            rep[k] = '$is("%s", %s)' % (v, X)
body = ''.join(pre.get(k, '') + rep.get(k, t[1]) + post.get(k, '') for k, t in enumerate(T))
body = re.sub(r'\$(tag|is|keys)\("(\w+)", ', lambda m: '$%s$%s(' % (m.group(1), m.group(2)), body); body = re.sub(r'\$both\("(\w+)", "(\w+)", ', lambda m: '$both$%s$%s(' % (m.group(1), m.group(2)), body)
tags = sorted(set(re.findall(r'\$(?:tag|is|keys)\$(\w+)\(', body))); pairs = sorted(set(re.findall(r'\$both\$(\w+?)\$(\w+)\(', body)))
out = ['declare function $$added(...names: string[]): void; declare function $v(x: any): any;\n' + ''.join('declare function $tag$%s(v?: any): { %s: 1 }; declare function $is$%s(v: { %s: 1 } | undefined): any; declare function $keys$%s(v?: any): { %s: 1 }[];\n' % ((x,) * 6) for x in tags) + ''.join('declare function $both$%s$%s(v?: any): { %s: 1; %s: 1 };\n' % (x, y, x, y) for x, y in pairs)]
HEAD = out[0].count('\n')
out.append(body)
check = ''.join(out); open(W + '/check.ts', 'w').write(check)
env = dict(os.environ, NO_COLOR='1')
r = subprocess.run([SEMA, 'cli', 'check.ts', '--noEmit', '--all', '--strict'], cwd=W, env=env, capture_output=True, text=True); t = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr); open(W + '/check.out', 'w').write(t)
if not re.search(r'Found [\d,]+ error|No type errors', t): sys.exit('splits1: NO VERDICT: the checker said neither')
if re.search(r'error: TS1\d\d\d:', t): report.append('THE CHECKING TEXT DOES NOT PARSE: ' + ' '.join(sorted(set(re.findall(r'error: (TS1\d\d\d):', t)))) + ': NO VERDICT'); wrong += 1
L = check.split('\n'); fn_at = sorted((f['line'] + HEAD, f['name']) for f in F)
def fn_of(line):
    best = '?'
    for a, nm in fn_at:
        if a <= line: best = nm
        else: break
    return best
seen = set()
for m in re.finditer(r"^error: (TS\d+): (.*?)\n\s+at check\.ts:(\d+):(\d+)", t, re.S | re.M):
    code, msg, line, col = m.group(1), ' '.join(m.group(2).split()), int(m.group(3)), int(m.group(4)); s = L[line - 1]
    if code == 'TS7034' and re.search(r"'[\w$]+\$V'", msg): captured.append('the checker itself gave up on %s (printed line %d)' % (re.search(r"'([\w$]+)\$V'", msg).group(1), line - HEAD)); continue
    if '$is$' in s and re.search(r"(required in type|parameter of type) '\{ \w+: 1; \}", msg):  # TS2345 | TS2741 | TS2739 ..: whatever the code, the message names a tag's type
        g = next((x for x in re.finditer(r'\$is\$(\w+)\(([\w$]+)\$V\)', s) if x.start() <= col - 1 <= x.end()), None) or re.search(r'\$is\$(\w+)\(([\w$]+)\$V\)', s)
        key = (line, col)
        if key in seen: continue
        seen.add(key); wrong += 1
        report.append('WRONG: in or behind %s (printed line %d): a read of `%s` as %s: %s' % (fn_of(line), line - HEAD, g.group(2) if g else '?', g.group(1) if g else '?', msg[:150]))
print('splits1: %d functions have variants: %d bases, %d variants' % (functions, bases_n, variants_n))
for x in report: print('  ' + x)
for x in captured: print('  CAPTURED (not verified: read it by hand): ' + x)
print('splits1: %s: %d wrong or not local, %d captured' % ('EVERY SPLIT IS THE BUNDLE\'s OWN PROGRAM' if not wrong else 'NOT SO', wrong, len(captured)))
sys.exit(1 if wrong else 0)
