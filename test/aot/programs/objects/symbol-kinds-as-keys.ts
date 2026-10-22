// Object literals and classes keyed by each kind of symbol: registered, well-known, unique with a description, unique without one. A symbol never finds the field named like its description.
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
const show = (v: unknown): string => (typeof v === "function" ? "function" : typeof v === "symbol" ? v.toString() : String(JSON.stringify(v)));
const read = (o: object, key: PropertyKey): unknown => (o as any)[key];
const write = (o: object, key: PropertyKey, v: unknown): void => { (o as any)[key] = v; };
const join = (...parts: string[]): string => parts.join("");

const registered = Symbol.for("k");
const first = Symbol("k");
const second = Symbol("k");
const bare = Symbol();
const blank = Symbol("");

class Plain { k = 1; kelvinReadingOfProbe = 2; }
const plain: [string, object][] = [["class", new Plain()], ["literal", { k: 3, kelvinReadingOfProbe: 4 }]];
const lookalikes: [string, symbol][] = [
  ["unique k", first],
  ["registered k", registered],
  ["unique k built", Symbol(join("", "k"))],
  ["registered k built", Symbol.for(join("", "k"))],
  ["unique long", Symbol("kelvinReadingOfProbe")],
  ["registered long", Symbol.for("kelvinReadingOfProbe")],
  ["unique long built", Symbol(join("kelvin", "ReadingOfProbe"))],
];
function misses(o: object): string {
  return lookalikes.map(([label, key]) => label + " " + [show(read(o, key)), key in o, Object.hasOwn(o, key), show(Object.getOwnPropertyDescriptor(o, key)), Reflect.has(o, key)].join()).join(" | ");
}
for (const [title, o] of plain) console.log("before", title, misses(o));
for (const [title, o] of plain) console.log("by text", title, show(read(o, join("", "k"))), show(read(o, join("kelvin", "ReadingOfProbe"))), Object.keys(o).join());
for (const [title, o] of plain) console.log("after", title, misses(o));
for (const [title, o] of plain) {
  write(o, first, "stored by unique symbol");
  write(o, registered, "stored by registered symbol");
  console.log("stored", title, show(read(o, "k")), show(read(o, first)), show(read(o, registered)), show(read(o, second)), Object.getOwnPropertySymbols(o).map(key => show(key)).join(), JSON.stringify(o));
  console.log("deleted", title, delete (o as any)[first], delete (o as any)[second], show(read(o, "k")), show(read(o, first)), Object.getOwnPropertySymbols(o).map(key => show(key)).join());
}

const literal = {
  [registered]: "registered",
  *[Symbol.iterator](): Generator<number> { yield 1; yield 2; },
  [first]: "first",
  [second]: "second",
  [bare]: "bare",
  [blank]: "blank",
  k: "text",
};
class Keyed {
  [registered] = "registered field";
  [first] = "first field";
  [second] = "second field";
  [bare] = "bare field";
  k = "text field";
  static [registered] = "static registered";
  static [first] = "static first";
  *[Symbol.iterator](): Generator<number> { yield 3; yield 4; }
  get [Symbol.toStringTag](): string { return "Keyed"; }
}
const keyed = new Keyed();

function literalReads(o: typeof literal): string { return [o[registered], o[first], o[second], o[bare], o[blank], o.k].join(); }
function fieldReads(o: Keyed): string { return [o[registered], o[first], o[second], o[bare], o.k].join(); }
function computedReads(o: object): string {
  return [Symbol.for("k"), Symbol.for(join("", "k")), first, second, bare, blank, Symbol("k"), Symbol(), Symbol(""), Symbol.iterator, "k"].map(key => show(read(o, key))).join();
}
function symbolKeys(o: object): string {
  return Object.getOwnPropertySymbols(o).map(key => show(key) + ":" + show(key.description) + ":" + show(Symbol.keyFor(key))).join(" ");
}
function report(): void {
  console.log("literal", literalReads(literal), "|", computedReads(literal), "|", symbolKeys(literal), "|", Object.keys(literal).join(), [...literal].join());
  console.log("class", fieldReads(keyed), "|", computedReads(keyed), "|", symbolKeys(keyed), "|", Object.keys(keyed).join(), [...keyed].join(), Object.prototype.toString.call(keyed));
  console.log("static", Keyed[registered], Keyed[first], computedReads(Keyed), "|", symbolKeys(Keyed), "|", symbolKeys(Keyed.prototype));
}
report();
console.log("descriptions", [registered, first, second, bare, blank, Symbol.iterator, Symbol.asyncIterator, Symbol.hasInstance].map(key => show(key.description)).join());
console.log("identity", Object.is(registered, Symbol.for("k")), Object.is(registered, Symbol.for(join("", "k"))), Object.is(first, second), Object.is(first, registered), Object.is(bare, Symbol()), Object.is(blank, bare));

const pair = { [first]: 1, [second]: 2 };
const pairKeys = Object.getOwnPropertySymbols(pair);
console.log("pair", pair[first], pair[second], pairKeys.length, Object.is(pairKeys[0], first), Object.is(pairKeys[1], second));
pair[first] = 10;
console.log("pair", pair[first], pair[second], show(read(pair, "k")), show(read(pair, registered)));

literal[registered] = "registered again";
keyed[second] = "second field again";
write(literal, Symbol.for(join("", "k")), literal[registered] + "!");
write(keyed, bare, "bare field again");
const copies: object[] = [{ ...literal }, Object.assign({}, keyed)];
collect();
report();
for (const copy of copies) console.log("copy", computedReads(copy), "|", symbolKeys(copy));
