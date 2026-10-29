// object[key] where the pair of shape and key is new each time, or has just been made false: every kind of key against every kind of receiver, and what changes between two reads.
function read(object: any, key: any): any { return object[key]; }
function tried(object: any, key: any): any { try { return read(object, key); } catch (error) { return "threw " + (error as Error).constructor.name; } }
function show(value: any): string {
    if (typeof value === "function") return "function " + value.name;
    if (typeof value === "symbol") return value.toString();
    if (value && typeof value === "object") return Array.isArray(value) ? "[" + value.join() + "]" : "object";
    return typeof value === "string" ? JSON.stringify(value) : String(value);
}
const lines: string[] = [];
function note(what: string, value: any): void { lines.push(what + ": " + show(value)); }
// Strings that are no atoms when they arrive: cut, joined, changed in case.
function cut(text: string): string { return ("<" + text + ">").slice(1, -1); }
function joined(text: string): string { return text.length < 2 ? text : text.slice(0, 1) + text.slice(1); }
function lowered(text: string): string { return text.toUpperCase().toLowerCase(); }

const tag = Symbol("tag");
const other = Symbol("other");
const digits = Symbol("1");

class Point { x = 1; y = 2; get sum() { return this.x + this.y; } static origin = "0,0"; static [tag] = "static by symbol"; static make() { return new Point(); } }
class Point3 extends Point { z = 3; static depth = 3; }
function plainFunction(a: any, b: any) { return a + b; }
(plainFunction as any).extra = "on a function";
(plainFunction as any)[tag] = "symbol on a function";
const list: any = [10, 20, 30];
list.label = "on an array";
list[tag] = "symbol on an array";
const bare = Object.create(null);
bare.only = "no prototype";
const withGetter = { get computed() { return "from a getter"; }, plain: "beside a getter" };
const parent = { inherited: "from the parent", shadowed: "parent's", get viaGetter() { return "getter of the parent on " + (this as any).name; } };
const child = Object.create(parent);
child.name = "child";
child.shadowed = "child's";
const frozen = Object.freeze({ cold: "frozen" });
const proxy = new Proxy({ real: 1 }, { get(target, key) { return "trapped " + String(key); } });
const big: any = {};
for (let i = 0; i < 200; i++) big["k" + i] = i;
delete big.k7;
const bySymbol: any = { [tag]: "own symbol", [digits]: "symbol described by a digit" };
const numbered: any = { 0: "zero", 1: "one", "01": "zero one", "-1": "minus one", "1.5": "one and a half", "": "empty name" };
const receivers: [string, any][] = [
    ["literal", { a: 1, b: "two", length: 7, name: "n", prototype: "p" }], ["instance", new Point()], ["derived instance", new Point3()], ["class", Point], ["derived class", Point3], ["function", plainFunction],
    ["array", list], ["bare", bare], ["getter", withGetter], ["child", child], ["frozen", frozen], ["proxy", proxy], ["big", big], ["by symbol", bySymbol], ["numbered", numbered],
    ["string", "text"], ["number", 5], ["boolean", true], ["map", new Map([["a", 1]])], ["bytes", new Uint8Array([7, 8])], ["date", new Date(0)], ["regexp", /x/g], ["error", new RangeError("r")], ["bound", plainFunction.bind(null)],
    ["arrow", () => 1], ["arguments", (function (..._: any[]) { return arguments; })(4, 5)],
];
const names = ["a", "b", "x", "y", "z", "sum", "origin", "depth", "make", "extra", "label", "only", "computed", "plain", "inherited", "shadowed", "viaGetter", "cold", "real", "k0", "k7", "k199", "length", "name", "prototype",
    "constructor", "toString", "hasOwnProperty", "__proto__", "size", "message", "source", "callee", "0", "1", "2", "01", "-1", "-0", "1.5", "", "NaN", "Infinity", "undefined", "nowhere at all", "byteLength"];
for (const [what, receiver] of receivers) {
    for (const name of names) {
        const asAtom = show(tried(receiver, name));
        for (const [how, make] of [["cut", cut], ["joined", joined], ["lowered", lowered]] as [string, (text: string) => string][]) {
            if (how === "lowered" && name !== name.toLowerCase()) continue;
            const made = show(tried(receiver, make(name)));
            if (made !== asAtom) lines.push("DIFFERENT " + what + "[" + how + " " + name + "]: " + made + " and " + asAtom);
        }
        if (name === "__proto__") lines.push(what + ".__proto__ is its prototype: " + (read(receiver, name) === Object.getPrototypeOf(Object(receiver))));
        else if (asAtom !== "undefined") lines.push(what + "[" + JSON.stringify(name) + "]: " + asAtom);
    }
    for (const symbol of [tag, other, digits, Symbol.iterator, Symbol.toStringTag, Symbol.hasInstance]) {
        const found = read(receiver, symbol);
        if (found !== undefined) note(what + "[" + symbol.toString() + "]", found);
    }
    for (const key of [0, 1, 2, -1, 1.5, NaN, null, undefined, true, { toString() { return "a"; } }, ["b"]]) {
        const found = read(receiver, key);
        if (found !== undefined) note(what + "[" + (typeof key === "object" && key ? "an object" : String(key)) + "]", found);
    }
}
for (const nothing of [null, undefined]) {
    for (const key of ["a", cut("a"), tag, 0]) {
        try { read(nothing, key); lines.push("no error"); } catch (error) { lines.push("of " + nothing + ": " + (error as Error).constructor.name); }
    }
}

// New shapes all the time: no cache has the pair.
let sum = 0;
for (let round = 0; round < 3000; round++) {
    const record: any = {};
    for (let i = 0; i < 6; i++) record["r" + (round % 700) + "_" + i] = round + i;
    for (const key of Object.keys(record)) sum += read(record, key);
    sum += read(record, "r" + (round % 700) + "_3");
    if (read(record, "absent" + round) !== undefined || read(record, "toString") !== Object.prototype.toString) sum = NaN;
}
note("sum over new shapes", sum);

// What was read is made false, and read again.
const base: any = { kept: 1 };
const heir: any = Object.create(base);
heir.own = "own";
note("absent at first", read(heir, "late"));
base.late = "arrived on the prototype";
note("then inherited", read(heir, "late"));
heir.late = "arrived on the object";
note("then own", read(heir, "late"));
delete heir.late;
note("then inherited again", read(heir, "late"));
delete base.late;
note("then absent again", read(heir, "late"));
Object.setPrototypeOf(heir, { late: "from another prototype" });
note("after setPrototypeOf", read(heir, "late"));
Object.defineProperty(heir, "own", { get() { return "now a getter"; }, configurable: true });
note("a value turned getter", read(heir, "own"));
Object.defineProperty(heir, "own", { value: "a value again", writable: false });
note("and back", read(heir, "own"));
const sym = Symbol("late");
note("symbol absent", read(heir, sym));
base[sym] = 1;
Object.setPrototypeOf(heir, base);
note("symbol inherited", read(heir, sym));

// A name that is no atom until an object gets it.
const unheard = ["never", "heard", "of"].join("-") + "-" + (lines.length > 0 ? "before" : "");
const holder: any = { some: 1 };
note("no such name anywhere", read(holder, unheard));
holder[["never", "heard", "of", "before"].join("-")] = "now there is";
note("the same text again", read(holder, unheard));
note("and in another string", read(holder, cut("never-heard-of-before")));

// Dictionaries: grown, shrunk, read by fresh strings.
const table: any = {};
for (let i = 0; i < 300; i++) table[cut("w" + (i % 150))] = i;
let total = 0;
for (let i = 0; i < 300; i++) total += read(table, cut("w" + i)) ?? -1;
for (let i = 0; i < 150; i += 2) delete table["w" + i];
for (let i = 0; i < 150; i++) total += read(table, joined("w" + i)) ?? -1000;
note("over a dictionary", total);

// Collections between the reads.
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun?.gc(true));
const survivors: any[] = [];
for (let s = 0; s < 40; s++) { const record: any = {}; for (let i = 0; i <= s % 5; i++) record["g" + s + "_" + i] = s * 10 + i; survivors.push(record); }
let kept = 0;
for (let round = 0; round < 6; round++) {
    for (const record of survivors) { for (const key in record) kept += read(record, key); kept += read(record, "missing") === undefined ? 1 : 1000000; kept += typeof read(record, "valueOf") === "function" ? 1 : 1000000; }
    collect();
}
note("over collections", kept);
console.log(lines.join("\n"));
