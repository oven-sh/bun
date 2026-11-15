// Objects as property keys: what runs, in which order, and which property is meant; reads, stores, `in`, hasOwn, computed names, updates, deletes, destructuring and classes.
const lines: string[] = [];
let log = "";
const say = (name: string, value: unknown) => { lines.push(name + " " + (typeof value === "symbol" ? value.toString() : typeof value === "object" ? JSON.stringify(value) : String(value)) + (log ? " [" + log + "]" : "")); log = ""; };
const attempt = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (error) { r = (error as Error).constructor.name + ": " + (error as Error).message; } say(name, r); };
const sym = Symbol("sym"); const nothing: any = process.argv[9], nil: any = process.argv[9] ?? null;
class Text { constructor(public x: string) {} toString() { log += "T" + this.x; return this.x; } }
class Below extends Text { valueOf() { log += "V"; return 9; } }
class Value { valueOf() { log += "v"; return "k"; } }
class Numbers { constructor(public n: number) {} toString(): any { log += "n"; return this.n; } }
class Symbols { [Symbol.toPrimitive](hint: string): any { log += "p" + hint; return sym; } }
class Hinted { [Symbol.toPrimitive](hint: string): any { log += "h" + hint; return hint === "string" ? "k" : 5; } toString() { log += "never"; return "never"; } }
class Objects { toString(): any { log += "o"; return {}; } valueOf(): any { log += "w"; return "k"; } }
class NoPrimitive { toString(): any { return {}; } valueOf(): any { return {}; } }
class Throws { toString(): string { log += "!"; throw new RangeError("key"); } }
class BadPrimitive { [Symbol.toPrimitive](): any { return {}; } }
class Nulls { toString(): any { return null; } }
class Getter { get toString() { log += "g"; return () => { log += "c"; return "k"; }; } }
class Own { toString: any; constructor() { this.toString = () => { log += "w"; return "k"; }; } }
class Tagged { get [Symbol.toStringTag]() { log += "t"; return "Tag"; } }
class Removed { toString() { return "first"; } }
const literal = { toString() { log += "l"; return "k"; } };
const dull = Object.setPrototypeOf({}, null);
const keys: [string, any][] = [["text", new Text("k")], ["index", new Text("1")], ["missing", new Text("none")], ["below", new Below("k")], ["value", new Value()], ["number", new Numbers(1)], ["double", new Numbers(1.5)], ["minus", new Numbers(-0)], ["symbol", new Symbols()], ["hinted", new Hinted()], ["objects", new Objects()],
  ["none", new NoPrimitive()], ["throws", new Throws()], ["bad", new BadPrimitive()], ["nulls", new Nulls()], ["getter", new Getter()], ["own", new Own()], ["tagged", new Tagged()], ["removed", new Removed()], ["literal", literal], ["dull", dull], ["plain", {}], ["list", ["k"]], ["lists", [1, 2]], ["date", new Date(NaN)], ["function", Object.assign(() => 1, { toString() { return "k"; } })], ["proxy", new Proxy(new Text("k"), {})], ["long", new Text("k".repeat(300))], ["proto", new Text("__proto__")], ["length", new Text("length")]];
const symbolic: any = { [sym]: "S", k: "K", "1": "one", "1.5": "onehalf", "0": "zero", null: "N", first: "F", second: "2", "[object Tag]": "tag", "[object Object]": "oo", "1,2": "lists", "Invalid Date": "date" };
class Fields { k = 1; [sym] = 2; get first() { return "G"; } set first(v) { log += "set" + String(v); } }
for (let turn = 0; turn < 3; turn++) {
  for (const [name, key] of keys) {
    const base = () => { log += "b"; return symbolic; };
    attempt(name + " read", () => symbolic[key]);
    attempt(name + " order", () => base()[(log += "e", key)]);
    attempt(name + " list", () => ([10, 20, 30] as any)[key]);
    attempt(name + " view", () => (new Uint8Array([10, 20, 30]) as any)[key]);
    attempt(name + " text", () => ("abc" as any)[key]);
    attempt(name + " number", () => (5 as any)[key]);
    attempt(name + " map", () => typeof (new Map() as any)[key]);
    attempt(name + " nullish", () => nil[key]);
    attempt(name + " store", () => { const o: any = { k: 0 }; o[key] = (log += "r", 7); return Object.entries(o).join(";") + (o[sym] ?? ""); });
    attempt(name + " store into class", () => { const o: any = new Fields(); o[key] = 7; return Object.entries(o).join(";") + o[sym]; });
    attempt(name + " store into list", () => { const o: any = [1, 2]; o[key] = 7; return o.length + JSON.stringify(Object.entries(o)); });
    attempt(name + " store into nothing", () => { nothing[key] = (log += "r", 1); return "fine"; });
    attempt(name + " store into frozen", () => { const o: any = Object.freeze({ k: 1 }); o[key] = 2; return "fine"; });
    attempt(name + " update", () => { const o: any = { k: 1, "1": 5, first: 2 }; o[key]++; o[key] += 2; return Object.entries(o).join(";"); });
    attempt(name + " in", () => key in symbolic);
    attempt(name + " in class", () => key in new Fields());
    attempt(name + " in list", () => key in [1, 2]);
    attempt(name + " in nothing", () => key in (5 as any));
    attempt(name + " hasOwn", () => Object.hasOwn(symbolic, key) + " " + Object.prototype.hasOwnProperty.call(symbolic, key) + " " + symbolic.hasOwnProperty(key));
    attempt(name + " computed", () => { const o: any = { [key]: 1 }; return Reflect.ownKeys(o).map(String).join(); });
    attempt(name + " method", () => { const o: any = { [key]() { return 1; } }; return Reflect.ownKeys(o).map(k => o[k].name).join(); });
    attempt(name + " class", () => { class C { [key] = 1; static [key] = 2; } return Reflect.ownKeys(new C()).map(String).join(); });
    attempt(name + " delete", () => { const o: any = { k: 1, "1": 2, [sym]: 3 }; return delete o[key] + Reflect.ownKeys(o).map(String).join(); });
    attempt(name + " destructured", () => { const { [key]: found, ...rest } = symbolic; return String(found) + Object.keys(rest).length; });
    attempt(name + " proxy", () => new Proxy(symbolic, { get(t, k) { log += "[" + String(k) + "]"; return (t as any)[k]; } })[key]);
    attempt(name + " call", () => { const o: any = { k() { return this === o; }, "1": () => 1, [sym]: () => 2 }; return o[key](); });
    attempt(name + " loop", () => { let r = ""; for (let i = 0; i < 4; i++) r += String((i & 1 ? symbolic : { k: 5, "1": 6 })[key]) + (key in symbolic); return r; });
    attempt(name + " reflect", () => Reflect.get(symbolic, key) + String(Reflect.has(symbolic, key)));
  }
  if (turn === 0) { (Removed.prototype as any).toString = () => { log += "R"; return "second"; }; (Text.prototype as any).valueOf = () => { log += "unseen"; return 1; }; }
  if (turn === 1) { delete (Removed.prototype as any).toString; (Value.prototype as any)[Symbol.toPrimitive] = (hint: string) => { log += "late" + hint; return "k"; }; }
}
for (const line of lines) console.log(line);
