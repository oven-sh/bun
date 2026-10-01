# The functions that the run of `const x: number = "s";` (harness, lib es5) enters and that an entered caller of an earlier
# landing step calls: the stand-ins on the path of the first visible result between those two steps.
# Input: data/functions-by-layer.tsv, the call graph fns.json, ../../end-to-end-k4-k5/data/k4-harness.entered.tsv.
# usage: python3 k4path.py <data dir> [--check]
import collections, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
FNS = os.environ.get('FNS_JSON', '/tmp/k3a/fns.json')
data = sys.argv[1]
fns = json.load(open(FNS))
step, layer = {}, {}
for l in open(os.path.join(data, 'functions-by-layer.tsv')).read().split('\n')[1:]:
    if l:
        f, a, b, name, lay, st = l.split('\t')
        step[(f, int(a))] = int(st); layer[(f, int(a))] = lay
entered = set()
for l in open(os.path.join(HERE, '../../../end-to-end-k4-k5/data/k4-harness.entered.tsv')):
    p = l.rstrip('\n').split('\t')
    if len(p) >= 4 and (p[1].startswith('checker/') or p[1].startswith('binder/')):
        entered.add((p[1], int(p[2])))
by_pos = {(f['file'], f['decl']): f for f in fns}
callers = collections.defaultdict(list)
for f in fns:
    for c in (f.get('callees') or []):
        callers[c].append(f)
short = lambda n: n.replace('checker.Checker.', '').replace('checker.', '')
rows = []
for e in sorted(entered):
    f = by_pos.get(e)
    s = step.get(e)
    if not f or s in (None, 0, 99):
        continue
    early = [(step.get((c['file'], c['decl'])), c) for c in callers.get(f['name'], []) if (c['file'], c['decl']) in entered]
    early = [(cs, c) for cs, c in early if cs not in (None, 0, 99) and cs < s]
    if early:
        cs, c = min(early, key=lambda x: (x[0], x[1]['name']))
        rows.append((s, cs, f['file'], f['decl'], short(f['name']), layer[e], short(c['name'])))
text = 'landing step\tearliest step of an entered caller\tfile\tline\tfunction\tlayer\tthat caller\n' + ''.join('\t'.join(map(str, r)) + '\n' for r in sorted(rows))
path = os.path.join(data, 'k4-early-callers.tsv')
if '--check' in sys.argv:
    ok = open(path).read() == text
    print('k4 path:', 'no diff' if ok else 'DIFFERS', len(entered), 'entered,', len(rows), 'with an earlier caller')
    sys.exit(0 if ok else 1)
open(path, 'w').write(text)
print(len(entered), 'entered,', len(rows), 'with an earlier caller')
