#!/usr/bin/env python3
# usage: compare-matrix.py <label main> <label pr>
# A cell is layout x target x entry:placement x form. "ok" for a load form: it loaded the mirrored file
# (out/lib.js, out/node_modules/pkg) or, for the addon, reached dlopen. `paths` is compared by value.
import json, sys
a = json.load(open(f'/tmp/measure/matrix-{sys.argv[1]}.json'))
b = json.load(open(f'/tmp/measure/matrix-{sys.argv[2]}.json'))
def ok(form, v):
    if form in ('literal','computed','passed'): return v == 'out/lib.js'
    if form in ('resolve','resolveComputed'): return v == 'out/lib.js'
    if form == 'bare': return v == 'out/node_modules/pkg'
    if form == 'addon': return v == 'ERR_DLOPEN_FAILED'
    return None
cells = sorted(k for k in a if '|split|' in k and k.count('|') == 4)
fixed = broke = same_ok = same_bad = 0
broke_also_unsplit = 0
paths_changed = paths_match_unsplit_main = paths_match_unsplit_pr = 0
eq_unsplit_main = eq_unsplit_pr = 0
detail = {}
for k in cells:
    layout, target, _, where, form = k.split('|')
    u = k.replace('|split|', '|unsplit|')
    ma, pr, un = a[k], b.get(k), b.get(u)
    eq_unsplit_main += (ma == un); eq_unsplit_pr += (pr == un)
    if form == 'paths':
        paths_changed += (ma != pr)
        continue
    o_ma, o_pr, o_un = ok(form, ma), ok(form, pr), ok(form, un)
    key = (layout, target, where.split(':')[1])
    d = detail.setdefault(key, [0,0,0,0])
    if not o_ma and o_pr: fixed += 1; d[0]+=1
    elif o_ma and not o_pr:
        broke += 1; d[1]+=1
        if not o_un: broke_also_unsplit += 1
    elif o_ma: same_ok += 1; d[2]+=1
    else: same_bad += 1; d[3]+=1
n = len(cells)
print(f"cells: {n} (load forms: {n - n//8}, paths: {n//8})")
print(f"fixed (fail -> ok): {fixed}; now fail (ok -> fail): {broke}, of them failing un-split too: {broke_also_unsplit}")
print(f"ok both: {same_ok}; fail both: {same_bad}")
print(f"cells equal to the un-split build: main {eq_unsplit_main}/{n}, PR {eq_unsplit_pr}/{n}; paths cells that changed: {paths_changed}")
print("per (layout, target, placement): fixed / now-fail / ok-both / fail-both")
for key in sorted(detail): print(" ", key, detail[key])
