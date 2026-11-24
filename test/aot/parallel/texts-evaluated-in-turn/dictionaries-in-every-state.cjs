// Plain objects that have gained and lost hundreds of names are made prototypes, not extensible, sealed or frozen, before and behind that; then text evaluated at run time stores into them and deletes from them, by name and by key, and their heirs are read by text and by compiled code in turn.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const F = (...a) => new Function(...a.slice(0, -1), hidden(a[a.length - 1]));
const lines = [], say = (...a) => lines.push(a.join(" "));
const attempt = f => { try { return String(f()); } catch (e) { return "!" + e.constructor.name; } };
const list = o => { const d = Object.getOwnPropertyDescriptors(o); return Reflect.ownKeys(d).map(k => String(k) + "=" + ("value" in d[k] ? String(d[k].value) : "accessor") + (d[k].writable === false ? "r" : "") + (d[k].configurable ? "" : "c")).join(); };
const wear = F("o", "n", "for (let i = 0; i < n; i++) { o['worn' + i % 7] = i; o.gone = i; delete o['worn' + i % 7]; delete o.gone; } return o;");
const names = ["x", "y", "z", "then", "late", "m"], put = {}, strict = {}, del = {}, delStrict = {}, get = {}, has = {};
for (const n of names) { put[n] = F("o", "v", `o.${n} = v; return v;`); strict[n] = F("o", "v", `"use strict"; o.${n} = v; return v;`); del[n] = F("o", `return delete o.${n};`); delStrict[n] = F("o", `"use strict"; return delete o.${n};`); get[n] = F("o", `return o.${n};`); has[n] = F("o", `return "${n}" in o;`); }
const putKey = F("o", "k", "v", "o[k] = v; return v;"), strictKey = F("o", "k", "v", "'use strict'; o[k] = v; return v;"), delKey = F("o", "k", "return delete o[k];"), getKey = F("o", "k", "return o[k];"), symbol = Symbol("k"), keys = ["x", "late", symbol, "7", "constructor"];
const read = (o, n) => o[n], change = (o, n, v) => { o[n] = v; }, drop = (o, n) => delete o[n];
const states = { none: o => o, fixed: Object.preventExtensions, sealed: Object.seal, frozen: Object.freeze, readonly: o => Object.defineProperty(o, "x", { writable: false }), kept: o => Object.defineProperty(o, "x", { configurable: false }), accessor: o => Object.defineProperty(o, "x", { get() { return "got"; }, set(v) { this.seen = v; }, configurable: true }) };
for (const [name, state] of Object.entries(states)) {
    for (const order of ["before", "behind", "both", "deleted"]) {
        const o = { x: 1, y: 2 }; if (order !== "behind") wear(o, 300);
        attempt(() => state(o)); if (order === "behind" || order === "both") attempt(() => wear(o, 300)); if (order === "deleted") attempt(() => drop(o, "y"));
        const t = [];
        for (let turn = 0; turn < 6; turn++) {
            for (const n of names) { t.push(attempt(() => put[n](o, turn)), attempt(() => strict[n](o, turn + 1)), attempt(() => get[n](o)), attempt(() => has[n](o))); if (turn & 1) t.push(attempt(() => del[n](o)), attempt(() => delStrict[n](o)), attempt(() => get[n](o))); }
            for (const k of keys) { t.push(attempt(() => putKey(o, k, turn)), attempt(() => strictKey(o, k, turn)), attempt(() => getKey(o, k))); if (turn & 1) t.push(attempt(() => delKey(o, k)), attempt(() => getKey(o, k))); }
        }
        say(name, order, t.join().length, t.slice(0, 20).join(), attempt(() => list(o)), Object.isExtensible(o), Object.isFrozen(o));
    }
}
// Heirs are read, with and without the name, before and behind each change of the dictionary above them.
for (const made of ["worn first", "prototype first"]) {
    for (const depth of [1, 2, 3]) {
        const base = { x: "base", y: "why" }; let heir = base;
        if (made === "worn first") wear(base, 300);
        for (let k = 0; k < depth; k++) { heir = Object.create(heir); heir["h" + k] = k; }
        if (made === "prototype first") wear(base, 300);
        const t = [], other = Object.create(heir); class Below { own = 1; } Object.setPrototypeOf(Below.prototype, heir); const instance = new Below();
        const look = () => { for (const n of names) t.push(get[n](heir), get[n](other), get[n](instance), has[n](heir), read(heir, n), read(instance, n), String(n in heir)); for (const k of keys) t.push(getKey(heir, k), getKey(instance, k)); };
        for (let k = 0; k < 40; k++) look(); t.length = 0;
        for (let turn = 0; turn < 12; turn++) {
            const n = names[turn % names.length], k = keys[turn % keys.length];
            put[n](base, "p" + turn); look(); for (let i = 0; i < 20; i++) look.call(null, t.length > 4000 ? t.splice(0) : 0);
            if (turn & 1) { del[n](base); look(); } putKey(base, k, "k" + turn); look(); if (turn % 3 === 0) { delKey(base, k); look(); }
            if (turn % 4 === 0) { change(base, n, "c" + turn); look(); drop(base, n); look(); } if (turn % 5 === 0) { heir[n] = "own"; look(); delete heir[n]; look(); }
        }
        let h = 0; for (const v of t) for (const c of typeof v === "function" ? v.name : String(v)) h = (h * 31 + c.charCodeAt(0)) | 0;
        say(made, depth, t.length, h, t.slice(-24).map(v => typeof v === "function" ? v.name : String(v)).join());
    }
}
// Instances of one class text that is run again keep their prototypes themselves, which are such dictionaries: what sites and tables remember of them ends with each change.
{
    const K = F("return class K { constructor(i) { this.i = i; } m() { return 1; } };"), all = []; for (let c = 0; c < 6; c++) { const C = K(); wear(C.prototype, 300); const l = []; for (let i = 0; i < 30; i++) l.push(new C(i)); all.push([C, l]); }
    const each = F("l", "let s = ''; for (let i = 0; i < l.length; i++) { const o = l[i]; s += o.late + '/' + ('x' in o) + '/' + o.x + '/' + o.m() + ','; } return s;"), byKey = F("l", "k", "let s = ''; for (let i = 0; i < l.length; i++) s += String(l[i][k]) + ('' + (k in l[i])) + ','; return s;"), stored = F("l", "v", "for (let i = 0; i < l.length; i++) l[i].y = v; return l.length;");
    let h = 0; const take = s => { for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.slice(0, 40); };
    const lookAll = () => { for (const [, l] of all) { take(each(l)); for (const k of ["late", "x", symbol]) take(byKey(l, k)); } };
    for (let k = 0; k < 20; k++) lookAll();
    for (let turn = 0; turn < 24; turn++) {
        const [C, l] = all[turn % all.length], n = ["late", "x"][turn & 1];
        put[n](C.prototype, "p" + turn); lookAll(); say("again", turn, take(each(l)), take(byKey(l, n)));
        if (turn % 3 === 0) { del[n](C.prototype); lookAll(); say("gone", turn, take(each(l))); }
        putKey(C.prototype, symbol, turn); lookAll(); if (turn % 4 === 0) { delKey(C.prototype, symbol); lookAll(); } if (turn % 5 === 0) { putKey(C.prototype, "x", "key" + turn); lookAll(); delKey(C.prototype, "x"); lookAll(); }
        if (turn === 10) { Object.defineProperty(C.prototype, "y", { set(v) { this.kept = v; }, get() { return "above"; }, configurable: true }); stored(l, turn); say("setter", l[0].kept, l[0].y, Object.keys(l[1]).join()); delKey(C.prototype, "y"); stored(l, turn); say("setter gone", l[0].y, Object.keys(l[1]).join()); }
        if (turn === 15) { put.m(C.prototype, () => "replaced"); say("method", take(each(l))); del.m(C.prototype); say("method gone", attempt(() => take(each(l)))); put.m(C.prototype, () => 2); }
    }
    say("again", h);
}
// A dictionary that lies between two others, and one whose prototype changes.
{
    const top = wear({ x: "top" }, 300), middle = wear(Object.create(top), 300), low = wear(Object.create(middle), 300), t = [];
    for (let turn = 0; turn < 30; turn++) { const o = [top, middle, low][turn % 3], n = names[turn % names.length]; put[n](o, turn); t.push(get[n](low), get[n](middle), get[n](top)); if (turn % 4 === 3) { del[n](o); t.push(get[n](low), get[n](middle)); } if (turn === 20) { Object.setPrototypeOf(middle, { x: "other", set late(v) { this.set = v; } }); put.late(low, "to the setter"); t.push(low.set, middle.set, get.late(low)); } }
    say("three", t.join(), list(low), list(middle), list(top));
}
console.log(lines.join("\n")); console.log(lines.length);
