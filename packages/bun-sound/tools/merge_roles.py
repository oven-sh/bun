#!/usr/bin/env python3
"""merge_roles.py <typed.cts of format 1> <out.ts> <out.table.json> [<shapes.d.ts> ..]
Takes a typed text in which variables were split into roles (`x$asRole`, `x$given`, declared between /*$*/ markers) and gives the variables their one name back:
  - the marked declarations of role variables go;
  - the one variable is declared with the union of the types of its roles, at every declaration of it in that function;
  - every `x$asRole` and `x$given` is written `x`.
What is left is npm's code with types added and nothing else. The checker's narrowing by assignment gives most reads the type of their role;
where it does not, fix_reads.py adds a cast at that read: the table says which role each occurrence had.
The shapes are appended as they are (they must be `declare namespace`s and `declare`d globals)."""
import json, re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tstokens import tokenize, code_indices, functions, match_close, skip_type

src, out, table_path, extra_path = sys.argv[1:5]
shape_files = sys.argv[5:]
NS = os.environ.get('NS', 'RR')   # the namespace of the shapes
extra = json.load(open(extra_path)) if os.path.exists(extra_path) else {}   # "function/variable": [types that belong to the union and that no role names]
text = open(src).read()
text = re.sub(r'^\s*///\s*<reference[^\n]*\n', '', text, flags=re.M)

T = tokenize(text)
C = code_indices(T)
pos_in_C = {k: p for p, k in enumerate(C)}
F = functions(T, C)


def innermost(p):
    best = None
    for f in F:
        if f.body_open < p < f.body_close and (best is None or f.body_open > best.body_open): best = f
    return best


def source(p, q):
    """the text of the code tokens p..q-1 (positions in C), with what stands between them"""
    return text[T[C[p]][2]:T[C[q - 1]][2] + len(T[C[q - 1]][1])]


def split_union(t):
    parts = []; depth = 0; cur = ''
    i = 0
    while i < len(t):
        c = t[i]
        if t.startswith('=>', i): cur += '=>'; i += 2; continue
        if c in '<([{': depth += 1
        elif c in '>)]}': depth -= 1
        if c == '|' and depth == 0: parts.append(cur.strip()); cur = ''
        else: cur += c
        i += 1
    parts.append(cur.strip())
    return [p for p in parts if p]


def is_function_type(t):
    depth = 0
    i = 0
    while i < len(t):
        if t.startswith('=>', i):
            if depth == 0: return True
            i += 2; continue
        if t[i] in '<([{': depth += 1
        elif t[i] in '>)]}': depth -= 1
        i += 1
    return False


def union(types):
    members = []
    for t in types:
        # `=>` outside every bracket: the whole text is one function type, whatever `|` stands in its result
        for m in (['(' + t + ')'] if is_function_type(t) else split_union(t)):
            if m not in members: members.append(m)
    tail = [m for m in members if m in ('null', 'undefined')]
    return ' | '.join([m for m in members if m not in tail] + tail)


# ---- the marked regions
markers = [k for k, t in enumerate(T) if t[0] == 'comment' and t[1] == '/*$*/']
assert len(markers) % 2 == 0, 'the markers do not go in pairs'
delete = []          # (start offset, end offset) of text to remove
roles = {}           # (function index, base) -> {variant name: type text}
aliases = set()      # (function index, variant): declared with `= base`: no store narrows it
given = {}           # (function index, base): the parameter was written base$given
findex = {id(f): n for n, f in enumerate(F)}
for a, b in zip(markers[::2], markers[1::2]):
    inner = [k for k in range(a + 1, b) if T[k][0] not in ('ws', 'comment')]
    start, end = T[a][2], T[b][2] + 5
    if not inner or T[inner[0]][1] != 'var':
        delete.append((T[a][2], T[a][2] + 5)); delete.append((T[b][2], T[b][2] + 5))   # the markers alone
        continue
    p = pos_in_C[inner[0]]; last = pos_in_C[inner[-1]]
    f = innermost(p)
    assert f is not None, 'a marked declaration outside every function'
    n = findex[id(f)]
    q = p
    plain = []
    while q <= last:
        if T[C[q]][1] == 'var':   # `var a$asRole: T, b;`
            q += 1
            while True:
                name = T[C[q]][1]; q += 1
                ty = None; init = None
                if T[C[q]][1] == ':':
                    r = skip_type(T, C, q + 1); ty = source(q + 1, r); q = r
                if T[C[q]][1] == '=':
                    init = T[C[q + 1]][1]; q += 2
                if '$as' in name:
                    base = name[:name.index('$as')]
                    roles.setdefault((n, base), {})[name] = ty
                    if init is not None:
                        assert init == base, (name, init)
                        aliases.add((n, name))
                else:
                    plain.append(name)
                if T[C[q]][1] == ',': q += 1; continue
                assert T[C[q]][1] == ';', (name, T[C[q]])
                q += 1
                break
            continue
        x, eq, g, semi = (T[C[q + i]][1] for i in range(4))   # `x = x$given;`
        assert eq == '=' and g == x + '$given' and semi == ';' and x in plain, (x, eq, g)
        given[(n, x)] = True
        q += 4
    # the white space before the region goes with it
    while start > 0 and text[start - 1] == ' ': start -= 1
    delete.append((start, end))

# ---- declarations of the bases
edits = []   # (offset, remove length, insert text)
problems = []
nested_cache = {}


def own_positions(f):
    """positions in C of f's parameter list and body that are not inside a nested function"""
    skip = [(g.keyword, g.body_close) for g in f.children]
    p = f.params_open
    si = 0
    while p <= f.body_close:
        while si < len(skip) and skip[si][1] < p: si += 1
        if si < len(skip) and skip[si][0] <= p <= skip[si][1]:
            p = skip[si][1] + 1; continue
        yield p
        p += 1


marked_spans = [(T[a][2], T[b][2]) for a, b in zip(markers[::2], markers[1::2])]


def in_deleted(offset):
    return any(s <= offset < e for s, e in delete)


declared = {}   # (n, base) -> final union text
untyped = []    # [function, variable, offset of the function's closing brace]: probe_types.py asks the checker for their types
for_in = set()
own_type = {}
bases = set(roles) | set(given)
for (n, base) in sorted(bases):
    f = F[n]
    variants = roles.get((n, base), {})
    sites = []   # (position of the name in C, position behind the annotation or None, annotation text or None, kind)
    # parameters
    depth = 0
    p = f.params_open + 1
    while p < f.params_close:
        t = T[C[p]]
        if t[1] in ('(', '[', '{', '<'): depth += 1
        elif t[1] in (')', ']', '}', '>'): depth -= 1
        prev = T[C[p - 1]][1]
        if depth == 0 and t[0] == 'id' and prev in ('(', ',', '...') and t[1] in (base, base + '$given'):
            q = p + 1
            optional = T[C[q]][1] == '?'
            if optional: q += 1
            if T[C[q]][1] == ':':
                r = skip_type(T, C, q + 1); sites.append((p, q + 1, r, source(q + 1, r), 'param'))
            else:
                sites.append((p, None, None, None, 'param'))
        p += 1
    # var declarators
    own = list(own_positions(f))
    ownset = set(own)
    for p in own:
        if p <= f.body_open: continue
        t = T[C[p]]
        if t[0] == 'id' and t[1] == 'var' and not in_deleted(t[2]):
            q = p + 1
            while True:
                name = T[C[q]][1]
                name_at = q
                q += 1
                ann = None
                if T[C[q]][1] == ':':
                    r = skip_type(T, C, q + 1); ann = (q + 1, r, source(q + 1, r)); q = r
                if name == base and T[C[q]][1] in ('in', 'of'):
                    problems.append('%s in %s is the variable of a for-in: it cannot have a written type' % (base, f.name)); for_in.add((n, base))
                elif name == base:
                    sites.append((name_at, ann[0] if ann else None, ann[1] if ann else None, ann[2] if ann else None, 'var'))
                # skip the initializer
                d = 0
                while True:
                    u = T[C[q]]
                    if u[0] == 'punct':
                        if u[1] in ('(', '[', '{'): q = match_close(T, C, q)
                        elif u[1] in (',', ';'): break
                        elif u[1] == ')': break      # for (var x in y)
                    elif u[0] == 'id' and u[1] in ('in', 'of') and T[C[q - 1]][1] == name: break
                    q += 1
                if T[C[q]][1] == ',': q += 1; continue
                break
    if not sites:
        if (n, base) not in for_in: problems.append('no declaration of %s in %s' % (base, f.name))
        continue
    own_types = [s[3] for s in sites if s[3]]
    more = extra.get('%s/%s' % (f.name, base), [])
    if not own_types and more: own_types = [more[0]]   # a parameter typed by its context: the first entry is its own type
    if not own_types:
        problems.append('%s in %s has no written type of its own (roles: %s)' % (base, f.name, ', '.join(variants)))
        untyped.append([f.name, base, T[C[f.body_close]][2]])
    u = union(own_types + [t for t in variants.values() if t] + more)
    declared[(n, base)] = u
    own_type[(n, base)] = union(own_types) if own_types else None
    for name_at, a, b, ann, kind in sites:
        if a is not None:
            s = T[C[a]][2]; e = T[C[b - 1]][2] + len(T[C[b - 1]][1])
            edits.append((s, e - s, u))
        else:
            s = T[C[name_at]][2] + len(T[C[name_at]][1])
            edits.append((s, 0, ': ' + u))

# ---- the names
occurrences = []   # (old offset, base, role type, variant)
for n, f in enumerate(F):
    mine = {b for (m, b) in bases if m == n}
    if not mine: continue
    for p in own_positions(f):
        t = T[C[p]]
        if t[0] != 'id' or in_deleted(t[2]): continue
        if p and T[C[p - 1]][1] in ('.', '?.'): continue
        name = t[1]
        base = name.split('$as')[0].split('$given')[0]
        if base not in mine: continue
        if T[C[p + 1]][1] == ':' and T[C[p - 1]][1] in ('{', ',') and name == base:
            # a property name of an object literal, or a parameter: parameters are told apart by their place
            if not (f.params_open < p < f.params_close): continue
        variants = roles.get((n, base), {})
        if name != base:
            edits.append((t[2], len(name), base))
        role_type = variants.get(name) if name != base and not name.endswith('$given') else own_type.get((n, base))
        if (n, base) in for_in: role_type = None
        occurrences.append([t[2], base, role_type, name, (n, name) in aliases, f.name])
# a nested function that names a variant
for n, f in enumerate(F):
    g = f.parent
    while g is not None:
        m = findex[id(g)]
        mine = {b for (k, b) in bases if k == m}
        if mine:
            for p in own_positions(f):
                t = T[C[p]]
                if t[0] == 'id' and ('$as' in t[1] or '$given' in t[1]) and t[1].split('$as')[0].split('$given')[0] in mine and (n, t[1].split('$as')[0].split('$given')[0]) not in bases:
                    if T[C[p - 1]][1] in ('.', '?.'): continue
                    base = t[1].split('$as')[0].split('$given')[0]
                    edits.append((t[2], len(t[1]), base))
                    occurrences.append([t[2], base, roles.get((m, base), {}).get(t[1]), t[1], True, f.name])
                    problems.append('CAPTURED: %s in %s (declared in %s)' % (t[1], f.name, g.name))
        g = g.parent

# a name inside a type that is written anew (the parameter of a function type) is no occurrence of the variable
rewritten = sorted((s, s + l) for s, l, ins in edits if l and ' ' in text[s:s + l] or l and '(' in text[s:s + l])
occurrences = [oc for oc in occurrences if not any(s <= oc[0] < e for s, e in rewritten)]
edits = [ed for ed in edits if not any(s < ed[0] < e for s, e in rewritten)]

# ---- write
for s, e in delete: edits.append((s, e - s, ''))
edits.sort()
outp = []; at = 0; shift = {}
new_offsets = {}
acc = 0
for s, l, ins in edits:
    assert s >= at, ('edits overlap', s, at, ins, text[s - 40:s + 40])
    outp.append(text[at:s]); acc += s - at
    new_offsets[s] = acc
    outp.append(ins); acc += len(ins)
    at = s + l
outp.append(text[at:])
new = ''.join(outp)
left = re.findall(r'[\w$]+\$(?:as[A-Z]\w*|given)\b', new)
if left: problems.append('left over: ' + ', '.join(sorted(set(left))[:20]))


def map_offset(o):
    # offset in the old text -> offset in the new one
    import bisect
    k = bisect.bisect_right(starts, o) - 1
    if k < 0: return o
    s, l, ins = edits[k]
    if o == s: return new_offsets[s]
    return new_offsets[s] + len(ins) + (o - (s + l))


starts = [e[0] for e in edits]
original_offsets = [oc[0] for oc in occurrences]
for oc in occurrences: oc[0] = map_offset(oc[0])
def without_comments(s):
    # what is published carries no working notes
    out = []; i = 0; n = len(s)
    while i < n:
        c = s[i]
        if c in '"\'`':
            j = i + 1
            while j < n and s[j] != c: j += 2 if s[j] == '\\' else 1
            out.append(s[i:j + 1]); i = j + 1
        elif s.startswith('//', i): i = s.find('\n', i) if s.find('\n', i) >= 0 else n
        elif s.startswith('/*', i): i = s.index('*/', i) + 2
        else: out.append(c); i += 1
    return '\n'.join(l.rstrip() for l in ''.join(out).split('\n') if l.strip()) + '\n'


shapes = ''
for sf in shape_files:
    shapes += without_comments(open(sf).read())
# a variable whose union holds `any` IS any: nothing narrows it and no read of it is an error: the reads of its other roles are cast from the start
alias = {m.group(1): m.group(2) for m in re.finditer(r'^\s*(?:export )?type (\w+) = ([^;]*);', shapes, flags=re.M)}


def is_any(t, seen=()):
    if is_function_type(t): return False
    for m in split_union(t):
        m = m.strip()
        if m == 'any': return True
        m = m[len(NS) + 1:] if m.startswith(NS + '.') else m
        if m in alias and m not in seen and is_any(alias[m], seen + (m,)): return True
    return False


by_name = {}
for (n, b), u in declared.items(): by_name[(F[n].name, b)] = u
for oc in occurrences:
    u = by_name.get((oc[5], oc[1]))
    oc[4] = bool(oc[4] or (u and is_any(u))) and bool(oc[2]) and not is_any(oc[2])
open(out, 'w').write(new.rstrip('\n') + '\n' + shapes)
# A parameter written x$given went on as an untyped variable x, which the checker typed read by read. Which reads of x still hold what was given?
# given_roles.json (probe_given.py writes it, from the text with the roles) answers by the number of the occurrence; without an answer such a read has no role.
given_names = {(F[n].name, b) for (n, b) in given}
answers_path = os.path.join(os.path.dirname(table_path), 'given_roles.json')
answers = json.load(open(answers_path)) if os.path.exists(answers_path) else {}
candidates = []
for k, oc in enumerate(occurrences):
    if (oc[5], oc[1]) in given_names and oc[3] == oc[1]:
        candidates.append([k, original_offsets[k], oc[1], oc[2], oc[5]])
        answer = answers.get(str(k))
        if isinstance(answer, str): oc[2] = None if answer == 'any' else answer; oc[4] = bool(oc[2]) and bool(by_name.get((oc[5], oc[1]))) and is_any(by_name[(oc[5], oc[1])])
        elif not answer: oc[2] = None; oc[4] = False
open(os.path.join(os.path.dirname(table_path), 'with_roles.ts'), 'w').write(text.rstrip('\n') + '\n' + shapes)
json.dump(candidates, open(os.path.join(os.path.dirname(table_path), 'given_candidates.json'), 'w'))
json.dump(untyped, open(os.path.join(os.path.dirname(table_path), 'untyped.json'), 'w'))
json.dump({'occurrences': occurrences, 'declared': {'%s/%s' % (F[n].name, b): u for (n, b), u in declared.items()}}, open(table_path, 'w'), indent=0)
print('functions with roles: %d · variables: %d · role variables: %d · occurrences: %d' % (len({n for n, _ in bases}), len(bases), sum(len(v) for v in roles.values()), len(occurrences)))
for p in problems: print('  ' + p)
