import { lines, type Program } from "./program";

interface Pair {
  words: string;
  first: string;
  second: string;
  useFirst(text: string): string;
  useSecond(text: string): string;
  useEither(text: string): string;
  setup?: string[];
  isNumeric?: boolean;
  isPlainData?: boolean;
}

const plusOne = (text: string) => `${text} + 1`;
const length = (text: string) => `${text}.length`;
const double = (text: string) => `${text}.double()`;
const kind = (text: string) => `typeof ${text}, ${text}`;

const items = [
  "class Item {",
  "  constructor(size) {",
  "    this.size = size;",
  "  }",
  "  double() {",
  "    return this.size * 2;",
  "  }",
  "}",
];

const pairs: Pair[] = [
  {
    words: "two-fractions",
    first: "1.5",
    second: "2.5",
    useFirst: plusOne,
    useSecond: plusOne,
    useEither: plusOne,
    isNumeric: true,
    isPlainData: true,
  },
  {
    words: "an-integer-and-a-fraction",
    first: "7",
    second: "1.5",
    useFirst: plusOne,
    useSecond: plusOne,
    useEither: plusOne,
    isNumeric: true,
    isPlainData: true,
  },
  {
    words: "two-instances",
    first: "new Item(1.5)",
    second: "new Item(7)",
    useFirst: double,
    useSecond: double,
    useEither: double,
    setup: items,
  },
  {
    words: "two-integers",
    first: "7",
    second: "8",
    useFirst: plusOne,
    useSecond: plusOne,
    useEither: plusOne,
    isNumeric: true,
    isPlainData: true,
  },
  {
    words: "two-texts",
    first: '"text"',
    second: '"more text"',
    useFirst: length,
    useSecond: length,
    useEither: length,
    isPlainData: true,
  },
  {
    words: "an-integer-and-text",
    first: "7",
    second: '"text"',
    useFirst: plusOne,
    useSecond: length,
    useEither: kind,
    isPlainData: true,
  },
  {
    words: "a-fraction-and-undefined",
    first: "1.5",
    second: "undefined",
    useFirst: plusOne,
    useSecond: text => `${text} === undefined`,
    useEither: kind,
  },
  {
    words: "an-instance-and-null",
    first: "new Item(1.5)",
    second: "null",
    useFirst: double,
    useSecond: text => `${text} === null`,
    useEither: text => `${text} === null ? "null" : ${text}.double()`,
    setup: items,
  },
];
const mainPairs = pairs.slice(0, 3);

interface Writer {
  words: string;
  rows: string[];
  write(pair: Pair): string[];
}

interface Reader {
  words: string;
  rows: string[];
  read(pair: Pair): string[];
  needs?: "numeric" | "plain data";
}

const both = (pair: Pair, first: string, second: string) =>
  `console.log(${pair.useFirst(first)}, ${pair.useSecond(second)});`;
const listReader = (words: string, rows: string[], make: string, needs?: Reader["needs"]): Reader => ({
  words,
  rows,
  needs,
  read: pair => [`const list = ${make};`, `console.log(list.length);`, both(pair, "list[0]", "list[1]")],
});

const setWriters: Writer[] = [
  {
    words: "add",
    rows: ["Set.prototype.add"],
    write: pair => ["const held = new Set();", `held.add(${pair.first});`, `held.add(${pair.second});`],
  },
  {
    words: "chained-calls-of-add",
    rows: ["Set.prototype.add"],
    write: pair => [`const held = new Set().add(${pair.first}).add(${pair.second});`],
  },
  {
    words: "its-constructor",
    rows: ["Set"],
    write: pair => [`const held = new Set([${pair.first}, ${pair.second}]);`],
  },
  {
    words: "union",
    rows: ["Set.prototype.union"],
    write: pair => [`const held = new Set().union(new Set([${pair.first}, ${pair.second}]));`],
  },
];

const setReaders: Reader[] = [
  listReader("a-spread", ["%SetIterator%.prototype.next"], "[...held]"),
  listReader("a-spread-of-its-values", ["Set.prototype.values"], "[...held.values()]"),
  listReader("a-spread-of-its-keys", ["Set.prototype.keys"], "[...held.keys()]"),
  listReader("array-from", ["Array.from"], "Array.from(held)"),
  listReader("array-from-of-its-values", ["Array.from", "Set.prototype.values"], "Array.from(held.values())"),
  listReader("array-from-with-a-callback", ["Array.from"], "Array.from(held, value => value)"),
  listReader("to-array-of-its-values", ["Iterator.prototype.toArray"], "held.values().toArray()"),
  listReader(
    "to-array-of-its-mapped-values",
    ["Iterator.prototype.map", "Iterator.prototype.toArray"],
    "held.values().map(value => value).toArray()",
  ),
  listReader("a-spread-of-a-copy", ["Set"], "[...new Set(held)]"),
  listReader("a-spread-of-a-union", ["Set.prototype.union"], "[...held.union(new Set())]"),
  listReader("a-spread-of-a-difference", ["Set.prototype.difference"], "[...held.difference(new Set())]"),
  listReader("a-spread-of-an-intersection", ["Set.prototype.intersection"], "[...held.intersection(held)]"),
  listReader("concat-of-a-spread", ["Array.prototype.concat"], "[].concat([...held])"),
  listReader("promise-all", ["Promise.all"], "await Promise.all(held)"),
  listReader("object-group-by", ["Object.groupBy"], 'Object.groupBy(held, () => "all").all'),
  listReader("a-spread-of-a-structured-clone", ["structuredClone"], "[...structuredClone(held)]", "plain data"),
  {
    words: "a-spread-of-its-entries",
    rows: ["Set.prototype.entries"],
    read: pair => ["const list = [...held.entries()];", both(pair, "list[0][1]", "list[1][0]")],
  },
  {
    words: "a-pattern",
    rows: ["%SetIterator%.prototype.next"],
    read: pair => [
      "const [first, second, third] = held;",
      both(pair, "first", "second"),
      "console.log(third === undefined);",
    ],
  },
  {
    words: "a-loop",
    rows: ["%SetIterator%.prototype.next"],
    read: pair => [`for (const value of held) console.log(${pair.useEither("value")});`],
  },
  {
    words: "for-each",
    rows: ["Set.prototype.forEach"],
    read: pair => [`held.forEach(value => console.log(${pair.useEither("value")}));`],
  },
  {
    words: "next-of-its-values",
    rows: ["Set.prototype.values", "%SetIterator%.prototype.next"],
    read: pair => [
      "const steps = held.values();",
      both(pair, "steps.next().value", "steps.next().value"),
      "console.log(steps.next().value === undefined);",
    ],
  },
  {
    words: "math-max-with-a-spread",
    rows: ["Math.max"],
    needs: "numeric",
    read: () => ["console.log(Math.max(...held) + 1, Math.min(...held) + 1);"],
  },
  {
    words: "a-call-with-a-spread",
    rows: [],
    read: pair => ["function use(first, second) {", `  ${both(pair, "first", "second")}`, "}", "use(...held);"],
  },
];

const mapWriters: Writer[] = [
  {
    words: "set",
    rows: ["Map.prototype.set"],
    write: pair => ["const held = new Map();", `held.set("a", ${pair.first});`, `held.set("b", ${pair.second});`],
  },
  {
    words: "chained-calls-of-set",
    rows: ["Map.prototype.set"],
    write: pair => [`const held = new Map().set("a", ${pair.first}).set("b", ${pair.second});`],
  },
  {
    words: "get-or-insert",
    rows: ["Map.prototype.getOrInsert"],
    write: pair => [
      "const held = new Map();",
      `held.getOrInsert("a", ${pair.first});`,
      `held.getOrInsert("b", ${pair.second});`,
    ],
  },
  {
    words: "get-or-insert-computed",
    rows: ["Map.prototype.getOrInsertComputed"],
    write: pair => [
      "const held = new Map();",
      `held.getOrInsertComputed("a", () => ${pair.first});`,
      `held.getOrInsertComputed("b", () => ${pair.second});`,
    ],
  },
  {
    words: "its-constructor",
    rows: ["Map"],
    write: pair => [`const held = new Map([["a", ${pair.first}], ["b", ${pair.second}]]);`],
  },
  {
    words: "its-constructor-from-object-entries",
    rows: ["Map", "Object.entries"],
    write: pair => [`const held = new Map(Object.entries({ a: ${pair.first}, b: ${pair.second} }));`],
  },
];

const mapReaders: Reader[] = [
  {
    words: "get",
    rows: ["Map.prototype.get"],
    read: pair => [both(pair, 'held.get("a")', 'held.get("b")'), 'console.log(held.get("c") === undefined);'],
  },
  listReader("a-spread-of-its-values", ["Map.prototype.values", "%MapIterator%.prototype.next"], "[...held.values()]"),
  listReader("array-from-of-its-values", ["Array.from", "Map.prototype.values"], "Array.from(held.values())"),
  listReader("to-array-of-its-values", ["Iterator.prototype.toArray"], "held.values().toArray()"),
  listReader("array-from-with-a-callback", ["Array.from"], "Array.from(held, ([key, value]) => value)"),
  listReader("a-mapped-spread", ["Array.prototype.map"], "[...held].map(([key, value]) => value)"),
  {
    words: "a-spread",
    rows: ["%MapIterator%.prototype.next"],
    read: pair => [
      "const list = [...held];",
      both(pair, "list[0][1]", "list[1][1]"),
      "console.log(list[0][0].length);",
    ],
  },
  {
    words: "a-spread-of-its-entries",
    rows: ["Map.prototype.entries"],
    read: pair => ["const list = [...held.entries()];", both(pair, "list[0][1]", "list[1][1]")],
  },
  {
    words: "a-loop-with-a-pattern",
    rows: ["%MapIterator%.prototype.next"],
    read: pair => [`for (const [key, value] of held) console.log(key, ${pair.useEither("value")});`],
  },
  {
    words: "for-each",
    rows: ["Map.prototype.forEach"],
    read: pair => [`held.forEach((value, key) => console.log(key, ${pair.useEither("value")}));`],
  },
  {
    words: "next-of-its-values",
    rows: ["Map.prototype.values", "%MapIterator%.prototype.next"],
    read: pair => ["const steps = held.values();", both(pair, "steps.next().value", "steps.next().value")],
  },
  {
    words: "next-of-its-entries",
    rows: ["Map.prototype.entries", "%MapIterator%.prototype.next"],
    read: pair => ["const steps = held.entries();", both(pair, "steps.next().value[1]", "steps.next().value[1]")],
  },
  {
    words: "object-from-entries",
    rows: ["Object.fromEntries"],
    read: pair => ["const made = Object.fromEntries(held);", both(pair, "made.a", "made.b")],
  },
  {
    words: "get-of-a-copy",
    rows: ["Map"],
    read: pair => ["const copy = new Map(held);", both(pair, 'copy.get("a")', 'copy.get("b")')],
  },
  {
    words: "get-of-a-structured-clone",
    rows: ["structuredClone"],
    needs: "plain data",
    read: pair => ["const copy = structuredClone(held);", both(pair, 'copy.get("a")', 'copy.get("b")')],
  },
  {
    words: "get-or-insert",
    rows: ["Map.prototype.getOrInsert"],
    read: pair => [both(pair, 'held.getOrInsert("a", false)', 'held.getOrInsert("b", false)')],
  },
  {
    words: "math-max-with-a-spread",
    rows: ["Math.max"],
    needs: "numeric",
    read: () => ["console.log(Math.max(...held.values()) + 1);"],
  },
];

const keyWriters: Writer[] = [
  {
    words: "set",
    rows: ["Map.prototype.set"],
    write: pair => ["const held = new Map();", `held.set(${pair.first}, "a");`, `held.set(${pair.second}, "b");`],
  },
];
const keyReaders: Reader[] = [
  listReader("a-spread-of-its-keys", ["Map.prototype.keys", "%MapIterator%.prototype.next"], "[...held.keys()]"),
  listReader("array-from-of-its-keys", ["Array.from", "Map.prototype.keys"], "Array.from(held.keys())"),
  {
    words: "a-spread",
    rows: ["%MapIterator%.prototype.next"],
    read: pair => ["const list = [...held];", both(pair, "list[0][0]", "list[1][0]")],
  },
  {
    words: "a-loop-with-a-pattern",
    rows: ["%MapIterator%.prototype.next"],
    read: pair => [`for (const [key] of held) console.log(${pair.useEither("key")});`],
  },
  {
    words: "for-each",
    rows: ["Map.prototype.forEach"],
    read: pair => [`held.forEach((value, key) => console.log(${pair.useEither("key")}));`],
  },
];

const listWriters: Writer[] = [
  {
    words: "push",
    rows: ["Array.prototype.push"],
    write: pair => ["const held = [];", `held.push(${pair.first});`, `held.push(${pair.second});`],
  },
  {
    words: "one-push",
    rows: ["Array.prototype.push"],
    write: pair => ["const held = [];", `held.push(${pair.first}, ${pair.second});`],
  },
  {
    words: "push-with-a-spread",
    rows: ["Array.prototype.push"],
    write: pair => ["const held = [];", `held.push(...[${pair.first}, ${pair.second}]);`],
  },
  {
    words: "unshift",
    rows: ["Array.prototype.unshift"],
    write: pair => ["const held = [];", `held.unshift(${pair.second});`, `held.unshift(${pair.first});`],
  },
  {
    words: "splice",
    rows: ["Array.prototype.splice"],
    write: pair => ["const held = [];", `held.splice(0, 0, ${pair.first}, ${pair.second});`],
  },
  { words: "array-of", rows: ["Array.of"], write: pair => [`const held = Array.of(${pair.first}, ${pair.second});`] },
  {
    words: "the-array-constructor",
    rows: ["Array"],
    write: pair => [`const held = new Array(${pair.first}, ${pair.second});`],
  },
  {
    words: "concat",
    rows: ["Array.prototype.concat"],
    write: pair => [`const held = [].concat(${pair.first}, [${pair.second}]);`],
  },
  {
    words: "array-from-with-a-callback",
    rows: ["Array.from"],
    write: pair => [
      `const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? ${pair.first} : ${pair.second}));`,
    ],
  },
  {
    words: "array-from-of-an-array-like-object",
    rows: ["Array.from"],
    write: pair => [`const held = Array.from({ length: 2, 0: ${pair.first}, 1: ${pair.second} });`],
  },
  {
    words: "fill-and-with",
    rows: ["Array.prototype.fill", "Array.prototype.with"],
    write: pair => [`const held = new Array(2).fill(${pair.first}).with(1, ${pair.second});`],
  },
  {
    words: "reflect-set",
    rows: ["Reflect.set"],
    write: pair => [
      "const held = [];",
      `Reflect.set(held, 0, ${pair.first});`,
      `Reflect.set(held, 1, ${pair.second});`,
    ],
  },
  {
    words: "object-assign",
    rows: ["Object.assign"],
    write: pair => [`const held = Object.assign([], { 0: ${pair.first}, 1: ${pair.second} });`],
  },
  {
    words: "object-values",
    rows: ["Object.values"],
    write: pair => [`const held = Object.values({ a: ${pair.first}, b: ${pair.second} });`],
  },
  {
    words: "map",
    rows: ["Array.prototype.map"],
    write: pair => [`const held = [0, 1].map(index => (index === 0 ? ${pair.first} : ${pair.second}));`],
  },
  {
    words: "flat-map",
    rows: ["Array.prototype.flatMap"],
    write: pair => [`const held = [0].flatMap(() => [${pair.first}, ${pair.second}]);`],
  },
  {
    words: "a-spread-of-a-generator",
    rows: ["%Generator%.prototype.next"],
    write: pair => [
      "function* values() {",
      `  yield ${pair.first};`,
      `  yield ${pair.second};`,
      "}",
      "const held = [...values()];",
    ],
  },
  {
    words: "plain-stores-honest",
    rows: [],
    write: pair => ["const held = [];", `held[0] = ${pair.first};`, `held[1] = ${pair.second};`],
  },
];

const listReaders: Reader[] = [
  {
    words: "its-indexes",
    rows: [],
    read: pair => [
      "console.log(held.length);",
      both(pair, "held[0]", "held[1]"),
      "console.log(held[2] === undefined);",
    ],
  },
  { words: "at", rows: ["Array.prototype.at"], read: pair => [both(pair, "held.at(0)", "held.at(-1)")] },
  listReader("a-spread", ["%ArrayIterator%.prototype.next"], "[...held]"),
  listReader("slice", ["Array.prototype.slice"], "held.slice()"),
  listReader("concat", ["Array.prototype.concat"], "held.concat()"),
  listReader("concat-onto-an-empty-list", ["Array.prototype.concat"], "[].concat(held)"),
  listReader("array-from", ["Array.from"], "Array.from(held)"),
  listReader("map", ["Array.prototype.map"], "held.map(value => value)"),
  listReader("filter", ["Array.prototype.filter"], "held.filter(() => true)"),
  listReader("flat", ["Array.prototype.flat"], "[held].flat()"),
  listReader("flat-map", ["Array.prototype.flatMap"], "held.flatMap(value => [value])"),
  listReader("to-sorted", ["Array.prototype.toSorted"], "held.toSorted(() => 0)"),
  listReader("to-spliced", ["Array.prototype.toSpliced"], "held.toSpliced(2, 0)"),
  listReader("to-reversed-twice", ["Array.prototype.toReversed"], "held.toReversed().toReversed()"),
  listReader("splice", ["Array.prototype.splice"], "held.splice(0)"),
  listReader("object-values", ["Object.values"], "Object.values(held)"),
  listReader("a-spread-of-a-set", ["Set"], "[...new Set(held)]"),
  listReader(
    "to-array-of-its-values",
    ["Array.prototype.values", "Iterator.prototype.toArray"],
    "held.values().toArray()",
  ),
  listReader("structured-clone", ["structuredClone"], "structuredClone(held)", "plain data"),
  listReader("json", ["JSON.parse", "JSON.stringify"], "JSON.parse(JSON.stringify(held))", "plain data"),
  listReader("promise-all", ["Promise.all"], "await Promise.all(held)"),
  {
    words: "a-pattern",
    rows: ["%ArrayIterator%.prototype.next"],
    read: pair => [
      "const [first, second, third] = held;",
      both(pair, "first", "second"),
      "console.log(third === undefined);",
    ],
  },
  {
    words: "a-loop",
    rows: ["%ArrayIterator%.prototype.next"],
    read: pair => [`for (const value of held) console.log(${pair.useEither("value")});`],
  },
  {
    words: "for-each",
    rows: ["Array.prototype.forEach"],
    read: pair => [`held.forEach(value => console.log(${pair.useEither("value")}));`],
  },
  {
    words: "find-and-find-last",
    rows: ["Array.prototype.find", "Array.prototype.findLast"],
    read: pair => [both(pair, "held.find(() => true)", "held.findLast(() => true)")],
  },
  {
    words: "shift-and-pop",
    rows: ["Array.prototype.shift", "Array.prototype.pop"],
    read: pair => [both(pair, "held.shift()", "held.pop()"), "console.log(held.length, held.pop() === undefined);"],
  },
  {
    words: "reduce",
    rows: ["Array.prototype.reduce", "Array.prototype.reduceRight"],
    read: pair => [both(pair, "held.reduceRight((kept, value) => value)", "held.reduce((kept, value) => value)")],
  },
  {
    words: "next-of-its-values",
    rows: ["Array.prototype.values", "%ArrayIterator%.prototype.next"],
    read: pair => ["const steps = held.values();", both(pair, "steps.next().value", "steps.next().value")],
  },
  {
    words: "its-entries",
    rows: ["Array.prototype.entries"],
    read: pair => [`for (const [index, value] of held.entries()) console.log(index + 1, ${pair.useEither("value")});`],
  },
  {
    words: "object-entries",
    rows: ["Object.entries"],
    read: pair => ["const entries = Object.entries(held);", both(pair, "entries[0][1]", "entries[1][1]")],
  },
  {
    words: "reflect-get",
    rows: ["Reflect.get"],
    read: pair => [both(pair, "Reflect.get(held, 0)", 'Reflect.get(held, "1")')],
  },
  {
    words: "a-descriptor",
    rows: ["Object.getOwnPropertyDescriptor"],
    read: pair => [
      both(pair, "Object.getOwnPropertyDescriptor(held, 0).value", "Object.getOwnPropertyDescriptor(held, 1).value"),
    ],
  },
  {
    words: "a-call-with-a-spread",
    rows: [],
    read: pair => ["function use(first, second) {", `  ${both(pair, "first", "second")}`, "}", "use(...held);"],
  },
  {
    words: "function-apply",
    rows: ["Function.prototype.apply"],
    read: pair => [
      "function use(first, second) {",
      `  ${both(pair, "first", "second")}`,
      "}",
      "use.apply(null, held);",
    ],
  },
  {
    words: "math-max-with-a-spread",
    rows: ["Math.max"],
    needs: "numeric",
    read: () => ["console.log(Math.max(...held) + 1, Math.min(...held) + 1);"],
  },
  {
    words: "a-sum",
    rows: [],
    needs: "numeric",
    read: () => [
      "let total = 0;",
      "for (let index = 0; index < held.length; index++) total += held[index];",
      "console.log(total);",
    ],
  },
  { words: "join", rows: ["Array.prototype.join"], needs: "plain data", read: () => ["console.log(held.join());"] },
  {
    words: "index-of-and-includes",
    rows: ["Array.prototype.indexOf", "Array.prototype.includes"],
    needs: "plain data",
    read: pair => [
      `console.log(held.indexOf(${pair.second}), held.includes(${pair.first}), held.lastIndexOf(${pair.first}), held.includes(99));`,
    ],
  },
  {
    words: "sort",
    rows: ["Array.prototype.sort"],
    needs: "numeric",
    read: () => ["held.sort((left, right) => left - right);", "console.log(held[0] + 1, held[1] + 1);"],
  },
  {
    words: "a-typed-array",
    rows: ["Float64Array"],
    needs: "numeric",
    read: () => ["const view = new Float64Array(held);", "console.log(view[0] + 1, view[1] + 1);"],
  },
];

const objectWriters: Writer[] = [
  {
    words: "object-assign",
    rows: ["Object.assign"],
    write: pair => [`const held = Object.assign({}, { a: ${pair.first} }, { b: ${pair.second} });`],
  },
  {
    words: "object-from-entries",
    rows: ["Object.fromEntries"],
    write: pair => [`const held = Object.fromEntries([["a", ${pair.first}], ["b", ${pair.second}]]);`],
  },
  {
    words: "object-define-property",
    rows: ["Object.defineProperty"],
    write: pair => [
      "const held = {};",
      `Object.defineProperty(held, "a", { value: ${pair.first}, enumerable: true });`,
      `Object.defineProperty(held, "b", { value: ${pair.second}, enumerable: true });`,
    ],
  },
  {
    words: "object-define-properties",
    rows: ["Object.defineProperties"],
    write: pair => [
      `const held = Object.defineProperties({}, { a: { value: ${pair.first}, enumerable: true }, b: { value: ${pair.second}, enumerable: true } });`,
    ],
  },
  {
    words: "object-create",
    rows: ["Object.create"],
    write: pair => [
      `const held = Object.create(null, { a: { value: ${pair.first}, enumerable: true }, b: { value: ${pair.second}, enumerable: true } });`,
    ],
  },
  {
    words: "reflect-set",
    rows: ["Reflect.set"],
    write: pair => [
      "const held = {};",
      `Reflect.set(held, "a", ${pair.first});`,
      `Reflect.set(held, "b", ${pair.second});`,
    ],
  },
  {
    words: "reflect-define-property",
    rows: ["Reflect.defineProperty"],
    write: pair => [
      "const held = {};",
      `Reflect.defineProperty(held, "a", { value: ${pair.first}, enumerable: true });`,
      `Reflect.defineProperty(held, "b", { value: ${pair.second}, enumerable: true });`,
    ],
  },
  {
    words: "object-group-by",
    rows: ["Object.groupBy"],
    write: pair => [
      `const groups = Object.groupBy([${pair.first}, ${pair.second}], (value, index) => (index === 0 ? "a" : "b"));`,
      "const held = { a: groups.a[0], b: groups.b[0] };",
    ],
  },
  {
    words: "a-spread-of-a-literal-honest",
    rows: [],
    write: pair => [`const held = { ...{ a: ${pair.first} }, b: ${pair.second} };`],
  },
];

const objectReaders: Reader[] = [
  {
    words: "its-names",
    rows: [],
    read: pair => [both(pair, "held.a", "held.b"), "console.log(held.c === undefined);"],
  },
  {
    words: "a-pattern",
    rows: [],
    read: pair => ["const { a, b, c } = held;", both(pair, "a", "b"), "console.log(c === undefined);"],
  },
  listReader("object-values", ["Object.values"], "Object.values(held)"),
  {
    words: "object-entries",
    rows: ["Object.entries"],
    read: pair => [`for (const [key, value] of Object.entries(held)) console.log(key, ${pair.useEither("value")});`],
  },
  {
    words: "object-keys",
    rows: ["Object.keys"],
    read: pair => [`for (const key of Object.keys(held)) console.log(key, ${pair.useEither("held[key]")});`],
  },
  {
    words: "a-for-in-loop",
    rows: [],
    read: pair => [`for (const key in held) console.log(key, ${pair.useEither("held[key]")});`],
  },
  {
    words: "reflect-get",
    rows: ["Reflect.get"],
    read: pair => [both(pair, 'Reflect.get(held, "a")', 'Reflect.get(held, "b")')],
  },
  {
    words: "a-descriptor",
    rows: ["Object.getOwnPropertyDescriptor"],
    read: pair => [
      both(
        pair,
        'Object.getOwnPropertyDescriptor(held, "a").value',
        'Object.getOwnPropertyDescriptor(held, "b").value',
      ),
    ],
  },
  { words: "a-spread", rows: [], read: pair => ["const copy = { ...held };", both(pair, "copy.a", "copy.b")] },
  {
    words: "object-assign",
    rows: ["Object.assign"],
    read: pair => ["const copy = Object.assign({}, held);", both(pair, "copy.a", "copy.b")],
  },
  {
    words: "a-map-of-its-entries",
    rows: ["Map", "Object.entries"],
    read: pair => ["const map = new Map(Object.entries(held));", both(pair, 'map.get("a")', 'map.get("b")')],
  },
  {
    words: "structured-clone",
    rows: ["structuredClone"],
    needs: "plain data",
    read: pair => ["const copy = structuredClone(held);", both(pair, "copy.a", "copy.b")],
  },
  {
    words: "json",
    rows: ["JSON.parse", "JSON.stringify"],
    needs: "plain data",
    read: pair => ["const copy = JSON.parse(JSON.stringify(held));", both(pair, "copy.a", "copy.b")],
  },
];

const promiseWriters: Writer[] = [
  {
    words: "promise-resolve",
    rows: ["Promise.resolve"],
    write: pair => [`const held = [Promise.resolve(${pair.first}), Promise.resolve(${pair.second})];`],
  },
  {
    words: "the-promise-constructor",
    rows: ["Promise"],
    write: pair => [
      `const held = [new Promise(resolve => resolve(${pair.first})), new Promise(resolve => resolve(${pair.second}))];`,
    ],
  },
  {
    words: "promise-with-resolvers",
    rows: ["Promise.withResolvers"],
    write: pair => [
      "const left = Promise.withResolvers();",
      "const right = Promise.withResolvers();",
      `left.resolve(${pair.first});`,
      `right.resolve(${pair.second});`,
      "const held = [left.promise, right.promise];",
    ],
  },
  {
    words: "then",
    rows: ["Promise.prototype.then"],
    write: pair => [
      `const held = [Promise.resolve().then(() => ${pair.first}), Promise.resolve().then(() => ${pair.second})];`,
    ],
  },
  {
    words: "catch",
    rows: ["Promise.reject", "Promise.prototype.catch"],
    write: pair => [
      `const held = [Promise.reject(${pair.first}).catch(reason => reason), Promise.reject(${pair.second}).catch(reason => reason)];`,
    ],
  },
  {
    words: "promise-try",
    rows: ["Promise.try"],
    write: pair => [`const held = [Promise.try(() => ${pair.first}), Promise.try(value => value, ${pair.second})];`],
  },
  {
    words: "promises-resolved-with-promises",
    rows: ["Promise.resolve"],
    write: pair => [
      `const held = [Promise.resolve(Promise.resolve(${pair.first})), Promise.resolve(Promise.resolve(${pair.second}))];`,
    ],
  },
  {
    words: "executors-that-resolve-with-promises",
    rows: ["Promise"],
    write: pair => [
      `const held = [new Promise(resolve => resolve(Promise.resolve(${pair.first}))), new Promise(resolve => resolve(Promise.resolve(${pair.second})))];`,
    ],
  },
  {
    words: "reactions-that-return-promises",
    rows: ["Promise.prototype.then"],
    write: pair => [
      `const held = [Promise.resolve().then(() => Promise.resolve(${pair.first})), Promise.resolve().then(() => Promise.resolve(${pair.second}))];`,
    ],
  },
  {
    words: "async-functions-honest",
    rows: [],
    write: pair => [`const held = [(async () => ${pair.first})(), (async () => ${pair.second})()];`],
  },
];

const promiseReaders: Reader[] = [
  { words: "await", rows: [], read: pair => [both(pair, "(await held[0])", "(await held[1])")] },
  {
    words: "then",
    rows: ["Promise.prototype.then"],
    read: pair => [
      `await held[0].then(value => console.log(${pair.useFirst("value")}));`,
      `await held[1].then(value => console.log(${pair.useSecond("value")}));`,
    ],
  },
  listReader("promise-all", ["Promise.all"], "await Promise.all(held)"),
  {
    words: "promise-all-settled",
    rows: ["Promise.allSettled"],
    read: pair => ["const list = await Promise.allSettled(held);", both(pair, "list[0].value", "list[1].value")],
  },
  {
    words: "promise-race-and-any",
    rows: ["Promise.race", "Promise.any"],
    read: pair => [
      `console.log(${pair.useFirst("(await Promise.race(held))")}, ${pair.useFirst("(await Promise.any(held))")});`,
    ],
  },
  {
    words: "finally",
    rows: ["Promise.prototype.finally"],
    read: pair => [both(pair, "(await held[0].finally(() => {}))", "(await held[1].finally(() => {}))")],
  },
  {
    words: "bun-peek",
    rows: ["Bun.peek"],
    read: pair => ["await null;", "await null;", "await null;", both(pair, "Bun.peek(held[0])", "Bun.peek(held[1])")],
  },
  {
    words: "for-await",
    rows: ["%AsyncFromSyncIterator%.prototype.next"],
    read: pair => [`for await (const value of held) console.log(${pair.useEither("value")});`],
  },
  listReader("array-from-async", ["Array.fromAsync"], "await Array.fromAsync(held)"),
];

function cross(subject: string, writers: Writer[], readers: Reader[]): Program[] {
  const programs: Program[] = [];
  writers.forEach((writer, position) => {
    for (const reader of readers) {
      for (const pair of position === 0 ? pairs : mainPairs) {
        if (reader.needs === "numeric" && !pair.isNumeric) continue;
        if (reader.needs === "plain data" && !pair.isPlainData) continue;
        const honest = writer.words.endsWith("-honest");
        const by = honest ? writer.words.slice(0, -"-honest".length) : writer.words;
        programs.push({
          name: `${pair.words}-put-into-${subject}-by-${by}-are-read-by-${reader.words}${honest ? "-honest" : ""}`,
          rows: [...writer.rows, ...reader.rows],
          text: lines(pair.setup, writer.write(pair), reader.read(pair)),
        });
      }
    }
  });
  return programs;
}

export function routePrograms(): Program[] {
  return [
    ...cross("a-set", setWriters, setReaders),
    ...cross("a-map", mapWriters, mapReaders),
    ...cross("a-map-as-keys", keyWriters, keyReaders),
    ...cross("a-list", listWriters, listReaders),
    ...cross("an-object", objectWriters, objectReaders),
    ...cross("promises", promiseWriters, promiseReaders),
  ];
}
