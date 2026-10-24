// Maps and Sets under random operations with several live iterators, held against a model written with arrays.
let seed = 12345;
function random(n) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; }
const objects = Array.from({ length: 40 }, (_, i) => ({ i }));
const symbols = Array.from({ length: 10 }, (_, i) => Symbol("s" + i));
function keyOf(kind, range) {
    const n = random(range);
    switch (kind) {
    case 0: return n;
    case 1: return "k" + n;
    case 2: return n + 0.5;
    case 3: return objects[n % objects.length];
    case 4: return [NaN, 0, -0, undefined, null, true, false, "", 1e300, -1, 2 ** 31, 2 ** 32 + 1, -(2 ** 31)][n % 13];
    case 5: return symbols[n % symbols.length];
    case 6: return BigInt(n % 50);
    case 7: return String(n);
    default: return n % 2 ? n : "m" + n;
    }
}
function same(a, b) { return a === b || (a !== a && b !== b) || (typeof a === "bigint" && typeof b === "bigint" && a == b); }
class Model {
    constructor() { this.entries = []; this.live = 0; }
    find(k) { for (const e of this.entries) if (!e.dead && same(e.k, k)) return e; return null; }
    set(k, v) { const e = this.find(k); if (e) e.v = v; else { this.entries.push({ k: k === 0 ? 0 : k, v, dead: false }); this.live++; } }
    delete(k) { const e = this.find(k); if (!e) return false; e.dead = true; this.live--; return true; }
    clear() { for (const e of this.entries) e.dead = true; this.live = 0; this.cleared = (this.cleared || 0) + 1; for (const it of this.iterators || []) it.at = 0; this.entries = []; }
    iterator() { const it = { at: 0, done: false }; (this.iterators ||= []).push(it); return it; }
    next(it) { if (it.done) return undefined; while (it.at < this.entries.length) { const e = this.entries[it.at++]; if (!e.dead) return e; } it.done = true; return undefined; }
}
function text(x) { return typeof x === "symbol" ? x.description : typeof x === "object" && x ? "o" + x.i : Object.is(x, -0) ? "-0" : String(x) + (typeof x)[0]; }
let checks = 0, wrong = 0;
function check(what, a, b) { checks++; if (a !== b) { if (wrong++ < 20) console.log("WRONG", what, a, b); } }
function round(isMap, kind, range, steps) {
    const real = isMap ? new Map() : new Set(), model = new Model();
    const iterators = [];
    for (let step = 0; step < steps; step++) {
        const op = random(100), k = keyOf(kind, range);
        if (op < 45) { if (isMap) real.set(k, step); else real.add(k); if (isMap || !model.find(k)) model.set(k, step); }
        else if (op < 65) check("delete", real.delete(k), model.delete(k));
        else if (op < 75) { check("has", real.has(k), !!model.find(k)); if (isMap) { const e = model.find(k); check("get", real.get(k), e ? e.v : undefined); } }
        else if (op < 77) { real.clear(); model.clear(); }
        else if (op < 83 && iterators.length < 6) iterators.push([[real.keys(), 0], [real.values(), 1], [real.entries(), 2], [real[Symbol.iterator](), isMap ? 2 : 1]][random(4)].concat(model.iterator()));
        else if (op < 97 && iterators.length) {
            const [it, form, mine] = iterators[random(iterators.length)];
            for (let n = random(4); n >= 0; n--) {
                const r = it.next(), e = model.next(mine);
                check("done", r.done, !e);
                if (!r.done && e) check("item", form === 2 ? text(r.value[0]) + ":" + text(isMap ? r.value[1] : r.value[1]) : text(r.value), form === 2 ? text(e.k) + ":" + text(isMap ? e.v : e.k) : text(form === 0 || !isMap ? e.k : e.v));
            }
        } else if (op < 98) {
            const mine = model.iterator(); let n = 0;
            real.forEach((v, key) => {
                const e = model.next(mine); check("forEach", text(key), e ? text(e.k) : "none");
                if (++n % 3 === 0) { const d = keyOf(kind, range); check("delete inside", real.delete(d), model.delete(d)); }
                if (n % 5 === 0 && n < 200) { const a = keyOf(kind, range); if (isMap) real.set(a, n); else real.add(a); if (isMap || !model.find(a)) model.set(a, n); }
                if (n === 17 && random(4) === 0) { real.clear(); model.clear(); }
            });
            check("forEach end", model.next(mine), undefined);
        } else {
            const mine = model.iterator(); let n = 0;
            for (const item of real) {
                const e = model.next(mine); check("for of", text(isMap ? item[0] : item), e ? text(e.k) : "none");
                if (++n % 4 === 0) { const d = keyOf(kind, range); check("delete in loop", real.delete(d), model.delete(d)); }
                if (n % 7 === 0 && n < 200) { const a = keyOf(kind, range); if (isMap) real.set(a, n); else real.add(a); if (isMap || !model.find(a)) model.set(a, n); }
                if (n > 300) break;
            }
        }
        check("size", real.size, model.live);
    }
    check("all", [...real.keys()].map(text).join(), model.entries.filter(e => !e.dead).map(e => text(e.k)).join());
}
for (const isMap of [true, false])
    for (let kind = 0; kind < 9; kind++)
        for (const range of [3, 9, 40, 300, 3000])
            round(isMap, kind, range, range < 100 ? 1500 : 5000);
// Kinds of keys that follow one another in one collection.
for (const isMap of [true, false]) {
    const real = isMap ? new Map() : new Set(), model = new Model();
    const it = real.keys(), mine = model.iterator();
    for (let step = 0; step < 20000; step++) {
        const k = keyOf(step >> 11, 600);
        if (isMap) real.set(k, step); else real.add(k);
        if (isMap || !model.find(k)) model.set(k, step);
        if (step % 3 === 0) { const d = keyOf(random(9), 600); check("mixed delete", real.delete(d), model.delete(d)); }
        if (step % 5 === 0) { const r = it.next(), e = model.next(mine); check("mixed next", r.done ? "done" : text(r.value), e ? text(e.k) : "done"); }
    }
    check("mixed size", real.size, model.live);
}
// Collections of constants, changed later, with an iterator taken before the change.
const words = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
const codes = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5]]);
const numbers = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const w = words.values(), c = codes.entries(), n = numbers.values();
console.log(w.next().value, c.next().value.join(), n.next().value);
words.delete("b"); words.add("z"); codes.delete("b"); codes.set("z", 26); numbers.delete(2); numbers.add(0.5); numbers.add("s");
console.log([...w].join(), [...c].join("|"), [...n].join(), words.size, codes.size, numbers.size);
const w2 = words.values(); w2.next(); words.clear(); words.add("again"); console.log([...w2].join(), [...words].join());
// A large one.
const big = new Map(); for (let i = 0; i < 1100000; i++) big.set(i, i); const bi = big.keys(); bi.next();
for (let i = 0; i < 1100000; i += 2) big.delete(i);
let sum = 0; for (const k of bi) sum += k; console.log(big.size, sum, big.get(1099999), big.has(1099998));
console.log("checks", checks, "wrong", wrong);
