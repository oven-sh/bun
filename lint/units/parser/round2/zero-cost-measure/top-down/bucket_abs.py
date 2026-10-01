import re, sys, collections
src = open('/workspace/notes/lint/units/parser/round2/zero-cost-measure/top-down/buckets.py').read()
start = src.index('B = ['); end = src.index('rxs = ')
ns = {}; exec(src[start:end], ns); B = ns['B']
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
rxs = [(n, re.compile(p)) for n, p in B]
rx = re.compile(r'bun_js_parser|bun_ast')
def load(path):
    fn = None; per = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)', '', line[3:].rstrip('\n'))
                continue
            if not c.isdigit(): continue
            parts = line.split(); p = per[fn]
            for i in range(1, min(len(parts), 6)): p[i - 1] += int(parts[i])
    return per
d = sys.argv[1]
for tag in sys.argv[2:]:
    print(tag)
    tot = collections.OrderedDict((n, [[0, 0] for _ in G]) for n, _ in B[1:])
    allp = [[0, 0] for _ in G]
    for gi, g in enumerate(G):
        per = load(f'{d}/{tag}.{g}.cg')
        for n, v in per.items():
            if not n or not rx.search(n): continue
            allp[gi][0] += v[0]; allp[gi][1] += v[1]
            for b, r in rxs[1:]:
                if r.search(n):
                    tot[b][gi][0] += v[0]; tot[b][gi][1] += v[1]; break
    for b, v in tot.items():
        print('  %-18s Bc ' % b + ''.join('%15d' % x[1] for x in v))
    print('  %-18s Bc ' % 'parser symbols' + ''.join('%15d' % x[1] for x in allp))
    print('  %-18s Ir ' % 'parser symbols' + ''.join('%15d' % x[0] for x in allp))
