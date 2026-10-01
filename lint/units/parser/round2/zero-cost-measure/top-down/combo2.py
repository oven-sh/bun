import re, sys, collections
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
rx = re.compile(r'bun_js_parser|bun_ast')
def norm(n):
    n = re.sub(r' \(\.llvm\.\d+\)', '', n)
    n = n.replace('>::old_', '>::').replace('parse_suffix_of', 'parse_suffix').replace('parse_arrow_body_with_flags', 'parse_arrow_body')
    n = re.sub(r'lexer_backtracker_(bool|result)::<<bun_js_parser::p::P<(\w+), (\w+)>>::(\w+), \w+>', r'ATTEMPT \4', n)
    n = re.sub(r'>::try_(skip_\w+)$', r'>::ATTEMPT \1', n)
    n = n.replace('bun_js_parser::p::P', 'P')
    n = re.sub(r'bun_js_parser::(p|parse::\w+|lexer|parser)::', '', n)
    n = re.sub(r'<P<(\w+), (\w+)>>::', lambda m: 'P<%s,%s>::' % (m.group(1)[0], m.group(2)[0]), n)
    return n
def load(path):
    fn = None; per = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fn='):
                    raw = line[3:].rstrip('\n'); fn = norm(raw) if rx.search(raw) else None
                continue
            if fn is None or not c.isdigit(): continue
            parts = line.split(); p = per[fn]
            for i in range(1, min(len(parts), 6)): p[i - 1] += int(parts[i])
    return per
d = '/tmp/zcm-td/cg'; F3 = sys.argv[2] if len(sys.argv) > 2 else 'rawf3b'
T = {t: {g: load(f'{d}/{t}.{g}.cg') for g in G} for t in ['rawbase', 'rawhead', 'rawvold3', F3]}
names = set()
for t in T:
    for g in G: names |= set(T[t][g])
rows = []; tot = [0] * 5
for n in names:
    v = []
    for g in G:
        b = T['rawbase'][g].get(n, [0]*5)[1]; h = T['rawhead'][g].get(n, [0]*5)[1]
        o = T['rawvold3'][g].get(n, [0]*5)[1]; f = T[F3][g].get(n, [0]*5)[1]
        v.append((o - b) + (f - h))
    if any(v): rows.append((v, n)); tot = [tot[i] + v[i] for i in range(5)]
print('estimate (vold3 - base) + (f3 - head), raw Bc, 20 passes:', tot)
print('sum of positive rows', [sum(r[0][i] for r in rows if r[0][i] > 0) for i in range(5)])
print('sum of negative rows', [sum(r[0][i] for r in rows if r[0][i] < 0) for i in range(5)])
for v, n in sorted(rows, key=lambda r: -sum(abs(x) for x in r[0][:4]))[:int(sys.argv[1])]:
    print(''.join('%+11d' % x for x in v[:4]) + '  ' + n[:110])
