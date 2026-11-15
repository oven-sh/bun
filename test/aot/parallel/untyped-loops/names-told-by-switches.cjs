// switch (x) { case "a": n += x.name; } in a loop: what a case says of its subject rests on no test of its own, and the loop's version asks the names of the text off no earlier lookup.
"use strict";
let calls = 0;
function names(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; switch (x) { case "a": n += x.name; } } return n; }
function each(list) { let n = 0; for (const x of list) { switch (x) { case "a": n += x.size; break; default: n += x.size; } } return n; }
function nested(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; switch (x) { case "a": switch (x.name) { case "b": n--; continue; default: n += 2; } break; default: n++; } if (x.kind !== "a") n++; } return n; }
function kinds(list) { let n = 0; for (const r of list) { const k = r.kind; switch (k) { case "a": n += k.size; break; case "b": n += k.name.length; break; default: n += 0.5; } } return n; }
function inner(list) { let n = 0; for (const r of list) { const k = r.kind; switch (k) { case "a": n += k.size.width; break; default: if (k) n += k.size; } } return n; }
function numbers(list) { let n = 0; for (const x of list) { switch (x) { case 1: n += x.name; break; case 2: n += x.size; break; default: n += x.name; } } return n; }
function stores(list) { for (const x of list) { switch (x) { case "a": calls += x.name ? 1 : 2; break; default: x.seen = 1; } } return list.length; }
function parts(list) { let s = ""; for (const x of list) { switch (x) { case "ab": s += x.length + x.toUpperCase() + x.name; break; case "c": s += x[0] + x.at(0); break; default: s += x.name; } } return s; }
const functions = { names, each, nested, kinds, inner, numbers, stores, parts };
globalThis.functions = functions;
const proto = { get size() { calls++; return 3; } };
const lists = {
    texts: ["a", "b", "ab", "a", "c", "a"],
    rows: JSON.parse('[{"name":1,"size":2,"kind":"a"},{"name":"x","kind":"b"},{"size":4,"kind":{"size":7,"name":"y"}},{"kind":"a"}]'),
    mixed: ["a", { name: 2, size: 3, kind: "a" }, "ab", { name: "q", kind: "b" }, "a", [1], 1, 2, { kind: { size: { width: 3 } } }],
    numbers: [1, 2, 3, 1.5, -0, 1],
    getters: [Object.create(proto), "a", Object.create(proto), { get kind() { calls++; return "a"; } }, { get name() { calls++; return 5; }, kind: "b" }],
    proxies: [new Proxy({ name: 1, kind: "a" }, { get(target, key) { calls += 10; return target[key]; } }), "a"],
    nothing: ["a", null], none: [], absent: ["a", undefined, "b"],
};
const hidden = (0, eval)("(f, l) => f(l)");
const run = (f, list) => { try { return String(hidden(functions[f], list)); } catch (error) { return error.name; } };
function turn(title) {
    for (const f of Object.keys(functions)) console.log(title, f, Object.keys(lists).map((name) => { let last = ""; for (let k = 0; k < 30; k++) last = run(f, lists[name].map((x) => x)); return last.slice(0, 30); }).join(" | "), calls);
}
turn("made");
String.prototype.name = 4; String.prototype.size = 6; turn("named");
delete String.prototype.name; Object.defineProperty(String.prototype, "size", { get() { calls++; return this.length; }, configurable: true }); turn("getter");
delete String.prototype.size; turn("gone");
