#!/usr/bin/env python3
"""inherited-setters.py <seed> [worlds = 40]: untyped text. A world: a chain of one to four prototypes, a setter somewhere on it, receivers of one or several shapes,
ONE site `o.value = v` (strict, and a sloppy twin made by new Function is left out: all text here is a module) warmed on them; then the world is altered behind the site's back, again and again, and the site is used after each alteration. Everything that runs writes into a log."""
import sys, random
seed = int(sys.argv[1]); R = random.Random(seed); worlds = int(sys.argv[2]) if len(sys.argv) > 2 else 40
out = ['const log = []; const say = (...a) => log.push(a.map(v => typeof v === "function" ? "fn" : typeof v === "object" && v !== null ? "{" + Reflect.ownKeys(v).map(String).join() + "}" : String(v)).join(" "));',
       'function flush(label) { console.log(label + ": " + log.join(" | ")); log.length = 0; }',
       'const guard = f => { try { return f(); } catch (e) { say("THROWN", e.name); } };']
ALTER = [
 ('replace the setter', 'Object.defineProperty(H, "value", { set(v) { say("second setter", v, this === R0); this._v2 = v; }, configurable: true });'),
 ('setter and getter', 'Object.defineProperty(H, "value", { get() { say("getter"); return this._v; }, set(v) { say("third setter", v); this._v = v; }, configurable: true });'),
 ('only a getter', 'Object.defineProperty(H, "value", { get() { return "got"; }, set: undefined, configurable: true });'),
 ('a data property on the holder', 'Object.defineProperty(H, "value", { value: "data", writable: true, configurable: true, enumerable: true });'),
 ('a read-only data property on the holder', 'Object.defineProperty(H, "value", { value: "fixed", writable: false, configurable: true });'),
 ('deleted from the holder', 'delete H.value;'),
 ('an own data property on the first receiver', 'Object.defineProperty(R0, "value", { value: "own", writable: true, configurable: true, enumerable: true });'),
 ('an own setter on the first receiver', 'Object.defineProperty(R0, "value", { set(v) { say("own setter", v); }, configurable: true });'),
 ('the own one deleted', 'delete R0.value;'),
 ('a nearer prototype gets a setter', 'Object.defineProperty(N, "value", { set(v) { say("nearer setter", v); }, configurable: true });'),
 ('a nearer prototype gets data', 'N.value = "nearer data";' ),
 ('a nearer prototype gets read-only data', 'Object.defineProperty(N, "value", { value: 1, writable: false, configurable: true });'),
 ('the nearer one deleted', 'delete N.value;'),
 ('another prototype for the first receiver', 'Object.setPrototypeOf(R0, { set value(v) { say("setter of another prototype", v); } });'),
 ('no prototype for the first receiver', 'Object.setPrototypeOf(R0, null);'),
 ('the old prototype back', 'Object.setPrototypeOf(R0, N);'),
 ('a prototype put between', 'Object.setPrototypeOf(N, Object.create(Object.getPrototypeOf(N), { value: { set(v) { say("setter put between", v); }, configurable: true } }));'),
 ('the first receiver frozen', 'Object.freeze(R0);'), ('the first receiver not extensible', 'Object.preventExtensions(R0);'), ('the holder frozen', 'Object.freeze(H);'),
 ('another name added to the holder', 'H["more" + log.length] = 1;'), ('another name added to the receivers', 'for (const r of RS) guard(() => { r.other = 1; });'), ('many names added to the holder', 'for (let i = 0; i < 70; i++) guard(() => { H["n" + i] = i; });'),
 ('a setter that throws', 'Object.defineProperty(H, "value", { set(v) { say("throwing setter"); throw new RangeError("from the setter"); }, configurable: true });'),
 ('a setter that replaces itself', 'Object.defineProperty(H, "value", { set(v) { say("replaces itself", v); Object.defineProperty(H, "value", { set(w) { say("the replacement", w); }, configurable: true }); }, configurable: true });'),
 ('a setter that deletes itself', 'Object.defineProperty(H, "value", { set(v) { say("deletes itself", v); delete H.value; }, configurable: true });'),
 ('a setter that defines an own property', 'Object.defineProperty(H, "value", { set(v) { say("defines own", v); Object.defineProperty(this, "value", { value: v, writable: true, configurable: true }); }, configurable: true });'),
 ('a setter that stores to another receiver', 'Object.defineProperty(H, "value", { set(v) { say("hands on", v); if (this !== RS[RS.length - 1]) put(RS[RS.length - 1], v + "+"); }, configurable: true });'),
 ('a bound setter', 'Object.defineProperty(H, "value", { set: function (v) { say("bound", v, this.tag); }.bind({ tag: "bound this" }), configurable: true });'),
 ('a native setter', 'Object.defineProperty(H, "value", { set: Array.prototype.push, configurable: true });'),
 ('a proxy as the setter', 'Object.defineProperty(H, "value", { set: new Proxy(function (v) { say("behind the proxy", v); }, { apply(t, self, args) { say("apply trap", args[0], self === R0); return Reflect.apply(t, self, args); } }), configurable: true });'),
 ('an arrow as the setter', 'Object.defineProperty(H, "value", { set: v => { say("arrow", v); }, configurable: true });'),
 ('an async setter', 'Object.defineProperty(H, "value", { set: async function (v) { say("async", v); }, configurable: true });'),
 ('a setter with two parameters and a default', 'Object.defineProperty(H, "value", { set: function (v, w = "default") { say("two", v, w, arguments.length); }, configurable: true });'),
 ('a collection', 'if (typeof gc === "function") gc(); else if (typeof Bun !== "undefined") Bun.gc(true);'),
]
for w in range(worlds):
    depth = R.randrange(1, 5); holder = R.randrange(depth); shapes = R.choice([1, 1, 2, 5, 12]); kind = R.choice(['create', 'class', 'literal'])
    L = ['{']
    if kind == 'class':
        L.append('class C0 { set value(v) { say("first setter", v, this === R0); this._v = v; } }')
        for d in range(1, depth): L.append('class C%d extends C%d {}' % (d, d - 1))
        L.append('const chain = [%s]; const H = C0.prototype, N = C%d.prototype;' % (', '.join('C%d.prototype' % d for d in range(depth)), depth - 1))
        L.append('const RS = []; for (let i = 0; i < 6; i++) { const r = new C%d(); for (let j = 0; j < i %% %d; j++) r["s" + j] = j; RS.push(r); }' % (depth - 1, shapes))
    else:
        L.append('const chain = [Object.create(null)]; for (let d = 1; d < %d; d++) chain.push(Object.create(chain[d - 1])); const H = chain[%d], N = chain[%d];' % (depth, depth - 1 - holder if depth - 1 - holder >= 0 else 0, depth - 1))
        L.append('Object.defineProperty(H, "value", { set(v) { say("first setter", v, this === R0); this._v = v; }, configurable: true });')
        L.append('const RS = []; for (let i = 0; i < 6; i++) { const r = %s; for (let j = 0; j < i %% %d; j++) r["s" + j] = j; RS.push(r); }' % ('Object.create(N)' if kind == 'create' else '{ __proto__: N, own: i }', shapes))
    L.append('const R0 = RS[0]; function put(o, v) { o.value = v; } function putAndYield(o, v) { return o.value = v; } function add(o) { o.value += "!"; }')
    L.append('for (let t = 0; t < 3; t++) for (const r of RS) guard(() => put(r, "warm" + t)); log.length = 0;')
    for step in range(R.randrange(4, 10)):
        name, text = R.choice(ALTER)
        L.append('guard(() => { %s }); for (const r of RS) guard(() => put(r, "s%d")); say("yields", guard(() => putAndYield(R0, "y%d"))); guard(() => add(RS[1])); say(R0, RS[1], guard(() => R0.value), guard(() => RS[2]._v)); flush("world %d step %d, %s");' % (text, step, step, w, step, name))
    L.append('}')
    out.append('\n'.join(L))
print('\n'.join(out))
