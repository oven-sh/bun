// Ordinary objects get properties by computed keys while what they inherit from has setters, read-only members and frozen fields under those keys.
"use strict";
const log = [];
function show(f) { try { const v = f(); return typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (e) { return "threw " + e.constructor.name; } }
function put(o, k, v) { o[k] = v; }
function get(o, k) { return o[k]; }
function has(o, k) { return k in o; }
class WithSetter { set v(x) { log.push("class setter " + x); } get v() { return "class getter"; } get only() { return "getter only"; } method() {} static set sv(x) { log.push("static setter " + x); } }
class Below extends WithSetter {}
const literalWithSetter = { set v(x) { log.push("literal setter " + x); }, get only() { return 1; }, plain: 1 };
const frozenLiteral = Object.freeze({ v: "frozen", only: "frozen too", plain: 2 });
const frozenInstance = Object.freeze(new (class P { constructor() { this.v = "field"; this.only = "field too"; } })());
const sealedLiteral = Object.seal({ v: "sealed", only: 1 });
const readOnlyOne = Object.defineProperty({ only: 5 }, "v", { value: "fixed", writable: false, enumerable: true, configurable: true });
const lateReadOnly = { v: 1, only: 2 };
const parts = ["v", "only", "plain", "method", "__proto__", "constructor", "fresh", "sv", "toString", "0", "length"];
const join = (a, b) => a + b;
const keysOf = () => parts.map(p => join(p.slice(0, 1), p.slice(1)));
const parents = { klass: () => WithSetter.prototype, below: () => Below.prototype, instance: () => new Below(), literalWithSetter: () => literalWithSetter, frozenLiteral: () => frozenLiteral, frozenInstance: () => frozenInstance, sealedLiteral: () => sealedLiteral,
    readOnlyOne: () => readOnlyOne, lateReadOnly: () => lateReadOnly, statics: () => WithSetter, belowStatics: () => Below, array: () => [1], fn: () => function f() {}, text: () => new String("ab"), none: () => null, plainObject: () => Object.prototype,
    proxy: () => new Proxy({}, { set(t, k, v, r) { log.push("trap " + String(k)); return Reflect.set(t, k, v, r); } }), twoUp: () => Object.create(WithSetter.prototype), map: () => new Map(), error: () => new Error("e"), bytes: () => new Uint8Array(1) };
for (const round of [1, 2, 3]) {
    if (round === 3) Object.defineProperty(lateReadOnly, "v", { writable: false });
    for (const [name, parent] of Object.entries(parents)) {
        for (const shape of ["empty", "some", "many"]) {
            const o = Object.create(parent());
            if (shape !== "empty") { o.a = 1; o.b = 2; }
            if (shape === "many") { for (let i = 0; i < 80; i++) o["m" + i] = i; }
            const line = [];
            for (const k of keysOf()) {
                line.push(k + ":" + show(() => put(o, k, { n: 1 })) + "/" + show(() => Object.hasOwn(o, k)) + "/" + show(() => get(o, k)) + "/" + has(o, k));
                line.push(show(() => put(o, k, 7)) + "/" + show(() => get(o, k)));
            }
            console.log(round, name, shape, line.join(" "), "|", log.join(), "|", show(() => Object.getPrototypeOf(o) === parent() || name));
            log.length = 0;
        }
    }
}
