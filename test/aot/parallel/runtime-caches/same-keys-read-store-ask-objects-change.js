// The same few key values are used again and again for reads, stores, `in` and hasOwn on objects of many kinds. Between the rounds each object is changed in one way, and every answer is printed.
const text = "alpha beta gamma __proto__ constructor length 1 01 -0 toString";
const literal = ["alpha", "beta", "gamma", "__proto__", "constructor", "length", "1", "01", "-0", "toString"];
const mark = Symbol("mark");
const keySets = {
    literals: literal,
    pieces: text.split(" "),
    slices: literal.map(name => ("<" + name + ">").slice(1, -1)),
    ropes: literal.map(name => name.slice(0, 1) + name.slice(1)),
    others: [mark, Symbol.iterator, 1, 1.5, -0, null, undefined, true, { toString() { return "alpha"; } }, ["beta"]],
};
function fill(o) { o.alpha = 1; o.beta = 2; o.gamma = 3; return o; }
class Point { constructor() { this.alpha = 1; this.beta = 2; this.gamma = 3; } get delta() { return 4; } }
const makers = {
    literal: () => ({ alpha: 1, beta: 2, gamma: 3 }),
    filled: () => fill({}),
    bare: () => fill(Object.create(null)),
    below: () => fill(Object.create({ alpha: "above", delta: "above" })),
    belowGetter: () => Object.create({ get alpha() { return "got"; }, set alpha(v) { this.seen = v; }, beta: 2 }),
    instance: () => new Point(),
    array: () => fill([7, 8, 9]),
    fn: () => fill(function named(a, b) {}),
    wide: () => { const o = {}; for (let i = 0; i < 100; i++) o["p" + i] = i; return fill(o); },
    thinned: () => { const o = {}; for (let i = 0; i < 100; i++) o["p" + i] = i; fill(o); for (let i = 0; i < 100; i += 2) delete o["p" + i]; return o; },
    proxy: () => new Proxy(fill({}), { get(t, k, r) { return k === "beta" ? "trapped" : Reflect.get(t, k, r); }, has(t, k) { return k === "gamma" ? false : Reflect.has(t, k); }, set(t, k, v, r) { return k === "alpha" ? true : Reflect.set(t, k, v, r); } }),
    bytes: () => fill(new Uint8Array(3)),
    map: () => fill(new Map()),
    text: () => new String("xyz"),
};
const changes = {
    nothing: o => {},
    deleted: o => { delete o.alpha; },
    deletedAndBack: o => { delete o.alpha; o.alpha = "back"; },
    deletedMiddleAndBack: o => { delete o.beta; o.extra = "extra"; o.beta = "back"; },
    accessor: o => { Object.defineProperty(o, "alpha", { get() { return "getter"; }, set(v) { this.caught = v; }, configurable: true, enumerable: true }); },
    readOnly: o => { Object.defineProperty(o, "beta", { value: "fixed", writable: false, configurable: true, enumerable: true }); },
    frozen: o => { Object.freeze(o); },
    sealed: o => { Object.seal(o); },
    closed: o => { Object.preventExtensions(o); },
    otherPrototype: o => { Object.setPrototypeOf(o, { alpha: "new above", epsilon: 5, set gamma(v) {} }); },
    noPrototype: o => { Object.setPrototypeOf(o, null); },
    manyMore: o => { for (let i = 0; i < 80; i++) o["q" + i] = i; },
    manyMoreAndFewer: o => { for (let i = 0; i < 80; i++) o["q" + i] = i; for (let i = 0; i < 80; i++) delete o["q" + i]; },
    ownProto: o => { Object.defineProperty(o, "__proto__", { value: "own", writable: true, configurable: true, enumerable: true }); },
    marked: o => { o[mark] = "marked"; },
};
const show = v => typeof v === "function" ? "function" : typeof v === "symbol" ? v.toString() : typeof v === "object" && v !== null ? "object" : String(v) + (Object.is(v, -0) ? "(-0)" : "");
const attempt = run => { try { return show(run()); } catch (error) { return error.constructor.name; } };
function read(o, k) { return o[k]; }
function store(o, k, v) { "use strict"; o[k] = v; return o[k]; }
function storeSloppy(o, k, v) { return new Function("o", "k", "v", "o[k] = v; return o[k];")(o, k, v); }
function has(o, k) { return k in o; }
function own(o, k) { return Object.hasOwn(o, k); }
function bump(o, k) { o[k] = (o[k] ?? 0) + 1; return o[k]; }
function round(o, keys, tag) {
    const line = [];
    for (let turn = 0; turn < 3; turn++) {
        for (const k of keys) {
            const answers = [attempt(() => read(o, k)), attempt(() => has(o, k)), attempt(() => own(o, k))];
            if (turn === 2) answers.push(attempt(() => store(o, k, tag)), attempt(() => read(o, k)), attempt(() => bump(o, k)), attempt(() => read(o, k)));
            if (turn !== 1) line.push(answers.join(","));
        }
    }
    return line.join(" ");
}
let lines = 0, sum = 0;
for (const [setName, keys] of Object.entries(keySets)) {
    for (const [makerName, make] of Object.entries(makers)) {
        for (const [changeName, change] of Object.entries(changes)) {
            const warm = make();
            for (let i = 0; i < 40; i++) for (const k of keys) { attempt(() => read(warm, k)); attempt(() => has(warm, k)); attempt(() => own(warm, k)); if (typeof k === "string" && k.length > 4 && k !== "__proto__" && k !== "length") attempt(() => store(warm, k, i)); }
            const o = make();
            const before = round(o, keys, 10);
            const changed = attempt(() => change(o));
            const after = round(o, keys, 20);
            const names = attempt(() => Reflect.ownKeys(o).filter(k => typeof k === "symbol" || !/^[pq]\d+$/.test(k)).map(show).join("|"));
            const all = `${setName} ${makerName} ${changeName}: ${changed} ${names}\n  ${before}\n  ${after}`;
            for (let i = 0; i < all.length; i++) sum = (sum * 31 + all.charCodeAt(i)) | 0;
            lines++;
            if (setName === "pieces" || changeName === "deletedMiddleAndBack") console.log(all);
        }
    }
}
console.log(lines, sum);
