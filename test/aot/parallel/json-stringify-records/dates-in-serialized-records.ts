// A date in a record that is serialized: JSON.stringify asks it for toJSON, which converts it to a number by Symbol.toPrimitive and valueOf and then calls toISOString. Whatever of the four one date, or a class below Date, has of its own is called; a time that is no number gives null; years in front of 0 and behind 9999 have six digits.
interface Row { at: Date; name: string }
interface Loose { at?: Date | null; list: Date[] }
const log: string[] = [];
function row(r: Row): string { return JSON.stringify(r); }
function loose(r: Loose): string { return JSON.stringify(r); }
class Stamp extends Date { toJSON(): string { log.push("Stamp.toJSON"); return "stamp " + this.getTime(); } }
class Quiet extends Date {}
class Iso extends Date { toISOString(): string { log.push("Iso.toISOString"); return "iso"; } }
class Valued extends Date { valueOf(): number { log.push("Valued.valueOf"); return NaN; } }
function withOwn(name: PropertyKey, value: unknown): Date { const d = new Date(86400000); Object.defineProperty(d, name, { value, configurable: true, writable: true, enumerable: false }); return d; }
const dates: [string, () => Date][] = [
  ["plain", () => new Date(86400000)],
  ["zero", () => new Date(0)],
  ["fraction", () => new Date(1.9)],
  ["negative", () => new Date(-1)],
  ["invalid", () => new Date(NaN)],
  ["too late", () => new Date(8.64e15 + 1)],
  ["latest", () => new Date(8.64e15)],
  ["earliest", () => new Date(-8.64e15)],
  ["year 0", () => new Date(Date.UTC(0, 0, 1) - 1900 * 365.2425 * 86400000)],
  ["year 10000", () => new Date(Date.UTC(10000, 0, 1))],
  ["year -1", () => new Date(-62198755200000)],
  ["another name", () => withOwn("label", "kept")],
  ["an enumerable name", () => Object.assign(new Date(86400000), { label: "kept" })],
  ["own toJSON", () => withOwn("toJSON", function (this: Date, key: string) { log.push("own toJSON " + key); return 5; })],
  ["own toJSON that is no function", () => withOwn("toJSON", 5)],
  ["own toISOString", () => withOwn("toISOString", () => { log.push("own toISOString"); return { not: "a text" }; })],
  ["own valueOf", () => withOwn("valueOf", () => { log.push("own valueOf"); return Infinity; })],
  ["own toPrimitive", () => withOwn(Symbol.toPrimitive, (hint: string) => { log.push("own toPrimitive " + hint); return NaN; })],
  ["own toString", () => withOwn("toString", () => { log.push("own toString"); return "text"; })],
  ["a getter toJSON", () => Object.defineProperty(new Date(86400000), "toJSON", { get() { log.push("get toJSON"); return undefined; }, configurable: true })],
  ["class with toJSON", () => new Stamp(7)],
  ["class with nothing", () => new Quiet(7)],
  ["class with toISOString", () => new Iso(7)],
  ["class with valueOf", () => new Valued(7)],
  ["no prototype", () => Object.setPrototypeOf(new Date(7), null)],
  ["the prototype of objects", () => Object.setPrototypeOf(new Date(7), Object.prototype)],
  ["the prototype of a class", () => Object.setPrototypeOf(new Date(7), Stamp.prototype)],
  ["frozen", () => Object.freeze(new Date(7))],
  ["a proxy", () => new Proxy(new Date(7), {})],
  ["a proxy that answers", () => new Proxy(new Date(7), { get(target, key) { log.push("get " + String(key)); const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } })],
  ["an object under the prototype", () => Object.create(Date.prototype)],
  ["set afterwards", () => { const d = new Date(7); d.setTime(86400000 * 2); return d; }],
  ["set to no time", () => { const d = new Date(7); d.setTime(NaN); return d; }],
];
function attempt(run: () => string): string { try { return run(); } catch (e) { return "threw " + (e as Error).name; } }
for (let i = 0; i < 3000; i++) { row({ at: new Date(i), name: "warm" }); loose({ at: new Date(i), list: [new Date(i)] }); }
for (const [label, make] of dates) {
  let first = "", second = "";
  for (let round = 0; round < 3; round++) { log.length = 0; first = attempt(() => row({ at: make(), name: "n" })); second = attempt(() => loose({ at: make(), list: [make(), new Date(1)] })); }
  console.log(label + ": " + first + " " + second + " | " + log.join());
}
console.log(loose({ list: [] }), loose({ at: null, list: [] }), loose({ at: undefined, list: [] }));
console.log(JSON.stringify(new Date(5)), JSON.stringify([new Date(5)]), JSON.stringify({ a: { b: new Date(5) } }), JSON.stringify(new Date(5), null, 2), JSON.stringify({ d: new Date(5) }, (key, value) => (typeof value === "string" ? value.length : value)), JSON.stringify({ d: new Date(5) }, ["d"]));
