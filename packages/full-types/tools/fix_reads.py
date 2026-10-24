#!/usr/bin/env python3
"""fix_reads.py <bun> <work folder with tsconfig.json> <file name in it> <table.json> [rounds]
Runs the checker on the merged text and, where a read of a variable that has several roles is not narrowed to its role by the checker's own flow analysis,
adds `!` (the error is about null or undefined alone) or a cast to the type of the role that this occurrence had. Nothing but types is added.
Writes the text back, and the table with the new offsets and what was done to each occurrence. Prints what is left."""
import json, re, subprocess, sys, bisect, collections
bun, work, name, table_path = sys.argv[1:5]
rounds = int(sys.argv[5]) if len(sys.argv) > 5 else 12
import os
NS = os.environ.get('NS', 'RR')
path = work + '/' + name
text = open(path).read()
table = json.load(open(table_path))
occ = [dict(at=o[0], base=o[1], role=o[2], variant=o[3], alias=o[4], fn=o[5], state=o[6] if len(o) > 6 else '', cast_len=o[7] if len(o) > 7 else 0) for o in table['occurrences']]
occ.sort(key=lambda o: o['at'])
for o in occ:
    if o['state'].startswith('cast'): o['end'] = o['at'] + len(o['base']) + o['cast_len']
NULLISH = {'TS18047', 'TS18048', 'TS18049', 'TS2531', 'TS2532', 'TS2533', 'TS2721', 'TS2722', 'TS2723'}
NAMED = {'TS18047', 'TS18048', 'TS18049'}   # the message names the variable itself
FALLBACK = {'TS2322', 'TS2345', 'TS2740', 'TS2739', 'TS2741', 'TS2769', 'TS2349', 'TS7053', 'TS2538', 'TS2678', 'TS2367', 'TS2559', 'TS2721', 'TS2723', 'TS2722', 'TS18046', 'TS2362', 'TS2363', 'TS2365', 'TS2356', 'TS2531', 'TS2532', 'TS2533', 'TS2339'}


def check():
    r = subprocess.run([bun, 'check', '--all', '--no-pretty'], cwd=work, capture_output=True, text=True)
    errors = []
    for line in (r.stdout + r.stderr).split('\n'):
        m = re.match(re.escape(name) + r'\((\d+),(\d+)\): error (TS\d+): (.*)', line)
        if m: errors.append((int(m.group(1)), int(m.group(2)), m.group(3), m.group(4)))
    return errors


def line_starts(t):
    s = [0]
    for m in re.finditer('\n', t): s.append(m.end())
    return s


def without_null(t):
    parts = [p.strip() for p in split_union(t)]
    kept = [p for p in parts if p not in ('null', 'undefined')]
    return ' | '.join(kept) if kept else t


def split_union(t):
    parts = []; depth = 0; cur = ''; i = 0
    while i < len(t):
        c = t[i]
        if t.startswith('=>', i):
            if depth == 0: return [t]
            cur += '=>'; i += 2; continue
        if c in '<([{': depth += 1
        elif c in '>)]}': depth -= 1
        if c == '|' and depth == 0: parts.append(cur); cur = ''
        else: cur += c
        i += 1
    parts.append(cur)
    return parts


def is_write(o):
    """the occurrence is a declaration, or the target of an assignment or of ++ --"""
    e = o['at'] + len(o['base'])
    rest = text[e:e + 40].lstrip()
    before = text[max(0, o['at'] - 12):o['at']].rstrip()
    if re.match(r'(=(?!=)|\+=|-=|\*=|/=|%=|&=|\|=|\^=|<<=|>>=|>>>=|\+\+|--|&&=|\|\|=|\?\?=)', rest): return True
    if before.endswith('++') or before.endswith('--'): return True
    if rest.startswith(':') or rest.startswith('?:'):
        # a declaration `x: T`; `c ? x : y` has a `?` before it on the way: told apart by what stands before the name
        if before.endswith('var') or before.endswith(',') or before.endswith('('): return True
    if before.endswith('var') : return True
    if re.match(r'in\b', rest) and before.endswith('('): return True
    return False


def extent(o):
    """start and end of the occurrence with what was added round it"""
    s, e = o['at'], o['at'] + len(o['base'])
    return s, e


history = []
for rnd in range(rounds):
    errors = check() if rnd else []
    history.append(len(errors))
    if rnd and not errors: break
    L = line_starts(text)
    starts = [o['at'] for o in occ]
    actions = {}   # index of the occurrence -> 'bang' | 'cast'
    unmatched = []
    if not rnd:   # what no error would ever show: see merge_roles.py
        for k, o in enumerate(occ):
            if is_write(o) or not o['alias']: continue
            if o['alias'] == 'bang' and o['state'] == '': actions[k] = 'bang'
            elif o['alias'] != 'bang' and o['state'] in ('', 'bang'): actions[k] = 'cast'
    for (ln, col, code, msg) in errors:
        off = L[ln - 1] + col - 1
        k = None
        # 1. the error is at the occurrence itself, or at the parenthesis of its cast
        j = bisect.bisect_left(starts, off)
        if j < len(occ) and occ[j]['at'] == off: k = j
        elif j < len(occ) and occ[j]['state'].startswith('cast') and occ[j]['at'] == off + 1 and text[off] == '(': k = j
        # 2. the error is at a property name, an index or a call: the receiver stands before it
        if k is None:
            b = off
            while b > 0 and text[b - 1] in ' \n\t': b -= 1
            if text[b - 1:b] == '.' or text[b - 2:b] == '?.':
                b -= 1
                if text[b - 1:b] == '?': b -= 1
                while b > 0 and text[b - 1] in ' \n\t': b -= 1
                had_bang = text[b - 1:b] == '!'
                if had_bang: b -= 1
                if text[b - 1:b] == ')':
                    # the cast of an occurrence: find the occurrence whose cast ends here
                    for j in range(bisect.bisect_left(starts, b) - 1, max(-1, bisect.bisect_left(starts, b) - 4), -1):
                        if occ[j]['state'].startswith('cast') and occ[j].get('end') == b: k = j; break
                else:
                    j = bisect.bisect_left(starts, b) - 1
                    if j >= 0 and occ[j]['at'] + len(occ[j]['base']) == b: k = j
        # 3. an assignment, an initializer, a return, an argument that is a longer expression: a read behind the error, in the same statement
        if k is not None and is_write(occ[k]): k = None; off += 1
        if k is None and code in FALLBACK:
            stop = len(text)
            m = re.compile(r'[;{}]').search(text, off)
            if m: stop = m.start()
            j = bisect.bisect_left(starts, off)
            later = None
            while j < len(occ) and occ[j]['at'] < stop:
                if not is_write(occ[j]) and occ[j]['role']:
                    if occ[j]['state'] in ('', 'bang'): k = j; break
                    if later is None: later = j
                j += 1
            if k is None: k = later
        if k is None or is_write(occ[k]) or not occ[k]['role']:
            unmatched.append((ln, col, code, msg)); continue
        o = occ[k]
        nullish = code in NULLISH or (o['state'].startswith('cast') and re.search(r"\| (null|undefined)'", msg))
        role_has_null = without_null(o['role']) != ' | '.join(p.strip() for p in split_union(o['role']))
        if not nullish: want = 'cast'
        elif o['state'] == '' and code in NAMED: want = 'bang'
        elif o['state'] == 'cast' and role_has_null: want = 'bang'
        else: want = 'chain'
        if want == 'cast' and o['state'].startswith('cast'):
            unmatched.append((ln, col, code, msg)); continue
        if actions.get(k) != 'cast': actions[k] = want
    if not actions:
        if rnd: break
        continue
    # apply, from the end
    order = sorted(actions, reverse=True)
    shifts = []   # (offset, delta)
    for k in order:
        o = occ[k]; s = o['at']; e = s + len(o['base'])
        if actions[k] == 'chain':
            # the variable is what its role says; a member read through it may be null, and the cast has taken the narrowing of that member away
            q = o['end'] if o['state'].startswith('cast') else e
            while True:
                if text[q:q + 1] == '!': q += 1
                m = re.compile(r'\s*\.\s*[\w$]+').match(text, q)
                if not m: q = None; break
                q = m.end()
                if text[q:q + 1] != '!': break
            if q is not None and re.match(r'\s*(=(?!=)|\+=|-=|\*=|/=|%=|&=|\|=|\^=|<<=|>>=|>>>=)', text[q:q + 8]): q = None   # the target of an assignment
            if q is not None:
                text = text[:q] + '!' + text[q:]; shifts.append((q, 1))
        elif actions[k] == 'bang':
            if o['state'].startswith('cast'):
                e2 = o['end']
                text = text[:e2] + '!' + text[e2:]; shifts.append((e2, 1)); o['state'] = 'cast+bang'
            else:
                text = text[:e] + '!' + text[e:]; shifts.append((e, 1)); o['state'] = 'bang'
        else:
            had_bang = o['state'] == 'bang'
            role = o['role']
            if had_bang:
                text = text[:e] + text[e + 1:]; shifts.append((e, -1))
                role = without_null(role)
            ins = ' as ' + role + ')'
            text = text[:s] + '(' + text[s:e] + ins + text[e:]
            shifts.append((e, len(ins))); shifts.append((s, 1))
            o['state'] = 'cast'; o['cast_len'] = len(ins)
    shifts.sort()
    offs = [s for s, _ in shifts]
    cum = []; acc = 0
    for _, d in shifts: acc += d; cum.append(acc)
    # new offset of an old offset x: x + the sum of the deltas at offsets <= x (an insertion AT the start of an occurrence moves it)
    for o in occ:
        i = bisect.bisect_right(offs, o['at'])
        o['at'] += cum[i - 1] if i else 0
    for o in occ:
        if o['state'].startswith('cast'):
            o['end'] = o['at'] + len(o['base']) + o['cast_len']
    bad = [o for o in occ if text[o['at']:o['at'] + len(o['base'])] != o['base']]
    assert not bad, bad[:3]
    open(path, 'w').write(text)

errors = check()
history.append(len(errors))
open(path, 'w').write(text)
table['occurrences'] = [[o['at'], o['base'], o['role'], o['variant'], o['alias'], o['fn'], o['state'], o['cast_len']] for o in occ]
json.dump(table, open(table_path, 'w'), indent=0)
# what is stored to a variable and is not in its union: a line for extra.json
names = set(re.findall(r'(?:interface|type) (\w+)', text))
L = line_starts(text); starts = [o['at'] for o in occ]; suggestions = collections.OrderedDict()
for (ln, col, code, msg) in errors:
    off = L[ln - 1] + col - 1
    j = bisect.bisect_left(starts, off)
    m = (re.match(r"Type '(.*)' is not assignable to type '", msg) or re.match(r"Type '(.*)' is missing the following properties from type '", msg)
         or re.match(r"Property '.*' is missing in type '(.*)' but required in type '", msg))
    if code in ('TS2322', 'TS2739', 'TS2740', 'TS2741') and m and j < len(occ) and occ[j]['at'] == off and is_write(occ[j]):
        t = re.sub(r'(?<![\w.$])([A-Za-z_]\w*)\b', lambda g: NS + '.' + g.group(1) if g.group(1) in names else g.group(1), m.group(1))
        suggestions.setdefault('%s/%s' % (occ[j]['fn'], occ[j]['base']), [])
        if t not in suggestions['%s/%s' % (occ[j]['fn'], occ[j]['base'])]: suggestions['%s/%s' % (occ[j]['fn'], occ[j]['base'])].append(t)
print('SUGGESTED ' + json.dumps(suggestions))
c = collections.Counter(o['state'] for o in occ)
print('errors by round:', history)
print('occurrences:', dict(c))
for e in errors[:int(sys.argv[6]) if len(sys.argv) > 6 else 60]: print('%d,%d %s %s' % e)
