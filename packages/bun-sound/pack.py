#!/usr/bin/env python3
"""pack.py <node_modules as installed> <a tree check.py has laid: <out>/node_modules> <where: a new folder> [name ..]: THE SOUND PACKAGES, ONE FOLDER A PACKAGE@VERSION: <where>/<name>/<version>/:
   sound.json     the manifest: { "sound": 1, "name", "version", "when": { define: value }, "basis": { path: sha256 }, "lay": { path: "new" | sha256 }, "needs": [] }
   lay/<path>     each replacement or new file AT THE VERY PATH IT TAKES IN THE PACKAGE
   package.json   so that the folder can be published as it is: @sound/<name>, the typed package's own version, a peer dependency on exactly that version, the original's license
   LICENSE        the package's own, as installed: lay/ is a copy of its code
   NOTICE         whose code it is, under which licence, which files were changed and how (Apache-2.0 4(b) asks for it; the others lose nothing by it)
   lay.sums       sha256 and path of every file under lay/: what a test can check without any tool
   src/           what lay/ is generated from (laid here by the caller: see bun-sound's check.py). NEVER COPY src/ UNDER A PROJECT's <root>/.sound/<name>/: the host's tsconfig takes its ambient .d.ts files for the project's own globals (seen: TS2339 on `process.argv`, the build stops): a project's folder holds sound.json and lay/ alone
THE SAME FOLDER (sound.json + lay/) IS WHAT A PROJECT KEEPS AS <root>/.sound/<name>/.
HOW lay IS FOUND: BY COMPARING THE TWO TREES, FILE BY FILE: what the laid tree has and the installed one has not is "new"; what differs replaces the installed file, named by that file's sha256. Nothing is taken on trust from the tool that laid it.
basis: the installed files that are NOT replaced but whose bytes the texts were typed on and verified against: for a new `x.ts` | `x.sound.ts` the `x.js` beside it, if it is still as installed.
when: A REPLACED ENTRY OF npm's THAT SWITCHES ON `process.env.NODE_ENV === 'production'` (React's index.js, server.bun.js ..) IS REPLACED BY A LINE THAT TAKES THE PRODUCTION BUNDLE ALWAYS: SO THE SET MAY BE APPLIED ONLY WHERE THE BUILD DEFINES process.env.NODE_ENV AS "production": `"when": { "process.env.NODE_ENV": "production" }`: elsewhere npm's entry would have taken the development bundle, and the answers (warnings, messages) would be others.
THE MECHANISM's RULE: all or nothing: name, version and every sha256 fit, no "new" path exists: else the package stays as installed, with one warning."""
import hashlib, json, os, re, shutil, sys
N, L, OUT = (os.path.abspath(a) for a in sys.argv[1:4]); names = sys.argv[4:]
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
if os.path.exists(OUT): sys.exit('pack.py: %s stands already: name another folder' % OUT)
def files(root):
    for d, ds, fs in os.walk(root):
        ds[:] = [x for x in ds if x != 'node_modules']
        for f in fs: yield os.path.relpath(os.path.join(d, f), root)
made = []
for name in names or sorted(os.listdir(L)):
    a, b = N + '/' + name, L + '/' + name
    if not os.path.isfile(b + '/package.json') or not os.path.isfile(a + '/package.json'): continue
    pj = json.load(open(a + '/package.json')); lay = {}; basis = {}
    if sha(a + '/package.json') != sha(b + '/package.json'): sys.exit('pack.py: %s: package.json differs: it can not be laid (the resolver has read it before the mechanism is asked)' % name)
    for f in sorted(files(b)):
        if not os.path.exists(a + '/' + f): lay[f] = 'new'
        elif sha(a + '/' + f) != sha(b + '/' + f): lay[f] = sha(a + '/' + f)
    gone = [f for f in files(a) if not os.path.exists(b + '/' + f)]
    if gone: sys.exit('pack.py: %s: the laid tree lacks %s: a sound package adds and replaces, it removes nothing' % (name, gone[:3]))
    if not lay: continue
    for f, v in lay.items():
        if v == 'new':
            js = re.sub(r'(\.sound)?\.ts$', '.js', f)
            if js != f and js not in lay and os.path.exists(a + '/' + js): basis[js] = sha(a + '/' + js)
            stem = re.sub(r'\.ts$', '', f)
            if not f.endswith('.sound.ts') and os.path.exists(a + '/' + stem + '.d.ts') : sys.exit('pack.py: %s: %s would shadow %s.d.ts: the checker takes x.ts ahead of x.d.ts beside x.js: name it x.sound.ts' % (name, f, stem))
    D = '%s/%s/%s' % (OUT, name, pj['version']); os.makedirs(D + '/lay')
    for f in lay: os.makedirs(os.path.dirname(D + '/lay/' + f), exist_ok=True); shutil.copy(b + '/' + f, D + '/lay/' + f)
    lic = next((x for x in ('LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license') if os.path.exists(a + '/' + x)), None) or sys.exit('pack.py: %s has no LICENSE file: what is published is a copy of its code' % name); shutil.copy(a + '/' + lic, D + '/LICENSE')
    owner = next((m.group(0).strip() for x in [a + '/' + lic] + [a + '/' + re.sub(r'(\.sound)?\.m?ts$', e, f) for f in lay for e in ('.js', '.mjs')] if os.path.exists(x) for l in open(x, errors='replace').read().split('\n')[:40] for m in [re.search(r'Copyright (\(c\) )?(\d{4}|[A-Z]).*', l)] if m), None) or sys.exit('pack.py: %s: no copyright line in its LICENSE or in the head of its files' % name)
    typed = [f for f, v in lay.items() if v == 'new']; doors = [f for f, v in lay.items() if v != 'new']; flat = '@sound/' + name.lstrip('@').replace('/', '__')
    open(D + '/NOTICE', 'w').write('''%s %s

This package holds files of %s %s (https://www.npmjs.com/package/%s/v/%s).
%s
Licensed under %s: see LICENSE, which is that package's own.

What was changed:
%s
  TypeScript type annotations, type declarations, `declare`d fields and type-only casts were added to the
  package's own JavaScript. No statement and no expression was changed: with the types erased, each file
  prints as the file it was made from.
%s
  These take the place of the package's files of the same name. Each only loads the typed file.

The additions are offered under the same licence as the package.
''' % (flat, pj['version'], name, pj['version'], name, pj['version'], owner, pj.get('license', 'UNLICENSED'), '\n'.join('  lay/' + f for f in typed), '\n'.join('  lay/' + f for f in doors)))
    open(D + '/lay.sums', 'w').write(''.join('%s  %s\n' % (sha(D + '/lay/' + f), f) for f in sorted(lay)))
    when = {'process.env.NODE_ENV': 'production'} if any(v != 'new' and re.search(r"process\.env\.NODE_ENV === 'production'", open(a + '/' + f, errors='replace').read()) for f, v in lay.items()) else {}
    json.dump({'sound': 1, 'name': name, 'version': pj['version'], 'when': when, 'basis': basis, 'lay': lay, 'needs': []}, open(D + '/sound.json', 'w'), indent=2); open(D + '/sound.json', 'a').write('\n')
    json.dump({'name': flat, 'version': pj['version'], 'description': 'Sound TypeScript types for %s %s: npm\'s own code with types added and nothing else changed, for `bun build --compile --aot`.' % (name, pj['version']),
               'license': pj.get('license', 'UNLICENSED'), 'peerDependencies': {name: pj['version']}, 'files': ['sound.json', 'lay', 'LICENSE', 'NOTICE']}, open(D + '/package.json', 'w'), indent=2); open(D + '/package.json', 'a').write('\n')
    made.append(D); print('%s@%s: lay %d (%d new, %d replaced) · basis %d · %d B · %s' % (name, pj['version'], len(lay), sum(v == 'new' for v in lay.values()), sum(v != 'new' for v in lay.values()), len(basis), sum(os.path.getsize(D + '/lay/' + f) for f in lay), D))
    for f, v in lay.items(): print('      %-62s %s' % (f, v[:12]))
if not made: sys.exit('pack.py: nothing differs: nothing is packed')
