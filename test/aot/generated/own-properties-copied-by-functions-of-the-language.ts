// A function of the language copies the own properties of a value onto another object, and the program reads the copy. Many values have own properties that are not stored as those of a
// literal are: the name, the length and the prototype of a function, the length of a list, the elements of a text, the last index of a regular expression. What is copied, and what the first
// of two calls hands to the second, is written in the call, or comes there through a variable, a function, a field, or a variable that may hold anything.
// Nothing but the reader reads a member of a value that the build does not know: what is caught is printed as a text.
// A program has one copy and one reader, in a function or in a block: what a build makes of a short program it does not make of a long one.
export const sources: Record<string, string> = {
  "a function": "function named(a, b) {}",
  "an arrow function": "(() => (a, b, c) => a)()",
  "an async function": "async function later(a) {}",
  "a generator function": "function* steps(a) {}",
  "a method": "({ method(a) {} }).method",
  "a getter": 'Object.getOwnPropertyDescriptor({ get x() { return 1; } }, "x").get',
  "a class": "class Named { static m() {} static x = 1; constructor(a) {} }",
  "a class below a class": "class Below extends class Above { static m() {} } { static x = 2; }",
  "a bound function": "function named(a, b) {}.bind(null, 1)",
  "a function with members": "Object.assign(function named(a) {}, { x: 1, m() {} })",
  "a function that was renamed": 'Object.defineProperty(function named() {}, "name", { value: "renamed" })',
  "a function without its name": "(f => (delete f.name, f))(function named(a) {})",
  "a function of the language": "Math.max",
  "a method of the language": "Array.prototype.map",
  "a getter of the language": 'Object.getOwnPropertyDescriptor(Map.prototype, "size").get',
  "a constructor of the language": "Map",
  "the constructor of lists": "Array",
  "the constructor of functions": "Function",
  "the prototype of functions": "Function.prototype",
  "a function of the host": "setTimeout",
  "a constructor of the host": "URL",
  "a function of Bun": "Bun.inspect",
  "a list": "[1, 2]",
  "a list with a hole": "[1, , 3]",
  "a list with members": "Object.assign([1], { x: 1, name: 2 })",
  "an empty list": "[]",
  "a typed array": "new Uint8Array([1, 2])",
  "the arguments of a sloppy function": "new Function('return arguments')(1, 2)",
  "the arguments of a strict function": "(function () { 'use strict'; return arguments; })(1, 2)",
  "a text object": 'new String("ab")',
  "a text": '"ab"',
  "a number object": "new Number(5)",
  "a regular expression": "/a/g",
  "an error": 'new Error("message", { cause: 1 })',
  "a date": "new Date(0)",
  "a Map": "new Map([[1, 2]])",
  "a promise": "Promise.resolve(1)",
  "a symbol object": "Object(Symbol.iterator)",
  "a proxy of a literal": "new Proxy({ x: 1, name: 2 }, {})",
  "a proxy of a function": "new Proxy(function named(a) {}, {})",
  "a literal": "{ x: 1, name: 2, length: 3 }",
  "a literal with accessors": "{ get name() { return 1; }, set name(v) {}, get x() { return 2; }, set length(v) {} }",
  "a literal with keys of every kind": '{ 1: 1, x: 2, [Symbol.iterator]: 3, 0: 4, "a-b": 5, name: 6 }',
  "a frozen literal": "Object.freeze({ x: 1, name: 2 })",
  "an object without a prototype": "Object.assign(Object.create(null), { x: 1, name: 2 })",
  "an object with hidden members":
    "Object.defineProperties({}, { name: { value: 1 }, x: { value: 2, enumerable: true }, length: { get() { return 3; } } })",
  "an instance": "new (class Named { x = 1; name = 2; #hidden = 3; get length() { return 4; } m() {} })()",
  "an instance of a class below Array": "new (class extends Array { x = 1 })(2)",
  "an instance of a class below Function": "new (class extends Function { x = 1 })('a', 'return a')",
  "what JSON.parse makes": `JSON.parse('{ "x": 1, "name": 2, "length": 3 }')`,
  "the object Math": "Math",
  "the object Reflect": "Reflect",
  "a namespace": "namespace",
};

type Copier = { inner?: (source: string) => string; outer: (operand: string) => string };
export const copiers: Record<string, Copier> = {
  "defineProperties on a literal": {
    inner: s => `Object.getOwnPropertyDescriptors(${s})`,
    outer: d => `Object.defineProperties({}, ${d})`,
  },
  "defineProperties on a literal that has the names": {
    inner: s => `Object.getOwnPropertyDescriptors(${s})`,
    outer: d => `Object.defineProperties({ name: "own", x: "own", length: "own" }, ${d})`,
  },
  "defineProperties on a list": {
    inner: s => `Object.getOwnPropertyDescriptors(${s})`,
    outer: d => `Object.defineProperties([], ${d})`,
  },
  "defineProperties on a function": {
    inner: s => `Object.getOwnPropertyDescriptors(${s})`,
    outer: d => `Object.defineProperties(function target() {}, ${d})`,
  },
  "defineProperties on an instance": {
    inner: s => `Object.getOwnPropertyDescriptors(${s})`,
    outer: d => `Object.defineProperties(new (class Target { x = 0; })(), ${d})`,
  },
  "create": { inner: s => `Object.getOwnPropertyDescriptors(${s})`, outer: d => `Object.create(null, ${d})` },
  "create below the prototype": {
    inner: s => `Object.getOwnPropertyDescriptors(${s})`,
    outer: d => `Object.create(Object.prototype, ${d})`,
  },
  "defineProperty under the name": {
    inner: s => `Object.getOwnPropertyDescriptor(${s}, "name") ?? {}`,
    outer: d => `Object.defineProperty({}, "name", ${d})`,
  },
  "defineProperty under the length": {
    inner: s => `Reflect.getOwnPropertyDescriptor(Object(${s}), "length") ?? {}`,
    outer: d => `(o => (Reflect.defineProperty(o, "length", ${d}), o))({})`,
  },
  "fromEntries of the entries": { inner: s => `Object.entries(${s})`, outer: d => `Object.fromEntries(${d})` },
  "fromEntries of the own keys": {
    inner: s => `Reflect.ownKeys(Object(${s}))`,
    outer: d => `Object.fromEntries(${d}.map(key => [key, 1]))`,
  },
  "parse of stringify": { inner: s => `JSON.stringify(${s}) ?? "null"`, outer: d => `JSON.parse(${d}) ?? {}` },
  "assign to a literal": { outer: s => `Object.assign({}, ${s})` },
  "assign to a function": { outer: s => `Object.assign(function target() {}, ${s})` },
  "assign to a list": { outer: s => `Object.assign([], ${s})` },
  "a spread": { outer: s => `({ ...${s} })` },
  "a spread behind members": { outer: s => `({ name: "own", x: "own", ...${s} })` },
  "a spread ahead of members": { outer: s => `({ ...${s}, name: "own" })` },
  "a rest": { outer: s => `(({ ...rest }) => rest)(${s})` },
  "a rest without the name": { outer: s => `(({ name, ...rest }) => rest)(${s})` },
  "structuredClone": { outer: s => `structuredClone(${s})` },
  "a loop over the names": {
    outer: s => `((from, to) => { for (const key in from) to[key] = from[key]; return to; })(${s}, {})`,
  },
  "a loop over the own keys": {
    outer: s =>
      `((from, to) => { for (const key of Reflect.ownKeys(from)) Object.defineProperty(to, key, Object.getOwnPropertyDescriptor(from, key)); return to; })(Object(${s}), {})`,
  },
};

export const roads = [
  "in the call",
  "a variable",
  "a function",
  "a field",
  "a variable that may hold anything",
] as const;
export type Road = (typeof roads)[number];

function byRoad(road: Road, name: string, expression: string): [before: string, use: string] {
  if (road === "in the call") return ["", `(${expression})`];
  if (road === "a variable") return [`const ${name} = ${expression};`, name];
  if (road === "a function") return ["", `pass(${expression})`];
  if (road === "a field") return [`const ${name} = { held: ${expression} };`, `${name}.held`];
  return [`let ${name} = ${expression}; if (process.argv.length > 5) ${name} = globalThis[process.argv[5]];`, name];
}

const namesRead = [
  "name",
  "length",
  "prototype",
  "x",
  "m",
  "lastIndex",
  "message",
  "cause",
  "callee",
  "size",
  "constructor",
];
export const readers: [label: string, read: string][] = [
  ...namesRead.map((name): [string, string] => [`a literal with ${name}`, `({ ${name}: copy.${name} })`]),
  ["a literal with the first element", "({ first: copy[0] })"],
  ["three members", "[copy.name, copy.length, typeof copy.prototype]"],
  ["the own keys", "Reflect.ownKeys(copy).map(String).join()"],
  ["the keys", "Object.keys(copy).join()"],
  ["how the name is described", 'JSON.stringify(Object.getOwnPropertyDescriptor(copy, "name"))'],
  ["how the length is described", 'JSON.stringify(Object.getOwnPropertyDescriptor(copy, "length"))'],
  ["a store to the name", '((copy.name = "stored"), copy.name)'],
  ["a store to the length", "((copy.length = 1), copy.length)"],
  ["the name removed", '[delete copy.name, "name" in copy, copy.name]'],
  ["a copy of the copy", "Object.keys({ ...copy }).join()"],
  ["the text of the name", "`${String(copy.name)}:${typeof copy.name}`"],
];

export const stands = ["in a function", "in a block"] as const;

/** `ofSource`: how what is copied reaches the first call. `ofOperand`: how what the first of two calls answers reaches the second. `stand`: where the copy is made and read. */
export function textOf(
  source: string,
  copier: string,
  ofSource: Road,
  ofOperand: Road,
  stand: (typeof stands)[number],
  reader: number,
): string {
  const { inner, outer } = copiers[copier];
  const [beforeSource, useOfSource] = byRoad(ofSource, "source", sources[source]);
  const [beforeOperand, useOfOperand] = inner ? byRoad(ofOperand, "operand", inner(useOfSource)) : ["", useOfSource];
  const made = [beforeSource, beforeOperand, `const copy = ${outer(useOfOperand)};`].filter(Boolean).join("\n  ");
  const [, read] = readers[reader];
  return `${source === "a namespace" ? 'import * as namespace from "node:path";\n' : ""}${[ofSource, ofOperand].includes("a function") ? "const pass = value => value;\n" : ""}${
    stand === "in a function" ? `function reader() {\n  ${made}\n  return ${read};\n}\n` : ""
  }try {
  ${stand === "in a function" ? "console.log(reader());" : `${made}\n  console.log(${read});`}
} catch (error) {
  console.log("THROWS", \`\${error}\`.split(":", 1)[0]);
}
`;
}

/** Every road for what the first call answers with what is copied in a variable, and every road for what is copied with the first call written in the second. */
export const pairsOfRoads = (copier: string): [Road, Road][] =>
  copiers[copier].inner
    ? [
        ...roads.map((road): [Road, Road] => ["a variable", road]),
        ...roads.filter(road => road !== "a variable").map((road): [Road, Road] => [road, "in the call"]),
      ]
    : roads.map((road): [Road, Road] => [road, "in the call"]);
