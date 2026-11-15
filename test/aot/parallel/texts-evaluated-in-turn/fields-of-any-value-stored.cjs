// Text evaluated at run time stores every kind of value into fields of objects that compiled code made: fields that take any value and fields that do not, absent, deleted and created again, of frozen, sealed and not extensible objects, beside fields with attributes and accessors of their own, below setters, while collections run.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const F = (...a) => new Function(...a.slice(0, -1), hidden(a[a.length - 1]));
const lines = [], say = (...a) => lines.push(a.join(" "));
const attempt = f => { try { return String(f()); } catch (e) { return "!" + e.constructor.name + ":" + e.message.slice(0, 60); } };
const show = v => v === undefined ? "undefined" : Object.is(v, -0) ? "-0" : typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : typeof v === "object" && v ? "{" + Object.keys(v).join() + "}" : typeof v + " " + String(v);
const list = o => { const d = Object.getOwnPropertyDescriptors(o); return Reflect.ownKeys(d).map(k => String(k) + "=" + ("value" in d[k] ? show(d[k].value) : "accessor") + (d[k].writable === false ? "r" : "") + (d[k].enumerable ? "" : "h") + (d[k].configurable ? "" : "c")).join(); };
const known = JSON.parse('{"list":[1,2.5,"text",null,true,{"a":1},[1]]}').list;
class Any { constructor(v) { this.v = v; this.w = v; } get sum() { return String(this.v) + String(this.w); } }
class Heir extends Any { constructor(v, n) { super(v); this.n = n; this.name = "heir" + n; } set later(v) { this.kept = v; } }
class Numbers { constructor(i) { this.i = i | 0; this.d = i + 0.5; this.t = "t" + i; this.b = i > 2; } }
class Maybe { constructor(i) { if (i & 1) this.odd = i; this.always = known[i % known.length]; if (i & 2) this.two = known[(i + 1) % known.length]; } }
class Fields { a = known[0]; b; c = undefined; d = null; #e = 1; get e() { return this.#e; } static s = known[1]; }
const literal = i => ({ first: known[i % known.length], second: i, third: undefined });
const values = [0, 1, -1, 2147483647, 4294967296, 1.5, -0, NaN, Infinity, undefined, null, true, false, "", "text", "ro" + known.length, Symbol("s"), 10n, 2n ** 70n, { a: 1 }, [1, 2], () => 1, new Any(1), new Map([[1, 2]]), /x/, Object.create(null)];
const makers = [() => new Any(known[3]), () => new Any(1), () => new Heir("h", 2), () => new Numbers(3), () => new Maybe(0), () => new Maybe(1), () => new Maybe(2), () => new Maybe(3), () => new Fields(), () => literal(1), () => literal(4), () => Object.assign(new Any(2), { extra: 1 }), () => Object.create(new Any(3)), () => ({ v: 1 }), () => [1]];
const names = ["v", "w", "n", "name", "i", "d", "t", "b", "odd", "always", "two", "a", "c", "e", "later", "sum", "first", "second", "third", "extra", "kept", "missing"];
const put = {}, putStrict = {}, get = {}, sum = text => { let k = 0; for (let i = 0; i < text.length; i++) k = k * 31 + text.charCodeAt(i) | 0; return k; };
for (const n of names) { put[n] = F("o", "v", `o.${n} = v; return v;`); putStrict[n] = F("o", "v", `"use strict"; o.${n} = v; return v;`); get[n] = F("o", `return o.${n};`); }
for (let m = 0; m < makers.length; m++) {
    for (const n of names) {
        const t = [];
        for (let turn = 0; turn < 3; turn++) { const o = makers[m](); for (const v of values) { t.push(attempt(() => show(put[n](o, v)))); t.push(attempt(() => show(get[n](o)))); } t.push(list(o)); }
        const p = makers[m](); t.push(attempt(() => show(putStrict[n](p, "strict"))), attempt(() => JSON.stringify(p)), Object.keys(p).join());
        say(m, n, sum(t.join()), t.slice(-3).join(" | ").slice(0, 260));
    }
}
const states = { frozen: Object.freeze, sealed: Object.seal, fixed: Object.preventExtensions, readonly: o => Object.defineProperty(o, "v", { writable: false }), other: o => Object.defineProperty(o, "w", { writable: false }), hidden: o => Object.defineProperty(o, "v", { enumerable: false }), accessor: o => Object.defineProperty(o, "v", { get() { return "got"; }, set(v) { this.w = v; } }), gone: o => { delete o.v; return o; }, again: o => { delete o.v; o.w = 1; o.v = 2; return o; } };
for (const [name, change] of Object.entries(states)) {
    for (const make of [() => new Any(5), () => new Heir(6, 7), () => literal(2)]) {
        const before = [make(), make()], o = make(); for (const b of before) for (let k = 0; k < 20; k++) put.v(b, k);
        change(o);
        const t = []; for (const n of ["v", "w", "first", "second", "missing"]) for (const p of [put, putStrict]) for (const v of [1, "x", undefined, { y: 1 }]) t.push(attempt(() => show(p[n](o, v))));
        say(name, t.join().slice(0, 300), list(o), attempt(() => list(before[0])), Object.isFrozen(o), Object.keys(o).join());
    }
}
// A field that is deleted and stored again goes to the end.
for (let k = 0; k < 40; k++) { const o = k & 1 ? new Any(k) : new Maybe(3); put.v(o, "a"); put.w(o, "b"); put.always(o, "c"); delete o[["v", "w", "always", "odd"][k & 3]]; put[["w", "v", "odd", "always"][k % 4]](o, k); put[["v", "w", "always", "odd"][k & 3]](o, k); say("order", k, Object.keys(o).join(), JSON.stringify(o)); }
// A setter that the prototype gets later, and a class that is given one, are not asked where the object has a field.
class Below { constructor(i) { this.x = known[i & 1]; } } const putX = F("o", "v", "o.x = v;"), below = []; for (let k = 0; k < 50; k++) { const o = new Below(k); putX(o, k); below.push(o); }
Object.defineProperty(Below.prototype, "x", { set(v) { this.y = v; }, get() { return "above"; }, configurable: true }); for (const o of below) putX(o, "late"); const fresh = attempt(() => list(new Below(1))); say("late", below.map(o => o.x).join().length, fresh, list(below[3]));
delete below[4].x; putX(below[4], "deleted"); say("late", list(below[4]), attempt(() => show(below[4].x)));
// Old objects that get young ones, read by compiled code after collections.
const kept = []; for (let k = 0; k < 64; k++) kept.push(k & 1 ? new Any(null) : new Heir(null, k));
const loop = F("kept", "turn", "for (let i = 0; i < kept.length; i++) { const o = kept[i]; o.v = { turn, i, text: 't' + turn + i }; o.w = [o.v, turn]; }"); let s = 0;
for (let turn = 0; turn < 60; turn++) { loop(kept, turn); if (turn % 7 === 0) { let l = []; for (let k = 0; k < 4000; k++) l.push({ k }); l = null; if (typeof Bun !== "undefined") Bun.gc(true); } for (const o of kept) s += o.v.i + o.w[1] + o.v.text.length + (o.w[0] === o.v ? 1 : 1000); }
say("kept", s);
// A site that meets many classes.
const many = F("l", "n", "let s = 0; for (let i = 0; i < n; i++) { const o = l[i % l.length]; o.v = i; o.w = o.v; s += o.w; } return s;");
for (const l of [[new Any(1)], [new Any(1), new Heir(1, 1)], makers.slice(0, 4).map(f => f()), makers.map(f => f())]) say("many", many(l, 3000), l.map(o => show(o.v)).join());
say(new Any(values[5]).sum, new Heir("a", 1).sum, Fields.s); console.log(lines.join("\n")); console.log(lines.length);
