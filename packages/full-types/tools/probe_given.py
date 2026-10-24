#!/usr/bin/env python3
"""probe_given.py <bun> <work folder> <with_roles.ts> <given_candidates.json> <given_roles.json>
In the text WITH roles a parameter x$given is copied to an untyped variable x at the head of the function, and the checker types each read of x by the stores that reach it.
For each read of such an x: does it still hold what was given? `(x satisfies Given)`, one probe a function a run. If not: what does it hold? `(x satisfies never)` makes the checker name it.
Writes { number of the occurrence: true | the type it holds there | false (not asked: a store, or nothing reaches it) }."""
import json, re, subprocess, sys, bisect, os, collections
from concurrent.futures import ThreadPoolExecutor
bun, work, text_path, candidates_path, out_path = sys.argv[1:6]
text = open(text_path).read()
C = json.load(open(candidates_path))
tsconfig = json.load(open(work + '/tsconfig.json')); tsconfig['compilerOptions']['noErrorTruncation'] = True; tsconfig = json.dumps(tsconfig)
name = json.loads(tsconfig)['files'][0]   # the probe stands where the project expects the text


def is_write(at, base):
    e = at + len(base)
    rest = text[e:e + 40].lstrip(); before = text[max(0, at - 12):at].rstrip()
    if re.match(r'(=(?!=)|\+=|-=|\*=|/=|%=|&=|\|=|\^=|<<=|>>=|>>>=|\+\+|--|&&=|\|\|=|\?\?=)', rest): return True
    if before.endswith('++') or before.endswith('--') or before.endswith('var'): return True
    if (rest.startswith(':') or rest.startswith('?:')) and (before.endswith(',') or before.endswith('(')): return True
    if rest.startswith(',') and before.endswith('var'): return True
    return False


NS = os.environ.get('NS', 'RR')
names = set(re.findall(r'(?:interface|type|enum|class) (\w+)', text))
named = {}   # number of the occurrence -> the type that the checker names there


def run(tag, picks, impossible=False, never=False):
    out = []; at = 0; acc = 0; where = {}
    for c in picks:
        k, s, base, given, fn = c
        out.append(text[at:s]); acc += s - at
        piece = '(' + base + ' satisfies ' + ('never' if never else '{ readonly $$impossible: 1 }' if impossible else given) + ')'
        where[acc] = (k, acc + len(piece))
        out.append(piece); acc += len(piece); at = s + len(base)
    out.append(text[at:])
    probe = ''.join(out)
    d = '%s/probe/%s' % (work, tag)
    os.makedirs(d, exist_ok=True)
    open(d + '/' + name, 'w').write(probe); open(d + '/tsconfig.json', 'w').write(tsconfig)
    r = subprocess.run([bun, 'check', '--all', '--no-pretty', '--threads=2'], cwd=d, capture_output=True, text=True)
    L = [0] + [m.end() for m in re.finditer('\n', probe)]
    keys = sorted(where); failed = set()
    for line in (r.stdout + r.stderr).split('\n'):
        m = re.match(re.escape(name) + r'\((\d+),(\d+)\): error TS\d+: (.*)', line)
        if not m: continue
        off = L[int(m.group(1)) - 1] + int(m.group(2)) - 1
        i = bisect.bisect_right(keys, off) - 1
        if i >= 0 and off < where[keys[i]][1]:
            failed.add(where[keys[i]][0])
            t = re.match(r"Type '(.*)' does not satisfy the expected type 'never'\.$", m.group(3))
            if never and t: named[where[keys[i]][0]] = re.sub(r'(?<![\w.$"\'])([A-Za-z_]\w*)\b', lambda g: NS + '.' + g.group(1) if g.group(1) in names else g.group(1), t.group(1))
    return failed


by_fn = collections.OrderedDict()
for c in C:
    if c[3] and not is_write(c[1], c[2]) and '/*$*/' not in text[max(0, c[1] - 60):c[1]].split('\n')[-1][-8:]:
        by_fn.setdefault(c[4], []).append(c)
jobs = [sorted((v[r] for v in by_fn.values() if r < len(v)), key=lambda c: c[1]) for r in range(max(len(v) for v in by_fn.values()))]
failed = set()
with ThreadPoolExecutor(32) as pool:
    for f in pool.map(lambda a: run('g%d' % a[0], a[1]), enumerate(jobs)): failed |= f
    # `any` satisfies everything: what was stored from an `any` is not what was given. It satisfies the impossible too
    refused = set()
    for f in pool.map(lambda a: run('i%d' % a[0], a[1], True), enumerate(jobs)): refused |= f
    answers = {str(c[0]): c[0] not in failed and c[0] in refused for v in by_fn.values() for c in v}
    others = [[c for c in job if not answers[str(c[0])]] for job in jobs]
    list(pool.map(lambda a: run('n%d' % a[0], a[1], never=True), enumerate(job for job in others if job)))
for k, t in named.items():
    if not answers[str(k)]: answers[str(k)] = t
json.dump(answers, open(out_path, 'w'))
subprocess.run(['rm', '-rf', work + '/probe'])
print('reads of variables that began as a parameter: %d · still what was given: %d · another type, named: %d' % (len(answers), sum(a is True for a in answers.values()), sum(isinstance(a, str) for a in answers.values())))
