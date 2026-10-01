#!/usr/bin/env python3
# Counts error baselines that hold a TS8xxx code, split by who reports the code in the reference.
import os, re, sys, collections
PARSER = {8002,8003,8004,8005,8006,8008,8009,8010,8011,8012,8013,8016,8017,8037,8038}
roots = sys.argv[1:]
for root in roots:
    files = []
    for d, _, fs in os.walk(root):
        for f in fs:
            if f.endswith('.errors.txt'):
                files.append(os.path.join(d, f))
    per_code = collections.Counter()
    any8 = parser8 = jsdoc8 = only_parser8 = 0
    js_units = 0
    for p in files:
        try:
            t = open(p, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        codes = set(int(c) for c in re.findall(r'error TS(8\d\d\d)', t))
        if re.search(r'^==== .*\.(js|jsx|mjs|cjs) \(\d+ errors?\) ====', t, re.M):
            js_units += 1
        if not codes:
            continue
        any8 += 1
        for c in codes:
            per_code[c] += 1
        if codes & PARSER:
            parser8 += 1
        if codes - PARSER:
            jsdoc8 += 1
        if codes <= PARSER:
            only_parser8 += 1
    print(f'{root}\n  error baselines: {len(files)}; with a .js/.jsx/.mjs/.cjs unit: {js_units}; with any TS8xxx: {any8}; with a checkJSSyntax code: {parser8}; with only checkJSSyntax codes: {only_parser8}; with another TS8xxx (JSDoc, checker): {jsdoc8}')
    for c, n in sorted(per_code.items()):
        print(f'    TS{c} {"parser" if c in PARSER else "other "} baselines={n}')
