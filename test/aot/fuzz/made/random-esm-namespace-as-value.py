#!/usr/bin/env python3
"""random-esm-namespace-as-value.py <seed> <folder>: ONE RANDOM PROGRAM OF ES MODULES WHOSE NAMESPACE IS A VALUE. The namespace object is the specification's: sorted keys, the tag, not extensible, writes refused, live, a dead zone throws; a bundle's plain object with getters is not. Exports: `const`, `let` that a function stores to, functions, classes, `default`, other names (`export { a as b }`), re-exports by name, `export *`, `export * as ns`; readers: `import * as ns` handed on as a value, `await import(..)`, `require(..)` from a CommonJS module; what is asked of the object: a name, a computed key, keys, `in`, descriptors, JSON, spread, `for in`, a store, `delete`, `defineProperty`, freeze | seal | extensible, the tag, identity between the ways to get it; cycles of ES modules in which the namespace is looked at while a module is half evaluated.
Left out: the prototype (Bun's namespace has one of its own), `"__esModule" in ns`, `export *` from a CommonJS module, the text that `console.log(ns)` prints; a store or a `delete` through the name `ns` (`bun build` rejects it); `this` in `ns.f()`; whether what `require` yields is extensible."""
import os, random, sys

seed, out = int(sys.argv[1]), sys.argv[2]
R = random.Random(seed)
os.makedirs(out, exist_ok=True)
pick, chance = R.choice, lambda p: R.random() < p
N = R.randint(2, 5)
POOL = ['a', 'b', 'c', 'f', 'K', 'zed', 'Apple', '_u', '$d', 'n1']
SHOW = 'const show = (v) => { try { return typeof v === "function" ? "fn" : typeof v === "symbol" ? "sym" : v === null || typeof v !== "object" ? String(v) : Array.isArray(v) ? "[" + v.map(show).join() + "]" : "{" + Object.keys(v).map((k) => k + ":" + show(v[k])).join() + "}"; } catch (e) { return "!" + e.constructor.name; } };\nconst attempt = (f) => { try { return show(f()); } catch (e) { return "!" + e.constructor.name; } };\n'
exports_of = {}


def asks(ns, names):
    """Questions to the object `ns`, which may have the names."""
    n = lambda: pick(names + ['nothing'])
    q = [
        'attempt(() => %s.%s)' % (ns, n()), 'attempt(() => %s["%s"])' % (ns, n()), 'attempt(() => { const k = "%s"; return %s[k]; })' % (n(), ns), 'attempt(() => Object.keys(%s).join())' % ns, 'attempt(() => "%s" in %s)' % (n(), ns),
        'attempt(() => Reflect.ownKeys(%s).map((k) => typeof k === "symbol" ? "sym" : k).join())' % ns, 'attempt(() => Object.getOwnPropertyNames(%s).join())' % ns, 'attempt(() => JSON.stringify(%s))' % ns, 'attempt(() => ({ ...%s }))' % ns,
        'attempt(() => { const seen = []; for (const k in %s) seen.push(k); return seen.join(); })' % ns, 'attempt(() => { "use strict"; %s.%s = 1; return "stored"; })' % (ns, n()), 'attempt(() => Reflect.set(%s, "%s", 1))' % (ns, n()),
        'attempt(() => { "use strict"; return delete %s.%s; })' % (ns, n()), 'attempt(() => Reflect.deleteProperty(%s, "%s"))' % (ns, n()), 'attempt(() => Object.isExtensible(%s))' % ns, 'attempt(() => Object.isFrozen(%s))' % ns,
        'attempt(() => Object.isSealed(%s))' % ns, 'attempt(() => %s[Symbol.toStringTag])' % ns, 'attempt(() => Object.prototype.toString.call(%s))' % ns, 'attempt(() => typeof %s)' % ns,
        'attempt(() => { const d = Object.getOwnPropertyDescriptor(%s, "%s"); return d && [d.writable, d.enumerable, d.configurable, show(d.value), "get" in d].join("/"); })' % (ns, n()),
        'attempt(() => Reflect.defineProperty(%s, "%s", { value: 1 }))' % (ns, n()), 'attempt(() => Reflect.defineProperty(%s, "%s", { enumerable: true }))' % (ns, n()), 'attempt(() => Object.prototype.hasOwnProperty.call(%s, "%s"))' % (ns, n()),
        'attempt(() => Object.entries(%s).map(([k, v]) => k + "=" + show(v)).join())' % ns, 'attempt(() => Object.values(%s).length)' % ns, 'attempt(() => Reflect.preventExtensions(%s))' % ns, 'attempt(() => { Object.freeze(%s); return "frozen"; })' % ns,
        'attempt(() => { Object.seal(%s); return "sealed"; })' % ns, 'attempt(() => Object.assign({}, %s))' % ns, 'attempt(() => %s.f && %s.f())' % (ns, ns), 'attempt(() => %s.K && new %s.K().v)' % (ns, ns), 'attempt(() => %s?.%s)' % (ns, n()),
        'attempt(() => { const { %s: taken } = %s; return taken; })' % (pick(names) if names else 'nothing', ns), 'attempt(() => %s.bump && %s.bump())' % (ns, ns), 'attempt(() => Reflect.has(%s, Symbol.toStringTag))' % ns,
        'attempt(() => Reflect.get(%s, "%s", {}))' % (ns, n()), 'attempt(() => Object.getOwnPropertySymbols(%s).length)' % ns,
    ]
    if ns.startswith(('ns_', 'back')):
        q = [x for x in q if ' = 1;' not in x and 'delete %s.' % ns not in x]
    if ns == 't':
        q = [x for x in q if 'isExtensible' not in x and 'isFrozen' not in x and 'isSealed' not in x and 'preventExtensions' not in x]
    return q


def module(i):
    later = list(range(i + 1, N))
    names = R.sample(POOL, R.randint(1, 5))
    t, body, mine = [], ['console.log("m%d starts");' % i], []
    cyclic = pick(range(i)) if i and chance(0.4) else None
    if cyclic is not None:
        t.append('import * as back from "./m%d.mjs";' % cyclic)
        body.append('console.log("m%d looks at m%d early:", %s);' % (i, cyclic, ', '.join(R.sample(asks('back', exports_of[cyclic]), 4))))
    for j in R.sample(later, min(len(later), R.randint(0, 2))):
        t.append('import * as ns_%d from "./m%d.mjs";' % (j, j))
        body.append('@asks %d' % j)
    for n in names:
        if n == 'f':
            body.append(pick(['export function f() { return %d; }' % R.randint(1, 99), 'export const f = () => %d;' % R.randint(1, 99)]))
        elif n == 'K':
            body.append('export class K { v = %d; }' % R.randint(1, 99))
        else:
            form = R.random()
            v = pick(['%d' % R.randint(0, 99), '"s%d"' % R.randint(0, 9), 'null', 'undefined', '[%d]' % R.randint(0, 9), '{ x: %d }' % R.randint(0, 9), '[1][0]', '-0', 'true'])
            if form < 0.4:
                body.append('export const %s = %s;' % (n, v))
            elif form < 0.65:
                body.append('export let %s = %d;' % (n, R.randint(0, 9)))
                if 'bump' not in mine:
                    body.append('export function bump() { %s++; return %s; }' % (n, n))
                    mine.append('bump')
            elif form < 0.8:
                body.append('const inner_%s = %s;\nexport { inner_%s as %s };' % (n, v, n, n))
            elif form < 0.9:
                body.append('export var %s = %s;' % (n, v))
            else:
                body.append('let unset_%s;\nexport { unset_%s as %s };' % (n, n, n))
        mine.append(n)
    if chance(0.4):
        body.append(pick(['export default %d;' % R.randint(1, 99), 'export default function () { return "default"; }', 'export default class { }', 'export default { d: 1 };']))
        mine.append('default')
    for j in later:
        if chance(0.3):
            theirs = [n for n in exports_later[j] if n != 'default' and n not in mine]
            form = pick(['star', 'names', 'as'])
            if form == 'star':
                t.append('export * from "./m%d.mjs";' % j)
                stars.setdefault(i, []).append(j)
            elif form == 'names' and theirs:
                n = pick(theirs)
                t.append('export { %s } from "./m%d.mjs";' % (n, j))
                mine.append(n)
            elif 'inner%d' % j not in mine:
                t.append('export * as inner%d from "./m%d.mjs";' % (j, j))
                mine.append('inner%d' % j)
    body.append('console.log("m%d ends");' % i)
    exports_of[i] = mine
    return t, body


# The names of the modules behind are needed by those in front: make them from the last to the first, with their own generators.
exports_later, stars, texts = {}, {}, {}
state = R.getstate()
for i in reversed(range(N)):
    exports_of.update({j: exports_later.get(j, []) for j in range(N)})
    exports_of.update({j: [] for j in range(i)})
    texts[i] = module(i)
    exports_later[i] = exports_of[i]
for i in range(N):
    t, body = texts[i]
    body = [('console.log("m%d asks m%s:", %s);' % (i, l.split()[1], ', '.join(R.sample(asks('ns_' + l.split()[1], exports_later[int(l.split()[1])]), 5)))) if l.startswith('@asks') else l for l in body]
    open(os.path.join(out, 'm%d.mjs' % i), 'w').write('\n'.join(t + [SHOW.rstrip('\n')] + body) + '\n')

# A CommonJS module that requires some of them.
j = R.randrange(N)
open(os.path.join(out, 'reader.cjs'), 'w').write('"use strict";\n' + SHOW + 'exports.read = function () { const t = require("./m%d.mjs"); return [%s].join(" "); };\nexports.get = function () { return require("./m%d.mjs"); };\n' % (
    j, ', '.join(R.sample(asks('t', exports_later[j]), 6) + ['attempt(() => t.__esModule)']), j))
t, body = ['import { read, get } from "./reader.cjs";'], ['console.log("main starts");']
for k in range(N):
    if chance(0.7):
        t.append('import * as ns_%d from "./m%d.mjs";' % (k, k))
        body.append('const value_%d = [ns_%d][0];' % (k, k))
        body.append('console.log("main asks m%d:", %s);' % (k, ', '.join(R.sample(asks('value_%d' % k, exports_later[k]), 7))))
        body.append('console.log("main asks m%d by its name:", %s);' % (k, ', '.join(R.sample(asks('ns_%d' % k, exports_later[k]), 4))))
        if chance(0.5):
            body.append('const dyn_%d = await import("./m%d.mjs");' % (k, k))
            body.append('console.log("main: import() of m%d:", dyn_%d === value_%d, %s);' % (k, k, k, ', '.join(R.sample(asks('dyn_%d' % k, exports_later[k]), 4))))
body.append('console.log("main: before require:", attempt(() => [%s].join()));' % ('ns_%d.__esModule' % j if any(l.startswith('import * as ns_%d ' % j) for l in t) else '"not imported"'))
body.append('console.log("main: required:", read());')
body.append('console.log("main: required again:", read(), %s);' % ('get() === ns_%d' % j if any(l.startswith('import * as ns_%d ' % j) for l in t) else 'typeof get()'))
body.append('console.log("main ends");')
open(os.path.join(out, 'main.mjs'), 'w').write('\n'.join(t + [SHOW.rstrip('\n')] + body) + '\n')
