#!/usr/bin/env python3
"""probe_reads.py <bun> <work folder> <file name> <table.json> [show]: WHICH READS OF A VARIABLE WITH ROLES DOES THE CHECKER SEE WIDER THAN THEIR ROLE, WITHOUT AN ERROR?
(`update.next` is legal on Update | FiberRoot: both have the member. No error asks for a cast, and the compiler is told a union of two layouts.)
A read that has no cast is written `(x satisfies Role)` in a copy of the text: an error TS1360 there = wider than its role. ONE PROBE A FUNCTION A RUN: a probe takes the
narrowing away from the reads behind it. What is wider is probed again as `(x! satisfies Role without null)`: passes = `!` is enough.
Marks the occurrences in the table ('cast' | 'bang' in the fifth place); the next run of fix_reads.py applies that. Prints how many."""
import json, re, subprocess, sys, bisect, os, collections
from concurrent.futures import ThreadPoolExecutor
bun, work, name, table_path = sys.argv[1:5]
show = len(sys.argv) > 5
text = open(work + '/' + name).read()
table = json.load(open(table_path))
occ = sorted(table['occurrences'], key=lambda o: o[0])
tsconfig = open(work + '/tsconfig.json').read()


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


def without_null(t):
    kept = [p.strip() for p in split_union(t) if p.strip() not in ('null', 'undefined')]
    return ' | '.join(kept) if kept else t


def is_write(at, base):
    e = at + len(base)
    rest = text[e:e + 40].lstrip(); before = text[max(0, at - 12):at].rstrip()
    if re.match(r'(=(?!=)|\+=|-=|\*=|/=|%=|&=|\|=|\^=|<<=|>>=|>>>=|\+\+|--|&&=|\|\|=|\?\?=)', rest): return True
    if before.endswith('++') or before.endswith('--') or before.endswith('var'): return True
    if (rest.startswith(':') or rest.startswith('?:')) and (before.endswith(',') or before.endswith('(')): return True
    if re.match(r'in\b', rest) and before.endswith('('): return True
    return False


def run(tag, picks, bang):
    """picks: indices of occurrences, in order of offset. Returns the set of those whose probe fails, with the message."""
    out = []; at = 0; acc = 0; where = {}
    for k in picks:
        o = occ[k]
        s = o[0]; e = s + len(o[1]) + (1 if o[6] == 'bang' else 0)
        banged = bang or o[6] == 'bang'
        role = without_null(o[2]) if banged else o[2]
        out.append(text[at:s]); acc += s - at
        piece = '(' + o[1] + ('!' if banged else '') + ' satisfies ' + role + ')'
        where[acc] = (k, acc + len(piece))
        out.append(piece); acc += len(piece); at = e
    out.append(text[at:])
    probe = ''.join(out)
    d = '%s/probe/%s' % (work, tag)
    os.makedirs(d, exist_ok=True)
    open(d + '/' + name, 'w').write(probe); open(d + '/tsconfig.json', 'w').write(tsconfig)
    r = subprocess.run([bun, 'check', '--all', '--no-pretty', '--threads=2'], cwd=d, capture_output=True, text=True)
    L = [0] + [m.end() for m in re.finditer('\n', probe)]
    keys = sorted(where); failed = {}
    for line in (r.stdout + r.stderr).split('\n'):
        m = re.match(re.escape(name) + r'\((\d+),(\d+)\): error TS\d+: (.*)', line)
        if not m: continue
        off = L[int(m.group(1)) - 1] + int(m.group(2)) - 1
        i = bisect.bisect_right(keys, off) - 1
        if i >= 0 and off < where[keys[i]][1]: failed[where[keys[i]][0]] = m.group(3)   # whatever the code: a failed `satisfies` is often told as TS2740 or TS2741
    return failed


by_fn = collections.OrderedDict()
for k, o in enumerate(occ):
    if o[6] not in ('', 'bang') or not o[2] or is_write(o[0], o[1]): continue
    if text[max(0, o[0] - 7):o[0]] == 'typeof ': continue
    by_fn.setdefault(o[5], []).append(k)
rounds = max(len(v) for v in by_fn.values())
jobs = [sorted(v[r] for v in by_fn.values() if r < len(v)) for r in range(rounds)]
wide = {}
with ThreadPoolExecutor(32) as pool:
    for f in pool.map(lambda a: run('a%d' % a[0], a[1], False), enumerate(jobs)): wide.update(f)
    again = collections.OrderedDict()
    for k in sorted(wide):
        if occ[k][6] == '': again.setdefault(occ[k][5], []).append(k)
    jobs2 = [sorted(v[r] for v in again.values() if r < len(v)) for r in range(max([len(v) for v in again.values()] or [0]))]
    still = {}
    for f in pool.map(lambda a: run('b%d' % a[0], a[1], True), enumerate(jobs2)): still.update(f)
n = collections.Counter()
for k, msg in sorted(wide.items()):
    want = 'cast' if (k in still or occ[k][6] == 'bang') else 'bang'
    occ[k][4] = want; n[want] += 1
    if show: print(want, occ[k][5], occ[k][3], '|', msg[:150])
table['occurrences'] = occ
json.dump(table, open(table_path, 'w'), indent=0)
subprocess.run(['rm', '-rf', work + '/probe'])
print('probed %d reads in %d runs: wider than their role: %s' % (sum(len(v) for v in by_fn.values()), len(jobs) + len(jobs2), dict(n)))
