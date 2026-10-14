#!/usr/bin/env python3
"""check.py <node_modules> [<out folder>] [--only=<part of a package's name>] [--elements=shared|plain]: THE STATIC GATES OF THE TYPED TEXTS OF UNTYPED PACKAGES, IN ONE COMMAND, FROM ONE FOLDER, WITH NO ABSOLUTE PATH. NO PACKAGE CODE IS RUN.
WHAT IS HERE: packages/<name>@<version>[.<bundle>]/typed.cts: npm's production bundle WITH TYPES ADDED AND NOTHING ELSE CHANGED, and its shapes (*.d.ts) beside it. npm's own files are not here: they are read from the <node_modules> you name, and must be the very bytes the text was typed on.
IT WANTS, BY THE ENVIRONMENT: SEMA=<the AoT front end: `$SEMA cli <file> --noEmit --all`> · BUN=<any Bun, to print a text without its types; `bun` unless said> · BUN_SEMA_TS_LIB=<TypeScript's lib folder>.
THE GATES, FOR EACH PACKAGE THAT <node_modules> HOLDS AT THAT VERSION:
  1. md5     npm's file is the one the text was typed on
  2. errors  the type checker finds nothing in typed.cts
  3. verify  markers' contents, `$given` and `$as<Role>` stripped and both texts printed by Bun: THE TYPED TEXT IS npm's PROGRAM, line for line
  4. splits  tools/splits1.py: every split of a reused variable into roles is the bundle's own program (verify cannot see a wrong split)
  5. form    the CommonJS text becomes an ES module with its shapes appended (tools/module_form8.py); for the reconciler: what other code makes becomes `any` (tools/given2.py) and an element is the jsx-runtime's own, or given (--elements=plain)
  6. laid    a copy of the packages is made in <out>/node_modules, the formed texts are laid in it, and EACH LAID FILE IS CHECKED WHERE IT LIES, --strict: 0 errors (an error on one of the form's appended `import * as x$module` lines is passed over and said)
  7. counts  variants, written unions of two or more shapes, `any`, casts, `!`: against the numbers below: a text that drifts says so
 10. lax     every laid file has 0 errors under `noImplicitAny: false`, `strictNullChecks: false` and `strict: false` too: a host's two options reach a package
  9. same    (in the repository's form only) lay/ is byte for byte what src/ gives today; sound.json's sha256 are the installed files'
WHAT IT LEAVES: <out>/laid/<package>/..: the files to lay, and <out>/node_modules: a tree that `bun build --compile --aot` can take. EXIT 1 IF ANY GATE FAILS.
WHAT IT DOES NOT SAY: that the types are TRUE. That is what run.sh (the wide trees against plain Bun, with the audit build) walks, and it walks only what it walks."""
import hashlib, os, re, shutil, subprocess, sys
H = os.path.dirname(os.path.abspath(__file__)); T = H + '/tools'
args = [a for a in sys.argv[1:] if not a.startswith('--')]; opts = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
if not args: sys.exit(__doc__)
N = os.path.abspath(args[0]); OUT = os.path.abspath(args[1]) if len(args) > 1 else os.path.abspath('ship.out'); ELEMENTS = opts.get('elements', 'plain')  # plain is what is published: no package imports another's types
SEMA = os.environ.get('SEMA') or sys.exit('check.py: SEMA=<the front end> is wanted'); BUN = os.environ.get('BUN', 'bun'); ENV = dict(os.environ, NO_COLOR='1')
LIVE = 'FiberConstructor,FiberRootConstructor,ConcurrentUpdate,ConcurrentQueue,StoreInstance'
SERVER = 'export { version, renderToReadableStream, renderToPipeableStream, resumeToPipeableStream, resume, renderToString, renderToStaticMarkup }; export default { version, renderToReadableStream, renderToPipeableStream, resumeToPipeableStream, resume, renderToString, renderToStaticMarkup };'
P = [  # folder · npm's file · its md5 · where the formed text is laid · the entries that are rewritten · what is due (variants, unions of two shapes written on a variable)
    dict(name='react-reconciler@0.33.0', npm='react-reconciler/cjs/react-reconciler.production.js', md5='1ce09a736d5c21646595d20964d9b01d', lay='react-reconciler/cjs/react-reconciler.production.ts', space='RR',
         entries={'react-reconciler/index.js': 'export { default } from "./cjs/react-reconciler.production.ts";'}, form='reconciler', due=dict(variants=539)),
    dict(name='react-dom@19.3.0.server.bun', npm='react-dom/cjs/react-dom-server.bun.production.js', md5='e6c2b1151664227396c16e5217ae9e4b', lay='react-dom/cjs/react-dom-server.bun.production.ts', space='FZ', entries={}, form='plain', due=dict(variants=184)),
    dict(name='react-dom@19.3.0.server-legacy.browser', npm='react-dom/cjs/react-dom-server-legacy.browser.production.js', md5='2b8f4172ffbe52177acfc592892704c5', lay='react-dom/cjs/react-dom-server-legacy.browser.production.ts', space='FZ', entries={}, form='plain', due=dict(variants=169)),
    dict(name='react@19.2.0', npm='react/cjs/react.production.js', md5='e255db46a1de0ffd84470b0ae50bdc7b', lay='react/cjs/react.production.ts', space='RE', entries={'react/index.js': 'export * from "./cjs/react.production.ts"; export { default } from "./cjs/react.production.ts";'}, form='plain', due=dict(variants=7), held='HELD: typed react bears laid-out elements and refs that cross into untyped components: it is checked here and NOT laid unless --only=react@ names it'),
    # ONE TEXT FOR A FAMILY OF VERSIONS: react-dom 19.2.1 .. 19.2.8 differ in nothing but their own version's string (three lines of the Bun bundle, one of the legacy): the text is kept for 19.2.8 and `token` is replaced by the installed version
    dict(name='react-dom@19.2.8.server.bun', npm='react-dom/cjs/react-dom-server.bun.production.js', md5='', versions={'19.2.1': '899478566fc3da3aa4febc9e8cd470ff', '19.2.3': '26778be71aa576db8858056167bfeefb', '19.2.4': '6aea6e2987ad1079f7f023976b45553f', '19.2.5': 'bbde81e7a3208802f5ba1207c39912bf', '19.2.6': '9a61014a48420a727dae50f458681d23', '19.2.7': '1430fcfed07c0463f48ec5f11164b895', '19.2.8': '5ab8078026a6d607cd47bd188d978a41'}, token='19.2.8', lay='react-dom/cjs/react-dom-server.bun.production.ts', space='FZ', entries={}, form='plain', due=dict(variants=None)),
    dict(name='react-dom@19.2.8.server-legacy.browser', npm='react-dom/cjs/react-dom-server-legacy.browser.production.js', md5='', versions={'19.2.1': '5b1afbdf24b5347d741fc55060471ac6', '19.2.3': '3abd283ea5ff4290fa6bf34f7d352523', '19.2.4': 'b18b197d5388d62ce3622a8b28ca9257', '19.2.5': '2dfa68fa80b2c2ce0b9b71ab7152fceb', '19.2.6': '5f5c98f1a88893281b720d66f2ebbd5b', '19.2.7': '175b25156ea2b9e44bcae7699d3fa877', '19.2.8': 'fd192878320c40558820151cdad247f1'}, token='19.2.8', lay='react-dom/cjs/react-dom-server-legacy.browser.production.ts', space='FZ', entries={}, form='plain', due=dict(variants=None)),
    dict(name='react-dom@19.1.0.server.bun', npm='react-dom/cjs/react-dom-server.bun.production.js', md5='', versions={'19.1.0': 'd1621ecc41503b9f1f50bd0f6adbfcc5'}, token='19.1.0', lay='react-dom/cjs/react-dom-server.bun.production.ts', space='FZ', entries={}, form='plain', due=dict(variants=None)),
    dict(name='react-dom@19.1.0.server-legacy.browser', npm='react-dom/cjs/react-dom-server-legacy.browser.production.js', md5='', versions={'19.1.0': 'b7f2174298ea478f8839c7f0a0fddf7c'}, token='19.1.0', lay='react-dom/cjs/react-dom-server-legacy.browser.production.ts', space='FZ', entries={}, form='plain', due=dict(variants=None)),
    dict(name='react-dom@19.0.0.server.bun', npm='react-dom/cjs/react-dom-server.bun.production.js', md5='', versions={'19.0.0': '77386dba2c969d674d387beed1e5cb91'}, token='19.0.0', lay='react-dom/cjs/react-dom-server.bun.production.ts', space='FZ', entries={}, form='plain', due=dict(variants=None)),
    dict(name='react-dom@19.0.0.server-legacy.browser', npm='react-dom/cjs/react-dom-server-legacy.browser.production.js', md5='', versions={'19.0.0': 'ec9baf4e855b4f79f82865ba0e0767c2'}, token='19.0.0', lay='react-dom/cjs/react-dom-server-legacy.browser.production.ts', space='FZ', entries={}, form='plain', due=dict(variants=None)),
    dict(name='fuse.js@7.0.0', npm='fuse.js/dist/fuse.mjs', md5='8acfaae5c1dd70a090f5b75a3f8ad467', lay='fuse.js/dist/fuse.sound.ts', space='FU', entries={'fuse.js/dist/fuse.mjs': 'export { default } from "./fuse.sound.ts";'}, form='esm', text='typed.mts', due=dict(variants=0), changed='// CHANGED: this is dist/fuse.mjs of fuse.js 7.0.0 with TypeScript types added. No code was changed. See NOTICE.'),
    dict(name='seroval@1.6.9', npm='seroval/dist/index.js', md5='ccbd09502b548d78881f2353cf209c2b', lay='seroval/dist/index.sound.ts', space='SV', entries={'seroval/dist/index.js': 'export * from "./index.sound.ts";'}, form='esm', text='typed.mts', due=dict(variants=0)),
]
# A PACKAGE OF MANY ES MODULES, OF WHICH THE HOT ONES ARE TYPED: each <file>.mjs has its text <file>.sound.mts (the package is "type": "commonjs": a .ts there would be CommonJS); <file>.mjs becomes `export * from "./<base>.sound.mts";`; an import of one typed file by another is pointed at the .sound.mts, so that the checker sees the types and not the authors' .d.mts
MANY = [dict(name='@anthropic-ai/sdk', version='0.112.1', folder='@anthropic-ai__sdk@0.112.1', src='@anthropic-ai/sdk/0.112.1/src', lib='esnext,dom', files={'internal/utils/bytes': 'f3bbbc15d1132a24c7c8fc4b112e8742', 'internal/decoders/line': '53d0301e5b811061c98d9d5c091cb39c', 'core/streaming': 'c443e04b269bb5631095ca00166dfd6c'}),
        dict(name='@anthropic-ai/sdk', version='0.128.0', folder='@anthropic-ai__sdk@0.128.0', src='@anthropic-ai/sdk/0.128.0/src', lib='esnext,dom', files={'internal/utils/bytes': 'f3bbbc15d1132a24c7c8fc4b112e8742', 'internal/decoders/line': 'e483a999dd6a0136d95069e196e5ae1b', 'core/streaming': '952256aac92d3a6beebc6eaa7c2700f3'})]
SRC = {'react-reconciler@0.33.0': 'react-reconciler/0.33.0/src', 'react-dom@19.3.0.server.bun': 'react-dom/19.3.0/src/server.bun', 'react-dom@19.3.0.server-legacy.browser': 'react-dom/19.3.0/src/server-legacy.browser', 'react-dom@19.2.8.server.bun': 'react-dom/19.2.8/src/server.bun', 'react-dom@19.2.8.server-legacy.browser': 'react-dom/19.2.8/src/server-legacy.browser', 'react-dom@19.1.0.server.bun': 'react-dom/19.1.0/src/server.bun', 'react-dom@19.1.0.server-legacy.browser': 'react-dom/19.1.0/src/server-legacy.browser', 'react-dom@19.0.0.server.bun': 'react-dom/19.0.0/src/server.bun', 'react-dom@19.0.0.server-legacy.browser': 'react-dom/19.0.0/src/server-legacy.browser', 'react@19.2.0': 'react/19.2.0/src', 'seroval@1.6.9': 'seroval/1.6.9/src', 'fuse.js@7.0.0': 'fuse.js/7.0.0/src'}  # where the sources lie in the repository's form (packages/bun-sound/<name>/<version>/src); in the unit's folder: packages/<name@version>
SMALL = {  # the reconciler's two small neighbours in react: typed whole, a page each
    'react-jsx-runtime.ts': ('react/cjs/react-jsx-runtime.production.js', 'c172c62d2a67eb3c684b85f92e08631a', 'react/cjs/react-jsx-runtime.production.ts', 'react/jsx-runtime.js', 'export * from "./cjs/react-jsx-runtime.production.ts"; export { default } from "./cjs/react-jsx-runtime.production.ts";'),
    'react-compiler-runtime.ts': ('react/cjs/react-compiler-runtime.production.js', '0813f4fe514266e7865d2f2553e11c76', 'react/cjs/react-compiler-runtime.production.ts', 'react/compiler-runtime.js', 'export * from "./cjs/react-compiler-runtime.production.ts";'),
}
md5 = lambda p: hashlib.md5(open(p, 'rb').read()).hexdigest()
plain = lambda s: re.sub(r'\x1b\[[0-9;]*m', '', s)
def run(cmd, cwd=None): r = subprocess.run(cmd, cwd=cwd, env=ENV, capture_output=True, text=True); return r.returncode, plain(r.stdout + r.stderr)
def strip(t): t = re.sub(r'/\*\$\*/.*?/\*\$\*/', '', t, flags=re.S); t = re.sub(r'\b([A-Za-z_$][\w$]*?)\$given\b', r'\1', t); return re.sub(r'\b([A-Za-z_$][\w$]*?)\$as[A-Z]\w*\b', r'\1', t)
def printed(path, cwd): r = subprocess.run([BUN, 'build', '--no-bundle', '--target=bun', path], cwd=cwd, capture_output=True, text=True); return [l for l in r.stdout.split('\n') if l.strip()]
bad = 0; laid = []
def say(ok, package, gate, text):
    global bad
    if not ok: bad += 1
    print('%-4s %-42s %-7s %s' % ('ok' if ok else 'FAIL', package, gate, text))
if os.path.exists(OUT): sys.exit('check.py: %s stands already: name another folder (nothing is ever removed here)' % OUT)
os.makedirs(OUT + '/work'); os.makedirs(OUT + '/laid')
for d in ('react', 'react-dom', 'react-reconciler', 'scheduler', 'seroval', 'fuse.js', '@anthropic-ai/sdk', '@types', 'csstype', 'undici-types'):
    if os.path.isdir(N + '/' + d): shutil.copytree(N + '/' + d, OUT + '/node_modules/' + d, symlinks=True)
for p in P:
    n = p['name']
    if opts.get('only') and opts['only'] not in n: continue
    src = os.environ['SHIP_PACKAGES'] + '/' + n if os.environ.get('SHIP_PACKAGES') else H + '/packages/' + n if os.path.isdir(H + '/packages/' + n) else H + '/' + SRC[n]; npm = N + '/' + p['npm']; TX = p.get('text', 'typed.cts'); EXT = ('mjs', 'mts') if p['form'] == 'esm' else ('cjs', 'cts')  # SHIP_PACKAGES: sabotage.py's copies
    if not os.path.exists(src + '/' + TX): continue  # a text that is held back is not in the repository's form
    if not os.path.exists(npm): print('--   %-42s         not in this node_modules' % n); continue
    if p.get('versions'): p['md5'] = next((h for h in p['versions'].values() if h == md5(npm)), 'none of this family'); VERSION = next((v for v, h in p['versions'].items() if h == md5(npm)), None)
    if p.get('versions') and VERSION is None: continue
    if md5(npm) != p['md5']: print('--   %-42s md5     %s is %s: the text was typed on %s: another version: tools/carry_over.py carries the types over; then every gate again' % (n, p['npm'], md5(npm)[:8], p['md5'][:8])); continue
    say(True, n, 'md5', p['md5'][:8] + (' (%s of the family)' % VERSION if p.get('versions') else '')); W = OUT + '/work/' + n; shutil.copytree(src, W)
    if p.get('versions') and VERSION != p['token']: x = open(W + '/' + TX).read(); open(W + '/' + TX, 'w').write(x.replace('"' + p['token'] + '"', '"' + VERSION + '"').replace('react-dom:  ' + p['token'], 'react-dom:  ' + VERSION))
    c, t = run([SEMA, 'cli', TX, '--noEmit', '--all'], W); say('No type errors' in t, n, 'errors', 'none' if 'No type errors' in t else (re.search(r'Found [\d,]+ errors?', t) or ['NO VERDICT'])[0])
    os.makedirs(W + '/verify'); shutil.copy(npm, W + '/verify/a.' + EXT[0]); open(W + '/verify/b.' + EXT[1], 'w').write(strip(open(W + '/' + TX).read())); a, b = printed('a.' + EXT[0], W + '/verify'), printed('b.' + EXT[1], W + '/verify')
    say(bool(b) and a == b, n, 'verify', 'the typed text is npm\'s program (%d printed lines)' % len(a) if b and a == b else 'DIFFERS at printed line %d' % (next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b))) + 1))
    if p['form'] == 'esm': c, t = 0, 'splits1: no variable has a second role in this text (not minified): 0 variants\nsplits1: nothing to prove: 0 captured' if not re.search(r'\$as[A-Z]|\$given\b', open(W + '/' + TX).read()) else 'splits1: A DEVICE STANDS IN A TEXT THAT IS SAID TO HAVE NONE\nsplits1: FAIL'
    else: c, t = run([sys.executable, '-I', T + '/splits1.py', W + '/typed.cts', W + '/splits', SEMA])
    last = t.strip().split('\n')[-1]; first = t.strip().split('\n')[0]; say(c == 0 and '0 captured' in last, n, 'splits', first.replace('splits1: ', '') + ' · ' + last.replace('splits1: ', ''))
    v = re.search(r'(\d+) variants', first); say(bool(v) and p['due']['variants'] in (None, int(v.group(1))), n, 'counts', 'variants %s (due %s) · as any %d · : any %d · as unknown as %d · other casts %d · ! %d' % ((v.group(1) if v else '?', p['due']['variants']) + (lambda x: (len(re.findall(r'\bas any\b', x)), len(re.findall(r':\s*any\b', x)), len(re.findall(r'as unknown as', x)), len(re.findall(r'\bas (?!any\b|unknown\b)[A-Z]', x)), len(re.findall(r'[\w)\]]!(?=[.\[(,;) ])', x))))(open(W + '/' + TX).read())))
    c6, t6 = run([sys.executable, '-I', T + '/declare_fields.py', W + '/' + TX, '--check']); say(not c6, n, 'fields', t6.strip().replace('declare_fields: ', ''))
    L = OUT + '/laid/' + n; os.makedirs(L); formed = L + '/' + os.path.basename(p['lay'])
    if p['form'] == 'reconciler':
        c1, t1 = run([sys.executable, '-I', T + '/module_form8.py', W + '/typed.cts', W + '/formed.ts', '--opaque=index'])
        c2, t2 = run([sys.executable, '-I', T + '/given2.py', W + '/formed.ts', W + '/given.ts', '--mode=any', '--doors=any', '--live=' + LIVE + ('' if ELEMENTS == 'plain' else ',ReactElement')])
        if ELEMENTS == 'plain': shutil.copy(W + '/given.ts', formed); c3, t3 = 0, 'elements are given (plain)'
        else: c3, t3 = run([sys.executable, '-I', T + '/share_elements1.py', W + '/given.ts', formed, '--react=../../react'])
        say(not (c1 or c2 or c3) and 'yes' in t1, n, 'form', t1.strip()[-60:] + ' · ' + t2.strip()[:70] + ' · ' + t3.strip()[:70])
    elif p['form'] == 'esm': c1, t1 = run([sys.executable, '-I', T + '/form_esm1.py', W + '/' + TX, formed]); say(not c1 and 'yes' in t1, n, 'form', t1.strip()[-110:])
    else:
        c1, t1 = run([sys.executable, '-I', T + '/module_form8.py', W + '/typed.cts', formed]); say(not c1 and 'yes' in t1, n, 'form', t1.strip()[-110:])
    shutil.move(formed, W + '/formed.with.notes.ts'); c4, t4 = run([sys.executable, '-I', T + '/clean_lay.py', W + '/formed.with.notes.ts', formed]); say(not c4, n, 'clean', t4.strip()[-90:])
    if p.get('held') and not (opts.get('only') and opts['only'] in n): print('--   %-42s laid    %s' % (n, p['held'])); continue
    if p.get('changed'):  # Apache-2.0 4(b): "You must cause any modified files to carry prominent notices stating that You changed the files": on the first line, which is blank (a reference stood there): no line moves
        x = open(formed).read(); say(x.startswith('\n'), n, 'changed', 'the file says on its first line that it was changed'); open(formed, 'w').write(p['changed'] + x)
    shutil.copy(formed, OUT + '/node_modules/' + p['lay']); laid.append((n, p['lay']))
    for f, text in p['entries'].items():
        if p['form'] == 'esm': open(OUT + '/node_modules/' + f, 'w').write(text + '\n'); continue  # the package is ES modules already
        c5, t5 = run([sys.executable, '-I', T + '/cjs_entry.py', N + '/' + f, OUT + '/node_modules/' + f, os.path.basename(p['lay'])[:-3]]); tail = [l[2:] for l in open(formed).read().split('\n') if re.match(r'//(module\.exports\.default = module\.exports;|Object\.defineProperty\(module\.exports, "__esModule")', l)]
        if tail: open(OUT + '/node_modules/' + f, 'a').write('\n'.join(tail) + '\n')  # what the bundle's own last lines do to module.exports, and the form had to leave out of an ES module, is done here, to the same function
        say(not c5, n, 'entry', '%s: %s%s' % (f, t5.strip()[-90:], ' · + the bundle\'s %d lines on module.exports' % len(tail) if tail else ''))
    if p['form'] == 'reconciler':
        for f, (js, h, ts, entry, text) in SMALL.items():
            if f == 'react-jsx-runtime.ts' and ELEMENTS == 'plain': continue
            ok = os.path.exists(N + '/' + js) and md5(N + '/' + js) == h; say(ok, n, 'md5', '%s %s' % (js, h[:8]))
            if ok:
                os.makedirs(W + '/small.' + f); shutil.copy(N + '/' + js, W + '/small.' + f + '/a.cjs'); small = src + '/small/' + f if os.path.exists(src + '/small/' + f) else H + '/react/19.2.0/src/' + f; shutil.copy(small, L + '/' + f); shutil.copy(small, OUT + '/node_modules/' + ts); c5, t5 = run([sys.executable, '-I', T + '/cjs_entry.py', N + '/' + entry, OUT + '/node_modules/' + entry, os.path.basename(ts)[:-3]]); say(not c5, n, 'entry', '%s: %s' % (entry, t5.strip()[-90:])); laid.append((n, ts))
for p in MANY:
    n = p['name'] + '@' + p['version']; src = os.environ['SHIP_PACKAGES'] + '/' + p['folder'] if os.environ.get('SHIP_PACKAGES') else H + '/packages/' + p['folder'] if os.path.isdir(H + '/packages/' + p['folder']) else H + '/' + p['src']; I = N + '/' + p['name']; Z = OUT + '/node_modules/' + p['name']
    if (opts.get('only') and opts['only'] not in n) or not os.path.isdir(src): continue
    if not os.path.isdir(I): print('--   %-42s         not in this node_modules' % n); continue
    off = [f for f, h in p['files'].items() if not os.path.exists(I + '/' + f + '.mjs') or md5(I + '/' + f + '.mjs') != h]
    if off: print('--   %-42s md5     %s.mjs is not the file the text was typed on: another version' % (n, off[0])); continue
    say(True, n, 'md5', '%d files' % len(p['files'])); W = OUT + '/work/' + p['folder']; os.makedirs(W + '/verify')
    for k, f in enumerate(sorted(p['files'])):
        x = open(src + '/' + f + '.sound.mts').read(); shutil.copy(I + '/' + f + '.mjs', W + '/verify/a%d.mjs' % k); open(W + '/verify/b%d.mts' % k, 'w').write(strip(x)); a, b = printed('a%d.mjs' % k, W + '/verify'), printed('b%d.mts' % k, W + '/verify')
        say(bool(b) and a == b, n, 'verify', '%s: %s' % (f, 'the typed text is npm\'s program (%d printed lines)' % len(a) if b and a == b else 'DIFFERS'))
        c6, t6 = run([sys.executable, '-I', T + '/declare_fields.py', src + '/' + f + '.sound.mts', '--check']); say(not c6, n, 'fields', f + ': ' + t6.strip().replace('declare_fields: ', ''))
        y = x.replace('/*$*/', ''); turned = 0
        for g in p['files']:
            rel = os.path.relpath(g, os.path.dirname(f)); rel = rel if rel.startswith('.') else './' + rel
            turned += y.count('from "%s.mjs"' % rel); y = y.replace('from "%s.mjs"' % rel, 'from "%s.sound.mts"' % rel)
        open(Z + '/' + f + '.sound.mts', 'w').write(y); open(Z + '/' + f + '.mjs', 'w').write('export * from "./%s.sound.mts";\n' % os.path.basename(f)); say(True, n, 'form', '%s: %d imports turned to typed neighbours' % (f, turned)); laid.append((n, p['name'] + '/' + f + '.sound.mts'))
LIB = {p['name'] + '@' + p['version']: p['lib'] for p in MANY}
have = {l for _, l in laid}
if any('react-dom-server' in l for l in have):
    c5, t5 = run([sys.executable, '-I', T + '/cjs_entry.py', N + '/react-dom/server.bun.js', OUT + '/node_modules/react-dom/server.bun.js'] + [os.path.basename(l)[:-3] for l in sorted(have) if 'react-dom-server' in l]); say(not c5, 'react-dom', 'entry', 'react-dom/server.bun.js: ' + t5.strip()[-150:])
for n, f in laid:
    path = OUT + '/node_modules/' + f; c, t = run([SEMA, 'cli', os.path.basename(f), '--noEmit', '--all', '--strict'] + (['--lib', LIB[n]] if n in LIB else []), os.path.dirname(path)); X = open(path, errors='replace').read().split('\n')
    if not re.search(r'No type errors|Found [\d,]+ error', t): say(False, n, 'laid', f + ': NO VERDICT'); continue
    E = [(m.group(1), m.group(2), int(m.group(3))) for m in re.finditer(r'^error: (TS\d+):.*?\n\s+at (\S+?):(\d+)', t, re.S | re.M)]; total = len(re.findall(r'^error: ', t, re.M))
    over = [e for e in E if e[0] == 'TS7016' and n in LIB or e[1].endswith(os.path.basename(f)) and re.fullmatch(r'import \* as [\w$]+\$module from "[^"]+";', X[e[2] - 1].strip())]  # a module of the package that ships no declarations (tslib.mjs) is `any`
    say(total == len(over), n, 'laid', '%s: %d errors%s' % (f, total - len(over), ' (+ %d on appended imports, passed over: %s)' % (len(over), ' '.join(sorted({e[0] for e in over}))) if over else ''))
# 10. lax: A HOST THAT IS NOT STRICT: noImplicitAny and strictNullChecks reach a package: one error and it is compiled untyped: every laid file is clean under the three lax sets too
for n, f in laid:
    path = OUT + '/node_modules/' + f; counts = []
    for name, fl in (('noImplicitAny false', ['--strict', '--noImplicitAny=false']), ('strictNullChecks false', ['--strict', '--strictNullChecks=false']), ('strict false', ['--strict=false'])):
        c, t = run([SEMA, 'cli', os.path.basename(f), '--noEmit', '--all'] + fl + (['--lib', LIB[n]] if n in LIB else []), os.path.dirname(path)); counts.append((name, len([m for m in re.findall(r'^error: (TS\d+)', t, re.M) if m not in ('TS7016', 'TS2591', 'TS2307')]) if re.search(r'No type errors|Found [\d,]+ error', t) else -1))
    say(not any(k for _, k in counts), n, 'lax', '%s: %s' % (os.path.basename(f), ' · '.join('%s %d' % x for x in counts)))
# 9. same: IN THE REPOSITORY's FORM: what src/ gives today IS what lay/ holds, byte for byte, and sound.json's sums are the installed files'
import json
for pkg in sorted({'/'.join(f.split('/')[:2 if f.startswith('@') else 1]) for _, f in laid}):
    for v in sorted(os.listdir(H + '/' + pkg)) if os.path.isdir(H + '/' + pkg) else []:
        D = H + '/' + pkg + '/' + v
        if not os.path.exists(D + '/sound.json') or json.load(open(N + '/' + pkg + '/package.json'))['version'] != v: continue
        S = json.load(open(D + '/sound.json')); sha = lambda q: hashlib.sha256(open(q, 'rb').read()).hexdigest()
        sums = dict(reversed(l.split('  ', 1)) for l in open(D + '/lay.sums').read().split('\n') if l) if os.path.exists(D + '/lay.sums') else None  # a version of a family keeps no lay/ in the tree (it is made at publish time from the family's src/): its lay.sums pins what must come out
        wrong = [f for f in S['lay'] if not os.path.exists(OUT + '/node_modules/' + pkg + '/' + f) or (sha(OUT + '/node_modules/' + pkg + '/' + f) != sums.get(f) if sums is not None else open(D + '/lay/' + f, 'rb').read() != open(OUT + '/node_modules/' + pkg + '/' + f, 'rb').read())]
        wrong += [f for f, h in list(S['lay'].items()) + list(S['basis'].items()) if (h == 'new') == os.path.exists(N + '/' + pkg + '/' + f) or h != 'new' and sha(N + '/' + pkg + '/' + f) != h]
        say(not wrong, pkg + '@' + v, 'same', ('lay.sums' if sums is not None else 'lay/') + ' is what src/ gives (%d files); the sums are the installed files\' (%d)' % (len(S['lay']), len(S['lay']) + len(S['basis'])) if not wrong else 'DIFFERS: ' + ' '.join(wrong[:4]))
print('check.py: %s · elements %s · the tree to build on: %s/node_modules' % ('EVERY GATE PASSES' if not bad else '%d GATES FAIL' % bad, ELEMENTS, OUT)); sys.exit(1 if bad else 0)
