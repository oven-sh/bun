// A loop copies the own properties of a source to a target by descriptor: names, symbols, indices, accessors, members that are not enumerable,
// with objects, classes, functions, lists, frozen objects and proxies as source or target. The descriptor may be changed, kept, renamed, joined
// with another one or used twice on the way. Afterwards members of the source are replaced, and what was copied is read, called and listed.
import type { Random } from "./random";

const sources = [
  `{ first() {\nreturn "first of " + this.label;\n}, second(n) {\nreturn this.first() + " and " + n;\n}, plain: 1, half: 1.5, text: "t" }`,
  `{ get shout() {\nreturn String(this.label).toUpperCase();\n}, set shout(value) {\nthis.label = String(value).toLowerCase();\n}, first: () => "arrow" }`,
  `{ [tag]: 7, [other]() {\nreturn "by symbol";\n}, first() {\nreturn "beside symbols";\n} }`,
  `{ 0: "zero", 1() {\nreturn "one";\n}, 10: 10, first() {\nreturn "beside indices";\n} }`,
  `Object.defineProperty({ first() {\nreturn "seen";\n} }, "hidden", { value: () => "hidden", enumerable: false, writable: false, configurable: false })`,
  `Object.defineProperties({}, { first: { value() {\nreturn "defined";\n}, configurable: true }, plain: { get: () => 2, enumerable: true } })`,
  `class Source {\nstatic first() {\nreturn "static of " + this.label;\n}\nstatic plain = 3;\nstatic get shout() {\nreturn "static getter";\n}\n}`,
  `(class Source {\nfirst() {\nreturn "method of " + this.label;\n}\nget shout() {\nreturn "getter of " + this.label;\n}\n}).prototype`,
  `new (class Source {\nplain = 4;\nfirst = () => "field";\n#hidden = 1;\n})()`,
  `Object.assign(function source() {\nreturn "source called";\n}, { first() {\nreturn "on a function";\n}, plain: 5 })`,
  `Object.assign(["a", "b"], { first() {\nreturn "on a list";\n} })`,
  `Object.freeze({ first() {\nreturn "frozen";\n}, plain: 6 })`,
  `Object.seal({ first() {\nreturn "sealed";\n}, plain: 7 })`,
  `new Proxy({ first() {\nreturn "behind a proxy";\n}, plain: 8 }, {})`,
  `new Proxy({ first() {\nreturn "listed by a trap";\n}, plain: 9, left: 1 }, { ownKeys: () => ["plain", "first", "left"] })`,
  `new Proxy({ first() {\nreturn "described by a trap";\n} }, { getOwnPropertyDescriptor: (target, key) => ({ ...Reflect.getOwnPropertyDescriptor(target, key), enumerable: false }) })`,
  `Object.create({ inherited() {\nreturn "inherited";\n} }, { first: { value() {\nreturn "own above inherited";\n}, writable: true, enumerable: true, configurable: true } })`,
  `Object.create(null, { first: { value: () => "no parent", enumerable: true } })`,
  `JSON.parse('{"plain":10,"text":"parsed","inner":{"deep":1}}')`,
  `new Map([["k", 1]])`,
  `"text"`,
] as const;

const targets = [
  `{}`,
  `{ label: "target" }`,
  `{ label: "target", first: "already there" }`,
  `function target() {\nreturn "target called";\n}`,
  `class Target {\nstatic label = "class";\n}`,
  `(class Target {\nlabel = "instance";\n}).prototype`,
  `new (class Target {\nlabel = "instance";\nplain = "own field";\n})()`,
  `[]`,
  `["x", "y", "z"]`,
  `Object.create({ label: "from the parent", first() {\nreturn "parent's";\n} })`,
  `Object.create(null)`,
  `Object.preventExtensions({ label: "closed", first: 0 })`,
  `new Proxy({ label: "proxied" }, {})`,
  `new Proxy({ label: "counted" }, { defineProperty(target, key, descriptor) {\nlines.push("defines " + String(key));\nreturn Reflect.defineProperty(target, key, descriptor);\n} })`,
  `Object.defineProperty({ label: "fixed" }, "first", { value: "fixed", configurable: false })`,
] as const;

const lists = [
  `Reflect.ownKeys(source)`,
  `Reflect.ownKeys(source)`,
  `Object.getOwnPropertyNames(source)`,
  `Object.keys(source)`,
  `Object.getOwnPropertySymbols(source)`,
  `[...Object.getOwnPropertyNames(source), ...Object.getOwnPropertySymbols(source)]`,
  `Reflect.ownKeys(source).reverse()`,
  `Reflect.ownKeys(source).filter(key => key !== "length" && key !== "name" && key !== "prototype")`,
  `["first", "plain", "shout", "absent"]`,
  `Object.keys(Object.getOwnPropertyDescriptors(source))`,
] as const;

// What one turn of the loop does with `key`.
const copies = [
  `Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));`,
  `Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));`,
  `Reflect.defineProperty(target, key, Reflect.getOwnPropertyDescriptor(source, key));`,
  `Object.defineProperty(target, key, Reflect.getOwnPropertyDescriptor(source, key));`,
  `Reflect.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));`,
  `const descriptor = Object.getOwnPropertyDescriptor(source, key);\nObject.defineProperty(target, key, descriptor);`,
  `if (Object.hasOwn(target, key)) continue;\nObject.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));`,
  `const descriptor = Object.getOwnPropertyDescriptor(source, key);\nif (descriptor === undefined) continue;\nObject.defineProperty(target, key, descriptor);`,
  `const descriptor = Object.getOwnPropertyDescriptor(source, key);\ndescriptor.enumerable = false;\nObject.defineProperty(target, key, descriptor);`,
  `const descriptor = Object.getOwnPropertyDescriptor(source, key);\nif ("value" in descriptor) descriptor.value = wrap(descriptor.value);\nObject.defineProperty(target, key, descriptor);`,
  `const descriptor = Object.getOwnPropertyDescriptor(source, key);\nif ("value" in descriptor) descriptor.writable = true;\ndescriptor.configurable = true;\nObject.defineProperty(target, key, descriptor);`,
  `const descriptor = Object.getOwnPropertyDescriptor(source, key);\nkept.push(descriptor);\nObject.defineProperty(target, key, descriptor);`,
  `const descriptor = Object.getOwnPropertyDescriptor(source, key);\nObject.defineProperty(target, key, descriptor);\nif ("value" in descriptor) descriptor.value = "changed behind the definition";`,
  `const descriptor = Object.getOwnPropertyDescriptor(source, key);\nObject.defineProperty(target, key, descriptor);\nObject.defineProperty(second, key, descriptor);`,
  `Object.defineProperty(target, typeof key === "string" ? "renamed_" + key : key, Object.getOwnPropertyDescriptor(source, key));`,
  `Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, "first") ?? { value: 0, configurable: true });`,
  `Object.defineProperty(target, key, { ...Object.getOwnPropertyDescriptor(source, key) });`,
  `Object.defineProperty(target, key, Object.assign({}, Object.getOwnPropertyDescriptor(source, key), { configurable: true }));`,
  `Object.defineProperty(target, key, nobody(0) || Object.getOwnPropertyDescriptor(source, key));`,
  `Object.defineProperty(target, key, turn % 2 ? Object.getOwnPropertyDescriptor(source, key) : Object.getOwnPropertyDescriptor(spare, key) ?? { value: "spare", configurable: true });`,
  `Object.defineProperty(nobody(1) ? target : second, key, Object.getOwnPropertyDescriptor(source, key));`,
  `define(target, key, Object.getOwnPropertyDescriptor(source, key));`,
  `Object.defineProperty(target, key, describe(source, key));`,
  `const next = key;\nObject.defineProperty(target, next, Object.getOwnPropertyDescriptor(source, key));`,
  `Object.defineProperty(target, key, Object.getOwnPropertyDescriptors(source)[key]);`,
  `target[key] = source[key];`,
] as const;

const whole = [
  `Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));`,
  `Object.assign(target, source);`,
  `for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(source))) Object.defineProperty(target, key, descriptor);`,
] as const;

const afterwards = [
  `source.first = () => "replaced in the source";`,
  `source.plain = "replaced in the source";`,
  `delete source.first;`,
  `Object.defineProperty(source, "first", { value: () => "redefined in the source", configurable: true });`,
  `target.first = () => "replaced in the target";`,
  `target.label = "renamed";`,
  `target.shout = "LOUD";`,
  `delete target.first;`,
  `for (const descriptor of kept) if ("value" in descriptor) descriptor.value = "changed late";`,
  `Object.freeze(target);`,
  `Object.setPrototypeOf(target, { first() {\nreturn "from a new parent";\n} });`,
] as const;

const looks = [
  `target.first()`,
  `target.first`,
  `target.second(2)`,
  `target.shout`,
  `target.plain`,
  `typeof target.plain === "function" ? "a function" : target.plain + 1`,
  `target.half * 2`,
  `target.hidden()`,
  `target[tag]`,
  `target[other]()`,
  `target[0]`,
  `target[1]()`,
  `target.length`,
  `target.renamed_first()`,
  `target.inherited`,
  `typeof target === "function" ? target() : "no function"`,
  `second.first()`,
  `source.first()`,
  `Reflect.ownKeys(target).map(String).join()`,
  `Object.keys(target).join()`,
  `shape(Object.getOwnPropertyDescriptor(target, "first"))`,
  `shape(Object.getOwnPropertyDescriptor(target, "plain"))`,
  `shape(Object.getOwnPropertyDescriptor(target, "shout"))`,
  `shape(Object.getOwnPropertyDescriptor(target, "hidden"))`,
  `target.first === source.first`,
  `JSON.stringify(target)`,
  `kept.length`,
] as const;

export function generate(random: Random): string {
  const rows: string[] = [];
  const count = random.between(1, 4);
  for (let row = 0; row < count; row++) {
    const loop = random.chance(0.85)
      ? `for (const key of ${random.pick(lists)}) {\n${random.pick(copies)}\n}`
      : random.pick(whole);
    const changes = Array.from(
      { length: random.between(0, 3) },
      () => `attempt("changes", () => {\n${random.pick(afterwards)}\n});`,
    );
    const seen = Array.from({ length: random.between(2, 6) }, () => random.pick(looks)).map(
      look => `attempt(${JSON.stringify(look)}, () => ${look});`,
    );
    const early = random.chance(0.3) ? seen.slice(0, 1) : [];
    rows.push(
      `function row${row}(turn) {\nwhere = "${row}";\nconst source = ${random.pick(sources)};\nconst target = ${random.pick(targets)};\nconst second = {};\nconst spare = { first: "spare first" };\nconst kept = [];\nattempt("copies", () => {\n${loop}\n});\n${[...early, ...changes, ...seen].join("\n")}\n}\nfor (let turn = 0; turn < ${random.pick([1, 1, 2, 50])}; turn++) row${row}(turn);`,
    );
  }
  return `const lines = [];
let where = "";
const tag = Symbol("tag");
const other = Symbol("other");
const nobody = globalThis[process.argv[2] ?? "Boolean"];
const wrap = value => (typeof value === "function" ? () => "wrapped" : value);
const define = (target, key, descriptor) => Object.defineProperty(target, key, descriptor);
const describe = (source, key) => Object.getOwnPropertyDescriptor(source, key);
const shape = found =>
found === undefined
? "none"
: [typeof found.value, typeof found.get, typeof found.set, found.writable, found.enumerable, found.configurable].join(" ");
function attempt(label, run) {
let text;
try {
const value = run();
text = typeof value === "function" ? "function" : typeof value === "symbol" ? "symbol" : typeof value === "object" && value !== null ? "object" : String(value);
} catch (error) {
text = "threw " + error.constructor.name;
}
lines.push(where + " " + label + ": " + text);
}
${rows.join("\n")}
console.log([...new Set(lines)].join("\\n"));
`;
}
