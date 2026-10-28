// Small programs of three to six files. One file of TypeScript declares something that holds values of a written type: a list, instances with a typed field, one object, a variable, a generic box, a map, a
// record, a static or private field, a closure, a function that takes them. Another file, of JavaScript or of TypeScript that hides it from the checker, puts one value of another kind there. A third file reads
// what is held in a loop of ten thousand turns. TypeScript accepts every program, and a type changes nothing about what a program prints: the executable prints what plain Bun prints.
// There is one holder, one way to fill it, one odd value at one place and one loop in a program. In this order are drawn:
//
//   the holder     a list; a list of instances (a field and a constructor, a parameter property, a field with a value); one instance; an exported variable with a function that sets it; generic boxes; a map; a
//                  record; a static field; a private field; a variable of a closure; lists in an object; a function with a typed parameter that adds up what it is given
//   the type       whole numbers, fractions, texts, booleans, objects, instances of a class, lists of numbers, functions, a number or null
//   the odd value  a primitive of another kind, `null`, `undefined`, an object with another member, a number in another representation, or none
//   how it comes   through the constructor, a typed function or method; a store to the field or the element; `Object.assign`, `Reflect.set`, `defineProperty` with a value or a getter, `delete`; a literal, an
//                  object made by `Object.create` or `Reflect.construct`, a proxy or `null` for the instance; through a generic function; handed by a built-in that calls the typed function
//   where, when    the first, second, middle or last place, or all; ahead of the loop, or in the middle of it, from a function of the other file that the loop calls on every turn
//   who fills      JavaScript without types, with a declaration file, read by TypeScript (`allowJs`), imported behind `// @ts-ignore`; TypeScript with `as any`, `// @ts-ignore` or `// @ts-nocheck`
//   who reads      the file that declares, a third file, a method of the class; by index, `for of`, `forEach`, `reduce`, `while`; straight, or through generic functions of one more file
import type { Random } from "./random";

/** `i` is the place. In a read `§` is what is held there; `sum`, `count` and `text` are printed behind the loop. */
type Element = { type: string; first: string; plain: string[]; odd: string[]; reads: string[] };

const elements: Record<string, Element> = {
  "whole numbers": {
    type: "number",
    first: "1",
    plain: ["i", "i % 7", "i * 2", "i & 255", "7"],
    odd: [
      `"7"`,
      `""`,
      "null",
      "undefined",
      "true",
      "2.5",
      "-0",
      "NaN",
      "4294967301",
      "2147483648",
      "1e300",
      "7n",
      "{ valueOf() { return 7; } }",
      "[7]",
      "{}",
      "new Number(7)",
      `Symbol("s")`,
    ],
    reads: [
      "sum += §;",
      "sum += § * 2;",
      "sum = (sum + §) | 0;",
      "sum += § % 3;",
      "sum += § | 0;",
      "sum ^= §;",
      "sum += § >>> 1;",
      "sum -= §;",
      "sum += -§;",
      "sum += § + 1;",
      "sum += § / 2;",
      "sum = Math.max(sum, §);",
      "sum += Math.floor(§);",
      "sum += Math.abs(§);",
      "if (§ > 5) count++;",
      "if (§ === 7) count++;",
      "if (§ < i) count++;",
      "if (§) count++;",
      "if (§ !== i) count++;",
      "count += § === 7 ? 1 : 0;",
      "sum += [1, 2, 3, 4][§ & 3];",
      "sum += [1, 2, 3, 4][§] ?? 0;",
      `if (text.length < 40) text += §;`,
      "if (text.length < 40) text += `${§},`;",
      'if (typeof § !== "number") count++;',
      "if (Number.isInteger(§)) count++;",
      "if (Object.is(§, -0)) count++;",
      "sum += §.toFixed(0).length;",
      "sum += § * §;",
      "sum += § + §;",
    ],
  },
  fractions: {
    type: "number",
    first: "0.5",
    plain: ["i + 0.5", "i / 4", "i * 0.1", "0.25"],
    odd: [
      `"0.5"`,
      "null",
      "undefined",
      "1",
      "-0",
      "NaN",
      "Infinity",
      "false",
      "5n",
      "{}",
      "[0.5]",
      "{ valueOf() { return 0.5; } }",
    ],
    reads: [
      "sum += §;",
      "sum += § * 2;",
      "sum += Math.floor(§);",
      "sum += Math.sqrt(§);",
      "sum = Math.min(sum, §);",
      "if (§ > 5) count++;",
      "if (§ === 0.25) count++;",
      "sum += § | 0;",
      "sum += § - 0.5;",
      "if (text.length < 40) text += §;",
      "if (§ !== §) count++;",
      'if (typeof § !== "number") count++;',
      "sum += § / (i + 1);",
    ],
  },
  texts: {
    type: "string",
    first: `"s"`,
    plain: [`"s" + i`, "String(i)", `"text"`, `i % 2 ? "odd" : "even"`, "`<${i}>`"],
    odd: [
      "7",
      "0",
      "null",
      "undefined",
      "true",
      `["s"]`,
      "{ length: 2 }",
      `new String("s")`,
      `{ toString() { return "made"; } }`,
      `Symbol("s")`,
      "7n",
      "{}",
    ],
    reads: [
      "sum += §.length;",
      "sum += §.charCodeAt(0);",
      `if (§ === "s5") count++;`,
      `if (§ < "s5") count++;`,
      `if (§ === "text") count++;`,
      "if (§) count++;",
      "if (text.length < 40) text += §;",
      'if (text.length < 40) text = text + § + ",";',
      "if (text.length < 40) text += §[0];",
      "if (text.length < 40) text += `${§};`;",
      "text = §;",
      `if (§.startsWith("s")) count++;`,
      `if (§.includes("1")) count++;`,
      `sum += §.indexOf("1");`,
      "if (text.length < 40) text += §.toUpperCase();",
      "if (text.length < 40) text += §.slice(1);",
      'if (typeof § !== "string") count++;',
      "sum += Number(§) | 0;",
      "sum += ({ text: 1, odd: 2, even: 3 }‹ as Record<string, number>›)[§] ?? 0;",
    ],
  },
  booleans: {
    type: "boolean",
    first: "true",
    plain: ["i % 2 === 0", "true", "false", "i > 5000"],
    odd: ["0", "1", `""`, `"false"`, "null", "undefined", "NaN", "{}", "[]", "0n", "new Boolean(false)"],
    reads: [
      "if (§) count++;",
      "if (!§) count++;",
      "if (§ === true) count++;",
      "if (§ === false) count++;",
      "if (§ !== true) count++;",
      "count += § ? 1 : 0;",
      "sum += Number(§);",
      "sum += +§;",
      'if (typeof § !== "boolean") count++;',
      "if (text.length < 40) text += §;",
      "if (§ && i > 10) count++;",
      "if (§ || i > 9990) count++;",
    ],
  },
  objects: {
    type: "{ a: number; b: string }",
    first: `{ a: 1, b: "t" }`,
    plain: [`{ a: i, b: "t" }`, `{ a: i, b: "t" + i }`, `{ a: 1, b: "t" }`],
    odd: [
      "{ a: 1 }",
      `{ b: "t" }`,
      "{}",
      `{ b: "t", a: 1 }`,
      `{ a: "1", b: 2 }`,
      `{ a: 1.5, b: "t" }`,
      `{ a: 1, b: "t", c: 3 }`,
      `{ a: undefined, b: null }`,
      `{ get a() { return 5; }, b: "t" }`,
      `Object.create({ a: 1, b: "t" })`,
      `Object.freeze({ a: 1, b: "t" })`,
      `new Proxy({ a: 1, b: "t" }, {})`,
      `new Proxy({}, { get: (_, key) => String(key) })`,
      `new (class { a = 1; b = "t"; })()`,
      "null",
      "undefined",
      "7",
      `"text"`,
      `[1, "t"]`,
    ],
    reads: [
      "sum += §.a;",
      "sum += §.a * 2;",
      "sum += §.b.length;",
      "sum += §.a + §.b.length;",
      "if (§.a === 1) count++;",
      "if (§.a > 5) count++;",
      `if (§.b === "t") count++;`,
      "if (text.length < 40) text += §.b;",
      "if (text.length < 40) text += §.a;",
      "{\nconst { a } = §;\nsum += a;\n}",
      "{\nconst { a, b } = §;\nsum += a + b.length;\n}",
      `sum += §["a"];`,
      `if ("a" in §) count++;`,
      "sum += Object.keys(§).length;",
      'if (typeof §.a !== "number") count++;',
      "if (i > 9997) text += JSON.stringify(§);",
      "§.a += 1;\nsum += §.a;",
      "§.a = i;\nsum += §.a;",
    ],
  },
  instances: {
    type: "Shape",
    first: "new Shape(1)",
    plain: ["new Shape(i)", "new Shape(2)"],
    odd: [
      `new Shape("3")`,
      "new Shape()",
      "new Shape(2.5)",
      "new (class extends Shape { area() { return -1; } })(3)",
      "new (class extends Shape { extra = 1; })(3)",
      `new (class Shape { side = 3; area() { return 9; } })()`,
      "{ side: 3, area() { return 9; } }",
      "{ side: 3 }",
      "Object.create(Shape.prototype)",
      "Object.assign(Object.create(Shape.prototype), { side: 3 })",
      "Reflect.construct(Shape, [3], class Other {})",
      "Reflect.construct(Object, [], Shape)",
      `Object.assign(new Shape(3), { side: "3" })`,
      `Object.defineProperty(new Shape(3), "side", { get() { return 4; } })`,
      "Object.setPrototypeOf(new Shape(3), null)",
      "Object.setPrototypeOf(new Shape(3), { area() { return 1; } })",
      "Object.assign(new Shape(3), { area() { return -2; } })",
      "new Proxy(new Shape(3), {})",
      "Object.freeze(new Shape(3))",
      "null",
      "undefined",
      "3",
    ],
    reads: [
      "sum += §.side;",
      "sum += §.area();",
      "sum += §.side * §.side;",
      "if (§ instanceof Shape) count++;",
      "if (§.side > 5) count++;",
      'if (typeof §.side !== "number") count++;',
      "if (text.length < 40) text += §.side;",
      "sum += Shape.prototype.area.call(§);",
      "if (§.area === Shape.prototype.area) count++;",
      "if (§.constructor === Shape) count++;",
      "sum += Object.keys(§).length;",
      "{\nconst { side } = §;\nsum += side;\n}",
      "§.side += 1;\nsum += §.area();",
      "§.side = i;\nsum += §.side;",
    ],
  },
  lists: {
    type: "number[]",
    first: "[1, 2]",
    plain: ["[i, i + 1]", "[i]", "[1, 2, 3]"],
    odd: [
      "[]",
      "[1.5, 2]",
      "[, 2]",
      `["1", 2]`,
      "[null, undefined]",
      "{ length: 2, 0: 1, 1: 2 }",
      "new Uint8Array([1, 2])",
      `"12"`,
      "null",
      "undefined",
      "7",
      "new Set([1, 2])",
      "Object.freeze([1, 2])",
      "new Proxy([1, 2], {})",
      "Object.defineProperty([1, 2], 0, { get() { return 10; } })",
    ],
    reads: [
      "sum += §[0];",
      "sum += §.length;",
      "sum += §[§.length - 1];",
      "for (const each of §) sum += each;",
      "for (let at = 0; at < §.length; at++) sum += §[at];",
      "if (Array.isArray(§)) count++;",
      "if (text.length < 40) text += §.join();",
      "sum += §.reduce((all, each) => all + each, 0);",
      "{\nconst [one] = §;\nsum += one;\n}",
      "sum += [...§].length;",
      "if (§.includes(2)) count++;",
      "§[0] = i;\nsum += §[0];",
    ],
  },
  functions: {
    type: "(n: number) => number",
    first: "n => n + 1",
    plain: ["n => n + i", "n => n * 2", "function (n) { return n - i; }"],
    odd: [
      `() => "text"`,
      "n => String(n)",
      "() => undefined",
      "(a, b) => a + b",
      "n => n + 0.5",
      "n => [n]",
      "async n => n",
      "class { constructor(n) { this.n = n; } }",
      "function* (n) { yield n; }",
      "Math.abs",
      "null",
      "undefined",
      "7",
      "{}",
    ],
    reads: [
      "sum += §(1);",
      "sum += §(i);",
      "sum += §(i) * 2;",
      "if (§(1) > 5) count++;",
      "if (text.length < 40) text += §(1);",
      "sum += §.length;",
      'if (typeof §(1) !== "number") count++;',
    ],
  },
  "a number or null": {
    type: "number | null",
    first: "null",
    plain: ["i % 3 ? i : null", "i", "null"],
    odd: ["undefined", `"7"`, "false", "0n", "{}", `""`, "NaN"],
    reads: [
      "sum += § ?? 1;",
      "if (§ === null) count++;",
      "if (§ !== null) sum += §;",
      "if (§ != null) sum += §;",
      "sum += § === null ? 0 : § + 1;",
      "if (§) sum += §;",
      "if (text.length < 40) text += §;",
    ],
  },
};

const shape = `export class Shape {
  side: number;
  constructor(side: number) {
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
}
`;

/** `v` is the value, `k` the place. What TypeScript refuses whatever the value is cast to begins with `!`. */
type Holder = {
  model: (type: string, first: string) => string[];
  names: string[];
  /** Adds what belongs at place `i`. None: the holder has one place. */
  ordinary?: (v: string) => string;
  ways: ((v: string, k: string, plain: string) => string)[];
  reads: ((i: string) => string)[];
  /** What a loop walks, and what it reads of each. */
  walked?: [string, (each: string) => string][];
};

const itemForms = [
  (type: string) => [
    "export class Item {",
    `value: ${type};`,
    `constructor(value: ${type}) {`,
    "this.value = value;",
    "}",
    `read(): ${type} {`,
    "return this.value;",
    "}",
    "}",
  ],
  (type: string) => [
    "export class Item {",
    `constructor(public value: ${type}) {}`,
    `read(): ${type} {`,
    "return this.value;",
    "}",
    "}",
  ],
  (type: string, first: string) => [
    "export class Item {",
    `value: ${type} = ${first};`,
    "mark = 1;",
    `constructor(value: ${type}) {`,
    "this.value = value;",
    "}",
    `read(): ${type} {`,
    "return this.value;",
    "}",
    "}",
  ],
  (type: string) => [
    "export class Item {",
    "mark: number;",
    `value: ${type};`,
    "label: string;",
    `constructor(value: ${type}) {`,
    "this.mark = 1;",
    "this.value = value;",
    `this.label = "item";`,
    "}",
    `read(): ${type} {`,
    "return this.value;",
    "}",
    "}",
  ],
];

const holders = (random: Random): Record<string, Holder> => ({
  "a list": {
    model: type => [
      `export const all: ${wrap(type)}[] = [];`,
      `export function add(value: ${type}) {`,
      "all.push(value);",
      "}",
    ],
    names: ["all", "add"],
    ordinary: v => `all.push(${v});`,
    ways: [
      (v, k) => `all[${k}] = ${v};`,
      (v, k) => `all.splice(${k}, 1, ${v});`,
      (v, k) => `all.fill(${v}, ${k}, ${k} + 1);`,
      (v, k) => `Reflect.set(all, ${k}, ${v});`,
      (v, k) =>
        `Object.defineProperty(all, ${k}, { value: ${v}, writable: true, enumerable: true, configurable: true });`,
      (v, k) => `Object.defineProperty(all, ${k}, { get() { return ${v}; }, configurable: true });`,
      (_, k) => `delete all[${k}];`,
      v => `all.push(${v});`,
      v => `all.unshift(${v});`,
      v => `add(${v});`,
      (v, k) => `all.copyWithin(${k}, all.push(${v}) - 1);`,
    ],
    reads: [i => `all[${i}]`],
    walked: [["all", each => each]],
  },
  "a list of instances": {
    model: (type, first) => [...random.pick(itemForms)(type, first), "export const all: Item[] = [];"],
    names: ["all", "Item"],
    ordinary: v => `all.push(new Item(${v}));`,
    ways: [
      (v, k) => `all[${k}] = new Item(${v});`,
      (v, k) => `all[${k}].value = ${v};`,
      (v, k) => `Object.assign(all[${k}], { value: ${v} });`,
      (v, k) => `Reflect.set(all[${k}], "value", ${v});`,
      (v, k) => `!all[${k}] = { value: ${v}, read() { return this.value; } };`,
      (v, k) => `all[${k}] = Object.assign(Object.create(Item.prototype), { value: ${v} });`,
      (_, k) => `all[${k}] = Object.create(Item.prototype);`,
      (_, k) => `!delete all[${k}].value;`,
      (v, k) => `Object.defineProperty(all[${k}], "value", { get() { return ${v}; }, configurable: true });`,
      (v, k) => `Object.defineProperty(all[${k}], "value", { value: ${v}, writable: false });`,
      (v, k) => `all[${k}] = Reflect.construct(Item, [${v}], class Other {});`,
      (v, k) => `Object.setPrototypeOf(all[${k}], { read() { return ${v}; } });`,
      (v, k) => `!all[${k}] = new (class extends Item { read() { return ${v}; } })(${v});`,
      (v, k, plain) =>
        `all[${k}] = new Proxy(new Item(${plain}), { get: (target, key) => (key === "value" ? ${v} : Reflect.get(target, key)) });`,
      (_, k) => `!all[${k}] = null;`,
      (v, k) => `all[${k}]["val" + "ue"] = ${v};`,
      (v, k) => `Object.assign(all[${k}], { more: 1, value: ${v} });`,
    ],
    reads: [i => `all[${i}].value`, i => `all[${i}].read()`],
    walked: [
      ["all", each => `${each}.value`],
      ["all", each => `${each}.read()`],
    ],
  },
  "one instance": {
    model: (type, first) => [
      "export class State {",
      "mark = 1;",
      `value: ${type} = ${first};`,
      `read(): ${type} {`,
      "return this.value;",
      "}",
      "}",
      "export const state = new State();",
    ],
    names: ["state"],
    ways: [
      v => `state.value = ${v};`,
      v => `Object.assign(state, { value: ${v} });`,
      v => `Reflect.set(state, "value", ${v});`,
      v => `Object.defineProperty(state, "value", { get() { return ${v}; }, configurable: true });`,
      () => "!delete state.value;",
      v => `state["val" + "ue"] = ${v};`,
      v => `for (const key in state) if (key === "value") state[key] = ${v};`,
      v => `Object.setPrototypeOf(state, { read() { return ${v}; } });`,
    ],
    reads: [() => "state.value", () => "state.read()"],
  },
  "a literal": {
    model: (type, first) => [`export const state: { mark: number; value: ${type} } = { mark: 1, value: ${first} };`],
    names: ["state"],
    ways: [
      v => `state.value = ${v};`,
      v => `Object.assign(state, { value: ${v} });`,
      v => `Object.defineProperty(state, "value", { get() { return ${v}; }, configurable: true });`,
      () => "!delete state.value;",
      v => `state["val" + "ue"] = ${v};`,
    ],
    reads: [() => "state.value"],
  },
  "a variable": {
    model: (type, first) => [
      `export let current: ${type} = ${first};`,
      `export function set(value: ${type}) {`,
      "current = value;",
      "}",
      `export function get(): ${type} {`,
      "return current;",
      "}",
    ],
    names: ["current", "set", "get"],
    ways: [
      v => `set(${v});`,
      v => `[${v}].forEach(set);`,
      v => `set.call(null, ${v});`,
      v => `Reflect.apply(set, undefined, [${v}]);`,
    ],
    reads: [() => "current", () => "get()"],
  },
  "generic boxes": {
    model: type => [
      "export class Box<T> {",
      "constructor(public value: T) {}",
      "get(): T {",
      "return this.value;",
      "}",
      "map<U>(change: (value: T) => U): Box<U> {",
      "return new Box(change(this.value));",
      "}",
      "}",
      `export const boxes: Box<${type}>[] = [];`,
    ],
    names: ["boxes", "Box"],
    ordinary: v => `boxes.push(new Box(${v}));`,
    ways: [
      (v, k) => `boxes[${k}] = new Box(${v});`,
      (v, k) => `boxes[${k}].value = ${v};`,
      (v, k) => `boxes[${k}] = boxes[${k}].map(() => (${v}));`,
      (v, k) => `boxes[${k}] = new Box(new Box(${v})).get();`,
      (v, k) => `Object.assign(boxes[${k}], { value: ${v} });`,
      (v, k) => `boxes[${k}] = Object.assign(Object.create(Box.prototype), { value: ${v} });`,
    ],
    reads: [i => `boxes[${i}].value`, i => `boxes[${i}].get()`, i => `boxes[${i}].map(value => value).value`],
    walked: [
      ["boxes", each => `${each}.value`],
      ["boxes", each => `${each}.get()`],
    ],
  },
  "a map": {
    model: type => [`export const byPlace = new Map<number, ${type}>();`],
    names: ["byPlace"],
    ordinary: v => `byPlace.set(i, ${v});`,
    ways: [(v, k) => `byPlace.set(${k}, ${v});`, (_, k) => `byPlace.delete(${k});`],
    reads: [i => `byPlace.get(${i})!`],
    walked: [["byPlace.values()", each => each]],
  },
  "a record": {
    model: type => [`export const record: Record<string, ${type}> = {};`],
    names: ["record"],
    ordinary: v => `record["k" + i] = ${v};`,
    ways: [
      (v, k) => `record["k" + ${k}] = ${v};`,
      (_, k) => `delete record["k" + ${k}];`,
      (v, k) =>
        `Object.defineProperty(record, "k" + ${k}, { get() { return ${v}; }, enumerable: true, configurable: true });`,
    ],
    reads: [i => `record["k" + ${i}]`],
    walked: [["Object.values(record)", each => each]],
  },
  "a static field": {
    model: (type, first) => [
      "export class Shared {",
      `static value: ${type} = ${first};`,
      `static read(): ${type} {`,
      "return Shared.value;",
      "}",
      "}",
    ],
    names: ["Shared"],
    ways: [
      v => `Shared.value = ${v};`,
      v => `Object.assign(Shared, { value: ${v} });`,
      v => `Object.defineProperty(Shared, "value", { get() { return ${v}; }, configurable: true });`,
    ],
    reads: [() => "Shared.value", () => "Shared.read()"],
  },
  "a private field": {
    model: (type, first) => [
      "export class Sealed {",
      `#value: ${type} = ${first};`,
      `set(value: ${type}) {`,
      "this.#value = value;",
      "}",
      `get(): ${type} {`,
      "return this.#value;",
      "}",
      "}",
      "export const sealed = new Sealed();",
    ],
    names: ["sealed"],
    ways: [v => `sealed.set(${v});`, v => `[${v}].forEach(each => sealed.set(each));`],
    reads: [() => "sealed.get()"],
  },
  "a closure": {
    model: (type, first) => [
      `export function keep(start: ${type}) {`,
      `let held: ${type} = start;`,
      `return { get: (): ${type} => held, set: (value: ${type}): void => void (held = value) };`,
      "}",
      `export const kept = keep(${first});`,
    ],
    names: ["kept"],
    ways: [v => `kept.set(${v});`, v => `[${v}].forEach(kept.set);`],
    reads: [() => "kept.get()"],
  },
  "lists in an object": {
    model: type => [`export const columns: { marks: number[]; values: ${wrap(type)}[] } = { marks: [], values: [] };`],
    names: ["columns"],
    ordinary: v => `columns.marks.push(i);\ncolumns.values.push(${v});`,
    ways: [
      (v, k) => `columns.values[${k}] = ${v};`,
      (v, k) => `columns.values.splice(${k}, 1, ${v});`,
      v => `!columns.values = columns.values.map(() => (${v}));`,
    ],
    reads: [i => `columns.values[${i}]`],
    walked: [["columns.values", each => each]],
  },
});

const wrap = (type: string) => (type.includes(" ") ? `(${type})` : type);

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const holderName = random.pick(Object.keys(holders(random)).concat("a typed function", "a typed function"));
  const elementName = random.pick(Object.keys(elements));
  const element = elements[elementName];
  const isOdd = random.chance(0.9);
  const place = random.weighted([
    [2, "0"],
    [1, "1"],
    [3, "5000"],
    [3, "9999"],
  ]);
  const when = random.weighted([
    [5, "ahead of the loop"],
    [3, "in the middle of the loop"],
  ] as const);
  const filling = random.weighted([
    [4, "JavaScript behind @ts-ignore"],
    [3, "JavaScript with a declaration file"],
    [2, "JavaScript that TypeScript reads"],
    [2, "as any"],
    [2, "@ts-ignore"],
    [2, "@ts-nocheck"],
  ] as const);
  const ordinaryBy = random.pick(["the file that declares", "the file that reads", "the file that fills"] as const);
  const readerPlace = random.weighted([
    [5, "a third file"],
    [2, "the file that declares"],
  ] as const);
  const walk = random.weighted([
    [5, "by index"],
    [2, "for of"],
    [1, "forEach"],
    [1, "while"],
    [1, "backwards"],
  ] as const);
  const generic = random.weighted([
    [6, "none"],
    [1, "identity"],
    [1, "each"],
    [1, "a box"],
    [1, "pick"],
  ] as const);
  const guard = random.weighted([
    [3, "round the loop"],
    [1, "inside the loop"],
    [2, "none"],
  ] as const);
  const isStrict = random.chance(0.85);
  const isMainTyped = random.chance(0.5);
  const writesEnds = random.chance(0.5);
  const isHeldInAVariable = random.chance(0.4);
  const isAnnotated = random.chance(0.4);

  const isFillerTyped = !filling.startsWith("JavaScript");
  const type = element.type;
  const plain = random.pick(element.plain);
  const odd = isOdd ? random.pick(element.odd) : plain.replace(/\bi\b/g, place);
  const read = random.pick(element.reads);
  const usesShape = elementName === "instances";
  const end = (name: string, typed: boolean) => (typed ? (writesEnds ? `./${name}.ts` : `./${name}`) : `./${name}.js`);
  const files: Record<string, string> = {};
  const catches = [
    "} catch (error) {",
    `console.log("THROWS", error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : typeof error);`,
    "}",
  ];
  /** Inside the loop what is thrown is counted, and told behind the loop. */
  const counts = ["} catch (error) {", "thrown += error instanceof TypeError ? 1 : 100000;", "}"];
  const inTypeScript = (text: string) => text.replace(/‹([^›]*)›/g, "$1");
  const shapeImport = (typed: boolean) =>
    usesShape
      ? [
          `import { Shape } from ${JSON.stringify(typed || filling === "JavaScript that TypeScript reads" ? end("shape", true) : "./shape.ts")};`,
        ]
      : [];
  if (usesShape) files["shape.ts"] = shape;

  /** A statement of the file that fills, hidden from the checker as drawn. */
  const hiddenIn = (statement: string, value: string) => {
    const isRefused = statement.startsWith("!");
    const text = isRefused ? statement.slice(1) : statement;
    if (!isFillerTyped || filling === "@ts-nocheck") return [text];
    if (filling === "@ts-ignore" || isRefused || /=> |function|class |new Shape\((?:"3")?\)|\["val"/.test(text))
      return ["// @ts-ignore", text];
    return [text.replace(value, () => `(${value}) as any`)];
  };

  const accumulators = ["sum", "count", "text"].filter(name => new RegExp(`\\b${name}\\b`).test(read));
  const declared = [
    ...accumulators.map(
      name =>
        `let ${name}${isAnnotated ? (name === "text" ? ": string" : ": number") : ""} = ${name === "text" ? `""` : "0"};`,
    ),
    ...(guard === "inside the loop" ? ["let thrown = 0;"] : []),
  ];
  const printed = [
    ...accumulators.map(name => `console.log(typeof ${name}, String(${name}).slice(0, 60));`),
    ...(guard === "inside the loop" ? [`console.log("thrown", thrown);`] : []),
  ];

  const model: string[] = [...shapeImport(true)];
  const filler: string[] = [];
  const fillerHead: string[] = [
    ...(filling === "@ts-nocheck" ? ["// @ts-nocheck"] : []),
    ...(/\bShape\b/.test(odd + plain) ? shapeImport(isFillerTyped) : []),
  ];
  const reader: string[] = [];
  const readerHead: string[] = [];
  const genericLines: string[] = [];
  const fillerNames: string[] = [];
  const modelFrom = (typed: boolean) =>
    JSON.stringify(typed || filling === "JavaScript that TypeScript reads" ? end("model", true) : "./model.ts");
  const isInTheMiddle = when === "in the middle of the loop";
  // The turn at which the other file acts: ahead of the place that it changes.
  const actsAt = place === "0" || place === "1" ? "0" : String(Number(place) - 1);

  if (holderName === "a typed function") {
    // The file that declares adds up what its function is given, and the other file calls it ten thousand times, itself or through a built-in.
    const parameter = random.pick(["value", "value", "...values", "{ value }"] as const);
    const named = parameter === "...values" ? "values[0]" : "value";
    const body = inTypeScript(read).replaceAll("§", named).split("\n");
    model.push(
      ...declared,
      "let i = 0;",
      `export function accept(${parameter === "value" ? `value: ${type}` : parameter === "...values" ? `...values: ${wrap(type)}[]` : `{ value }: { value: ${type} }`}) {`,
      ...(guard === "inside the loop" ? ["try {", ...body, ...counts] : body),
      "i++;",
      "}",
      "export function report() {",
      ...printed,
      "}",
    );
    const given = (text: string) => (parameter === "{ value }" ? `{ value: ${text} }` : text);
    const each = isOdd ? `i === ${place} ? ${odd} : ${plain}` : plain;
    const caller = random.weighted([
      [6, "a loop"],
      [2, "forEach"],
      [1, "map"],
      [1, "a set"],
      [1, "Array.from"],
      [1, "call"],
      [1, "apply"],
      [1, "bound"],
    ] as const);
    const list = `Array.from({ length: 10000 }, (_, i) => (${given(each)}))`;
    const calls = {
      "a loop": [`for (let i = 0; i < 10000; i++) accept(${given(each)});`],
      forEach: [`${list}.forEach(accept);`],
      map: [`${list}.map(accept);`],
      "a set": [`new Set(${list}).forEach(accept);`],
      "Array.from": [`Array.from(${list}, accept);`],
      call: [`for (let i = 0; i < 10000; i++) accept.call(undefined, ${given(each)});`],
      apply: [`for (let i = 0; i < 10000; i++) accept.apply(undefined, [${given(each)}, i]);`],
      bound: ["const bound = accept.bind(null);", `for (let i = 0; i < 10000; i++) bound(${given(each)});`],
    }[caller];
    fillerHead.push(`import { accept } from ${modelFrom(isFillerTyped)};`);
    const lines = calls.flatMap(line =>
      isFillerTyped && filling !== "@ts-nocheck" ? ["// @ts-ignore", line] : [line],
    );
    filler.push(
      "export function fill() {",
      ...(guard === "round the loop" ? ["try {", ...lines, ...catches] : lines),
      "}",
    );
    fillerNames.push("fill");
    reader.push(`export { report as read } from ${JSON.stringify(end("model", true))};`);
  } else {
    const holder = holders(random)[holderName];
    model.push(...holder.model(type, element.first));
    const way = random.pick(holder.ways);
    const ordinary = holder.ordinary
      ? ["for (let i = 0; i < 10000; i++) {", ...holder.ordinary(plain).split("\n"), "}"]
      : [];
    const names = (text: string) => holder.names.filter(name => new RegExp(`\\b${name}\\b`).test(text));

    // The odd value, through a generic function of one more file where that is drawn.
    let statement = way(odd, place, plain.replace(/\bi\b/g, place));
    const acts = hiddenIn(statement, odd);
    const fillerBody = [...(ordinaryBy === "the file that fills" ? ordinary : []), ...(isInTheMiddle ? [] : acts)];
    filler.push("export function fill() {", ...fillerBody, "}");
    fillerNames.push("fill");
    if (isInTheMiddle) {
      filler.push(
        `export function tick(turn${isFillerTyped ? ": number" : ""}) {`,
        `if (turn === ${actsAt}) {`,
        ...acts,
        "}",
        "}",
      );
      fillerNames.push("tick");
    }
    const fillerUses = names(filler.join("\n"));
    if (fillerUses.length) fillerHead.push(`import { ${fillerUses.join(", ")} } from ${modelFrom(isFillerTyped)};`);
    if (ordinaryBy === "the file that declares") model.push(...ordinary);

    // The loop.
    const walkedHere =
      holder.walked && walk !== "by index" && walk !== "while" && walk !== "backwards" && generic !== "pick"
        ? random.pick(holder.walked)
        : undefined;
    const access = random.pick(holder.reads);
    const through = (text: string) =>
      generic === "identity"
        ? `identity(${text})`
        : generic === "a box"
          ? `new Carrier(${text}).held`
          : generic === "pick" && /^(\w+(?:\[i\])?)\.value$/.test(text)
            ? `pick(${text.replace(/\.value$/, "")}, "value")`
            : text;
    const isStored = /§[.\w[\]]* \+?= /.test(read);
    const element0 = (text: string) => {
      const reached = isStored ? text : through(text);
      const times = read.split("§").length - 1;
      // What is stored into is named as it stands. What is read more than once through a call is held in a variable.
      if (!isStored && (isHeldInAVariable || (times > 1 && (/[()]/.test(reached) || type.includes("null")))))
        return [
          `const held${isAnnotated ? `: ${type}` : ""} = ${reached};`,
          ...inTypeScript(read).replaceAll("§", "held").split("\n"),
        ];
      return inTypeScript(read).replaceAll("§", reached).split("\n");
    };
    const tick = isInTheMiddle ? ["tick(i);"] : [];
    const guardedInside = (lines: string[]) => (guard === "inside the loop" ? ["try {", ...lines, ...counts] : lines);
    let loop: string[];
    if (walkedHere && generic === "each") {
      loop = [
        "let i = 0;",
        `each(${walkedHere[0].includes("(") ? `[...${walkedHere[0]}]` : walkedHere[0]}, one => {`,
        ...tick,
        ...guardedInside(element0(walkedHere[1]("one"))),
        "i++;",
        "});",
      ];
    } else if (walkedHere && walk === "for of") {
      loop = [
        "let i = 0;",
        `for (const one of ${walkedHere[0]}) {`,
        ...tick,
        ...guardedInside(element0(walkedHere[1]("one"))),
        "i++;",
        "}",
      ];
    } else if (walkedHere && walk === "forEach") {
      loop = [
        `${walkedHere[0].includes("(") ? `[...${walkedHere[0]}]` : walkedHere[0]}.forEach((one, i) => {`,
        ...tick,
        ...guardedInside(element0(walkedHere[1]("one"))),
        "});",
      ];
    } else if (walk === "while") {
      loop = ["let i = 0;", "while (i < 10000) {", ...tick, ...guardedInside(element0(access("i"))), "i++;", "}"];
    } else if (walk === "backwards" && !isInTheMiddle) {
      loop = ["for (let i = 9999; i >= 0; i--) {", ...guardedInside(element0(access("i"))), "}"];
    } else {
      loop = ["for (let i = 0; i < 10000; i++) {", ...tick, ...guardedInside(element0(access("i"))), "}"];
    }
    const body = [...declared, ...(guard === "round the loop" ? ["try {", ...loop, ...catches] : loop), ...printed];
    const text = body.join("\n");
    if (/\bidentity\(/.test(text))
      genericLines.push("export function identity<T>(value: T): T {", "return value;", "}");
    if (/\beach\(/.test(text))
      genericLines.push(
        "export function each<T>(list: readonly T[], visit: (value: T) => void): void {",
        "for (const value of list) visit(value);",
        "}",
      );
    if (/\bnew Carrier\(/.test(text))
      genericLines.push("export class Carrier<T> {", "constructor(public held: T) {}", "}");
    if (/\bpick\(/.test(text))
      genericLines.push(
        "export function pick<T, K extends keyof T>(from: T, key: K): T[K] {",
        "return from[key];",
        "}",
      );
    const genericNames = ["identity", "each", "Carrier", "pick"].filter(name => new RegExp(`\\b${name}\\(`).test(text));
    const target = readerPlace === "the file that declares" ? model : reader;
    const head = readerPlace === "the file that declares" ? model : readerHead;
    if (genericNames.length)
      head.unshift(`import { ${genericNames.join(", ")} } from ${JSON.stringify(end("generic", true))};`);
    if (isInTheMiddle)
      head.unshift(
        ...(filling === "JavaScript behind @ts-ignore" && isStrict ? ["// @ts-ignore"] : []),
        `import { tick } from ${JSON.stringify(end("filler", isFillerTyped))};`,
      );
    if (readerPlace !== "the file that declares") {
      const used = names(text + (ordinaryBy === "the file that reads" ? ordinary.join("\n") : ""));
      if (used.length) readerHead.push(`import { ${used.join(", ")} } from ${JSON.stringify(end("model", true))};`);
      if (/\bShape\b/.test(text + (ordinaryBy === "the file that reads" ? ordinary.join("\n") : "")))
        readerHead.push(...shapeImport(true));
    }
    target.push(...(ordinaryBy === "the file that reads" ? ordinary : []), "export function read() {", ...body, "}");
    if (readerPlace === "the file that declares")
      reader.push(`export { read } from ${JSON.stringify(end("model", true))};`);
  }

  files["model.ts"] = model.join("\n") + "\n";
  files[isFillerTyped ? "filler.ts" : "filler.js"] = [...fillerHead, ...filler].join("\n") + "\n";
  files["reader.ts"] = [...readerHead, ...reader].join("\n") + "\n";
  if (genericLines.length) files["generic.ts"] = genericLines.join("\n") + "\n";
  if (filling === "JavaScript with a declaration file")
    files["filler.d.ts"] =
      fillerNames
        .map(name => `export declare function ${name}(${name === "tick" ? "turn: number" : ""}): void;`)
        .join("\n") + "\n";
  const file = isMainTyped ? "main.ts" : "main.js";
  const text =
    [
      ...(isMainTyped && filling === "JavaScript behind @ts-ignore" && isStrict ? ["// @ts-ignore"] : []),
      `import { fill } from ${JSON.stringify(end("filler", isFillerTyped && (isMainTyped || filling === "JavaScript that TypeScript reads")).replace(/^\.\/filler$/, isMainTyped ? "./filler" : "./filler.ts"))};`,
      `import { read } from ${JSON.stringify(isMainTyped ? end("reader", true) : "./reader.ts")};`,
      "fill();",
      "read();",
    ].join("\n") + "\n";
  files["tsconfig.json"] =
    JSON.stringify(
      {
        compilerOptions: {
          target: "esnext",
          module: "preserve",
          moduleResolution: "bundler",
          noEmit: true,
          strict: isStrict,
          types: [],
          ...(filling === "JavaScript that TypeScript reads" && { allowJs: true }),
          ...(writesEnds && { allowImportingTsExtensions: true }),
        },
      },
      null,
      2,
    ) + "\n";
  return { file, text, files };
}
