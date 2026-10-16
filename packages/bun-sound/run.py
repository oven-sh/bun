#!/usr/bin/env python3
"""run.py build | answers <a whole Bun that knows --aot> <node_modules> <out folder> [--elements=shared|plain]: THE HALF THAT RUNS: THE WIDE TREES: a gate of CORRECTNESS for the typed texts, not a measure.
`build` RUNS NO PACKAGE CODE: it calls check.py (every static gate; <out>/node_modules is the typed tree) and builds, for each tree whose packages <node_modules> holds: untyped (your node_modules as it is) · typed · typed.audit (BUN_JSC_auditAOTTypedAssertions=1 at the build: what contradicts a type is REPORTED on stderr and the program goes on).
THE AUDIT IS SEEN TO SPEAK BEFORE ITS SILENCE COUNTS: trees/lie/lie.ts (five lines of our own; a string where its type says number) is built as the audit's column is and run by `answers`: it must print an `AOT:` line and go on. (From 10-14 04:06 to 09:4x the option went by BUN_AOT_OPTIONS, a name that nothing read any more: the column was a second `typed` and its gate passed by saying nothing.)
`answers` RUNS THEM, AND THE SAME SOURCE PLAINLY (`bun wide.tsx` on the untouched packages, twice: the tree must be determinate), and compares scenario by scenario (a scenario begins with a line `== name`; each runs inside a try, so ONE RUN NAMES EVERY MINE).
  trees/client/wide.tsx  27 scenarios, 55 heads: react + react-reconciler on a host of its own (host2.ts): 24 + react's own API
  trees/server/wide.tsx  26 scenarios, run twice (52 heads): react-dom/server's Bun bundle, then every scenario once more through the legacy bundle (`"" string`)
DUE: the lie is reported · plain: 0 THREW, the same text twice · every column: 0 heads differ · no `AOT:` line in an audit but the trees' own (said below).
IT WANTS check.py's ENVIRONMENT (SEMA, BUN, BUN_SEMA_TS_LIB). EXIT 1 IF ANYTHING IS NOT AS DUE."""
import json, os, re, shutil, subprocess, sys
H = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith('--')]; flags = [a for a in sys.argv[1:] if a.startswith('--')]
if len(args) < 4: sys.exit(__doc__)
STEP, AOT, N, OUT = args[0], os.path.abspath(args[1]), os.path.abspath(args[2]), os.path.abspath(args[3])
ENV = dict(os.environ, NO_COLOR='1', BUN_ENABLE_CRASH_REPORTING='0', NODE_ENV='production', TZ='America/Los_Angeles')
AUDIT = {'BUN_JSC_auditAOTTypedAssertions': '1'}
TREES = {'client': (['react', 'react-reconciler', 'scheduler'], [[]]), 'server': (['react', 'react-dom'], [[], ['', 'string']])}
# A MARKED TREE IS THREE PROGRAMS OUT OF ONE FILE (the compiler judges the whole program: one `fromJSON(JSON.parse(..))` makes every node outside data and no layout is left to test): as it is · born: what stands between /*C*/ marks is cut out: nothing comes in from outside · doors: what stands between /*D*/ marks becomes `import { carry } from "./carried.js"` (an untyped file behind `carry<T>(x: T): T`) and what stands between /*L*/ marks is cut: the layouts stay AND plain data reaches every door
MARKED = {'seroval': ['seroval'], 'fuse': ['fuse.js']}
for name, needs in MARKED.items():
    for v in ('', '.born', '.doors'): TREES[name + v] = (needs, [[]])
TREES['sdk'] = (['@anthropic-ai/sdk'], [[]])
FILE = lambda tree: 'wide.ts' if tree.split('.')[0] in MARKED or tree == 'sdk' else 'wide.tsx'
def cut(tree, text):
    if tree.endswith('.born'): return re.sub(r'/\*C\*/.*?/\*C\*/', '', text, flags=re.S)
    if tree.endswith('.doors'): return re.sub(r'/\*L\*/.*?/\*L\*/', '', re.sub(r'/\*D\*/.*?/\*D\*/', 'import { carry } from "./carried.js";', text, flags=re.S), flags=re.S)
    return text
SEROVAL_OPEN = 'Sequence Stream AsyncParsePluginContext DeserializePluginContext SerializePluginContext StreamParsePluginContext SyncParsePluginContext Serializer SerovalNode ObjectRecord MapRecord'  # a plugin is handed the contexts and hands nodes back: serialize(node), onParse(node)
FACTS = {  # tree -> the package it judges and the pins (a percent, a ratio, the named records that may admit foreign objects); `by`: by the installed version where a tree serves several. Two points down, or a tenth more bytes, fails
    'client': dict(of='react-reconciler', offset=87.0, bytes=0.95, opened='ActionStateQueue ActionStateQueueNode Cache CacheComponentState CapturedValue CaughtErrorInfo ConcurrentQueue ConcurrentUpdate ContextDependency Dependencies Effect ErrorInfo EventFunctionPayload Fiber FiberRoot FunctionComponentUpdateQueue Hook HookQueue HookUpdate HostNode HostText MemoCache OffscreenInstance OffscreenQueue OffscreenState PortalState ReactPortal RootState Selector SharedQueue SpawnedCachePool StoreConsistencyCheck StoreInstance SuspenseListRenderState SuspenseState TreeContext Update UpdateQueue', strangers='AbortSignalLike AsyncDispatcher Dispatcher EffectInstance EventFunctionRef OffscreenProps'),
    'server': dict(of='react-dom', strangers='ComponentIdentity Ping RefObject PostponedHoles FormatContext ResumableState StylesheetResource ViewTransitionContext', by={'19.3.': dict(offset=47.7, bytes=1.002), '19.2.': dict(offset=48.3, bytes=0.99), '19.1.': dict(offset=64.0, bytes=0.965), '19.0.': dict(offset=62.7, bytes=0.968)}),
    'seroval.born': dict(of='seroval', offset=68.3, bytes=0.96, strangers=SEROVAL_OPEN), 'seroval.doors': dict(of='seroval', offset=68.3, bytes=0.967, strangers=SEROVAL_OPEN),
    'fuse.born': dict(of='fuse.js', offset=59.8, bytes=1.064, strangers='ArrayEntry Book IndexRecord RecordEntry FuseIndex FuseOptionKeyObject<Book> FuseOptionKeyObject<Row> FuseOptionKeyObject<string> FuseSearchOptions FuseSortFunctionArg FuseSortFunctionMatch FuseSortFunctionMatchList IndexOptions QueryNode'), 'fuse.doors': dict(of='fuse.js', offset=59.8, bytes=1.068, strangers='ArrayEntry Book IndexRecord RecordEntry FuseIndex FuseOptionKeyObject<Book> FuseOptionKeyObject<Row> FuseOptionKeyObject<string> FuseSearchOptions FuseSortFunctionArg FuseSortFunctionMatch FuseSortFunctionMatchList IndexOptions QueryNode'),
    'sdk': dict(of='@anthropic-ai/sdk', strangers='', by={'0.112.': dict(receiver=35.9, read=35.3, bytes=1.29), '0.128.': dict(receiver=35.8, read=35.3, bytes=1.015)}),
}
if os.environ.get('BUN_SOUND_PINS'):  # more pins, kept in a file outside the repository: { tree: { key: value } }
    for tree, more in json.load(open(os.environ['BUN_SOUND_PINS'])).items(): FACTS[tree].update(more)
def pins(tree):
    due = FACTS[tree]
    return dict(due, **next((x for v, x in due.get('by', {}).items() if json.load(open(N + '/' + due['of'] + '/package.json'))['version'].startswith(v)), {}))
ENTRIES = (('react-reconciler', 'react-reconciler'), ('react-compiler-runtime', 'react'), ('react-dom-server', 'react-dom'), ('seroval', 'seroval'), ('fuse', 'fuse.js'))
KNOWN = {'server': [r"AOT: Coerce at <anonymous> \(wide\.tsx:\d+:\d+\): 'as Function' left untyped object unchanged", r"AOT: Coerce at UNSAFE_componentWillMount \(wide\.tsx:\d+:\d+\): 'as \{ enqueueReplaceState \}' left untyped object unchanged"], 'client': [r"AOT: Coerce at <anonymous> \(wide\.tsx:\d+:\d+\): 'as \{ defaultProps \}' left function D unchanged", r"AOT: Claim at Counted \(wide\.tsx:\d+:\d+\): expected \{ id, children \}, got untyped object; .*",
    # React's OWN DATA MODEL: a root's state is born a RootState (createFiberRoot: laid out) AND IS REPLACED AT THE FIRST UPDATE BY `assign({}, prevState, payload)` (getStateFromUpdate): a plain object with the same three members: `memoizedState as RootState` leaves it as it is: true, harmless, three reads by the general way a root's render
    r"AOT: Coerce at (attemptEarlyBailoutIfNoScheduledUpdate|beginWork|completeWork) \(\S*react-reconciler\.production\.ts:\d+:\d+\): 'as RootState' left untyped object unchanged"]}  # the trees' own casts, and what is known and said
# React CALLS A COMPONENT WITHOUT ARGUMENTS to learn its stack frame (describeNativeComponentFrame) and catches the TypeError: a component that takes its props apart is handed undefined: said by the audit, true, harmless
for tree in ('server', 'client'): KNOWN[tree].append(r"AOT: Claim at [A-Z]\w* \(wide\.tsx:\d+:\d+\): expected \{ \w+ \}, got undefined")
# fuse.js: an index that comes in from outside (Fuse.parseIndex of what JSON carried; malformed ones too) holds plain objects where the text's own index holds IndexRecords: each is read as it is, by the general way: said by the audit, true, and the answers are plain's
FUSE = [r"AOT: (Claim|GetById) at <anonymous> \(\S*fuse\.sound\.ts:\d+:\d+\): expected (IndexRecord \| undefined|object), got .*", r"AOT: Coerce at <anonymous> \(wide\.ts:\d+:\d+\): 'as \{ \$ \}' left untyped object unchanged"]
FUSE.append(r"AOT: Store at \w+ \(\S*fuse\.sound\.ts:\d+:\d+\): expected Fuse, got native ProxyObject; a native object cannot (become|be used as) Fuse")  # scenario 18: a Proxy over an instance as the receiver of its methods: handed to the second body: the answers are plain's
KNOWN['fuse'] = KNOWN['fuse.doors'] = KNOWN['fuse.born'] = FUSE
UNTYPED_RED = dict.fromkeys(('fuse', 'fuse.born', 'fuse.doors'), 'the untyped --aot build of untouched fuse.js 7.0.0 aborts in scenario 03 (includeMatches with a key through an array): "panic(main thread): abort() called": the compiler\'s fault; the typed build and plain Bun are fine')
KNOWN_RED = {  # a head that is red TODAY, in the typed columns, WITH ITS REASON: it is printed every time; the day it is green the run says so and it comes off this list
}
bad = 0
def fail(s):
    global bad
    bad += 1; print('FAIL ' + s)
if STEP == 'build':
    r = subprocess.run([sys.executable, H + '/check.py', N, OUT] + flags, env=ENV);
    if r.returncode: sys.exit('run.py: the static gates fail: nothing is built')
    shutil.copytree(H + '/trees/lie', OUT + '/rooms/lie')
    subprocess.run([AOT, 'build', '--compile', '--aot', '--target=bun', 'lie.ts', '--outfile', OUT + '/rooms/lie/lie'], cwd=OUT + '/rooms/lie', env=dict(ENV, **AUDIT), capture_output=True, stdin=subprocess.DEVNULL)
    for tree, (needs, _) in TREES.items():
        if not all(os.path.isdir(N + '/' + p) for p in needs): print('--   %s: not in this node_modules: %s' % (tree, ' '.join(p for p in needs if not os.path.isdir(N + '/' + p)))); continue
        for column, modules, options in (('untyped', N, {}), ('typed', OUT + '/node_modules', {}), ('typed.audit', OUT + '/node_modules', AUDIT)):
            R = '%s/rooms/%s/%s' % (OUT, tree, column); os.makedirs(R)
            for f in os.listdir(H + '/trees/' + tree.split('.')[0]):
                if f.startswith('carried.') and not tree.endswith('.doors'): continue
                shutil.copy(H + '/trees/' + tree.split('.')[0] + '/' + f, R)
            if tree.split('.')[0] in MARKED: x = open(R + '/wide.ts').read(); open(R + '/wide.ts', 'w').write(cut(tree, x))
            if tree == 'server':  # AN OLDER VERSION's ENTRY EXPORTS FEWER NAMES (19.2.x under the `bun` condition: no renderToPipeableStream, no resumeToPipeableStream; `resume` is undefined): npm's CommonJS entry gives undefined for a name it lacks, an ES module entry stops the build: the tree takes such a name as undefined IN EVERY COLUMN AND IN THE PLAIN RUN, and the scenarios that call it throw alike
                x = open(R + '/wide.tsx').read(); lacks = []
                for module, f in (('react', 'react/cjs/react.production.js'), ('react-dom', 'react-dom/cjs/react-dom.production.js'), ('react-dom/server', 'react-dom/server.bun.js'), ('react-dom/static', 'react-dom/static.node.js')):
                    E = set(re.findall(r'^exports\.(\w+) = ', open(N + '/' + f).read(), re.M)); m = re.search(r'^import \{([^}]*)\} from "%s";$' % module, x, re.M)
                    names = [k.strip() for k in m.group(1).replace('\n', ' ').split(',') if k.strip()]; gone = [k for k in names if not k.startswith('type ') and k not in E]
                    if gone: x = x.replace(m.group(0), 'import { %s } from "%s"; var %s;' % (', '.join(k for k in names if k not in gone), module, ', '.join('%s: typeof import("%s").%s' % (k, module, k) for k in gone))); lacks += gone
                if lacks: open(R + '/wide.tsx', 'w').write(x); open(R + '/../lacks.txt', 'w').write(' '.join(lacks))
            os.symlink(modules, R + '/node_modules')
            if modules != N and os.path.isdir(OUT + '/sound'): shutil.copytree(OUT + '/sound', R + '/.sound')  # what is typed where it lies
            counted = column == 'typed' and tree in FACTS
            listed = column == 'typed.audit' and tree in FACTS  # one --aot-explain a build: the audit's build, which is made anyway, carries the second
            b = subprocess.run([AOT, 'build', '--compile', '--aot'] + (['--aot-explain=given'] if counted else ['--aot-explain=foreign'] if listed else []) + ['--target=bun', '--define', 'process.env.NODE_ENV="production"', FILE(tree), '--outfile', R + '/wide'], cwd=R, env=dict(ENV, **options, BUN_AOT_TYPED_SNAPSHOT=R + '/snapshot', BUN_JSC_aotMapFilePath=R + '/map'), capture_output=True, text=True, stdin=subprocess.DEVNULL)
            if listed:  # THE FOURTH MEASURE: WHICH NAMED RECORDS ADMIT FOREIGN OBJECTS: a new name on that list is a layout whose every read got dearer (`Fiber`, once)
                now = set(re.findall(r'^aot: foreign: ([A-Z][\w$<>]*): ', b.stdout + b.stderr, re.M)); opened = set(pins(tree).get('opened', '').split()); new = sorted(now - set(FACTS[tree]['strangers'].split()) - opened)
                # `opened`: A LOSS THAT IS KNOWN AND HAS NO OWNER YET: records that were closed when the package was typed and admit foreign objects on today's compiler: said at every run, so that it is not forgotten; a name more fails
                if opened & now: print('     %s: facts: A KNOWN LOSS: %d records that were closed admit foreign objects: %s (why: --aot-explain=foreign)' % (tree, len(opened & now), ' '.join(sorted(opened & now))))
                laid_out = set(re.findall(r'^shape \d+ \w+ "([^"]+)" ', open(OUT + '/rooms/' + tree + '/typed/ir.txt', errors='replace').read(), re.M))
                lost = sorted(name for name in opened - now if name.split('<')[0] not in laid_out)
                if lost: fail('%s: facts: THESE RECORDS HAVE NO LAYOUT AT ALL: every access to them goes by name: worse than admitting foreign objects: %s' % (tree, ' '.join(lost)))
                if opened - now - set(lost): print('     %s: facts: CLOSED AGAIN: take them off `opened` in run.py: %s' % (tree, ' '.join(sorted(opened - now - set(lost)))))
                if new: fail('%s: facts: THESE RECORDS ADMIT FOREIGN OBJECTS NOW: %s (why: --aot-explain=foreign)' % (tree, ' '.join(new)))
                else: print('ok   %s: facts: no record admits foreign objects that did not (%d do)' % (tree, len(now)))
            if counted:  # FACTS: a typed version can be compiled, give the right answers AND HAVE LOST WHAT IT IS FOR. Twice a change in the compiler did that with every other gate green: an ES entry took the reconciler's layouts (twice the instructions); small records taken for outside data "by their looks" made Fiber admit strangers (+16%). Both were found by a benchmark of an application. THREE MEASURES, ALL THE COMPILER's OWN: at how many property reads it knows the receiver's layout; at how many it knows what is read; and the bytes of the package's compiled bodies, typed over untyped (the image's map)
                due = pins(tree); pkg = due['of']; out = b.stdout + b.stderr
                size = lambda f: sum(int(c[3]) for c in (l.rstrip('\n').split('\t') for l in open(f, errors='replace') if l.startswith('F\t')) if len(c) > 10 and ('/' + pkg + '/') in c[10]) if os.path.exists(f) else 0  # an F line of the map: a body: its size in column 4, its file in column 11 (a linked node_modules shows its real path)
                # BY THE PACKAGE's OWN FUNCTIONS: what --aot-explain=given counts is the whole program, and Bun's own built-in modules are part of it: as they got types the two percents of every tree fell by four points and nothing had been lost
                open(R + '/ir.txt', 'w').write(subprocess.run([os.environ['SEMA'], 'cli', FILE(tree), '--snapshot=snapshot', '--aot'], cwd=R, env=ENV, capture_output=True, text=True, errors='replace', stdin=subprocess.DEVNULL).stdout)
                m = re.search(r': \d+ of [1-9]\d* \(([\d.]+)%\)', subprocess.run([sys.executable, H + '/tools/facts.py', R + '/ir.txt', pkg], capture_output=True, text=True).stdout)
                got = {'offset': float(m.group(1)) if m else None}
                u = size(OUT + '/rooms/' + tree + '/untyped/map'); got['bytes'] = round(size(R + '/map') / u, 3) if u else None
                worse = [k for k in got if got[k] is None or k in due and (got[k] < due[k] - 2 if k != 'bytes' else got[k] > due[k] * 1.1)]
                better = [k for k in got if got[k] is not None and k in due and (got[k] > due[k] + 2 if k != 'bytes' else got[k] < due[k] * 0.9)]
                line = '%s: facts: %s: %s%% of the reads and stores of a property in its own functions go by offset (due %s) · its compiled bodies: typed / untyped bytes %s (due %s)' % (tree, pkg, got['offset'], due.get('offset'), got['bytes'], due.get('bytes'))
                if worse: fail(line + ' · WORSE: ' + ' '.join(worse) + ': THE TYPED VERSION HAS LOST FACTS ON THIS COMPILER (which records: tools/facts.py)')
                else: print('ok   ' + line + (' · BETTER THAN PINNED: ' + ' '.join(better) + ': raise FACTS in run.py' if better else ''))
            open(R + '/build.txt', 'w').write(b.stdout + b.stderr)
            if 'TS100009' in b.stdout + b.stderr: fail('%s %s: a typed package has fallen: %s' % (tree, column, re.search(r'.*TS100009.*', b.stdout + b.stderr).group(0)[:200]))
            if os.access(R + '/wide', os.X_OK): print('ok   %s %s: built: %d B' % (tree, column, os.path.getsize(R + '/wide')))
            else: fail('%s %s: NOT BUILT: %s' % (tree, column, ' '.join(re.findall(r'.*(?:error|not compiled).*', b.stdout + b.stderr)[:3])[:300]))
    # THE ENTRIES: what each laid door is to its importers: typed against untyped, both --aot; control = `bun build --compile` WITHOUT --aot on the untouched packages, shown as a note (`bun run` stops on a name that a CommonJS entry lacks: a bundle reads undefined)
    for stem, pkg in ENTRIES:
        if not os.path.isdir(N + '/' + pkg): continue
        for column, modules, flags2 in (('control', N, []), ('untyped', N, ['--aot']), ('typed', OUT + '/node_modules', ['--aot'])):
            R = '%s/rooms/entries/%s/%s' % (OUT, stem, column); os.makedirs(R)
            for f in os.listdir(H + '/trees/entries'): shutil.copy(H + '/trees/entries/' + f, R)
            os.symlink(modules, R + '/node_modules')
            if modules != N and os.path.isdir(OUT + '/sound'): shutil.copytree(OUT + '/sound', R + '/.sound')
            b = subprocess.run([AOT, 'build', '--compile'] + flags2 + ['--target=bun', '--define', 'process.env.NODE_ENV="production"', stem + '.ts', '--outfile', R + '/entry'], cwd=R, env=ENV, capture_output=True, text=True, stdin=subprocess.DEVNULL); open(R + '/build.txt', 'w').write(b.stdout + b.stderr)
            if not os.access(R + '/entry', os.X_OK): fail('entries %s %s: NOT BUILT: %s' % (stem, column, ' '.join(re.findall(r'.*(?:error|not compiled).*', b.stdout + b.stderr)[:3])[:300]))
elif STEP == 'answers':
    lie = subprocess.run([OUT + '/rooms/lie/lie'], cwd=OUT + '/rooms/lie', env=ENV, capture_output=True, text=True, errors='replace', stdin=subprocess.DEVNULL) if os.access(OUT + '/rooms/lie/lie', os.X_OK) else None
    said = [l for l in lie.stderr.split('\n') if l.startswith('AOT: ')] if lie else []
    if lie and not lie.returncode and said and 'went on' in lie.stdout: print('ok   the audit speaks: %s' % said[0][:150])
    else: fail('THE AUDIT SAYS NOTHING OF A LIE: EVERY typed.audit BELOW IS VOID: trees/lie/lie.ts: %s' % ('exit %d: %s' % (lie.returncode, (lie.stderr.strip().split('\n') or [''])[-3:]) if lie else 'no executable'))
    for stem, pkg in ENTRIES:
        base = '%s/rooms/entries/%s' % (OUT, stem)
        if not os.path.isdir(base): continue
        got = {c: subprocess.run([base + '/' + c + '/entry'], cwd=base + '/' + c, env=ENV, capture_output=True, text=True, errors='replace', stdin=subprocess.DEVNULL) if os.access(base + '/' + c + '/entry', os.X_OK) else None for c in ('control', 'untyped', 'typed')}
        ran = lambda c: got[c] is not None and got[c].returncode == 0
        same = ran('typed') and ran('untyped') and got['typed'].stdout == got['untyped'].stdout
        print('%s entries %s: typed %s' % ('ok  ' if same else 'FAIL', stem, 'says what untyped says (%d lines)' % got['typed'].stdout.count('\n') if same else 'DIFFERS FROM untyped'))
        if not same:
            bad += 1
            for x, y in zip((got['typed'].stdout + got['typed'].stderr if got['typed'] else '(no executable)').split('\n'), (got['untyped'].stdout + got['untyped'].stderr if got['untyped'] else '(no executable)').split('\n')):
                if x != y: print('          typed:   %s\n          untyped: %s' % (x[:230], y[:230]))
        if ran('control') and ran('untyped') and got['control'].stdout != got['untyped'].stdout: print('     entries %s: a note, not the set\'s matter: --aot and the plain bundle differ ON THE UNTOUCHED PACKAGE in %d lines (the bundle\'s require() of a module that is also imported hangs a `default` on it)' % (stem, sum(x != y for x, y in zip(got['control'].stdout.split('\n'), got['untyped'].stdout.split('\n')))))
    def heads(text):
        out = {}; order = []; h = None
        for l in text.split('\n'):
            if l.startswith('== '):
                h = l
                while h in out: h += ' (once more)'  # a tree that is run in two turns says each head twice: BOTH are compared
                order.append(h); out[h] = []
            elif h is not None: out[h].append(l)
        return order, out
    for tree, (_, turns) in TREES.items():
        base = '%s/rooms/%s' % (OUT, tree)
        if not os.path.isdir(base): continue
        def go(cmd, cwd):
            o = e = ''; code = 0
            for extra in turns: r = subprocess.run(cmd + extra, cwd=cwd, env=ENV, capture_output=True, text=True, errors='replace', stdin=subprocess.DEVNULL); o += r.stdout; e += r.stderr; code += abs(r.returncode)
            return o, e, code
        p1, pe, pc = go([AOT, FILE(tree)], base + '/untyped'); p2, _, _ = go([AOT, FILE(tree)], base + '/untyped'); order, want = heads(p1); known = [h for h in order if re.match(r'== 9[89] ', h)]; order = [h for h in order if h not in known]
        lacks = open(base + '/lacks.txt').read() if os.path.exists(base + '/lacks.txt') else ''
        if lacks: print('     %s: this version\'s entry lacks: %s: the scenarios that call them throw, in the plain run as in every column' % (tree, lacks))
        print('%s %s plain: exit %d · %d heads · %d THREW · a second time: %s' % ('ok  ' if not pc and p1 == p2 and ('THREW' not in p1 or lacks) else 'FAIL', tree, pc, len(order), p1.count('THREW'), 'the same text' if p1 == p2 else 'ANOTHER TEXT: THE TREE IS NOT DETERMINATE'))
        if pc or p1 != p2 or 'THREW' in p1 and not lacks: bad += 1
        for column in ('untyped', 'typed', 'typed.audit'):
            R = base + '/' + column
            if not os.access(R + '/wide', os.X_OK): fail('%s %s: no executable' % (tree, column)); continue
            o, e, code = go([R + '/wide'], R); open(R + '/answers.txt', 'w').write(o); open(R + '/answers.err', 'w').write(e); got_order, got = heads(o)
            differ = [h for h in order if got.get(h) != want[h]] + [h for h in got_order if h not in want]
            for h in known: print('     %s %s: %s: %s' % (tree, column, h[:90], 'THE SAME AS PLAIN TODAY' if got.get(h) == want[h] else 'differs, as known'))
            for (tr, prefix), why in KNOWN_RED.items():
                if tr == tree and column != 'untyped':
                    red = [h for h in differ if h.startswith(prefix)]; differ = [h for h in differ if not h.startswith(prefix)]
                    print('     %s %s: %s' % (tree, column, 'KNOWN RED: %s: %s' % (' | '.join(red), why) if red else 'A HEAD THAT WAS KNOWN RED IS GREEN: `%s..`: TAKE IT OFF run.py\'s LIST' % prefix))
            lines = sorted(set(l for l in e.split('\n') if l.startswith('AOT: ') and not l.startswith('AOT count') and not any(re.fullmatch(k, l) for k in KNOWN.get(tree, []))))
            if tree.split('.')[0] in MARKED and not tree.endswith('.born') and lines: print('     %s %s: %d kinds of audit lines: plain data reaches the doors in this program: each is read as it is: said, not counted (the born program must be silent)' % (tree, column, len(lines))); lines = []
            if column == 'untyped' and tree in UNTYPED_RED and (differ or code): print('     %s untyped: KNOWN RED, NOT THE SET\'s: %s' % (tree, UNTYPED_RED[tree])); continue
            ok = not differ and not code and not lines
            print('%s %s %s: exit %d · %d of %d heads differ from the plain run%s' % ('ok  ' if ok else 'FAIL', tree, column, code, len(differ), len(order), ' · %d kinds of audit lines' % len(lines) if lines else ''))
            if not ok: bad += 1
            for h in differ[:12]:
                a, b = got.get(h, ['(no such head)']), want.get(h, ['(no such head)']); i = next((i for i in range(max(len(a), len(b))) if (a[i:i + 1] or ['']) != (b[i:i + 1] or [''])), 0)
                print('       %s\n          here:  %s\n          plain: %s' % (h, (a[i:i + 1] or [''])[0][:190], (b[i:i + 1] or [''])[0][:190]))
                thrown = [l.strip() for l in a if re.search(r'TypeError|THREW|uncaught', l) and l not in b]  # the first line that differs may be a mere consequence: a lost update, where the cause is an error that the package caught further down
                if thrown: print('          AN ERROR THAT PLAIN Bun DOES NOT PRINT, in this scenario: %s' % thrown[0][:230])
            for l in lines[:20]: print('       ' + l[:200])
else: sys.exit(__doc__)
print('run.py %s: %s' % (STEP, 'ALL AS DUE' if not bad else '%d NOT AS DUE' % bad)); sys.exit(1 if bad else 0)
