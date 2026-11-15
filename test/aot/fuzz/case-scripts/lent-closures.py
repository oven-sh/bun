#!/usr/bin/env python3
"""lent-closures.py <folder>: Writes one file per case. A closure written as an argument may lie in the frame of the caller and be lent to the callee. Here the callee, which is reached by value, lets it outlive the call by every route.
The stack is then written over, a collection runs, and only then is the closure called. Each prints texts of primitives."""
import os, sys
out = sys.argv[1]
H = '''let said = "";
const G = globalThis;
const hidden = known => process.argv[9] ?? known;
let kept = null;
const holder = { f: null, list: [], map: new Map(), set: new Set(), weak: new WeakMap(), key: {} };
const tick = () => new Promise(r => setTimeout(r, 2));
function name(e) { return "threw " + (e && e.constructor ? e.constructor.name : typeof e); }
function borrows(f) { return f(); }
function smash(d, a, b, c) { const x = a + d, y = b + "x", z = [c, d], w = { d, x }; return d > 0 ? smash(d - 1, x, y.slice(-3), z.length) + w.d + z[1] - d - d : x * 0; }
function settle() { smash(60, 1, "q", 2); const junk = []; for (let i = 0; i < 20000; i++) junk.push({ i, s: "j" + i }); Bun.gc(true); smash(60, 3, "r", 4); return junk.length; }
function attempt(f) { try { return String(f()); } catch (e) { return name(e); } }
'''
# the callee takes f; afterwards LATER is evaluated behind settle()
C = {
 "control-borrows": ("function callee(f) { return f(); }", "'-'"),
 "returns-it": ("function callee(f) { return f; }", "attempt(answer)"),
 "returns-it-on-one-path": ("function callee(f) { return G.nothing ? 0 : f; }", "attempt(answer)"),
 "throws-it": ("function callee(f) { throw f; }", "attempt(thrown)"),
 "a-variable-of-the-module": ("function callee(f) { kept = f; return 0; }", "attempt(kept)"),
 "a-member": ("function callee(f) { holder.f = f; return 0; }", "attempt(holder.f)"),
 "a-member-by-a-computed-key": ("function callee(f) { holder[hidden('f')] = f; return 0; }", "attempt(holder.f)"),
 "pushed-to-a-list": ("function callee(f) { holder.list.push(f); return 0; }", "attempt(holder.list[0])"),
 "an-element": ("function callee(f) { holder.list[0] = f; return 0; }", "attempt(holder.list[0])"),
 "a-map-value": ("function callee(f) { holder.map.set('k', f); return 0; }", "attempt(holder.map.get('k'))"),
 "a-map-key": ("function callee(f) { holder.map.set(f, 1); return 0; }", "attempt([...holder.map.keys()][0])"),
 "a-set": ("function callee(f) { holder.set.add(f); return 0; }", "attempt([...holder.set][0])"),
 "a-weak-map-value": ("function callee(f) { holder.weak.set(holder.key, f); return 0; }", "attempt(holder.weak.get(holder.key))"),
 "global-this": ("function callee(f) { G.keptThere = f; return 0; }", "attempt(G.keptThere)"),
 "in-a-fresh-record": ("function callee(f) { return { f }; }", "attempt(answer.f)"),
 "in-a-fresh-list": ("function callee(f) { return [f]; }", "attempt(answer[0])"),
 "captured-by-a-closure": ("function callee(f) { return () => f(); }", "attempt(answer)"),
 "captured-two-deep": ("function callee(f) { return () => () => f(); }", "attempt(answer())"),
 "the-arguments-object": ("function callee(f) { return arguments; }", "attempt(answer[0])"),
 "a-rest-parameter": ("function callee(...fs) { return fs; }", "attempt(answer[0])"),
 "bound": ("function callee(f) { return f.bind(null); }", "attempt(answer)"),
 "a-proxy-of-it": ("function callee(f) { return new Proxy(f, {}); }", "attempt(answer)"),
 "a-weak-ref": ("function callee(f) { kept = f; return new WeakRef(f); }", "attempt(answer.deref())"),
 "handed-on-to-one-that-keeps": ("function keeps(g) { kept = g; return 0; }\nfunction callee(f) { return keeps(f); }", "attempt(kept)"),
 "handed-on-by-value-to-one-that-keeps": ("function keeps(g) { kept = g; return 0; }\nconst ways = [keeps, borrows];\nfunction callee(f) { return ways[G.nothing ? 1 : 0](f); }", "attempt(kept)"),
 "handed-on-in-tail-position": ("function keeps(g) { kept = g; return 0; }\nfunction callee(f) { 'use strict'; return keeps(f); }", "attempt(kept)"),
 "handed-on-to-hidden-text": ("const keeps = new Function('g', hidden('globalThis.keptThere = g; return 0;'));\nfunction callee(f) { return keeps(f); }", "attempt(G.keptThere)"),
 "a-direct-eval-sees-it": ("function callee(f) { return eval(hidden('globalThis.keptThere = f, 0')); }", "attempt(G.keptThere)"),
 "a-timeout": ("function callee(f) { setTimeout(() => { said += 'late ' + attempt(f) + ' '; }, 1); return 0; }", "(await tick(), await tick(), '-')"),
 "a-timeout-takes-it-itself": ("function callee(f) { setTimeout(f, 1); return 0; }", "(await tick(), await tick(), '-')"),
 "a-microtask": ("function callee(f) { queueMicrotask(() => { said += 'late ' + attempt(f) + ' '; }); return 0; }", "(await tick(), '-')"),
 "then": ("function callee(f) { return Promise.resolve().then(f); }", "String(await answer)"),
 "an-async-callee": ("async function callee(f) { await null; settle(); return f(); }", "String(await answer)"),
 "an-async-callee-behind-a-timer": ("async function callee(f) { await tick(); return f(); }", "String(await answer)"),
 "an-async-arrow": ("const callee = async f => { await null; return f(); };", "String(await answer)"),
 "a-generator-callee": ("function* callee(f) { yield 1; yield f(); }", "(answer.next(), String(answer.next().value))"),
 "an-async-generator-callee": ("async function* callee(f) { yield 1; yield f(); }", "(await answer.next(), String((await answer.next()).value))"),
 "a-member-of-this": ("const self = { f: null, callee(f) { this.f = f; return 0; } };\nconst callee = f => self.callee(f);", "attempt(self.f)"),
 "a-field-of-a-new-instance": ("class K { constructor(f) { this.f = f; } }\nfunction callee(f) { return new K(f); }", "attempt(answer.f)"),
 "a-private-field": ("class K { #f; constructor(f) { this.#f = f; } go() { return this.#f(); } }\nfunction callee(f) { return new K(f); }", "attempt(() => answer.go())"),
 "a-static-field": ("class K { static f = null; }\nfunction callee(f) { K.f = f; return 0; }", "attempt(K.f)"),
 "a-property-put-on-it": ("function callee(f) { f.tag = 'tagged'; kept = f; return 0; }", "attempt(kept) + ':' + kept.tag"),
 "a-property-put-on-it-and-not-kept": ("function callee(f) { f.tag = 'tagged'; return f.tag + f(); }", "String(answer)"),
 "its-own-members-read": ("function callee(f) { return f.name + ':' + f.length + ':' + typeof f.prototype + ':' + (f instanceof Function) + ':' + Object.keys(f).length; }", "String(answer)"),
 "its-text-read": ("function callee(f) { return String(f).length > 0; }", "String(answer)"),
 "called-by-call-and-apply": ("function callee(f) { return f.call(null) + f.apply(null, []) + Reflect.apply(f, null, []); }", "String(answer)"),
 "a-default-captures-it": ("function callee(f, g = () => f()) { return g; }", "attempt(answer)"),
 "a-pattern-takes-it-apart": ("function callee(f) { const [g] = [f]; kept = g; return 0; }", "attempt(kept)"),
 "a-condition-chooses-it": ("function callee(f) { kept = G.nothing ? borrows : f; return 0; }", "attempt(kept)"),
 "a-loop-carries-it": ("function callee(f) { let g = borrows; for (let i = 0; i < 2; i++) g = i ? f : g; kept = g; return 0; }", "attempt(kept)"),
 "an-event-listener": ("const target = new EventTarget();\nfunction callee(f) { target.addEventListener('e', () => { said += 'event ' + attempt(f) + ' '; }); return 0; }", "(target.dispatchEvent(new Event('e')), '-')"),
 "a-getter-made-of-it": ("function callee(f) { return Object.defineProperty({}, 'k', { get: f }); }", "attempt(() => answer.k)"),
 "a-sort-callback-later": ("function callee(f) { kept = () => [2, 1].sort(() => (f(), 0)).length + ':' + f(); return 0; }", "attempt(kept)"),
 "an-error-carries-it": ("function callee(f) { const e = new Error('e'); e.f = f; throw e; }", "attempt(thrown.f)"),
 "a-finally-keeps-it": ("function callee(f) { try { return 0; } finally { kept = f; } }", "attempt(kept)"),
 "recursion-then-kept": ("function callee(f, d = 5) { if (d > 0) return callee(f, d - 1); kept = f; return 0; }", "attempt(kept)"),
 "a-collection-while-it-is-lent": ("function callee(f) { settle(); return f(); }", "String(answer)"),
 "it-lends-another-in-turn": ("function callee(f) { const k = 7; return borrows(() => f() + k); }", "String(answer)"),
 "it-calls-the-lender-again": ("let depth = 0;\nfunction callee(f) { return depth++ < 2 ? lender(callee, depth) + '/' + f() : f(); }", "String(answer)"),
}
L = {
 "an-ordinary-call": "function lender(way, n) { const a = n * 2, b = 's' + n; const r = way(() => a + b); return r; }",
 "in-tail-position": "function lender(way, n) { const a = n * 2, b = 's' + n; return way(() => a + b); }",
 "a-function-expression": "function lender(way, n) { const a = n * 2, b = 's' + n; const r = way(function () { return a + b; }); return r; }",
 "two-closures": "function lender(way, n) { const a = n * 2, b = 's' + n; const r = way(() => a + b, () => b + a); return r; }",
 "in-a-loop": "function lender(way, n) { let r; for (let i = 0; i < 2; i++) { const a = (n + i) * 2, b = 's' + n; r = way(() => a + b); } return r; }",
 "writes-what-it-captured": "function lender(way, n) { let a = n * 2; const b = 's' + n; const r = way(() => a++ + b); a += 10; return r; }",
}
MANY = "".join("function b%d(f) { return f() + %d; }\n" % (i, i) for i in range(14)) + "const table = [" + ", ".join("b%d" % i for i in range(14)) + ", callee];\n"
P = {}
for c, (callee, later) in C.items():
    for l, lender in L.items():
        P["%s--%s.mjs" % (c, l)] = H + lender + "\n" + callee + "\n" + MANY + "let answer, thrown;\nfor (let i = 0; i < 14; i++) said = String(lender(table[i], 1)) + ' ';\ntry { answer = lender(table[14], 1); } catch (e) { thrown = e; }\nsettle();\nsaid += %s + ' ';\nsettle();\nsaid += %s;\nconsole.log(said);\n" % (later, later if "await" not in later and "next()" not in later and "dispatch" not in later else "'.'")
for n, t in P.items(): open(os.path.join(out, n), "w").write(t)
open(os.path.join(out, "LIST.txt"), "w").write("\n".join(sorted(P)) + "\n")
print(len(P), "programs,", len(C), "routes,", len(L), "lenders")
