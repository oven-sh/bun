// The same deletions by computed keys are repeated on new objects of the same shapes, and everything that can be seen of the objects is written down each time.

function show(f) { try { const v = f(); return typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (e) { return "threw " + e.constructor.name; } }
function remove(o, k) { return delete o[k]; }
function read(o, k) { return o[k]; }
const tag = Symbol("tag"), other = Symbol("other");
const join = (a, b) => a + b;
const makers = {
    four: () => ({ close: 1, error: 2, data: 3, end: 4 }),
    one: () => ({ close: 1 }),
    none: () => ({}),
    added: () => { const o = {}; o.end = 1; o.close = 2; o.error = 3; return o; },
    many: () => { const o = {}; for (let i = 0; i < 30; i++) o["k" + i] = i; o.close = "c"; o.error = "e"; return o; },
    veryMany: () => { const o = {}; for (let i = 0; i < 200; i++) o["k" + i] = i; o.close = "c"; return o; },
    nullProto: () => { const o = Object.create(null); o.close = 1; o.error = 2; return o; },
    literalNullProto: () => ({ __proto__: null, close: 1, error: 2, data: 3 }),
    inherits: () => Object.assign(Object.create({ close: "above", data: "above" }), { close: 1, error: 2 }),
    fixed: () => Object.defineProperty({ error: 2, data: 3 }, "close", { value: 1, configurable: false, enumerable: true, writable: true }),
    hidden: () => Object.defineProperty({ error: 2 }, "close", { value: 1, configurable: true, enumerable: false }),
    getter: () => ({ get close() { return "got"; }, error: 2 }),
    frozen: () => Object.freeze({ close: 1, error: 2 }),
    sealed: () => Object.seal({ close: 1, error: 2 }),
    closed: () => Object.preventExtensions({ close: 1, error: 2 }),
    elements: () => ({ close: 1, 0: "zero", 1: "one", error: 2 }),
    symbols: () => ({ close: 1, [tag]: "t", error: 2, [other]: "o" }),
    parsed: () => JSON.parse('{"close":1,"__proto__":{"x":1},"error":2,"7":7}'),
    spread: () => ({ ...{ close: 1, error: 2 }, data: 3 }),
    doubles: () => ({ close: 1.5, error: 2.5, data: -0 }),
    holdsObjects: () => ({ close: { a: 1 }, error: [1, 2], data: () => 1 }),
    wasDeleted: () => { const o = { a: 1, close: 2, error: 3 }; delete o.a; return o; },
    putBack: () => { const o = { close: 1, error: 2 }; delete o.close; o.close = 3; return o; },
};
const keys = () => [join("clo", "se"), "error", join("da", "ta"), "missing", "0", "1", "7", join("__pro", "to__"), tag, other, "k3", "k29", "k150", "toString", "", "-1", "1.5", "4294967295", "constructor"];
const lines = [];
for (let round = 0; round < 4; round++) for (const [name, make] of Object.entries(makers)) {
    for (const k of keys()) {
        const o = make();
        const before = read(o, k);
        const did = show(() => remove(o, k));
        lines.push([round, name, String(k), show(() => before), did, show(() => read(o, k)), show(() => Object.hasOwn(o, k)), show(() => k in o), Reflect.ownKeys(o).length > 40 ? Reflect.ownKeys(o).length : Reflect.ownKeys(o).map(String).join("+"), show(() => o.close), show(() => o.error), show(() => { o[k] = "again"; return read(o, k); }), Reflect.ownKeys(o).length > 40 ? "" : Reflect.ownKeys(o).map(String).join("+"), show(() => remove(o, k)), show(() => remove(o, k))].join(" | "));
    }
    const o = make(); const order = [];
    for (const k of keys()) order.push(show(() => remove(o, k)));
    if (round === 2) Bun.gc(true);
    lines.push([round, name, "all", order.join(), show(() => o), Reflect.ownKeys(o).length].join(" | "));
    const walked = make(); const seen = [];
    for (const k in walked) { seen.push(k); if (seen.length < 40) show(() => remove(walked, seen.length % 2 ? "error" : k)); }
    lines.push([round, name, "walked", seen.length > 40 ? seen.length : seen.join(), Object.keys(walked).length].join(" | "));
}
// What inherits from an object sees the deletion.
for (let round = 0; round < 3; round++) { const parent = { close: "p", error: "q" }; const child = Object.create(parent); const line = [read(child, "close"), child.close, remove(parent, join("clo", "se")), read(child, "close"), child.close, "close" in child]; parent.close = "back"; line.push(child.close, remove(parent, "close"), child.close); lines.push("inherit " + line.join()); }
// One object loses and gets the same names for a long time.
{ const o = { a: 1 }; const names = ["close", "error", "data", "end"]; let t = 0; for (let i = 0; i < 3000; i++) { const k = names[i & 3]; o[k] = i; if (i % 3) t += remove(o, names[(i + 1) & 3]) ? 1 : 0; t += Object.keys(o).length; } lines.push("long " + t + " " + JSON.stringify(o)); }
console.log(lines.join("\n"));
