// Instances of classes that stand below a built-in class, with declared fields of their own, frozen, sealed, closed, redefined and given another prototype in typed code.
// What the built-in class keeps for itself is still there afterwards, the fields answer as in plain JavaScript, and the instances live through collections.
//
//   below    Map, Set, WeakMap, WeakSet, Array, Error and its kinds, Promise, RegExp, Date, lists of bytes and of fractions, ArrayBuffer, DataView, String, Number, Boolean,
//            EventTarget, Event, URL, URLSearchParams, Headers, Blob, AbortController, TextEncoder; directly or with a class in between
//   fields   a whole number, a fraction, a text, an object, an optional one that is set late or never; set by an initializer or in the constructor
//   done     Object.freeze, seal, preventExtensions and those of Reflect; defineProperty of a declared field as a constant, as an accessor, as hidden; of a new name; defineProperties;
//            setPrototypeOf to the built-in's own prototype, to that of a sibling, to null and back; a delete of the optional field; Object.assign; one to three of them, one behind the other
//   where    in a function that takes the declared type, in a method of the class, in its constructor, in a callback of a list of instances
//   then     stores to the fields, reads of them, what the built-in class itself does, the three questions (isFrozen, isSealed, isExtensible), the names; ahead of a collection and behind it
import type { Random } from "./random";

type Base = { name: string; type?: string; arguments: string; uses: string[] };

const bases: Base[] = [
  { name: "Map", type: "Map<number, string>", arguments: "", uses: [`o.set(1, "one").size`, `o.get(1)`, `o.has(2)`, `[...o.keys()].length`] },
  { name: "Set", type: "Set<number>", arguments: "", uses: [`o.add(3).size`, `o.has(3)`, `[...o].length`] },
  { name: "WeakMap", type: "WeakMap<object, number>", arguments: "", uses: [`o.set(anchor, 4).get(anchor)`, `o.has(anchor)`] },
  { name: "WeakSet", type: "WeakSet<object>", arguments: "", uses: [`o.add(anchor).has(anchor)`] },
  { name: "Array", type: "Array<number>", arguments: "", uses: [`o.push(5)`, `o.length`, `o[0]`, `o.map(each => each + 1).length`, `o.pop()`] },
  { name: "Error", arguments: `"failed"`, uses: [`o.message`, `o.name`, `typeof o.stack`] },
  { name: "TypeError", arguments: `"of a type"`, uses: [`o.message`, `o.name`, `o instanceof Error`] },
  { name: "RangeError", arguments: `"of a range"`, uses: [`o.message`, `String(o)`] },
  { name: "Promise", type: "Promise<number>", arguments: "resolve => resolve(6)", uses: [`typeof o.then`, `o instanceof Promise`] },
  { name: "RegExp", arguments: `"a+", "g"`, uses: [`o.test("caab")`, `o.lastIndex`, `o.source`, `o.flags`] },
  { name: "Date", arguments: "86400000", uses: [`o.getTime()`, `o.getUTCDate()`, `o.setUTCDate(3)`] },
  { name: "Uint8Array", type: "Uint8Array<ArrayBuffer>", arguments: "new ArrayBuffer(4)", uses: [`o.length`, `(o[1] = 7)`, `o[1]`, `o.byteLength`] },
  { name: "Float64Array", type: "Float64Array<ArrayBuffer>", arguments: "new ArrayBuffer(0)", uses: [`o.length`, `o.byteLength`] },
  { name: "ArrayBuffer", arguments: "8", uses: [`o.byteLength`, `o.slice(2).byteLength`] },
  { name: "DataView", type: "DataView<ArrayBuffer>", arguments: "new ArrayBuffer(8)", uses: [`o.byteLength`, `(o.setInt8(1, 9), o.getInt8(1))`] },
  { name: "String", arguments: `"text"`, uses: [`o.length`, `o.charAt(1)`, `o + "!"`] },
  { name: "Number", arguments: "12", uses: [`o.valueOf()`, `o.toFixed(1)`] },
  { name: "Boolean", arguments: "true", uses: [`o.valueOf()`] },
  { name: "EventTarget", arguments: "", uses: [`o.dispatchEvent(new Event("e"))`] },
  { name: "Event", arguments: `"e"`, uses: [`o.type`, `o.bubbles`] },
  { name: "URL", arguments: `"http://host/path?q=1"`, uses: [`o.pathname`, `o.searchParams.get("q")`, `(o.hash = "h", o.href)`] },
  { name: "URLSearchParams", arguments: `"a=1&b=2"`, uses: [`o.get("b")`, `(o.append("c", "3"), o.toString())`] },
  { name: "Headers", arguments: "", uses: [`(o.set("x", "1"), o.get("x"))`, `o.has("y")`] },
  { name: "Blob", arguments: `["abc"]`, uses: [`o.size`, `o.slice(1).size`] },
  { name: "AbortController", arguments: "", uses: [`o.signal.aborted`, `(o.abort(), o.signal.aborted)`] },
  { name: "TextEncoder", arguments: "", uses: [`o.encode("ab").length`, `o.encoding`] },
];

const prelude = `type Link = { next: Link | null; n: number };
const anchor = {};
function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (value === null || typeof value !== "object") return String(value);
  return Array.isArray(value) ? "[" + value.map(show).join(", ") + "]" : "{" + Object.keys(value).sort().join(",") + "}";
}
function attempt(name: string, run: () => unknown): void {
  try {
    console.log(name, show(run()));
  } catch (error) {
    console.log(name, "throws", error instanceof Error ? error.constructor.name : typeof error);
  }
}`;

function scene(random: Random, index: number): string {
  const base = random.pick(bases);
  const name = `Below${index}`;
  const parent = base.type ?? base.name;
  const between = random.chance(0.25);
  const inConstructor = random.chance(0.4);
  const fields = inConstructor
    ? `tally: number; ratio: number; label: string; chain: Link; late?: Link;\n  constructor(i: number) {\n    super(${base.arguments});\n    this.tally = i; this.ratio = i / 4; this.label = "l" + i; this.chain = { next: null, n: i };\nIN_THE_CONSTRUCTOR  }`
    : `tally: number = 1; ratio: number = 0.25; label: string = "l"; chain: Link = { next: null, n: 1 }; late?: Link;\n  constructor(i: number) {\n    super(${base.arguments});\n    this.tally += i;\nIN_THE_CONSTRUCTOR  }`;
  const sibling = `class Sibling${index} extends ${parent} {\n  other(): string {\n    return "sibling";\n  }\n}`;
  const steps = (o: string): string[] => [
    `Object.freeze(${o});`,
    `Object.freeze(${o});`,
    `Object.seal(${o});`,
    `Object.seal(${o});`,
    `Object.preventExtensions(${o});`,
    `Object.preventExtensions(${o});`,
    `Reflect.preventExtensions(${o});`,
    `Object.defineProperty(${o}, "tally", { value: 50, writable: false });`,
    `Object.defineProperty(${o}, "tally", { get: () => 60, configurable: true });`,
    `Object.defineProperty(${o}, "label", { enumerable: false });`,
    `Object.defineProperty(${o}, "ratio", { value: 2.5, writable: true, enumerable: true, configurable: false });`,
    `Object.defineProperty(${o}, "added", { value: 70, enumerable: true });`,
    `Object.defineProperties(${o}, { chain: { value: { next: null, n: 80 }, writable: false }, more: { value: 81, enumerable: true } });`,
    `Reflect.defineProperty(${o}, "late", { value: { next: null, n: 90 }, writable: true, enumerable: true, configurable: true });`,
    `Object.setPrototypeOf(${o}, ${base.name}.prototype);`,
    `Object.setPrototypeOf(${o}, Sibling${index}.prototype);`,
    `Object.setPrototypeOf(${o}, null);`,
    `Reflect.setPrototypeOf(${o}, ${name}.prototype);`,
    `delete ${o}.late;`,
    `${o}.late = { next: null, n: 100 };`,
    `Object.assign(${o}, { tally: 110, label: "assigned" });`,
  ];
  const drawn = (o: string) => random.sample(steps(o), random.between(1, 3)).map(step => `try { ${step} } catch (error) { console.log("${index} refused", (error as Error).constructor.name); }`);
  const where = random.pick(["function", "function", "function", "method", "constructor", "callback"]);
  const close = where === "method" ? `  shut(): void {\n    ${drawn("this").join("\n    ")}\n  }\n` : "";
  const declaration = `${between ? `class Between${index} extends ${parent} {\n  depth(): number {\n    return 1;\n  }\n}\n` : ""}class ${name} extends ${between ? `Between${index}` : parent} {
  ${fields.replace("IN_THE_CONSTRUCTOR", where === "constructor" ? `    ${drawn("this").join("\n    ")}\n` : "")}
${close}  total(): number {
    return this.tally + this.ratio + this.label.length + this.chain.n + (this.late?.n ?? 0);
  }
}
${sibling}`;
  const looks = [
    `attempt("${index} total", () => o.total());`,
    `attempt("${index} tally", () => o.tally);`,
    `attempt("${index} store tally", () => (o.tally = 7));`,
    `attempt("${index} store ratio", () => (o.ratio += 0.5));`,
    `attempt("${index} store label", () => (o.label += "+"));`,
    `attempt("${index} store chain", () => (o.chain = { next: o.chain, n: 8 }).n);`,
    `attempt("${index} store in chain", () => (o.chain.n += 1));`,
    `attempt("${index} store late", () => (o.late = { next: null, n: 9 }).n);`,
    `attempt("${index} late", () => o.late?.n);`,
    `attempt("${index} names", () => Object.keys(o).sort().join());`,
    `attempt("${index} questions", () => [Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)]);`,
    `attempt("${index} is one", () => [o instanceof ${name}, o instanceof ${base.name}]);`,
    `attempt("${index} described", () => JSON.stringify(Object.getOwnPropertyDescriptor(o, "tally")));`,
    ...base.uses.map((use, at) => `attempt("${index} use ${at}", () => ${use});`),
  ];
  const look = () => random.sample(looks, random.between(3, 7)).join("\n  ");
  const many = random.pick([1, 3, 40]);
  const doIt =
    where === "function" ? `for (const o of all) close${index}(o);` : where === "method" ? `for (const o of all) o.shut();` : where === "callback" ? `all.forEach(o => {\n  ${drawn("o").join("\n  ")}\n});` : "";
  return `${declaration}
${where === "function" ? `function close${index}(o: ${name}): void {\n  ${drawn("o").join("\n  ")}\n}\n` : ""}function look${index}(o: ${name}): void {
  ${look()}
}
function again${index}(o: ${name}): void {
  ${look()}
}
{
  const all: ${name}[] = [];
  for (let i = 0; i < ${many}; i++) all.push(new ${name}(i));
  ${random.chance(0.3) ? `look${index}(all[0]);` : ""}
  ${doIt}
  look${index}(all[${random.below(many)}]);
  for (let i = 0; i < 300; i++) all[0].chain.next = { next: null, n: i };
  Bun.gc(true);
  again${index}(all[${random.below(many)}]);
  again${index}(all[all.length - 1]);
}`;
}

export function generate(random: Random): string {
  return [prelude, ...Array.from({ length: random.between(1, 4) }, (_, index) => scene(random, index)), "export {};"].join("\n") + "\n";
}
