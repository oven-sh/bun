#!/usr/bin/env python3
"""form_esm1.py <typed.mts> <out .ts>: THE FORM FOR A TYPED TEXT THAT IS AN ES MODULE ALREADY (seroval's dist/index.js): module_form8.py turns CommonJS into a module AND makes the shapes live; here only the second is left to do:
 1. each leading `/// <reference path="./x.d.ts" />` line becomes an empty line (the text keeps its line numbers);
 2. the shape files it named are appended, NOT AMBIENT: `declare namespace SV {` -> `namespace SV {`, and every declaration that starts a line two spaces in (`  interface` | `  type`) gets `export`: AN AMBIENT TYPE HAS NO LAYOUT (it is what is GIVEN); a namespace of interfaces and aliases alone emits no code.
LAID BACK (the appended part cut off, the empty lines made references again) IT MUST BE THE TEXT THAT CAME IN: asserted."""
import os, re, sys
src, out = sys.argv[1], sys.argv[2]; L = open(src).read().split('\n'); D = os.path.dirname(os.path.abspath(src)); refs = []
i = 0
while i < len(L) and re.fullmatch(r'\s*///\s*<reference path="\./([^"]+)"\s*/>\s*', L[i]): refs.append(re.search(r'path="\./([^"]+)"', L[i]).group(1)); L[i] = ''; i += 1
body = '\n'.join(L).rstrip('\n'); tail = []; shapes = spaces = 0
for f in refs:
    for l in open(D + '/' + f).read().rstrip('\n').split('\n'):
        if re.match(r'declare namespace \w+ \{', l): l = l[len('declare '):]; spaces += 1
        elif re.match(r'  (interface|type) ', l): l = '  export ' + l[2:]; shapes += 1
        elif re.match(r'declare (var|let|const|function) ', l): pass  # a global the library's types lack (`declare var window: any;`): ambient in a module too: it emits nothing and names the global
        elif re.match(r'declare ', l): sys.exit('form_esm1: %s declares something else than a namespace: %s' % (f, l[:80]))
        tail.append(l)
MARK = '// ---- the shapes, live (sv/form_esm1.py) ----'
open(out, 'w').write(body + '\n' + MARK + '\n' + '\n'.join(tail) + '\n')
back = open(out).read().split('\n' + MARK + '\n')[0].split('\n')
for k, f in enumerate(refs): back[k] = '/// <reference path="./%s" />' % f
ok = '\n'.join(back).rstrip('\n') == open(src).read().rstrip('\n')
print('form_esm1: references %d · namespaces %d · shapes %d · laid back it is the text that came in: %s' % (len(refs), spaces, shapes, 'yes' if ok else 'NO')); sys.exit(0 if ok else 1)
