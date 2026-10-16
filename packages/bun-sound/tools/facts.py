#!/usr/bin/env python3
"""tools/facts.py <the front end's IR of a program (text)> <package> [<package> ..]: HOW MUCH OF A TYPED PACKAGE IS FACTS IN THIS PROGRAM: over the functions of the package's modules (all that lies under node_modules/<package>/: a file typed where it lies keeps its .js name): reads and stores of a property whose receiver is known to be laid out (a class or a record) against those that go by name; and how many of the package's declared records have a layout.
Prints one line a package: `facts <package>: <f> of <n> (<p>%) reads and stores are by offset · records <r>, foreign <k>`. The number is a property of (text, program, front end): run.py pins it for each tree and fails when it falls."""
import re, sys
t = open(sys.argv[1], errors='replace').read(); types = dict(re.findall(r'^type (#\d+): (.*)$', t, re.M))
mods = {m.group(1): m.group(2) for m in re.finditer(r'^module (\d+) "([^"]+)"', t, re.M)}
for pkg in sys.argv[2:]:
    mine = {k for k, v in mods.items() if ('node_modules/' + pkg + '/') in v}; f = n = 0
    for part in re.split(r'^(?=function \d+ )', t, flags=re.M)[1:]:
        m = re.match(r'function \d+ "[^"]*" \w+ flags \d+ module (\d+) ', part)
        if not m or m.group(1) not in mine: continue
        ty = dict(re.findall(r'\b(v\d+): (#\d+)', part))
        for op, r in re.findall(r'= (GetById|PutById|GetField|PutField) (v\d+)', part):
            n += 1; f += op.endswith('Field') or 'class' in types.get(ty.get(r, ''), '')
    rec = [l for l in re.findall(r'^shape \d+ (?:Record|Instance) .*$', t, re.M) if ('node_modules/' + pkg + '/') in l]
    print('facts %s: %d of %d (%.1f%%) reads and stores are by offset · records %d, foreign %d' % (pkg, f, n, 100.0 * f / n if n else 0, len(rec), sum(' foreign' in l for l in rec)))
