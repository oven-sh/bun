#!/usr/bin/env python3
"""For each code that tsc 6.0.2 or typescript-go reports for a targeted input as a.js beside the parse diagnostics:
what bun's JavaScript instantiation says about the same input. Reads js-lint-expect.json.
usage: python3 ts8-to-bun-errors.py > ts8-to-bun-errors.txt"""
import json, collections
ex = json.load(open('js-lint-expect.json'))
by = collections.defaultdict(lambda: collections.defaultdict(list))
for e in ex:
    js = e['tsc']['js']
    go = e['typescript_go']
    gojs = js if go == 'same as tsc' else go['js']
    for c in sorted({d['code'] for d in js} | {d['code'] for d in gojs}):
        by[c][e['bun_javascript']].append(e['src'])
shapes = collections.Counter()
for c in sorted(by):
    n = sum(len(v) for v in by[c].values())
    print(f"\nTS{c}: {n} inputs")
    for msg, srcs in sorted(by[c].items(), key=lambda kv: -len(kv[1])):
        print(f"   {len(srcs):3}  bun js: {msg}")
        if msg != 'accepts': shapes[msg] += len(srcs)
        for s in srcs[:4]: print(f"          {json.dumps(s)}")
        if len(srcs) > 4: print(f"          ... {len(srcs)-4} more")
print(f"\n{len(shapes)} distinct messages of bun's JavaScript instantiation stand for these codes")
