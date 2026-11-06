#!/usr/bin/env python3
"""pure-module-symbols.py <folder>: ONE CASE A FOLDER: in a CommonJS module that only makes values the compiler takes `Symbol("x")` for a constant, and it names what other modules' run-once code took out of `module.exports = { aSym, bSym }` IF that code is proven to have ended before the object escapes.
THE QUESTION OF EVERY CASE: is a symbol that --aot took for a constant the symbol that plain Bun would have at that place? Every line is an identity or a description; nothing depends on how deep the stack is: where a case dives to the stack's end it prints only what must be the same at any depth."""
import os, sys

out = sys.argv[1]
cases = {}

KEYS = """'use strict'
const keys = { kState: Symbol('state'), kOptions: Symbol('options'), kShared: Symbol.for('shared') }
module.exports = keys
"""
SYMBOLS = """'use strict'
const aSym = Symbol('a')
const bSym = Symbol('b')
module.exports = { aSym, bSym }
"""
USER = """'use strict'
const { aSym, bSym } = require('./symbols')
module.exports = { make() { return { [aSym]: 1, [bSym]: 2 } }, readA(o) { return o[aSym] }, readB(o) { return o[bSym] }, a: aSym, b: bSym }
"""
SAY = "const say = (...v) => console.log(v.map(x => typeof x === 'symbol' ? x.toString() : String(x)).join(' '));\n"

# ---- a module that only makes values

cases["keys-control"] = {"main.js": SAY + "const a = require('./keys'), b = require('./keys'); say(a === b, a.kState === b.kState, a.kState, a.kOptions, a.kShared === Symbol.for('shared'), Object.keys(a).length, Object.getOwnPropertySymbols(a).length);\n", "keys.js": KEYS}

cases["keys-at-the-stacks-end"] = {"main.js": SAY + """const seen = []; let tries = 0, failures = 0;
function attempt() { tries++; try { const k = require('./keys'); seen.push(k.kState); return true; } catch (e) { failures++; for (const c of module.children ?? []) if (c && c.exports && typeof c.exports.kState === 'symbol') seen.push(c.exports.kState); return false; } }
function dive(n) { try { return dive(n + 1); } catch (e) { if (!attempt()) throw e; return n; } }
dive(0);
const last = require('./keys');
say('whole', typeof last.kState, last.kState, last.kOptions, Object.keys(last).join());
say('every symbol seen on the way is the last one, or there was a failure between', seen.every(s => s === last.kState) || failures > 0);
say('again', require('./keys') === last);
""", "keys.js": KEYS}

cases["keys-lazy-at-the-bottom-of-a-recursion"] = {"main.js": SAY + """function lazy() { return require('./keys'); }
function dive(n) { try { return dive(n + 1); } catch (e) { return lazy(); } }
let first; try { first = dive(0); } catch (e) { first = null; }
const k = lazy();
say(typeof k.kState, k.kState, typeof k.kOptions, k.kOptions, k.kShared === Symbol.for('shared'), Object.keys(k).join());
say(first === null || first === k, first === null || first.kState === k.kState);
const o = { [k.kState]: 1, [k.kOptions]: 2 }; say(o[lazy().kState], o[lazy().kOptions]);
""", "keys.js": KEYS}

TRAPS = {
    "a-setter-on-module-cache": "const M = require('node:module'); const file = require.resolve('./keys'); Object.defineProperty(M._cache, file, { configurable: true, get() { return undefined; }, set(v) { kept = v; throw new Error('trap'); } }); disarm = () => { delete M._cache[file]; };",
    "a-setter-on-module-prototype-loaded": "const M = require('node:module'); Object.defineProperty(M.prototype, 'loaded', { configurable: true, get() { return false; }, set(v) { if (armed && v) { kept = this; throw new Error('trap'); } } }); disarm = () => { delete M.prototype.loaded; };",
    "a-setter-on-module-prototype-exports": "const M = require('node:module'); Object.defineProperty(M.prototype, 'exports', { configurable: true, get() { return this._e; }, set(v) { this._e = v; if (armed && v && v.kState) { kept = this; throw new Error('trap'); } } }); disarm = () => { delete M.prototype.exports; };",
    "children-push-throws": "const push = module.children.push; module.children.push = function (c) { if (armed) { kept = c; throw new Error('trap'); } return push.call(this, c); }; disarm = () => { delete module.children.push; };",
}
for name, lay in TRAPS.items():
    cases["keys-trap-" + name] = {"main.js": SAY + "let kept, armed = true, disarm = () => {};\ntry { " + lay + " } catch (e) { say('the trap cannot be laid:', e.name); }\n" + """let first; try { first = require('./keys'); say('no throw'); } catch (e) { say('threw', e.message); }
armed = false; try { disarm(); } catch (e) { say('disarm', e.name); }
let again; try { again = require('./keys'); } catch (e) { say('again threw', e.name, e.message); }
const early = first ?? kept?.exports;
say('kept', typeof kept, 'early', typeof early?.kState, 'again', typeof again?.kState);
say('the same symbol', early && again ? early.kState === again.kState : 'nothing to compare', 'the same object', early && again ? early === again : 'nothing to compare');
""", "keys.js": KEYS}

cases["keys-through-the-parents-children"] = {"main.js": SAY + "const k = require('./keys'); const c = (module.children ?? []).find(c => String(c.filename ?? c.id).endsWith('keys.js')); say(typeof c, c ? c.exports === k : 'none', c ? c.exports.kState === k.kState : 'none'); const p = process.mainModule; say(p === module, typeof p);\n", "keys.js": KEYS}

cases["keys-imported-by-es-modules"] = {"main.mjs": SAY + "import d from './keys.js'; import * as ns from './keys.js'; import { kState, kOptions } from './keys.js'; import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url)('./keys.js'); say(d === r, d.kState === kState, ns.kState === kState, ns.default === d, r.kOptions === kOptions, kState, kOptions);\n", "keys.js": KEYS}

# ---- an exports object of symbols that escapes late

PKG = """'use strict'
const symbols = require('./symbols')
const user = require('./user')
module.exports = { user, make: user.make }
module.exports.symbols = symbols
"""
BASE = {"symbols.js": SYMBOLS, "user.js": USER, "pkg.js": PKG}
LATE = """'use strict'
const { aSym, bSym } = require('./symbols')
module.exports = { a: aSym, b: bSym, readA(o) { return o[aSym]; } }
"""
REPORT = "const report = (pkg, late) => { const o = pkg.make(); say('early', pkg.user.a, pkg.user.readA(o), 'late', late.a, late.readA(o), 'the same', late.a === pkg.user.a, 'as the object says', late.a === pkg.symbols.aSym, late.b === pkg.symbols.bSym); };\n"

cases["escape-control"] = {**BASE, "late.js": LATE, "main.js": SAY + REPORT + "const pkg = require('./pkg'); report(pkg, require('./late'));\n"}
CHANGES = {
    "stored-to": "pkg.symbols.aSym = Symbol('changed');",
    "defined-from-outside": "Object.defineProperty(pkg.symbols, 'aSym', { value: Symbol('defined'), enumerable: true, configurable: true, writable: true });",
    "a-getter-from-outside": "let n = 0; Object.defineProperty(pkg.symbols, 'aSym', { get() { return Symbol('got' + n++); }, enumerable: true, configurable: true });",
    "deleted": "delete pkg.symbols.aSym;",
    "swapped": "{ const s = pkg.symbols; [s.aSym, s.bSym] = [s.bSym, s.aSym]; }",
    "assigned-over": "Object.assign(pkg.symbols, { aSym: Symbol.for('assigned'), bSym: 7 });",
    "by-reflect": "Reflect.set(pkg.symbols, 'aSym', Symbol('reflected'));",
    "by-a-computed-name": "{ const name = ['a', 'Sym'].join(''); pkg.symbols[name] = Symbol('computed'); }",
    "the-prototype-replaced-and-deleted": "Object.setPrototypeOf(pkg.symbols, { aSym: Symbol('inherited') }); delete pkg.symbols.aSym;",
}
for name, change in CHANGES.items():
    cases["escape-then-" + name] = {**BASE, "late.js": LATE, "main.js": SAY + REPORT + "const pkg = require('./pkg');\n" + change + "\nreport(pkg, require('./late'));\n"}

cases["escape-es-importers"] = {**BASE, "late.mjs": "import d from './symbols.js'; import * as ns from './symbols.js'; import { aSym, bSym } from './symbols.js';\nexport const a = aSym, b = bSym, viaDefault = d.aSym, viaNamespace = ns.aSym, viaNamespaceDefault = ns.default.aSym;\n", "main.mjs": SAY + "import pkg from './pkg.js';\npkg.symbols.aSym = Symbol('changed');\nconst late = await import('./late.mjs');\nsay(late.a, late.viaDefault, late.viaNamespace, late.viaNamespaceDefault, late.viaDefault === pkg.symbols.aSym, late.a === pkg.user.a, late.b === pkg.user.b);\n"}

cases["escape-top-level-await-on-the-road"] = {**BASE, "late.js": LATE, "wait.mjs": "import pkg from './pkg.js';\nawait new Promise(r => setTimeout(r, 5));\npkg.symbols.aSym = Symbol('after the wait');\nexport default pkg;\n", "main.mjs": SAY + REPORT + "import pkg from './wait.mjs'; import { createRequire } from 'node:module';\nreport(pkg, createRequire(import.meta.url)('./late.js'));\n"}

cases["escape-a-failure-half-way"] = {"symbols.js": SYMBOLS, "user.js": USER, "late.js": LATE, "pkg.js": "'use strict'\nconst symbols = require('./symbols')\nglobalThis.leaked = symbols\nif (!globalThis.second) { globalThis.second = true; throw new Error('half way') }\nconst user = require('./user')\nmodule.exports = { user, make: user.make, symbols }\n", "main.js": SAY + REPORT + "try { require('./pkg'); } catch (e) { say('caught', e.message); }\nglobalThis.leaked.aSym = Symbol('changed between');\nconst pkg = require('./pkg'); report(pkg, require('./late')); say(pkg.user.a === globalThis.leaked.aSym);\n"}

cases["escape-two-packages-share-the-symbols"] = {**BASE, "other.js": "'use strict'\nconst symbols = require('./symbols')\nconst { aSym } = symbols\nmodule.exports = { a: aSym, readA(o) { return o[aSym]; }, b: symbols.bSym, symbols }\n", "main.js": SAY + REPORT + "const pkg = require('./pkg');\npkg.symbols.aSym = Symbol('between the packages');\nconst other = require('./other'); report(pkg, other); say(other.symbols === pkg.symbols);\n"}

cases["escape-by-the-cache"] = {**BASE, "late.js": LATE, "main.js": SAY + REPORT + "const pkg = require('./pkg');\nrequire.cache[require.resolve('./symbols')].exports.aSym = Symbol('through the cache');\nreport(pkg, require('./late'));\n"}

cases["escape-exports-replaced-through-the-cache"] = {**BASE, "late.js": LATE, "main.js": SAY + REPORT + "const pkg = require('./pkg');\nrequire.cache[require.resolve('./symbols')].exports = { aSym: Symbol('another object'), bSym: pkg.symbols.bSym };\nconst late = require('./late'); const o = pkg.make(); say(late.a, late.readA(o), late.a === pkg.user.a, late.b === pkg.user.b);\n"}

cases["escape-a-cycle-through-the-user"] = {"symbols.js": SYMBOLS, "late.js": LATE, "user.js": "'use strict'\nconst pkg = require('./pkg')\nconst symbols = require('./symbols')\nif (pkg.early) pkg.early(symbols)\nconst { aSym, bSym } = symbols\nmodule.exports = { make() { return { [aSym]: 1, [bSym]: 2 } }, readA(o) { return o[aSym] }, a: aSym, b: bSym }\n", "pkg.js": "'use strict'\nmodule.exports.early = s => { s.aSym = Symbol('in the cycle') }\nconst symbols = require('./symbols')\nconst user = require('./user')\nmodule.exports.user = user; module.exports.make = user.make; module.exports.symbols = symbols\n", "main.js": SAY + REPORT + "const pkg = require('./pkg'); report(pkg, require('./late'));\n"}

cases["escape-handed-to-a-function-of-the-host"] = {**BASE, "late.js": LATE, "main.js": SAY + REPORT + "const pkg = require('./pkg');\nconst copy = structuredClone({ n: 1 }); JSON.stringify(pkg.symbols, function (k, v) { if (k === '' && copy.n) this[''].aSym = Symbol('inside stringify'); return v; });\nreport(pkg, require('./late'));\n"}

for name, files in cases.items():
    os.makedirs(os.path.join(out, name), exist_ok=True)
    for f, text in files.items():
        with open(os.path.join(out, name, f), "w") as h:
            h.write(text)
print(len(cases), "cases")
