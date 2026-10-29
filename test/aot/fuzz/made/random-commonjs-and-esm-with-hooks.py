#!/usr/bin/env python3
"""random-commonjs-and-esm-with-hooks.py <seed> <folder>: as random-commonjs-and-esm.py, and more of what a compiler's conclusions rest on: HOOKS (closures that `require` in a function, handed to `globalThis.hooks` and run by OTHER modules in the middle of their bodies: who can see a module half evaluated); hoisted functions that read a variable holding `require(..)` or a `const` of a literal and are exported ABOVE that declaration (dead zones); initializers with side effects that nobody reads; `module.exports` stored twice, in a branch, in a function; `require.main === module`, `module.id`, `__filename` away from the entry point.
Every way to write an export (names, TypeScript's emit, a literal, one value, other names for `exports`, getters, stars, stores in branches and in functions), to read one (a variable that holds `require(..)`, a pattern, `require(..).n`, named | default | namespace imports, import(..)), to see a module half evaluated (cycles at the top level, `require` in a function, callbacks), and to make somebody able to tell that there is no object (keys, `in`, `delete`, a computed key, handing it on). What is printed: values, `typeof`, names of errors; no text of a function, nothing that depends on a path.
Left out on purpose: direct `eval`; a module that throws and is required again; a key that appears late in `import * as ns` of a module that keeps its object; `let` | `const` | `class` of an ES module read in its dead zone (a bundle has a `var` there); sloppy `this`."""
import os, random, sys

seed, out = int(sys.argv[1]), sys.argv[2]
R = random.Random(seed)
os.makedirs(out, exist_ok=True)
pick, chance = R.choice, lambda p: R.random() < p

N = R.randint(2, 6)
NAMES = ['a', 'b', 'c', 'f', 'g', 'K', 'default', 'late']
ES_NAMES = ['a', 'b', 'c', 'g', 'K']
is_fn = lambda n: n in ('f', 'g')
STAR = '''var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
'''
SHOW = 'const show = (v) => { try { return typeof v === "function" ? "fn" : v === null || typeof v !== "object" ? String(v) : Array.isArray(v) ? "[" + v.map(show).join() + "]" : "{" + Object.keys(v).map((k) => k + ":" + show(v[k])).join() + "}"; } catch (e) { return "!" + e.constructor.name; } };\nconst attempt = (f) => { try { return show(f()); } catch (e) { return "!" + e.constructor.name; } };\n'

modules = []  # per module: dict(name, style, names, marked)


def value(i, n, others):
    """The text of a value for the export `n` of module i."""
    if is_fn(n):
        body = pick(['return %d;' % R.randint(1, 99), 'return x === undefined ? %d : x + 1;' % R.randint(1, 99)] + (['return typeof this;', 'return this === undefined ? "none" : typeof this.a;'] if n == 'f' else []) + ['calls_%d++; return calls_%d;' % (i, i),
                     'return exports.a;' if modules[i]['style'] not in ('value',) else 'return 7;', 'return module.exports.b;'])
        return pick(['function (x) { %s }', 'function named_%s (x) { %%s }' % n, '(x) => { %s }' if 'this' not in body else 'function (x) { %s }']) % body
    if n == 'K':
        return 'class { constructor() { this.v = %d; } get() { return this.v; } static make() { return new this().v; } }' % R.randint(1, 99)
    kinds = ['(console.log("m%d makes %s"), %d)' % (i, n, R.randint(0, 99)), 'made_%d()' % i, '%d' % R.randint(0, 99), '"s%d"' % R.randint(0, 9), 'null', 'undefined', '[%d, %d]' % (R.randint(0, 9), R.randint(0, 9)), '{ x: %d }' % R.randint(0, 9), 'true', '-0', 'local_%d' % i]
    if others:
        j = pick(others)
        kinds += ['require("./m%d").%s' % (j, pick(NAMES))] * 2
    return pick(kinds)


def cjs(i):
    m = modules[i]
    style, names = m['style'], m['names']
    later = [j for j in range(i + 1, N) if not modules[j]['es']]
    earlier = [j for j in range(0, i) if not modules[j]['es']]
    t = ['"use strict";'] if chance(0.8) or True else []
    body, tail = [], []
    body.append('let local_%d = %d, calls_%d = 0;' % (i, R.randint(100, 199), i))
    tail.append('function made_%d() { console.log("m%d made"); return %d; }' % (i, i, R.randint(0, 99)))
    body.append('console.log("m%d starts");' % i)
    held = {}
    early = chance(0.5)
    if early and style not in ('value', 'literal'):
        body.append('exports.readHeld = readHeld_%d; exports.readConstant = readConstant_%d;' % (i, i))
    if chance(0.5):
        body.append('console.log("m%d runs hooks:", (globalThis.hooks || []).map((h) => attempt(h)).join(" "));' % i)
    for j in R.sample(later, min(len(later), R.randint(0, 2))):
        kind = pick(['const', 'var', 'let'])
        held[j] = 'r%d' % j
        body.append('%s r%d = require("./m%d");' % (kind, j, j))
    cyclic = None
    if earlier and chance(0.45):
        cyclic = pick(earlier)
        how = pick(['top', 'top', 'function', 'pattern'])
        if how == 'top':
            body.append('const back = require("./m%d");' % cyclic)
            body.append('console.log("m%d sees m%d early:", %s);' % (i, cyclic, ', '.join('attempt(() => back.%s)' % n for n in R.sample(NAMES, 3))))
            tail.append('exports_late_reader_%d = () => [%s].join();' % (i, ', '.join('attempt(() => back.%s)' % n for n in R.sample(NAMES, 3))))
            body.insert(1, 'let exports_late_reader_%d;' % i)
        elif how == 'pattern':
            ns = R.sample([n for n in NAMES if n != 'default'], 2)
            body.append('const { %s } = require("./m%d");' % (', '.join('%s: back_%s' % (n, n) for n in ns), cyclic))
            body.append('console.log("m%d took from m%d early:", %s);' % (i, cyclic, ', '.join('show(back_%s)' % n for n in ns)))
        else:
            body.append('function look_back() { const back = require("./m%d"); return [%s].join(); }' % (cyclic, ', '.join('attempt(() => back.%s)' % n for n in R.sample(NAMES, 3))))
            body.append('console.log("m%d looks back:", look_back());' % i)
    others = list(held)
    tail.append('function readHeld_%d() { return %s; }' % (i, 'show(%s.%s)' % (held[pick(others)], pick(NAMES)) if others else '"holds nothing"'))
    tail.append('function readConstant_%d() { return constant_%d; }' % (i, i))
    everybody = [j for j in range(N) if not modules[j]['es']]
    if chance(0.6):
        j = pick(everybody)
        body.append('(globalThis.hooks = globalThis.hooks || []).push(() => { const m = require("./m%d"); return "m%d:" + [%s].join(); });' % (j, j, ', '.join(pick(['attempt(() => m.%s)' % pick(NAMES), 'attempt(() => m.readHeld())', 'attempt(() => m.readConstant())', 'attempt(() => m.g())', 'typeof m']) for _ in range(3))))
    if chance(0.3):
        body.append('console.log("m%d environment:", attempt(() => require.main === module), attempt(() => module !== require.main), String(module.id).replace(/^.*[\\\\/]/, ""), String(module.filename).replace(/^.*[\\\\/]/, ""), String(__filename).replace(/^.*[\\\\/]/, ""), typeof __dirname);' % i)
    target = 'exports'
    if style == 'alias':
        target = pick(['self', 'api'])
        body.append('%s %s = %s;' % (pick(['var', 'const']), target, pick(['exports', 'module.exports', 'this'])))
    if style == 'this':
        target = 'this'
    if style == 'module':
        target = 'module.exports'
    if m['marked']:
        body.append(pick(['Object.defineProperty(exports, "__esModule", { value: true });', 'exports.__esModule = true;']))
    if style == 'ts':
        plain = [n for n in names if not is_fn(n)]
        if plain:
            body.append(' = '.join('exports.%s' % n for n in plain) + ' = void 0;')
        for n in names:
            if is_fn(n):
                body.append('exports.%s = %s_%d;' % (n, n, i))
                tail.append('function %s_%d(x) { %s }' % (n, i, pick(['return %d;' % R.randint(1, 99), 'return exports.a;', 'return local_%d;' % i, 'return typeof this;'])))
    if style == 'star' and later:
        j = pick(later)
        t.append(STAR.rstrip('\n'))
        body.append('__exportStar(require("./m%d"), exports);' % j)
    if style == 'literal':
        parts = []
        for n in names:
            parts.append(pick(['%s: %s' % (n, value(i, n, others)), '%s: %s' % (n, value(i, n, others)), 'get %s() { return local_%d; }' % (n, i) if not is_fn(n) and chance(0.3) else '%s: %d' % (n, R.randint(0, 9))]))
        body.append('module.exports = { %s };' % ', '.join(parts))
    elif style == 'value':
        what = pick(['function', 'class', 'variable', 'require', 'number', 'arrow'])
        if what == 'require' and not later:
            what = 'function'
        if what == 'function':
            body.append('function whole_%d(x) { return x === undefined ? %d : x; }' % (i, R.randint(1, 99)))
            body.append('module.exports = whole_%d;' % i)
        elif what == 'arrow':
            body.append('module.exports = (x) => %d;' % R.randint(1, 99))
        elif what == 'class':
            body.append('class Whole_%d { constructor() { this.v = %d; } }' % (i, R.randint(1, 99)))
            body.append('module.exports = Whole_%d;' % i)
        elif what == 'variable':
            body.append('const whole_%d = { a: %d, f() { return typeof this; } };' % (i, R.randint(1, 99)))
            body.append('module.exports = whole_%d;' % i)
        elif what == 'require':
            body.append('module.exports = require("./m%d");' % pick(later))
        else:
            body.append('module.exports = %d;' % R.randint(1, 99))
        if chance(0.3):
            body.append(pick(['if (local_%d > 150) module.exports = function other_%d() { return "other"; };' % (i, i), 'module.exports = function second_%d() { return "second"; };' % i,
                              'globalThis.reset_%d = () => { module.exports = function reset() { return "reset"; }; };' % i]))
        if what in ('function', 'class', 'variable', 'arrow'):
            for n in names[:2]:
                body.append('module.exports.%s = %s;' % (n, value(i, n, others)))
    else:
        for n in names:
            if style == 'ts' and is_fn(n):
                continue
            v = value(i, n, others)
            form = R.random()
            if n == 'late':
                tail.append('function init_%d() { %s.late = %s; }' % (i, 'exports' if target == 'this' else target, v))
                tail.append('%s.init = init_%d;' % (target, i))
            elif form < 0.62:
                body.append('%s.%s = %s;' % (target, n, v))
            elif form < 0.72 and others and not is_fn(n):
                j = pick(others)
                body.append('Object.defineProperty(exports, "%s", { enumerable: true, get: function () { return %s.%s; } });' % (n, held[j], pick(NAMES)))
            elif form < 0.80:
                body.append('if (%s) %s.%s = %s;' % (pick(['local_%d > 50' % i, 'local_%d < 50' % i, 'typeof process === "nothing"', 'true', 'false']), target, n, v))
            elif form < 0.86:
                body.append('%s.%s = %s;' % (target, n, v))
                body.append('%s.%s = %s;' % (target, n, value(i, n, others)))
            elif form < 0.92 and not is_fn(n):
                body.append('%s.%s = %d;' % (target, n, R.randint(0, 9)))
                tail.append('%s.bump_%s = function () { %s.%s++; return %s.%s; };' % (target, n, 'exports', n, 'exports', n))
            else:
                body.append('%s["%s"] = %s;' % (target, n, v))
    # What lets somebody tell.
    if chance(0.28):
        e = pick(['exports', 'module.exports'])
        body.append(pick([
            'console.log("m%d keys:", Object.keys(%s).join());' % (i, e), 'console.log("m%d has a:", "a" in %s, %s.hasOwnProperty("b"));' % (i, e, e), 'delete %s.%s;' % (e, pick(NAMES)),
            'const key_%d = ["a", "b"][local_%d %% 2]; %s[key_%d] = "computed";' % (i, i, e, i), 'console.log("m%d as JSON:", attempt(() => JSON.stringify(%s)));' % (i, e), 'Object.freeze(%s);' % e,
            'console.log("m%d typeof:", typeof %s.a, typeof %s.f, typeof %s.nothing);' % (i, e, e, e), 'globalThis.handed = globalThis.handed || []; globalThis.handed.push(%s);' % e,
            '%s.a += 1;' % e, 'console.log("m%d own read:", attempt(() => %s.a), attempt(() => %s.f && %s.f()));' % (i, e, e, e), 'for (const k in %s) console.log("m%d in:", k);' % (e, i),
            'console.log("m%d same:", exports === module.exports, this === exports);' % i, 'Object.assign(%s, { c: "assigned" });' % e, 'exports = { replaced: true };',
        ]))
    for j in others:
        if chance(0.7):
            body.append('console.log("m%d reads m%d:", %s);' % (i, j, ', '.join(reads(held[j], 3))))
    if chance(0.5):
        body.append('console.log("m%d runs hooks late:", (globalThis.hooks || []).map((h) => attempt(h)).join(" "));' % i)
    body.append('const constant_%d = %s;' % (i, pick(['%d' % R.randint(0, 99), '"text"', 'true', 'null', '0.5', '2 * 3 + 1'])))
    tail.append('console.log("m%d ends");' % i)
    open(os.path.join(out, 'm%d.js' % i), 'w').write('\n'.join(t + [SHOW.rstrip('\n')] + body + tail) + '\n')


def reads(m, k):
    forms = []
    on_es_side = m.startswith(('ns_', 'dyn_'))
    for _ in range(k):
        n = pick(ES_NAMES + ['default'] if on_es_side else NAMES)
        if on_es_side:
            forms.append(pick(['attempt(() => %s.%s)' % (m, n), 'typeof %s.%s' % (m, n), 'attempt(() => %s.g())' % m, 'attempt(() => (0, %s.g)())' % m, 'attempt(() => new %s.K().get())' % m, 'attempt(() => %s.K.make())' % m, 'attempt(() => %s["%s"])' % (m, n),
                               'attempt(() => %s?.%s)' % (m, n), 'attempt(() => %s.bump_%s())' % (m, pick(['a', 'b', 'c'])), 'attempt(() => %s.readConstant())' % m, 'attempt(() => %s.readHeld())' % m]))
            continue
        forms.append(pick(['attempt(() => %s.%s)' % (m, n), 'attempt(() => %s.%s)' % (m, n), 'typeof %s.%s' % (m, n), 'attempt(() => %s.%s())' % (m, pick(['f', 'g'])), 'attempt(() => (0, %s.%s)())' % (m, pick(['f', 'g'])),
                           'attempt(() => new %s.K().get())' % m, 'attempt(() => %s.K.make())' % m, 'attempt(() => %s.f(1))' % m, 'attempt(() => %s())' % m, 'attempt(() => typeof %s)' % m, 'attempt(() => %s.bump_%s())' % (m, pick(['a', 'b', 'c'])),
                           'attempt(() => { %s.init(); return %s.late; })' % (m, m), 'attempt(() => %s["%s"])' % (m, n), 'attempt(() => %s?.%s)' % (m, n), 'attempt(() => %s.__esModule)' % m]))
    return forms


def es(i):
    """An ES module that only reads: it imports from modules behind it."""
    later = list(range(i + 1, N))
    t, body = [], ['console.log("m%d starts");' % i]
    for j in R.sample(later, min(len(later), R.randint(1, 2))):
        ext = 'mjs' if modules[j]['es'] else 'js'
        if modules[j]['es']:
            t.append('import { sum as sum_%d } from "./m%d.mjs";' % (j, j))
            body.append('console.log("m%d has sum of m%d:", show(sum_%d));' % (i, j, j))
            continue
        form = pick(['names', 'default', 'star', 'all'])
        ns = R.sample(ES_NAMES, 2)
        if form in ('names', 'all'):
            t.append('import { %s } from "./m%d.%s";' % (', '.join('%s as %s_%d' % (n, n, j) for n in ns), j, ext))
            body.append('console.log("m%d imports of m%d:", %s);' % (i, j, ', '.join('attempt(() => %s_%d)' % (n, j) for n in ns)))
            body.append('console.log("m%d calls of m%d:", %s);' % (i, j, ', '.join('attempt(() => %s_%d())' % (n, j) for n in ns if is_fn(n)) or '"none"'))
        if form in ('default', 'all'):
            t.append('import d_%d from "./m%d.%s";' % (j, j, ext))
            body.append('console.log("m%d default of m%d:", typeof d_%d, %s);' % (i, j, j, ', '.join(reads('d_%d' % j, 2))))
        if form in ('star', 'all'):
            t.append('import * as ns_%d from "./m%d.%s";' % (j, j, ext))
            body.append('console.log("m%d namespace of m%d:", %s);' % (i, j, ', '.join(reads('ns_%d' % j, 3))))
    body.append('export const sum = %d;' % R.randint(1, 99))
    body.append('console.log("m%d ends");' % i)
    open(os.path.join(out, 'm%d.mjs' % i), 'w').write('\n'.join(t + [SHOW.rstrip('\n')] + body) + '\n')


for i in range(N):
    is_es = i < N - 1 and chance(0.22)
    modules.append({'es': is_es, 'style': pick(['names', 'names', 'ts', 'ts', 'literal', 'value', 'value', 'alias', 'this', 'module', 'star']), 'names': R.sample(NAMES, R.randint(1, 5)), 'marked': chance(0.3)})
    if modules[-1]['style'] == 'ts':
        modules[-1]['marked'] = True
for i in range(N):
    (es if modules[i]['es'] else cjs)(i)

# The entry point: an ES module (it may await) or a CommonJS one.
entry_es = chance(0.5)
t, body = [], ['console.log("main starts");']
for j in range(N):
    ext = 'mjs' if modules[j]['es'] else 'js'
    if modules[j]['es']:
        if entry_es:
            t.append('import { sum as sum_%d } from "./m%d.mjs";' % (j, j))
            body.append('console.log("main: sum of m%d:", sum_%d);' % (j, j))
        continue
    if not chance(0.75):
        continue
    if entry_es:
        form = pick(['names', 'default', 'star', 'dynamic', 'all'])
        ns = R.sample(ES_NAMES, 3)
        if form in ('names', 'all'):
            t.append('import { %s } from "./m%d.js";' % (', '.join('%s as %s_%d' % (n, n, j) for n in ns), j))
            body.append('console.log("main: imports of m%d:", %s);' % (j, ', '.join('attempt(() => %s_%d)' % (n, j) for n in ns)))
        if form in ('default', 'all'):
            t.append('import d_%d from "./m%d.js";' % (j, j))
            body.append('console.log("main: default of m%d:", typeof d_%d, %s);' % (j, j, ', '.join(reads('d_%d' % j, 4))))
        if form in ('star', 'all'):
            t.append('import * as ns_%d from "./m%d.js";' % (j, j))
            body.append('console.log("main: namespace of m%d:", %s);' % (j, ', '.join(reads('ns_%d' % j, 4))))
        if form == 'dynamic':
            body.append('const dyn_%d = await import("./m%d.js");' % (j, j))
            body.append('console.log("main: import() of m%d:", %s);' % (j, ', '.join(reads('dyn_%d' % j, 4))))
        if form in ('names', 'all'):
            body.append('console.log("main: again, imports of m%d:", %s);' % (j, ', '.join('attempt(() => %s_%d)' % (n, j) for n in ns)))
    else:
        form = pick(['held', 'held', 'pattern', 'direct', 'var'])
        if form in ('held', 'var'):
            body.append('%s m_%d = require("./m%d");' % ('var' if form == 'var' else 'const', j, j))
            body.append('console.log("main: m%d:", %s);' % (j, ', '.join(reads('m_%d' % j, 5))))
            body.append('console.log("main: m%d again:", %s);' % (j, ', '.join(reads('m_%d' % j, 3))))
            if chance(0.2):
                body.append(pick(['console.log("main: keys of m%d:", attempt(() => Object.keys(m_%d).join()));' % (j, j), 'console.log("main: m%d whole:", show(m_%d));' % (j, j), 'console.log("main: has:", attempt(() => "a" in m_%d));' % j,
                                  'attempt(() => { m_%d.a = "stored from outside"; }); console.log("main: stored:", attempt(() => m_%d.a), attempt(() => require("./m%d").a));' % (j, j, j)]))
        elif form == 'pattern':
            ns = R.sample([n for n in NAMES if n != 'default'], 3)
            body.append('const { %s } = require("./m%d");' % (', '.join('%s: %s_%d' % (n, n, j) for n in ns), j))
            body.append('console.log("main: taken from m%d:", %s);' % (j, ', '.join('show(%s_%d)' % (n, j) for n in ns)))
        else:
            body.append('console.log("main: direct m%d:", %s);' % (j, ', '.join(reads('require("./m%d")' % j, 4))))
body.append('console.log("main: hooks:", (globalThis.hooks || []).map((h) => attempt(h)).join(" "));')
for j in range(N):
    body.append('if (globalThis.reset_%d) { globalThis.reset_%d(); console.log("main: m%d reset:", attempt(() => %s)); }' % (j, j, j, 'typeof 0' if entry_es else 'require("./m%d")()' % j))
body.append('console.log("main: handed:", show((globalThis.handed || []).map((h) => typeof h === "function" ? "fn" : Object.keys(h).join("+"))));')
body.append('console.log("main ends");')
head = [] if entry_es else ['"use strict";']
open(os.path.join(out, 'main.mjs' if entry_es else 'main.js'), 'w').write('\n'.join(head + t + [SHOW.rstrip('\n')] + body) + '\n')
