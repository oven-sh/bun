// `key in object`, hasOwnProperty and Object.hasOwn where the pair of shape and key is new each time, or has just been made false: every kind of key against every kind of receiver.
function isIn(object: any, key: any): any { try { return key in object; } catch (error) { return (error as Error).constructor.name; } }
function owns(object: any, key: any): any { try { return Object.prototype.hasOwnProperty.call(object, key); } catch (error) { return (error as Error).constructor.name; } }
function hasOwn(object: any, key: any): any { try { return Object.hasOwn(object, key); } catch (error) { return (error as Error).constructor.name; } }
function all(object: any, key: any): string { return isIn(object, key) + " " + owns(object, key) + " " + hasOwn(object, key); }
const lines: string[] = [];
function cut(text: string): string { return ("<" + text + ">").slice(1, -1); }
function joined(text: string): string { return text.length < 2 ? text : text.slice(0, 1) + text.slice(1); }

const tag = Symbol("tag");
const other = Symbol("other");
class Point { x = 1; y?: number; get sum() { return this.x; } static origin = "0,0"; static [tag] = 1; static make() { return new Point(); } }
class Point3 extends Point { z = 3; static depth = 3; }
function plainFunction(a: any, b: any) { return a + b; }
(plainFunction as any).extra = 1;
const list: any = [10, , 30];
list.label = "on an array";
list[tag] = 1;
const bare = Object.create(null);
bare.only = 1;
const withAccessors = { get computed() { return 1; }, set written(value: number) {}, plain: undefined };
const parent = { inherited: 1, shadowed: 1, get viaGetter() { return 1; } };
const child = Object.create(parent);
child.shadowed = 2;
const hidden = Object.defineProperty({}, "unseen", { value: 1, enumerable: false });
const proxy = new Proxy({ real: 1 }, { has(target, key) { return key === "claimed" || key in target; }, getOwnPropertyDescriptor(target, key) { return key === "real" ? { value: 1, configurable: true, enumerable: true, writable: true } : undefined; } });
const big: any = {};
for (let i = 0; i < 200; i++) big["k" + i] = i;
delete big.k7;
const numbered: any = { 0: 1, 1: 1, "01": 1, "-1": 1, "1.5": 1, "": 1 };
const receivers: [string, any][] = [
    ["literal", { a: 1, b: undefined, length: 7, name: "n", prototype: "p" }], ["instance", new Point()], ["derived instance", new Point3()], ["class", Point], ["derived class", Point3], ["function", plainFunction],
    ["array", list], ["bare", bare], ["accessors", withAccessors], ["child", child], ["hidden", hidden], ["frozen", Object.freeze({ cold: 1 })], ["proxy", proxy], ["big", big], ["by symbol", { [tag]: 1 }], ["numbered", numbered],
    ["string", "text"], ["string object", new String("text")], ["number", 5], ["map", new Map()], ["bytes", new Uint8Array(2)], ["regexp", /x/g], ["error", new RangeError("r")], ["bound", plainFunction.bind(null)], ["arrow", () => 1],
    ["arguments", (function (..._: any[]) { return arguments; })(4, 5)], ["null", null], ["undefined", undefined],
];
const names = ["a", "b", "x", "y", "z", "sum", "origin", "depth", "make", "extra", "label", "only", "computed", "written", "plain", "inherited", "shadowed", "viaGetter", "unseen", "cold", "real", "claimed", "k0", "k7", "k199",
    "length", "name", "prototype", "constructor", "toString", "hasOwnProperty", "__proto__", "size", "message", "stack", "lastIndex", "callee", "0", "1", "2", "01", "-1", "-0", "1.5", "", "NaN", "nowhere at all", "byteLength"];
for (const [what, receiver] of receivers) {
    const yes: string[] = [];
    for (const name of names) {
        const asAtom = all(receiver, name);
        for (const [how, make] of [["cut", cut], ["joined", joined]] as [string, (text: string) => string][]) {
            const made = all(receiver, make(name));
            if (made !== asAtom) lines.push("DIFFERENT " + what + "[" + how + " " + name + "]: " + made + " and " + asAtom);
        }
        if (asAtom !== "false false false") yes.push(JSON.stringify(name) + " " + asAtom);
    }
    for (const symbol of [tag, other, Symbol.iterator, Symbol.toStringTag, Symbol.hasInstance]) {
        const found = all(receiver, symbol);
        if (found !== "false false false") yes.push(symbol.toString() + " " + found);
    }
    for (const key of [0, 1, 2, -1, 1.5, null, undefined, true, { toString() { return "a"; } }, ["b"]]) {
        const found = all(receiver, key);
        if (found !== "false false false") yes.push((typeof key === "object" && key ? "an object" : String(key)) + " " + found);
    }
    lines.push(what + ": " + yes.join("; "));
}

// The order in which a key and a receiver are converted.
const order: string[] = [];
const loud = { toString() { order.push("key"); return "a"; } };
try { Object.prototype.hasOwnProperty.call(null, loud as any); } catch { order.push("threw"); }
try { Object.hasOwn(null as any, loud as any); } catch { order.push("threw"); }
try { (loud as any) in (null as any); } catch { order.push("threw"); }
lines.push("order: " + order.join());

// New shapes all the time.
let count = 0;
for (let round = 0; round < 3000; round++) {
    const record: any = {};
    for (let i = 0; i < 6; i++) record["r" + (round % 700) + "_" + i] = i ? round : undefined;
    for (const key of Object.keys(record)) count += (isIn(record, key) ? 1 : 0) + (owns(record, key) ? 10 : 0) + (hasOwn(record, key) ? 100 : 0);
    count += (isIn(record, "absent" + round) ? 1000 : 0) + (owns(record, "absent" + round) ? 1000 : 0) + (isIn(record, "toString") ? 1 : 0) + (hasOwn(record, "toString") ? 1000 : 0) + (owns(record, "r" + (round % 700) + "_3") ? 1 : 0);
}
lines.push("over new shapes: " + count);

// What was answered is made false, and asked again.
const base: any = { kept: 1 };
const heir: any = Object.create(base);
heir.own = 1;
lines.push("absent: " + all(heir, "late"));
base.late = 1;
lines.push("on the prototype: " + all(heir, "late"));
heir.late = 1;
lines.push("on the object: " + all(heir, "late"));
delete heir.late;
lines.push("deleted from the object: " + all(heir, "late"));
delete base.late;
lines.push("deleted from the prototype: " + all(heir, "late"));
Object.defineProperty(base, "late", { get() { return 1; }, configurable: true });
lines.push("an accessor on the prototype: " + all(heir, "late") + ", " + all(Object.create(base), cut("late")));
delete base.late;
lines.push("gone: " + all(heir, "late"));
Object.setPrototypeOf(heir, { late: 1 });
lines.push("after setPrototypeOf: " + all(heir, "late"));
Object.setPrototypeOf(heir, null);
lines.push("without a prototype: " + all(heir, "late") + ", " + all(heir, "toString") + ", " + all(heir, "own"));

const unheard = ["not", "heard", "of"].join("~") + "~" + (lines.length ? "yet" : "");
const holder: any = { some: 1 };
lines.push("no such name anywhere: " + all(holder, unheard));
holder[["not", "heard", "of", "yet"].join("~")] = 1;
lines.push("the same text again: " + all(holder, unheard) + ", " + all(holder, cut("not~heard~of~yet")));

const table: any = {};
for (let i = 0; i < 300; i++) table[cut("w" + (i % 150))] = i;
let total = 0;
for (let i = 0; i < 300; i++) total += (isIn(table, cut("w" + i)) ? 1 : 0) + (owns(table, cut("w" + i)) ? 10 : 0) + (hasOwn(table, joined("w" + i)) ? 100 : 0);
for (let i = 0; i < 150; i += 2) delete table["w" + i];
for (let i = 0; i < 150; i++) total += (isIn(table, joined("w" + i)) ? 1000 : 0) + (owns(table, "w" + i) ? 10000 : 0) + (hasOwn(table, cut("w" + i)) ? 100000 : 0);
lines.push("over a dictionary: " + total);
console.log(lines.join("\n"));
