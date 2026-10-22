"""tstokens.py: a tokenizer for the typed texts of bun-sound (ES5 bundles with TypeScript annotations), and the functions of a text.
Tokens are (kind, text, start). Kinds: ws, comment, str, regex, id, num, punct. No arrows or classes are expected in CODE; arrows in types are fine."""
import re

KEY_BEFORE_REGEX = {'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else'}
PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--',
         '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**']
ID = re.compile(r'[A-Za-z_$][\w$]*')
NUM = re.compile(r'(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)n?')


def tokenize(js):
    T = []
    i = 0
    n = len(js)
    last = None
    while i < n:
        c = js[i]
        if c.isspace():
            j = i
            while j < n and js[j].isspace():
                j += 1
            T.append(('ws', js[i:j], i)); i = j; continue
        if js.startswith('//', i):
            j = js.find('\n', i); j = n if j < 0 else j
            T.append(('comment', js[i:j], i)); i = j; continue
        if js.startswith('/*', i):
            j = js.find('*/', i) + 2
            T.append(('comment', js[i:j], i)); i = j; continue
        if c in '"\'':
            j = i + 1
            while js[j] != c:
                j += 2 if js[j] == '\\' else 1
            T.append(('str', js[i:j + 1], i)); last = T[-1]; i = j + 1; continue
        if c == '`':
            j = i + 1; depth = 0
            while True:
                if js[j] == '\\': j += 2; continue
                if depth == 0 and js[j] == '`': break
                if js.startswith('${', j): depth += 1; j += 2; continue
                if depth and js[j] == '{': depth += 1
                if depth and js[j] == '}': depth -= 1
                j += 1
            T.append(('str', js[i:j + 1], i)); last = T[-1]; i = j + 1; continue
        if c == '/' and (last is None or (last[0] == 'punct' and last[1] not in (')', ']', '}')) or (last[0] == 'id' and last[1] in KEY_BEFORE_REGEX)):
            j = i + 1; cls = False
            while True:
                if js[j] == '\\': j += 2; continue
                if js[j] == '[': cls = True
                elif js[j] == ']': cls = False
                elif js[j] == '/' and not cls: break
                j += 1
            j += 1
            while j < n and js[j].isalnum(): j += 1
            T.append(('regex', js[i:j], i)); last = T[-1]; i = j; continue
        m = ID.match(js, i)
        if m:
            T.append(('id', m.group(0), i)); last = T[-1]; i = m.end(); continue
        m = NUM.match(js, i)
        if m and m.group(0):
            T.append(('num', m.group(0), i)); last = T[-1]; i = m.end(); continue
        for p in PUNCT:
            if js.startswith(p, i):
                T.append(('punct', p, i)); break
        else:
            T.append(('punct', c, i))
        last = T[-1]; i += len(T[-1][1])
    return T


def code_indices(T):
    """indices of the tokens that are neither white space nor comments"""
    return [k for k, t in enumerate(T) if t[0] not in ('ws', 'comment')]


OPEN = {'(': ')', '[': ']', '{': '}'}


def match_close(T, C, p):
    """C: code indices; p: position in C of an opening bracket. Returns the position in C of its partner."""
    depth = 0
    opener = T[C[p]][1]
    closer = OPEN[opener]
    q = p
    while True:
        t = T[C[q]]
        if t[0] == 'punct':
            if t[1] == opener: depth += 1
            elif t[1] == closer:
                depth -= 1
                if depth == 0: return q
        q += 1


def skip_angle(T, C, p):
    """p at '<' of a type-argument or type-parameter list; returns the position behind its '>'. '>>' and '>>>' close two and three."""
    depth = 0
    q = p
    while True:
        t = T[C[q]]
        if t[0] == 'punct':
            if t[1] == '<': depth += 1
            elif t[1] == '>': depth -= 1
            elif t[1] == '>>': depth -= 2
            elif t[1] == '>>>': depth -= 3
            elif t[1] in OPEN:
                q = match_close(T, C, q)
            if depth <= 0 and t[1] in ('>', '>>', '>>>'): return q + 1
        q += 1


def skip_type(T, C, p):
    """p at the first token of a type; returns the position behind the type."""
    q = p
    while True:
        t = T[C[q]]
        # prefix operators
        while t[0] == 'id' and t[1] in ('keyof', 'typeof', 'readonly', 'unique', 'infer', 'asserts', 'new', 'abstract') or (t[0] == 'punct' and t[1] in ('|', '&')):
            q += 1; t = T[C[q]]
        if t[0] == 'punct' and t[1] == '<':  # a generic function type
            q = skip_angle(T, C, q); t = T[C[q]]
        if t[0] == 'punct' and t[1] == '(':
            r = match_close(T, C, q) + 1
            if T[C[r]][1] == '=>':
                q = skip_type(T, C, r + 1)
                return q  # a function type takes all that follows
            q = r
        elif t[0] == 'punct' and t[1] in ('{', '['):
            q = match_close(T, C, q) + 1
        elif t[0] in ('id', 'str', 'num'):
            q += 1
            if t[1] == 'import' and T[C[q]][1] == '(':
                q = match_close(T, C, q) + 1
        elif t[0] == 'punct' and t[1] == '-' and T[C[q + 1]][0] == 'num':
            q += 2
        else:
            raise SyntaxError('type expected at offset %d: %r' % (t[2], t[1]))
        # postfix
        while True:
            t = T[C[q]]
            if t[0] == 'punct' and t[1] == '.' and T[C[q + 1]][0] == 'id': q += 2
            elif t[0] == 'punct' and t[1] == '<': q = skip_angle(T, C, q)
            elif t[0] == 'punct' and t[1] == '[': q = match_close(T, C, q) + 1
            else: break
        t = T[C[q]]
        if t[0] == 'punct' and t[1] in ('|', '&'):
            q += 1; continue
        if t[0] == 'id' and t[1] in ('is', 'extends') :
            q += 1; continue
        if t[0] == 'punct' and t[1] == '?' and False:
            pass
        return q


class Function:
    __slots__ = ('keyword', 'name', 'params_open', 'params_close', 'body_open', 'body_close', 'parent', 'children')

    def __repr__(self):
        return 'Function(%s)' % self.name


def functions(T, C):
    """Every `function` with a body, positions in C. Signatures without a body are passed over."""
    out = []
    for p, k in enumerate(C):
        t = T[k]
        if t[0] != 'id' or t[1] != 'function': continue
        if p and T[C[p - 1]][1] == '.': continue
        q = p + 1
        if T[C[q]][1] == '*': q += 1
        name = None
        if T[C[q]][0] == 'id':
            name = T[C[q]][1]; q += 1
        if T[C[q]][1] == '<': q = skip_angle(T, C, q)
        if T[C[q]][1] != '(': continue  # `function` as a word of a type or a member
        if name is None and p >= 2 and T[C[p - 1]][1] in (':', '=') and T[C[p - 2]][0] == 'id':
            name = T[C[p - 2]][1]   # `name: function (` and `x.name = function (`
        f = Function(); f.keyword = p; f.name = name; f.params_open = q; f.params_close = match_close(T, C, q)
        q = f.params_close + 1
        if T[C[q]][1] == ':':
            q = skip_type(T, C, q + 1)
        if T[C[q]][1] != '{': continue  # an overload signature
        f.body_open = q; f.body_close = match_close(T, C, q); f.parent = None; f.children = []
        out.append(f)
    seen = {}
    for f in out:   # a name is a key: the second function of a name is name#2
        seen[f.name] = seen.get(f.name, 0) + 1
        if seen[f.name] > 1: f.name = '%s#%d' % (f.name, seen[f.name])
    stack = []
    for f in out:
        while stack and stack[-1].body_close < f.keyword: stack.pop()
        if stack:
            f.parent = stack[-1]; stack[-1].children.append(f)
        stack.append(f)
    return out
