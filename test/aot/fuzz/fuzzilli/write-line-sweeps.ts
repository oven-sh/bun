// Programs of one or two lines, one question each, written out in full and not drawn. A build leaves out what a program does not reach, and finds what it reaches by the roads that it knows.
// A road that it does not know shows only where nothing else in the program reaches the same thing, so each program is built alone and holds nothing but its line.
//
//   bun write-line-sweeps.ts <folder> [texts|species|methods|walks]      writes <folder>/<family>/<n>-<words>.mjs; the Bun that runs this file says which names, classes and methods there are
//
// texts     the name of a member or a global spelled as a value: a literal, a piece of a template, a join, a sum, a comparison, the key of a Map
// species   a static method called off a class that came by `[Symbol.species]`, by a pattern, by `.constructor` of an instance or of the prototype
// methods   a method of a built-in prototype called once: by its name, by a computed name, off the prototype, through Reflect.apply(), taken out by a pattern
// walks     something that can be walked goes into something that walks it
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [out, only] = process.argv.slice(2);
let count = 0;
function write(family: string, words: string, text: string) {
  if (only && only !== family) return;
  mkdirSync(join(out, family), { recursive: true });
  const name = `${String(++count).padStart(5, "0")}-${words.replace(/[^\w$]+/g, "-").slice(0, 100)}.mjs`;
  writeFileSync(join(out, family, name), text + "\n");
}
const isName = (key: string) => /^[A-Za-z_$][\w$]*$/.test(key);
const ownNames = (holder: object) => Object.getOwnPropertyNames(holder).filter(isName);
const halves = (word: string) =>
  [word.slice(0, word.length >> 1), word.slice(word.length >> 1)].map(half => JSON.stringify(half));

/** An instance of each class of the language, and of Buffer. */
const instances: Record<string, string> = {
  Array: "[1, 2]",
  String: '"ab"',
  Number: "1.5",
  Boolean: "true",
  BigInt: "1n",
  Symbol: 'Symbol("a")',
  Function: "(function () {})",
  Object: "({ a: 1 })",
  Map: "new Map([[1, 2]])",
  Set: "new Set([1])",
  WeakMap: "new WeakMap()",
  WeakSet: "new WeakSet()",
  Promise: "Promise.resolve(1)",
  RegExp: "/a/g",
  Date: "new Date(0)",
  Error: 'new Error("a")',
  ArrayBuffer: "new ArrayBuffer(8)",
  SharedArrayBuffer: "new SharedArrayBuffer(8)",
  DataView: "new DataView(new ArrayBuffer(8))",
  Int8Array: "new Int8Array(2)",
  Uint8Array: "new Uint8Array(2)",
  Uint8ClampedArray: "new Uint8ClampedArray(2)",
  Int16Array: "new Int16Array(2)",
  Uint16Array: "new Uint16Array(2)",
  Int32Array: "new Int32Array(2)",
  Uint32Array: "new Uint32Array(2)",
  Float32Array: "new Float32Array(2)",
  Float64Array: "new Float64Array(2)",
  BigInt64Array: "new BigInt64Array(2)",
  BigUint64Array: "new BigUint64Array(2)",
  Buffer: "Buffer.alloc(2)",
  Iterator: "[1, 2].values()",
  URL: 'new URL("http://a.test/")',
  URLSearchParams: 'new URLSearchParams("a=1")',
  TextEncoder: "new TextEncoder()",
  TextDecoder: "new TextDecoder()",
  AbortController: "new AbortController()",
  Headers: "new Headers()",
};
const classOf = (name: string) => (globalThis as any)[name] as (Function & Record<PropertyKey, unknown>) | undefined;

// texts
{
  const names = new Set<string>(ownNames(globalThis));
  for (const holder of [Object, Function, Array, Promise, Symbol, Reflect, String, Number, JSON, Math, process, Bun])
    for (const name of ownNames(holder)) names.add(name);
  for (const holder of [Object, Function, Array, Promise, String, RegExp, Error, Map, Set, Symbol])
    for (const name of ownNames(holder.prototype)) names.add(name);
  for (const name of [
    "done",
    "value",
    "default",
    "exports",
    "module",
    "require",
    "raw",
    "get",
    "set",
    "enumerable",
    "cause",
    "__proto__",
  ])
    names.add(name);
  for (const name of [...names].sort()) {
    const text = JSON.stringify(name);
    const [first, second] = halves(name);
    write("texts", `literal-${name}`, `console.log(${text});`);
    write("texts", `template-${name}`, `console.log(\`${name}\${Date.now() > 0 ? "" : "x"}\`);`);
    write("texts", `join-${name}`, `console.log([${first}, ${second}].join(""));`);
    write("texts", `sum-${name}`, `console.log(${first} + ${second});`);
    write("texts", `compared-${name}`, `const word = Date.now() > 0 ? ${text} : "a";\nconsole.log(word === ${text});`);
    write("texts", `key-of-a-map-${name}`, `console.log(new Map([[${text}, 1]]).get(${text}));`);
  }
  write(
    "texts",
    "defined-on-the-global-object",
    `Object.defineProperty(globalThis, "madeUp", { value: 1 });\nconsole.log(madeUp);`,
  );
  write(
    "texts",
    "several-defined-on-the-global-object",
    `Object.defineProperties(globalThis, { madeUp: { value: 1 } });\nconsole.log(madeUp);`,
  );
}

// species
for (const [name, instance] of Object.entries(instances)) {
  const made = classOf(name);
  if (!made) continue;
  const statics = new Set<string>();
  for (
    let holder: object | null = made;
    holder && holder !== Function.prototype;
    holder = Object.getPrototypeOf(holder)
  )
    for (const key of ownNames(holder)) if (typeof (made as any)[key] === "function") statics.add(key);
  const roads: [string, string][] = [
    ["constructor-of-an-instance", `const Maker = ${instance}.constructor;`],
    ["constructor-of-the-prototype", `const Maker = ${name}.prototype.constructor;`],
    ["constructor-above-an-instance", `const Maker = Object.getPrototypeOf(${instance}).constructor;`],
  ];
  if (Symbol.species in made)
    roads.push(
      ["species", `const Maker = ${name}[Symbol.species];`],
      ["species-by-a-pattern", `const { [Symbol.species]: Maker } = ${name};`],
      ["species-by-reflect", `const Maker = Reflect.get(${name}, Symbol.species);`],
    );
  for (const [road, line] of roads)
    for (const key of statics)
      write("species", `${road}-${name}-${key}`, `${line}\nconsole.log(typeof Maker.${key}());`);
}

// methods
for (const [name, instance] of Object.entries(instances)) {
  const made = classOf(name);
  if (!made?.prototype) continue;
  for (const key of ownNames(made.prototype as object)) {
    const described = Object.getOwnPropertyDescriptor(made.prototype, key)!;
    if (typeof described.value !== "function" || key === "constructor") continue;
    const [first, second] = halves(key);
    const shown = (call: string) => `console.log(typeof ${call});`;
    write("methods", `named-${name}-${key}`, shown(`${instance}.${key}()`));
    write("methods", `by-a-text-${name}-${key}`, shown(`${instance}[${JSON.stringify(key)}]()`));
    write(
      "methods",
      `by-a-joined-text-${name}-${key}`,
      `const name = [${first}, ${second}].join("");\n${shown(`${instance}[name]()`)}`,
    );
    write("methods", `off-the-prototype-${name}-${key}`, shown(`${name}.prototype.${key}.call(${instance})`));
    write("methods", `by-reflect-${name}-${key}`, shown(`Reflect.apply(${name}.prototype.${key}, ${instance}, [])`));
    write(
      "methods",
      `by-a-pattern-${name}-${key}`,
      `const { ${key}: taken } = ${instance};\n${shown(`taken.call(${instance})`)}`,
    );
    write("methods", `read-and-never-called-${name}-${key}`, `console.log(typeof ${instance}.${key});`);
  }
}

// walks
{
  const plain = "4, 5, 4";
  const pairs = '["a", 1], ["b", 2], ["a", 3]';
  const lists = (items: string) => [
    `[${items}]`,
    `JSON.parse(${JSON.stringify(`[${items}]`)})`,
    `Object.freeze([${items}])`,
    `Object.freeze([${items}, , ${items}])`,
    `[${items}].slice()`,
    `[${items}].map(each => each)`,
    `structuredClone([${items}])`,
    `Array.of(${items})`,
    `Array.from([${items}])`,
    `new (class extends Array {})(${items})`,
  ];
  const sources = [
    "L",
    "L.values()",
    "L.keys()",
    "L.entries()",
    "L[Symbol.iterator]()",
    "new Set(L)",
    "new Set(L).values()",
    "(function () { return arguments; })(...L)",
    "((...all) => all)(...L)",
    "(texts => texts)`a${1}b${2}a`",
    "process.execArgv.concat(L)",
    "Object.values(L)",
    "Object.entries(L)",
    "(function* () { yield* L; })()",
    "L.values().map(each => each)",
    "Iterator.from(L)",
    "({ [Symbol.iterator]: () => L.values() })",
    "L.toReversed()",
    "L.flat()",
  ];
  const sinks: [string, boolean][] = [
    ["new Map(S).size", true],
    ["[...new Map(S)].join()", true],
    ["JSON.stringify(Object.fromEntries(S))", true],
    ["new Set(S).size", false],
    ["[...new Set(S)].join()", false],
    ["new Uint8Array(S).join()", false],
    ["Uint8Array.from(S).length", false],
    ["new Float64Array(S).join()", false],
    ["Array.from(S).length", false],
    ["[...S].join()", false],
    ["Math.max(...S)", false],
    ["((...all) => all.length)(...S)", false],
    ['(([first, second]) => first + "|" + second)(S)', false],
    ["Buffer.from(S).length", false],
    ["Array.from(S, each => each).join()", false],
    ["new Set(S).union(new Set([9])).size", false],
  ];
  for (const [sink, takesPairs] of sinks)
    lists(takesPairs ? pairs : plain).forEach((list, at) =>
      sources.forEach((source, from) =>
        write(
          "walks",
          `list-${at}-source-${from}-${sink}`,
          `const rows = ${list};\nconsole.log(${sink.replace(/\bS\b/g, `(${source.replace(/\bL\b/g, "rows")})`)});`,
        ),
      ),
    );
}
console.log(`${count} programs`);
