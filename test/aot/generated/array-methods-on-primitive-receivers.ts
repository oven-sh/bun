// Generic Array.prototype methods start with ToObject(this): a primitive string is read like a String object, and its code units are its elements.

const iterators = ["values", "keys", "entries", "[Symbol.iterator]"];

export const methods: Record<string, string> = {
  "values": "",
  "keys": "",
  "entries": "",
  "[Symbol.iterator]": "",
  "at": "0",
  "slice": "",
  "map": "each => each",
  "filter": "() => true",
  "concat": "",
  "flat": "",
  "flatMap": "each => [each]",
  "with": '0, "z"',
  "toSorted": "",
  "toReversed": "",
  "toSpliced": "0, 0",
  "find": "() => true",
  "findLast": "() => true",
  "findIndex": 'each => each === "b"',
  "findLastIndex": 'each => each === "a"',
  "indexOf": '"b"',
  "lastIndexOf": '"b"',
  "includes": '"b"',
  "join": '"-"',
  "reduce": "(sum, each) => each",
  "reduceRight": "(sum, each) => each",
  "some": 'each => each === "b"',
  "every": 'each => each === "a"',
  "forEach": "each => console.log(typeof each, show(each))",
  "toString": "",
  "toLocaleString": "",
  "push": '"c"',
  "pop": "",
  "shift": "",
  "unshift": '"c"',
  "splice": "0, 1",
  "reverse": "",
  "sort": "",
  "fill": '"c"',
  "copyWithin": "0, 1",
};

export const receivers: Record<string, { value: string; setup?: string }> = {
  "string": { value: '"ab"' },
  "string variable": { value: "text", setup: 'const text = String(globalThis.missing ?? "ab");' },
  "String object": { value: 'new String("ab")' },
  "number": { value: "5" },
  "boolean": { value: "true" },
  "symbol": { value: "Symbol.iterator" },
  "bigint": { value: "5n" },
  "number with inherited length": { value: "5", setup: "Number.prototype.length = 2;" },
  "boolean with inherited length": { value: "true", setup: "Boolean.prototype.length = 2;" },
  "symbol with inherited length": { value: "Symbol.iterator", setup: "Symbol.prototype.length = 2;" },
  "bigint with inherited length": { value: "5n", setup: "BigInt.prototype.length = 2;" },
  "array-like object": { value: '{ length: 2, 0: "a", 1: "b" }' },
};

export const calls: Record<string, (method: string, receiver: string, args: string) => string> = {
  "call": (method, receiver, args) => `${method}.call(${[receiver, args].filter(Boolean).join(", ")})`,
  "apply": (method, receiver, args) => `${method}.apply(${receiver}, [${args}])`,
  "bind": (method, receiver, args) => `${method}.bind(${receiver})(${args})`,
  "Reflect.apply": (method, receiver, args) => `Reflect.apply(${method}, ${receiver}, [${args}])`,
};

const uses: Record<string, (result: string) => string> = {
  "whole": result => `return show(${result});`,
  "length": result => `return show((${result}).length);`,
  "element": result => `return show((${result})[0]);`,
  "second element": result => `return show((${result})[1]);`,
  "typeof element": result => `return typeof (${result})[0];`,
  "pattern": result => `const [first, second] = ${result}; return show(first) + " " + show(second);`,
  "for-of": result =>
    `const seen = []; for (const each of ${result}) seen.push(typeof each + " " + show(each)); return seen.join();`,
  "callback": result => `return Array.prototype.map.call(${result}, each => typeof each + " " + show(each)).join();`,
};

const usesOfIterators: Record<string, (iterator: string) => string> = {
  "next": iterator => `return show(${iterator}.next().value);`,
  "typeof next": iterator => `return typeof ${iterator}.next().value;`,
  "pattern of the iterator": iterator =>
    `const [first, second] = ${iterator}; return show(first) + " " + show(second);`,
  "for-of over the iterator": iterator =>
    `const seen = []; for (const each of ${iterator}) seen.push(typeof each + " " + show(each)); return seen.join();`,
  "arguments": iterator =>
    `return ((first, second) => typeof first + " " + show(first) + " " + show(second))(...${iterator});`,
};

const head = `function show(value) {
  if (typeof value === "symbol") return String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value !== "object" || value === null) return String(value);
  return JSON.stringify(value, (key, inner) => (typeof inner === "bigint" || typeof inner === "symbol" ? show(inner) : inner));
}
function line(label, run) {
  let answer;
  try { answer = run(); } catch (error) { answer = "THROWS " + error.name; }
  console.log(label + " | " + answer);
}
`;

export function program(method: string, receiver: string, call: string) {
  const { value, setup = "" } = receivers[receiver];
  const made = calls[call](`Array.prototype${method.startsWith("[") ? method : "." + method}`, value, methods[method]);
  const isIterator = iterators.includes(method);
  let text = `${head}${setup}\n`;
  for (const [use, body] of Object.entries(uses))
    text += `line(${JSON.stringify(use)}, () => { ${body(isIterator ? `[...${made}]` : made)} });\n`;
  if (isIterator)
    for (const [use, body] of Object.entries(usesOfIterators))
      text += `line(${JSON.stringify(use)}, () => { ${body(made)} });\n`;
  return { file: "main.mjs", text };
}

export const wasOnceWrong = (method: string, receiver: string) =>
  ["values", "[Symbol.iterator]"].includes(method) && ["string", "string variable"].includes(receiver);

const values = 'Array.prototype.values.call("ab")';
const entries = 'Array.prototype.entries.call("ab")';

export const stored: Record<string, string> = {
  "method of a mapped element.mjs": `console.log([...${values}].map(each => each.toUpperCase())[0]);`,
  "Set.mjs": `console.log(new Set(${values}).has("a"), [...new Set(${values})][0]);`,
  "Math.max of mapped elements.mjs": `console.log(Math.max(...[...${values}].map(each => each.charCodeAt(0))));`,
  "value of an entry.mjs": `console.log([...${entries}][0][1]);`,
  "entries in for-of.mjs": `for (const [key, value] of ${entries}) console.log(key, value, typeof value);`,
  "entries in nested patterns.mjs": `const [[, first], [, second]] = ${entries};\nconsole.log(first, second);`,
  "Map of entries.mjs": `console.log(new Map(${entries}).get(0), new Map(${entries}).get(1));`,
  "Object.fromEntries.mjs": `console.log(Object.fromEntries(${entries})[0]);`,
  "rest pattern.mjs": `const [first, ...rest] = ${values};\nconsole.log(first, rest[0], rest.length);`,
  "for-of.mjs": `for (const each of ${values}) console.log(typeof each, each === undefined, each + "!");`,
  "next.mjs": `const iterator = ${values};\nconsole.log(iterator.next().value, iterator.next().value, iterator.next().value);`,
  "arguments.mjs": `function take(first, second) { return first + "|" + second + "|" + typeof first; }\nconsole.log(take(...${values}));`,
  "rest parameter.mjs": `function take(...all) { return all[0] + "|" + all.length; }\nconsole.log(take(...${values}));`,
  "constructor arguments.mjs": `class Pair { constructor(first, second) { this.first = first; this.second = second; } }\nconsole.log(new Pair(...${values}).first);`,
  "yield*.mjs": `function* all() { yield* ${values}; }\nconsole.log([...all()][0], all().next().value);`,
  "toArray.mjs": `console.log(${values}.toArray()[0]);`,
  "iterator map.mjs": `console.log(${values}.map(each => each + "!").toArray()[0]);`,
  "iterator find.mjs": `console.log(${values}.find(each => each === "b"));`,
  "iterator reduce.mjs": `console.log(${values}.reduce((sum, each) => sum + each));`,
  "iterator some and every.mjs": `console.log(${values}.some(each => each === "b"), ${values}.every(each => typeof each === "string"));`,
  "Iterator.from.mjs": `console.log([...Iterator.from(${values})][0]);`,
  "concat.mjs": `console.log([].concat([...${values}])[0]);`,
  "push.mjs": `const list = [];\nlist.push(...${values});\nconsole.log(list[0], list.length);`,
  "two spreads.mjs": `console.log([...${values}, ...${values}][2]);`,
  "array or string.mjs":
    'const source = globalThis.missing ? [1, 2] : "ab";\nconsole.log([...Array.prototype.values.call(source)][0]);',
  "parameter.mjs":
    'function first(source) { return [...Array.prototype.values.call(source)][0]; }\nconsole.log(first("ab"), first([1]), first({ length: 1, 0: true }));',
  "typed parameter.ts":
    'function first(source: string): string { return [...Array.prototype.values.call(source)][0]; }\nconsole.log(first("ab"));',
  "template literal.mjs": "const n = 1;\nconsole.log([...Array.prototype.values.call(`a${n}`)][1]);",
  "empty string.mjs":
    'console.log([...Array.prototype.values.call("")][0], [...Array.prototype.values.call("")].length);',
  "surrogate pair.mjs":
    'console.log([...Array.prototype.values.call("\\u{1F600}")].length, [...Array.prototype.values.call("\\u{1F600}")][0].charCodeAt(0));',
  "method added to String.prototype.mjs":
    'String.prototype.units = Array.prototype.values;\nconsole.log([..."ab".units()][0]);',
  "destructured method.mjs": 'const { values } = Array.prototype;\nconsole.log([...values.call("ab")][0]);',
  "method read from an array.mjs": 'console.log([...[].values.call("ab")][0]);',
  "call of call.mjs": 'console.log([...Function.prototype.call.call(Array.prototype.values, "ab")][0]);',
  "methods of the list.mjs": `const list = [...${values}];\nconsole.log(list[0], list[1], list.at(-1), list.indexOf("b"), list.includes("a"), list.join("+"));`,
  "concatenated elements.mjs": `let sum = "";\nfor (const each of [...${values}]) sum += each;\nconsole.log(sum);`,
  "nullish and truthiness.mjs": `console.log([...${values}][0] ?? "nothing", [...${values}][0] === undefined, [...${values}][0] ? "yes" : "no");`,
  "optional call.mjs": `console.log([...${values}][0]?.toUpperCase());`,
  "for await.mjs": `const all = [];\nfor await (const each of ${values}) all.push(each);\nconsole.log(all[0], typeof all[1]);`,
  "Array.fromAsync.mjs": `console.log((await Array.fromAsync(${values}))[0]);`,
  "Promise.all.mjs": `console.log((await Promise.all(${values}))[0]);`,
  "length getter on Number.prototype.mjs":
    'Object.defineProperty(Number.prototype, "length", { get() { "use strict"; console.log(typeof this); return 1; } });\nconsole.log([...Array.prototype.values.call(5)].map(each => String(each)).join());',
};
