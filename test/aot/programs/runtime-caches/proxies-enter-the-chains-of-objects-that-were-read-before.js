// Proxies enter the chains of objects that were read, stored to, asked and listed before.
const log = [];
function tracer(name, under) {
    return new Proxy(under, {
        get(t, k, r) { log.push(name + ".get " + String(k)); return Reflect.get(t, k, r); },
        set(t, k, v, r) { log.push(name + ".set " + String(k)); return Reflect.set(t, k, v, r); },
        has(t, k) { log.push(name + ".has " + String(k)); return Reflect.has(t, k); },
        getOwnPropertyDescriptor(t, k) { log.push(name + ".gopd " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
        ownKeys(t) { log.push(name + ".keys"); return Reflect.ownKeys(t); },
        getPrototypeOf(t) { log.push(name + ".proto"); return Reflect.getPrototypeOf(t); },
    });
}
class Base { constructor() { this.a = 1; } hello() { return "base"; } get size() { return 7; } }
class Derived extends Base { constructor() { super(); this.b = 2; } hello() { return "derived+" + super.hello(); } }
function Old() { this.p = 1; } Old.prototype.greet = function () { return "old"; };
const makers = {
    literal: () => ({ a: 1, b: 2 }),
    base: () => new Base(),
    derived: () => new Derived(),
    old: () => new Old(),
    created: () => Object.create({ inherited: 5 }),
    array: () => [1, , 3],
    fn: () => function named() {},
    error: () => new Error("m"),
    map: () => new Map(),
    nullish: () => Object.create(null),
    date: () => new Date(0),
    regexp: () => /x/g,
    bytes: () => new Uint8Array(2),
    promise: () => Promise.resolve(1),
};
function show(f) { try { const v = f(); return typeof v === "function" ? "function" : String(v); } catch (e) { return "threw " + e.constructor.name; } }
function readers(o) {
    return [
        show(() => o.a), show(() => o.b), show(() => o.missing), show(() => o.hello && o.hello()), show(() => o.size), show(() => o.inherited), show(() => o[1]), show(() => o[7]),
        show(() => "missing" in o), show(() => "a" in o), show(() => 1 in o), show(() => { o.fresh = 1; return o.fresh; }), show(() => { o.viaSetter = 2; return Object.hasOwn(o, "viaSetter"); }),
        show(() => { const k = []; for (const x in o) k.push(x); return k.join(); }), show(() => o.toString === Object.prototype.toString), show(() => o instanceof Base), show(() => o.length), show(() => o.name), show(() => o.message),
        show(() => Object.keys(o).join()), show(() => JSON.stringify(o)), show(() => ({ ...o }).a), show(() => o.constructor && o.constructor.name), show(() => { delete o.fresh; return o.fresh; }),
    ].join("|");
}
function flush(label) { console.log(label, log.length, log.join(",")); log.length = 0; }
const order = process.argv[2] ?? "warm";
for (const [name, make] of Object.entries(makers)) {
    const one = make(), two = make();
    if (order === "warm") for (let i = 0; i < 3; i++) console.log(name, "before", readers(one)), readers(two);
    flush(name + " none");
    // 1: the object's own prototype is wrapped
    const was = Object.getPrototypeOf(one);
    console.log(name, "set", show(() => Object.setPrototypeOf(one, tracer("direct", was ?? {}))));
    for (let i = 0; i < 2; i++) { console.log(name, "direct", readers(one)); flush(name + " direct"); }
    console.log(name, "other", readers(two)); flush(name + " other");
    // 2: the proxy goes above the shared prototype, where that takes one
    if (was && ["base", "derived", "old", "created", "error"].includes(name)) {
        const above = Object.getPrototypeOf(was);
        const did = show(() => Object.setPrototypeOf(was, tracer("above", above ?? {})));
        console.log(name, "above set", did);
        for (let i = 0; i < 2; i++) { console.log(name, "above", readers(two)); flush(name + " above"); }
        const three = make();
        console.log(name, "made later", readers(three)); flush(name + " later");
        show(() => Object.setPrototypeOf(was, above));
        console.log(name, "back", readers(two)); flush(name + " back");
    }
}
