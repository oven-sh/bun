// object[key] = value where the pair of shape and key is new each time: every kind of key against every kind of receiver, what refuses a store, and what a store must not disturb.
"use strict";
function store(object: any, key: any, value: any): string { try { object[key] = value; return "stored"; } catch (error) { return (error as Error).constructor.name; } }
// Of the type of what is there, so that no written type becomes false.
function fitting(object: any, key: any): any { let now: any; try { now = object[key]; } catch {} return typeof now === "string" ? "v" : typeof now === "function" || (typeof now === "object" && now) ? now : 7; }
function cut(text: string): string { return ("<" + text + ">").slice(1, -1); }
function joined(text: string): string { return text.length < 2 ? text : text.slice(0, 1) + text.slice(1); }
function describe(object: any, key: any): string {
    const d = Object.getOwnPropertyDescriptor(Object(object), key);
    if (!d) return "none";
    return ("value" in d ? "value " + (typeof d.value === "function" ? "a function" : String(d.value)) : "accessor") + (d.writable ? " w" : "") + (d.enumerable ? " e" : "") + (d.configurable ? " c" : "");
}
const lines: string[] = [];
const tag = Symbol("tag");
const log: string[] = [];
class Point { x = 1; y?: number; set wide(value: number) { log.push("wide " + value); } static origin = "0,0"; }
function makers(): [string, () => any][] {
    return [
        ["literal", () => ({ a: 1, b: 2 })], ["empty", () => ({})], ["bare", () => Object.create(null)], ["instance", () => new Point()], ["class", () => class extends Point {}], ["function", () => function f() {}],
        ["array", () => [1, 2]], ["read-only", () => Object.defineProperty({ a: 1 }, "fixed", { value: 1, writable: false, enumerable: true, configurable: true })],
        ["hidden", () => Object.defineProperty({}, "a", { value: 1, writable: true, enumerable: false, configurable: false })],
        ["setter", () => ({ set a(value: any) { log.push("own setter " + String(value)); } })], ["getter only", () => ({ get a() { return 1; } })],
        ["heir of a setter", () => Object.create({ set a(value: any) { log.push("inherited setter " + String(value) + " on " + (Object.keys(this).join() || "nothing")); } })],
        ["heir of a getter", () => Object.create({ get a() { return 1; } })], ["heir of read-only", () => Object.create(Object.freeze({ a: 1 }))], ["heir of a value", () => Object.create({ a: 1, fixed: 2 })],
        ["heir of a proxy", () => Object.create(new Proxy({}, { set(target, key, value, receiver) { log.push("trapped " + String(key)); return Reflect.set(target, key, value, receiver); } }))],
        ["frozen", () => Object.freeze({ a: 1 })], ["sealed", () => Object.seal({ a: 1 })], ["not extensible", () => Object.preventExtensions({ a: 1 })],
        ["proxy", () => new Proxy({}, { set(target: any, key, value) { log.push("set " + String(key)); target[key] = value; return true; } })],
        ["big", () => { const big: any = {}; for (let i = 0; i < 100; i++) big["k" + i] = i; return big; }], ["shrunk", () => { const o: any = { a: 1, b: 2, c: 3 }; delete o.b; return o; }],
        ["bytes", () => new Uint8Array(2)], ["map", () => new Map()], ["string object", () => new String("ab")], ["string", () => "ab"], ["number", () => 5], ["null", () => null], ["undefined", () => undefined],
    ];
}
const keys: any[] = ["a", "b", "x", "y", "wide", "origin", "fixed", "k5", "fresh name", "length", "name", "prototype", "__proto__", "constructor", "toString", "0", "1", "5", "01", "-1", "1.5", "", tag, 0, 7, -1, 1.5, null, undefined, true];
for (const [what, make] of makers()) {
    const row: string[] = [];
    for (const key of keys) {
        const first = make();
        log.length = 0;
        const outcome = store(first, key, fitting(first, key)) + " " + (first == null ? "" : describe(first, key)) + (log.length ? " (" + log.join() + ")" : "");
        if (typeof key === "string") {
            for (const [how, remake] of [["cut", cut], ["joined", joined]] as [string, (text: string) => string][]) {
                const second = make();
                log.length = 0;
                const again = store(second, remake(key), fitting(second, key)) + " " + (second == null ? "" : describe(second, key)) + (log.length ? " (" + log.join() + ")" : "");
                if (again !== outcome) lines.push("DIFFERENT " + what + "[" + how + " " + key + "]: " + again + " and " + outcome);
            }
        }
        row.push(String(typeof key === "string" ? JSON.stringify(key) : String(key)) + ": " + outcome);
    }
    lines.push(what + " | " + row.join(" | "));
}
// __proto__ by key sets the prototype.
const adopted: any = {};
store(adopted, cut("__proto__"), { from: "the new prototype" });
lines.push("adopted: " + adopted.from + " " + Object.keys(adopted).length);

// The order of keys, and that attributes stay.
const ordered: any = {};
for (const key of ["z", "a", cut("m"), tag, "10", "2", joined("bb"), "a", cut("z")]) store(ordered, key, String(key.toString()));
lines.push("order: " + Reflect.ownKeys(ordered).map(String).join());
const quiet = Object.defineProperty({}, "q", { value: 1, writable: true, enumerable: false, configurable: false });
store(quiet, cut("q"), 2);
lines.push("attributes stay: " + describe(quiet, "q"));

// New shapes all the time; replacing and adding; growing past the room in the object and past the first storage.
let sum = 0;
for (let round = 0; round < 2000; round++) {
    const record: any = {};
    for (let i = 0; i < 24; i++) store(record, "r" + (round % 300) + "_" + i, round + i);
    for (let i = 0; i < 24; i += 2) store(record, cut("r" + (round % 300) + "_" + i), 1);
    for (const key in record) sum += record[key];
    sum += Object.keys(record).length;
}
lines.push("over new shapes: " + sum);

// A table that grows into a dictionary, with fresh keys, and shrinks.
const table: any = {};
for (let i = 0; i < 2000; i++) store(table, cut("w" + (i % 500)), i);
for (let i = 0; i < 500; i += 3) delete table["w" + i];
for (let i = 0; i < 500; i += 5) store(table, joined("w" + i), -i);
let total = 0;
for (const key in table) total += table[key];
lines.push("a table: " + Object.keys(table).length + " " + total + " " + Object.keys(table).slice(-3).join());

// A store that a prototype begins to intercept.
const base: any = {};
const made: any[] = [];
for (let i = 0; i < 6; i++) {
    const heir = Object.create(base);
    heir.first = i;
    if (i === 2) Object.defineProperty(base, "watched", { set(value) { log.push("caught " + value); }, configurable: true });
    if (i === 4) Object.defineProperty(base, "watched", { value: 0, writable: false, configurable: true });
    log.length = 0;
    made.push(store(heir, "watched", i) + " " + describe(heir, "watched") + " " + log.join());
}
lines.push("intercepted: " + made.join(" | "));
// An object that is a prototype gets a property by key, and its heirs see it.
const proto: any = {};
const seer: any = Object.create(proto);
lines.push("before: " + seer["given" as string]);
store(proto, cut("given"), "now");
lines.push("after: " + seer[cut("given")]);
// Values that are cells, stored into old objects, over collections.
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun?.gc(true));
const old: any = {};
collect();
for (let i = 0; i < 40; i++) { store(old, cut("cell" + (i % 10)), { n: i, text: "t" + i }); if (i % 7 === 0) collect(); }
collect();
lines.push("cells: " + Object.keys(old).map(key => old[key].n + old[key].text).join());
console.log(lines.join("\n"));
