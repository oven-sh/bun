// Plain objects that have lost a property get, replace and lose others in text evaluated at run time, by name and by key: in the cell and beside it, under symbols and under names that are indexes, below setters and read-only properties, as prototypes, frozen, sealed, with accessors of their own; between collections, while they are walked.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const F = (...a) => new Function(...a.slice(0, -1), hidden(a[a.length - 1]));
const lines = [], say = (...a) => lines.push(a.join(" "));
const attempt = f => { try { return String(f()); } catch (e) { return "!" + e.constructor.name + ":" + e.message.slice(0, 50); } };
const show = o => { const d = Object.getOwnPropertyDescriptors(o); return Reflect.ownKeys(d).map(k => String(k) + "=" + ("value" in d[k] ? typeof d[k].value === "function" ? "function" : String(d[k].value) : "accessor") + (d[k].writable === false ? "r" : "") + (d[k].enumerable ? "" : "h") + (d[k].configurable ? "" : "c")).join(); };
const put = [], putStrict = [], del = [], delStrict = [];
for (const n of ["a", "b", "x", "then", "constructor", "toString"]) {
    put.push(F("o", "v", `o.${n} = v; return v;`)); putStrict.push(F("o", "v", `'use strict'; o.${n} = v; return v;`));
    del.push(F("o", `return delete o.${n};`)); delStrict.push(F("o", `'use strict'; return delete o.${n};`));
}
const putKey = F("o", "k", "v", "o[k] = v; return v;"), putKeyStrict = F("o", "k", "v", "'use strict'; o[k] = v; return v;");
const delKey = F("o", "k", "return delete o[k];"), delKeyStrict = F("o", "k", "'use strict'; return delete o[k];");
const symbol = Symbol("s"), keys = ["a", "b", "x", "then", symbol, "7", "007", "-1", "1.5", "__proto__", "length", "4294967295", "4294967294", "a" + "b", String(1e21)];
const make = F("n", "const o = {}; for (let i = 0; i < n; i++) o['p' + i] = i; o.gone = 1; delete o.gone; return o;");
const collect = () => { let l = []; for (let i = 0; i < 3000; i++) l.push({ i }); l = null; if (typeof Bun !== "undefined") Bun.gc(true); };
for (const n of [0, 1, 4, 5, 6, 7, 9, 40, 130]) {
    const o = make(n);
    for (let turn = 0; turn < 30; turn++) {
        for (let k = 0; k < put.length; k++) { put[k](o, turn + "." + k); if ((turn + k) % 3 === 0) del[k](o); }
        for (const k of keys) { putKey(o, k, turn); if ((turn + String(k).length) % 4 === 0) delKey(o, k); }
        if (turn % 10 === 9) { say(n, turn, show(o).slice(-260), Object.keys(o).length); collect(); }
    }
    const order = []; for (const k in o) { order.push(k); if (order.length === 3) { del[0](o); put[1](o, "walked"); putKey(o, "new" + n, 1); } } say(n, "walk", order.join().slice(-120), JSON.stringify(o).length);
}
const shapes = {
    "setter above": () => { const o = Object.create({ set a(v) { this.kept = "s" + v; }, get b() { return 1; } }); o.gone = 1; delete o.gone; return o; },
    "read only above": () => { const p = {}; Object.defineProperty(p, "a", { value: 1 }); Object.defineProperty(p, "b", { value: 2, writable: true }); const o = Object.create(p); o.gone = 1; delete o.gone; return o; },
    "far above": () => { let p = { set a(v) { this.kept = "f" + v; } }; for (let i = 0; i < 4; i++) { p = Object.create(p); p["h" + i] = 1; } const o = Object.create(p); o.gone = 1; delete o.gone; return o; },
    "no prototype": () => { const o = Object.create(null); o.gone = 1; delete o.gone; return o; },
    "proxy above": () => { const o = Object.create(new Proxy({}, { set(t, k, v, r) { Reflect.defineProperty(r, k, { value: "proxy" + v, writable: true, configurable: true, enumerable: true }); return true; } })); o.gone = 1; delete o.gone; return o; },
    "accessor of its own": () => { const o = make(3); Object.defineProperty(o, "a", { get() { return "got"; }, set(v) { this.kept = v; }, configurable: true, enumerable: true }); Object.defineProperty(o, "b", { get() { return 1; } }); return o; },
    "read only of its own": () => { const o = make(3); Object.defineProperty(o, "a", { value: 1, writable: false, configurable: true }); Object.defineProperty(o, "b", { value: 1, writable: true, configurable: false }); return o; },
    "hidden": () => { const o = make(3); Object.defineProperty(o, "a", { value: 1, writable: true, configurable: true, enumerable: false }); return o; },
    "frozen": () => Object.freeze(Object.assign(make(3), { a: 1 })), "sealed": () => Object.seal(Object.assign(make(3), { a: 1 })), "not extensible": () => Object.preventExtensions(Object.assign(make(3), { a: 1 })),
    "a prototype": () => { const o = make(3); o.heir = null; const h = Object.create(o); Object.defineProperty(o, "heir", { value: () => [h.a, h.b, "x" in h].join("/"), enumerable: false, configurable: true, writable: true }); return o; },
    "an instance": () => new (F("return class A { constructor() { this.i = 1; this.gone = 2; delete this.gone; } set a(v) { this.kept = 'class' + v; } };")())(),
    "a compiled prototype": () => { const o = Object.create(new Compiled()); o.gone = 1; delete o.gone; return o; },
    "an heir of a compiled class": () => new (F("B", "return class H extends B { constructor() { super(); this.h = 1; this.gone = 1; delete this.gone; } }")(Compiled))(),
    "an array": () => Object.assign([1, 2], { a: 1 }), "a function": () => Object.assign(function f() {}, { a: 1 }), "a compiled object": () => new Compiled(), "arguments": () => (function () { return arguments; })(1, 2),
};
class Compiled { constructor() { this.own = 1; } get b() { return "compiled"; } set x(v) { this.kept = "compiled" + v; } }
for (const [name, build] of Object.entries(shapes)) {
    for (const [p, d] of [[put, del], [putStrict, delStrict]]) {
        const o = build(), t = [];
        for (let turn = 0; turn < 8; turn++) for (let k = 0; k < 3; k++) { t.push(attempt(() => p[k](o, turn))); if (turn & 1) t.push(attempt(() => d[k](o))); }
        for (const k of keys) { t.push(attempt(() => (p === put ? putKey : putKeyStrict)(o, k, 5))); t.push(attempt(() => (p === put ? delKey : delKeyStrict)(o, k))); t.push(attempt(() => delKey(o, "missing"))); }
        say(name, p === put ? "sloppy" : "strict", t.join().length, t.slice(0, 14).join(), attempt(() => show(o)).slice(0, 200), attempt(() => o.kept), name === "a prototype" ? o.heir() : "");
    }
}
// A cache that is filled and emptied, its values old and new objects.
{
    const cache = {}, add = F("c", "k", "v", "c[k] = v;"), drop = F("c", "k", "delete c[k];"), get = F("c", "k", "return c[k];"); let s = 0;
    for (let i = 0; i < 6000; i++) { add(cache, "k" + i % 97, { i }); if (i % 3 === 0) drop(cache, "k" + (i * 7) % 97); const v = get(cache, "k" + (i * 5) % 97); s += v ? v.i : 1; if (i % 1500 === 1499) { collect(); say("cache", i, s, Object.keys(cache).length, Object.keys(cache).slice(0, 9).join()); } }
}
for (const v of [undefined, null, 1, "t", symbol]) say("no object", attempt(() => put[0](v, 1)), attempt(() => putStrict[0](v, 1)), attempt(() => del[0](v)), attempt(() => delKey(v, "a")));
console.log(lines.join("\n")); console.log(lines.length);
