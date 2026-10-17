// A read by key and a store by key of the same property, in either order: what the one has learned must not let the other through where it may not go.
"use strict";
type Table = Record<string, unknown>;
const lines: string[] = [];
function read(table: Table, key: string | symbol): unknown { return (table as any)[key]; }
function store(table: Table, key: string | symbol, value: unknown): string {
    try { (table as any)[key] = value; return "stored"; } catch (error) { return (error as Error).constructor.name; }
}
function both(what: string, table: Table, keys: (string | symbol)[]): void {
    const seen: string[] = [];
    for (let round = 0; round < 3; round++) {
        for (const key of keys) {
            const before = read(table, key);
            const outcome = store(table, key, "round " + round);
            seen.push(String(before) + ">" + outcome + ">" + String(read(table, key)));
        }
    }
    lines.push(what + ": " + seen.join(" "));
}
const mark = Symbol("mark");
const plain: Table = { a: 1, b: 2, [mark]: 3 };
both("plain", plain, ["a", "b", mark, "c"]);

const guarded: Table = { open: 1 };
Object.defineProperty(guarded, "shut", { value: "fixed", writable: false, enumerable: true, configurable: true });
Object.defineProperty(guarded, mark, { value: "fixed too", writable: false, enumerable: true, configurable: true });
both("one may not be written", guarded, ["open", "shut", mark]);
Object.defineProperty(guarded, "shut", { writable: true });
both("now it may", guarded, ["open", "shut", mark]);
Object.defineProperty(guarded, "open", { writable: false });
both("and the other may not", guarded, ["open", "shut"]);

const frozen: Table = { x: 1, y: 2 };
both("before freezing", frozen, ["x", "y"]);
Object.freeze(frozen);
both("frozen", frozen, ["x", "y", "z"]);
const sealed: Table = { x: 1 };
both("before sealing", sealed, ["x"]);
Object.seal(sealed);
both("sealed", sealed, ["x", "z"]);

let kept: unknown = "nothing";
const computed: Table = { get got() { return "got " + String(kept); }, set got(value: unknown) { kept = value; }, get only() { return "only"; } } as Table;
both("accessors", computed, ["got", "only"]);

const parent: Table = { inherited: "from the parent" };
Object.defineProperty(parent, "lockedAbove", { value: "locked", writable: false });
const heir: Table = Object.create(parent);
both("an heir", heir, ["inherited", "lockedAbove"]);
lines.push("the parent keeps " + String(parent.inherited) + ", the heir has " + Object.keys(heir).join());

const large: Table = {};
for (let i = 0; i < 200; i++) large["k" + i] = i;
let sum = 0;
for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 200; i++) {
        const key = "k" + (i * 7) % 200;
        sum += read(large, key) as number;
        large[key] = (read(large, key) as number) + 1;
    }
}
delete large.k5;
lines.push("large " + sum + " " + String(read(large, "k5")) + " " + store(large, "k5", "again") + " " + String(read(large, "k5")) + " " + Object.keys(large).length);

class Counter {
    #count = 0;
    static #made = 0;
    constructor() { Counter.#made++; }
    bump(): number { this.#count += 1; return this.#count; }
    static has(value: object): boolean { return #count in value; }
    static get made(): number { return Counter.#made; }
}
const counters = [new Counter(), new Counter(), new Counter()];
let bumps = 0;
for (let round = 0; round < 50; round++) for (const counter of counters) bumps += counter.bump();
lines.push("private " + bumps + " " + Counter.made + " " + Counter.has(counters[0]) + " " + Counter.has({}));
console.log(lines.join("\n"));
