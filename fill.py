#!/usr/bin/env python3
# Fills pr-body.tmpl.md into pr-body.md from the measurement files and manual.json.
import json, re, statistics, subprocess, sys

ROOT = '/tmp/repro-9089/'
def load(path):
    rows = {}
    for line in open(path):
        m = re.match(r'(\w+) ([\w-]+) \[([^\]]+)\] (\w+): \[([0-9, ]+)\]', line.strip())
        if not m:
            if line.strip(): print('UNPARSED', path, line.strip(), file=sys.stderr)
            continue
        mode, name, label, build, vals = m.groups()
        rows[(name, label, build)] = [int(v) for v in vals.split(',')]
    return rows
ins = load(ROOT + 'measure-insns.txt')
calls = load(ROOT + 'measure-calls.txt')
def med(table, name, label, build):
    v = table.get((name, label, build))
    if v is None: raise SystemExit(f'missing {name} {label} {build}')
    return int(statistics.median(v))
fmt = lambda n: f'{int(n):,}'
manual = json.load(open(ROOT + 'manual.json'))

passing = [
    ('`toMatchObject`, 3 keys, 2 matchers', 'pass3', 'verdict'),
    ('`toMatchObject`, 10 keys, 2 matchers', 'pass10', 'verdict'),
    ('`toMatchObject`, 3 plain keys', 'plain3', 'verdict'),
    ('`toMatchObject`, 10 plain keys', 'plain10', 'verdict'),
    ('`toMatchObject`, 40 plain keys', 'plain40', 'verdict'),
    ('`toMatchObject`, 10 matchers', 'matchers10', 'verdict'),
    ('`toMatchObject`, 4 nested objects', 'nest4', 'verdict'),
    ('the whole host call, 3 keys, 2 matchers', 'pass3', 'host-call'),
    ('the whole host call, 10 plain keys', 'plain10', 'host-call'),
    ('`Bun.deepMatch`', 'deepmatch', 'Bun.deepMatch'),
    ('`toEqual` with `expect.objectContaining`', 'containing', 'host-call'),
    ('a custom asymmetric matcher, asked by `toEqual`', 'custom', 'ask'),
    ('a custom matcher, `expect(x).toBeOdd()`', 'custom-sym', 'call'),
    ('a custom asymmetric matcher, asked inside `this.equals()`', 'custom-equals', 'ask'),
    ('an `expect.resolvesTo` matcher, asked by `toEqual`', 'resolves', 'ask'),
    ('`toEqual` with one `expect.resolvesTo` matcher, the whole host call', 'resolves', 'host-call'),
]
rows = ['| call | #48544 | this PR |', '| --- | --- | --- |']
for title, name, label in passing:
    b, n = med(ins, name, label, 'base'), med(ins, name, label, 'new')
    if b != n: raise SystemExit(f'passing row differs: {name} {label} {b} {n}')
    rows.append(f'| {title} | {fmt(b)} | {fmt(n)} |')
PASS_TABLE = '\n'.join(rows)
for name, label in [(n, l) for _, n, l in passing]:
    if (name, label, 'base') in calls and calls[(name, label, 'base')] != calls[(name, label, 'new')]:
        raise SystemExit(f'allocator calls differ: {name} {label}')

failing = [
    ('the values of the issue', 'fail-repro'),
    ('mismatch first, 9 matchers after it', 'fail-10'),
    ('9 matchers, mismatch last', 'fail-last'),
    ('10 plain keys, no matcher', 'fail-plain10'),
    ('mismatch first, then 10 nested records, no matcher', 'fail-records10'),
    ('mismatch first, one matcher and 10 nested records', 'fail-records10m'),
]
rows = ['| call | #48544 | this PR | change | the second walk |', '| --- | --- | --- | --- | --- |']
pct = {}
for title, name in failing:
    b, n = med(ins, name, 'host-call', 'base'), med(ins, name, 'host-call', 'new')
    vb, vn = med(ins, name, 'verdict+rows', 'base'), med(ins, name, 'verdict+rows', 'new')
    pct[name] = f'{(n - b) / b * 100:+.1f}%'
    rows.append(f'| {title} | {fmt(b)} | {fmt(n)} | {pct[name]} | {fmt(vn - vb)} |')
FAIL_TABLE = '\n'.join(rows)
def per_call(name, label, build):
    total, runs, _present = calls[(name, label, build)]
    assert total % runs == 0, (name, label, build, total, runs)
    return total // runs
alloc = [f"{per_call(name, 'host-call', 'base')} to {per_call(name, 'host-call', 'new')}" for _, name in failing[:4]]
ALLOC_LINE = ('Allocator calls per failing host call, for the first four rows: ' + ', '.join(alloc) +
              '. The first row costs less than before because the diff prints the row of `b` in place of the date.')

def size(path):
    out = subprocess.run(['llvm-size', path], capture_output=True, text=True, check=True).stdout.splitlines()[1].split()
    return int(out[0])
import os
tb, tn = size(ROOT + 'bin/bun-base'), size(ROOT + 'bin/bun-new')
fb, fn = os.path.getsize(ROOT + 'bin/bun-base'), os.path.getsize(ROOT + 'bin/bun-new')
TEXT_DELTA = f'{tn - tb:+,}'

walker = subprocess.run(['grep', '-n', '^bool Bun__deepMatch(', '/workspace/bun/src/jsc/bindings/bindings.cpp'], capture_output=True, text=True).stdout
WALKER_LINE = walker.split(':')[0]

values = {
    'WALKER_LINE': WALKER_LINE,
    'FAIL_TOTAL': str(manual['fail_total']), 'FAIL_EXPECT': str(manual['fail_expect']),
    'FAIL10_BASE': fmt(med(ins, 'fail-10', 'host-call', 'base')), 'FAIL10_NEW': fmt(med(ins, 'fail-10', 'host-call', 'new')),
    'FAIL10_PCT': pct['fail-10'], 'PLAIN_PCT': pct['fail-plain10'],
    'NOT_BASE': fmt(med(ins, 'not3', 'host-call', 'base')), 'NOT_NEW': fmt(med(ins, 'not3', 'host-call', 'new')),
    'MISS_BASE': fmt(med(ins, 'miss', 'host-call', 'base')), 'MISS_NEW': fmt(med(ins, 'miss', 'host-call', 'new')),
    'SNAP_BASE': fmt(med(ins, 'snapshot', 'verdict', 'base')), 'SNAP_NEW': fmt(med(ins, 'snapshot', 'verdict', 'new')),
    'TESTERS_BASE': fmt(med(ins, 'testers', 'verdict', 'base')), 'TESTERS_NEW': fmt(med(ins, 'testers', 'verdict', 'new')),
    'TEXT_DELTA': TEXT_DELTA,
    'PASS_TABLE': PASS_TABLE, 'FAIL_TABLE': FAIL_TABLE, 'ALLOC_LINE': ALLOC_LINE,
    'IDENTICAL_LINE': manual['identical_line'],
    'WALL_ROWS': '\n'.join(manual['wall_rows']),
    'SIZE_LINES': manual['size_lines'].replace('TEXT_BASE', fmt(tb)).replace('TEXT_NEW', fmt(tn)).replace('TEXT_DELTA', TEXT_DELTA).replace('FILE_DELTA', f'{fn - fb:,}'),
    'MUTATION_LINE': manual['mutation_line'], 'DEPTH_LINE': manual['depth_line'],
    'SELF_REVIEW_LINE': manual['self_review_line'],
}
assert med(ins, 'not3', 'host-call', 'new') - med(ins, 'not3', 'host-call', 'base') == 3
assert med(ins, 'snapshot', 'verdict', 'new') - med(ins, 'snapshot', 'verdict', 'base') == 2
assert med(ins, 'miss', 'host-call', 'new') - med(ins, 'miss', 'host-call', 'base') == 24
assert med(ins, 'testers', 'verdict', 'new') - med(ins, 'testers', 'verdict', 'base') == 4
body = open(ROOT + 'pr-body.tmpl.md').read()
for key in sorted(values, key=len, reverse=True):
    body = body.replace(key, values[key])
left = re.findall(r'\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b', body)
left = [w for w in left if w not in ('BUN_JSC_')]
open(ROOT + 'pr-body.md', 'w').write(body)
visible = body.split('<details>')[0]
words = len(re.findall(r'\S+', visible))
print('visible words:', words, '| placeholders left:', sorted(set(left)))
for bad in ['\u2014', '\u2013', ';']:
    if bad in body: print('FOUND', repr(bad), body.count(bad))
