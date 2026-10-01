#!/usr/bin/env python3
"""Per source function outside parse_skip_typescript.rs/type_sink.rs/lexer: dBc head-base, split into lint-test lines and the rest."""
import sys, re, collections
sys.path.insert(0, '/workspace/notes/lint/units/parser/round2/zero-cost-measure-1a')
from cgline import load, Src
lint = re.compile(r'starts_for_parse_only|is_lint_parse|sidecar_mark|recorded')
frx = re.compile(r'^src/(js_parser|ast)/'); skip = re.compile(r'parse_skip_typescript\.rs|type_sink\.rs|/lexer\.rs|lexer_tables\.rs')
M = '/workspace/notes/lint/measure/parser/cg'
groups = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
def agg(path, root):
    S = Src(root); per = load(path); out = collections.defaultdict(lambda: [0, 0])
    for (fl, fn, line), v in per.items():
        if not fl or not frx.search(fl) or skip.search(fl): continue
        k = (fl.split('src/')[-1], S.fn(fl, line)); t = out[k]
        if lint.search(S.text(fl, line)): t[1] += v[1]
        else: t[0] += v[1]
    return out
rows = collections.defaultdict(lambda: [[0, 0] for _ in groups])
for gi, g in enumerate(groups):
    A = agg(f'{M}/base.{g}.cg', '/tmp/zc1a/basetree'); B = agg(f'{M}/head.{g}.cg', '/workspace/wt/parser')
    for k in set(A) | set(B):
        a = A.get(k, [0, 0]); b = B.get(k, [0, 0]); rows[k][gi] = [b[0] - a[0], b[1] - a[1]]
tot = [[sum(r[i][j] for r in rows.values()) for j in range(2)] for i in range(5)]
print(f'{"source function (rest | lint-test lines)":52}' + ''.join(f'{g:>22}' for g in groups))
print(f'{"TOTAL":52}' + ''.join(f'{t[0]:>+12,}|{t[1]:>+9,}' for t in tot))
for k, r in sorted(rows.items(), key=lambda kv: -sum(abs(x[0]) for x in kv[1])):
    if not any(x[0] or x[1] for x in r): continue
    if sum(abs(x[0]) + abs(x[1]) for x in r) < int(sys.argv[1]) if len(sys.argv) > 1 else 0: continue
    print(f'{(k[0].replace("js_parser/", "") + " " + k[1])[:52]:52}' + ''.join(f'{x[0]:>+12,}|{x[1]:>+9,}' for x in r))
