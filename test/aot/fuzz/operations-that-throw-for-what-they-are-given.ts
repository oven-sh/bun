// Operations that throw, or run code of the program, for some operands and not for others. The operand's type names the kind for which nothing happens; now and then the other kind arrives.
//
//   operations  extends, new, calls, classes called without new, in, instanceof, members of null and undefined, big integers beside numbers, symbols turned into texts and numbers,
//               variables before their declarations, private names, patterns over null, spreads and loops over what cannot be iterated, lengths, digits and radixes out of range,
//               operators, templates, comparisons and member reads that run valueOf, toString, getters and traps
//   the operand a parameter of any type, of the right type, of both types; a constant; a variable that a branch never taken would have set right; a variable that a try which fails would have set right;
//               a variable of the module; a field
//   the result  used or not
//   written as  a statement; what a field, a static field, a member of a literal, an element, a parameter, a default, a result, an export or a key is made from that nobody reads; the body of a constructor, a getter,
//               a callback, a generator or an async function of which nobody wants the outcome; in a loop that runs never, once or three times, in its test, twice in a row, behind a test of the type, in finally
//   around it   a try of its own or none
//   arrivals    only the other kind, or the right kind first
//
// Each scene prints what it noted, and the name of the error or what came out.
import type { Random } from "./random";

// `X` the operand. right: an expression of the kind for which nothing happens. type: its type. others: the kinds for which something does.
// A form that starts with "{" is a block of statements: `R` is where a result goes.
type Operation = { form: string; type: string; right: string; others: string[] };

const noisy = (answer: string) =>
  `{ valueOf() { note("valueOf"); return ${answer}; }, toString() { note("toString"); return String(${answer}); } }`;
const nothing = ["null", "undefined"];
const notCallable = ["undefined", "7", "{}", '"text"'];
const notConstructible = [
  ...notCallable,
  "() => 1",
  "Math.max",
  "({ method() {} }).method",
  "async function () {}",
  "function* () {}",
];
const notObject = ["7", '"text"', "undefined", "null", "true", "7n", "Symbol()"];
const notNumber = [
  "7n",
  "Symbol()",
  noisy("3"),
  `{ [Symbol.toPrimitive]() { note("toPrimitive"); return 3; } }`,
  `{ valueOf() { throw new RangeError("no"); } }`,
  "Object.create(null)",
];
const notText = ["Symbol()", noisy('"t"'), "Object.create(null)", `{ toString() { throw new RangeError("no"); } }`];
const notIterable = [
  "7",
  "null",
  "undefined",
  "{}",
  "{ [Symbol.iterator]: 7 }",
  "{ [Symbol.iterator]() { return 7; } }",
  `{ [Symbol.iterator]() { note("iterator"); return [1][Symbol.iterator](); } }`,
];

export const operations: Operation[] = [
  {
    form: "{ class Below extends X {} R = typeof Below; }",
    type: "typeof Real",
    right: "Real",
    others: [...notConstructible, "Object.assign(function () {}, { prototype: 7 })"],
  },
  {
    form: "{ const Below = class extends X { own = 1 }; R = typeof Below; }",
    type: "new () => Real",
    right: "Real",
    others: ["undefined", "7", "() => 1"],
  },
  {
    form: '{ class Below extends X { static made = note("static"); } R = 1; }',
    type: "typeof Real",
    right: "Real",
    others: ["undefined", "() => 1"],
  },
  { form: "new X()", type: "typeof Real", right: "Real", others: notConstructible },
  { form: "new X", type: "new () => object", right: "Real", others: ["undefined", "Symbol", "() => 1"] },
  { form: "Reflect.construct(Real, [], X)", type: "typeof Real", right: "Real", others: ["undefined", "() => 1"] },
  { form: "X()", type: "() => number", right: "() => 1", others: [...notCallable, "Real", "class {}", "null"] },
  { form: 'X(note("argument"))', type: "(given: void) => number", right: "() => 1", others: ["undefined", "Real"] },
  { form: "X.call(null)", type: "() => number", right: "() => 1", others: ["Real", "undefined", "{ call: 7 }"] },
  { form: "holder(X).member()", type: "() => number", right: "() => 1", others: ["undefined", "7", "Real"] },
  { form: "X``", type: "(parts: TemplateStringsArray) => number", right: "() => 1", others: ["undefined", "Real"] },
  {
    form: '"key" in X',
    type: "object",
    right: "{ key: 1 }",
    others: [...notObject, `new Proxy({}, { has() { note("has"); return true; } })`],
  },
  { form: "0 in X", type: "number[]", right: "[1]", others: ["7", '"text"', "null"] },
  {
    form: "real instanceof X",
    type: "typeof Real",
    right: "Real",
    others: [
      "7",
      "undefined",
      "null",
      "{}",
      "() => 1",
      "{ [Symbol.hasInstance]: 7 }",
      `{ [Symbol.hasInstance]() { note("hasInstance"); return true; } }`,
      "Object.assign(function () {}, { prototype: 7 })",
    ],
  },
  {
    form: "X.member",
    type: "{ member: number }",
    right: "{ member: 1 }",
    others: [
      ...nothing,
      `{ get member() { note("getter"); return 1; } }`,
      `{ get member() { throw new RangeError("no"); } }`,
      `new Proxy({}, { get() { note("get"); return 1; } })`,
      `Object.create({ get member() { note("getter above"); return 1; } })`,
    ],
  },
  {
    form: "X[key]",
    type: "Record<string, number>",
    right: "{ member: 1 }",
    others: [...nothing, `{ get member() { note("getter"); return 1; } }`],
  },
  {
    form: "X[0]",
    type: "number[]",
    right: "[1]",
    others: [...nothing, `Object.defineProperty([], 0, { get() { note("getter"); return 1; } })`],
  },
  {
    form: "X.length",
    type: "number[]",
    right: "[1]",
    others: [...nothing, `{ get length() { note("getter"); return 1; } }`],
  },
  { form: "X.length", type: "string", right: '"text"', others: nothing },
  {
    form: "X.inner.member",
    type: "{ inner: { member: number } }",
    right: "{ inner: { member: 1 } }",
    others: ["{}", "{ inner: null }", "null"],
  },
  { form: "holder(1)[X]", type: '"member"', right: '"member"', others: notText },
  {
    form: "X.member = 1",
    type: "{ member: number }",
    right: "{ member: 1 }",
    others: [
      ...nothing,
      "Object.freeze({ member: 1 })",
      `{ set member(given: number) { note("setter"); } }`,
      "{ get member() { return 1; } }",
      "Object.preventExtensions({})",
      "7",
    ],
  },
  { form: "X[0] = 1", type: "number[]", right: "[1]", others: [...nothing, "Object.freeze([1])"] },
  { form: "X.length = 0", type: "number[]", right: "[1]", others: ["null", "Object.freeze([1])"] },
  {
    form: "delete X.member",
    type: "{ member?: number }",
    right: "{ member: 1 }",
    others: [
      ...nothing,
      "Object.freeze({ member: 1 })",
      `new Proxy({}, { deleteProperty() { note("delete"); return true; } })`,
    ],
  },
  {
    form: "X.method()",
    type: "{ method(): number }",
    right: "{ method() { return 1; } }",
    others: [...nothing, "{}", "{ method: 7 }"],
  },
  { form: "1n + X", type: "bigint", right: "2n", others: ["7", "Symbol()", noisy("3n"), noisy("3"), "undefined"] },
  { form: "X * 2n", type: "bigint", right: "2n", others: ["7", "null"] },
  { form: "X / 2n", type: "bigint", right: "4n", others: ["7"] },
  { form: "8n / X", type: "bigint", right: "2n", others: ["0n", "7"] },
  { form: "8n % X", type: "bigint", right: "3n", others: ["0n"] },
  { form: "2n ** X", type: "bigint", right: "2n", others: ["-1n", "7"] },
  { form: "X >>> 1", type: "number", right: "7", others: ["1n", "Symbol()"] },
  { form: "+X", type: "number", right: "7", others: notNumber },
  { form: "-X", type: "number", right: "7", others: ["Symbol()", noisy("3")] },
  { form: "~X", type: "number", right: "7", others: ["Symbol()", noisy("3")] },
  { form: "X + 1", type: "number", right: "7", others: notNumber },
  { form: "X - 1", type: "number", right: "7", others: notNumber },
  { form: "X * X", type: "number", right: "7", others: ["Symbol()", noisy("3")] },
  { form: "X | 0", type: "number", right: "7", others: notNumber },
  { form: "X < 1", type: "number", right: "7", others: ["Symbol()", noisy("3"), "Object.create(null)"] },
  { form: "X == 1", type: "number", right: "7", others: [noisy("1"), "Object.create(null)"] },
  { form: "X++", type: "number", right: "7", others: ["Symbol()", noisy("3")] },
  { form: "Math.abs(X)", type: "number", right: "7", others: notNumber },
  { form: "Math.max(1, X)", type: "number", right: "7", others: ["7n", "Symbol()", noisy("3")] },
  { form: "Math.floor(X)", type: "number", right: "7.5", others: ["7n", noisy("3")] },
  { form: "Number(X)", type: "string", right: '"7"', others: ["Symbol()", noisy("3")] },
  { form: "isNaN(X)", type: "number", right: "7", others: ["7n", "Symbol()", noisy("3")] },
  { form: "`${X}`", type: "string", right: '"text"', others: notText },
  { form: '"head" + X', type: "string", right: '"text"', others: notText },
  { form: 'X + "tail"', type: "string", right: '"text"', others: notText },
  {
    form: "String.prototype.trim.call(X)",
    type: "string",
    right: '"text"',
    others: [...nothing, "Symbol()", noisy('"t"')],
  },
  { form: '"text".concat(X)', type: "string", right: '"text"', others: notText },
  { form: '"text".includes(X)', type: "string", right: '"t"', others: ["/t/", "Symbol()", noisy('"t"')] },
  { form: '"text".indexOf(X)', type: "string", right: '"t"', others: ["Symbol()", noisy('"t"')] },
  { form: '"text".charCodeAt(X)', type: "number", right: "1", others: ["1n", "Symbol()", noisy("1")] },
  { form: '"text".slice(X)', type: "number", right: "1", others: ["1n", noisy("1")] },
  { form: "[X].join()", type: "string", right: '"text"', others: notText },
  { form: '"ab".repeat(X)', type: "number", right: "2", others: ["-1", "Infinity", "1n", noisy("1")] },
  { form: "(7).toFixed(X)", type: "number", right: "2", others: ["101", "-1", "1n"] },
  { form: "(7).toString(X)", type: "number", right: "2", others: ["1", "37", "1n"] },
  { form: "new Array(X)", type: "number", right: "2", others: ["-1", "1.5", "2 ** 32"] },
  { form: "new Uint8Array(X)", type: "number", right: "2", others: ["-1", "Symbol()"] },
  { form: "new ArrayBuffer(X)", type: "number", right: "2", others: ["-1"] },
  { form: "String.fromCodePoint(X)", type: "number", right: "65", others: ["-1", "1.5", "1n"] },
  { form: "BigInt(X)", type: "number", right: "7", others: ["1.5", "NaN", "undefined", "Symbol()", '"x"'] },
  { form: "[1, 2].with(X, 0)", type: "number", right: "1", others: ["9", "-9"] },
  { form: "X.reduce((a: number, b: number) => a + b)", type: "number[]", right: "[1]", others: ["[]"] },
  {
    form: "{ const { member } = X; R = member; }",
    type: "{ member: number }",
    right: "{ member: 1 }",
    others: [...nothing, `{ get member() { note("getter"); return 1; } }`],
  },
  { form: "{ const {} = X; R = 1; }", type: "object", right: "{}", others: nothing },
  {
    form: "{ const { ...rest } = X; R = typeof rest; }",
    type: "object",
    right: "{}",
    others: [...nothing, `{ get member() { note("getter"); return 1; } }`],
  },
  { form: "{ const [first] = X; R = first; }", type: "number[]", right: "[1]", others: notIterable },
  { form: "{ const [] = X; R = 1; }", type: "number[]", right: "[1]", others: notIterable },
  {
    form: "{ const { inner: { member } } = X; R = member; }",
    type: "{ inner: { member: number } }",
    right: "{ inner: { member: 1 } }",
    others: ["{}", "{ inner: null }"],
  },
  { form: "takesPattern(X)", type: "{ member: number }", right: "{ member: 1 }", others: nothing },
  { form: "takesList(X)", type: "number[]", right: "[1]", others: ["null", "7"] },
  { form: "[...X]", type: "number[]", right: "[1]", others: notIterable },
  { form: "Math.max(...X)", type: "number[]", right: "[1]", others: notIterable },
  { form: "new Real(...X)", type: "number[]", right: "[1]", others: ["7", "null"] },
  {
    form: "({ ...X })",
    type: "object",
    right: "{ member: 1 }",
    others: [
      `{ get member() { note("getter"); return 1; } }`,
      `new Proxy({}, { ownKeys() { note("ownKeys"); return []; } })`,
    ],
  },
  { form: "{ for (const each of X) R = each; }", type: "number[]", right: "[1]", others: notIterable },
  {
    form: "{ for (const each of X) break; R = 1; }",
    type: "number[]",
    right: "[1]",
    others: [
      "7",
      `{ [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return() { note("return"); return {}; } }; } }`,
      "{ [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return() { return 7; } }; } }",
    ],
  },
  {
    form: "{ for (const each in X) R = each; }",
    type: "object",
    right: "{ member: 1 }",
    others: [`new Proxy({}, { ownKeys() { note("ownKeys"); return []; } })`],
  },
  { form: "new Set(X)", type: "number[]", right: "[1]", others: ["7", "{}"] },
  { form: "new Map(X)", type: "[number, number][]", right: "[[1, 1]]", others: ["7", "[1]"] },
  { form: "Object.fromEntries(X)", type: "[string, number][]", right: '[["a", 1]]', others: ["7", "[1]", "null"] },
  { form: "Array.from(X)", type: "number[]", right: "[1]", others: [...nothing, "{ [Symbol.iterator]: 7 }"] },
  {
    form: "Object.keys(X)",
    type: "object",
    right: "{ member: 1 }",
    others: [...nothing, `new Proxy({}, { ownKeys() { note("ownKeys"); return []; } })`],
  },
  {
    form: "Object.entries(X)",
    type: "object",
    right: "{ member: 1 }",
    others: ["null", `{ get member() { note("getter"); return 1; } }`],
  },
  {
    form: "Object.assign({}, X)",
    type: "object",
    right: "{ member: 1 }",
    others: [`{ get member() { note("getter"); return 1; } }`],
  },
  {
    form: "Object.getPrototypeOf(X)",
    type: "object",
    right: "{}",
    others: [...nothing, `new Proxy({}, { getPrototypeOf() { note("getPrototypeOf"); return null; } })`],
  },
  { form: "Object.create(X)", type: "object | null", right: "null", others: ["undefined", "7"] },
  { form: "Object.setPrototypeOf({}, X)", type: "object | null", right: "null", others: ["undefined", "7"] },
  {
    form: 'Object.defineProperty(X, "member", { value: 1 })',
    type: "object",
    right: "{}",
    others: ["7", "null", "Object.freeze({})"],
  },
  {
    form: 'Object.defineProperty({}, "member", X)',
    type: "PropertyDescriptor",
    right: "{ value: 1 }",
    others: ["7", "{ get: 7 }", "{ get() {}, value: 1 }"],
  },
  { form: "Reflect.ownKeys(X)", type: "object", right: "{}", others: ["7", "null"] },
  {
    form: 'Reflect.get(X, "member")',
    type: "object",
    right: "{}",
    others: ["7", `{ get member() { note("getter"); return 1; } }`],
  },
  { form: "new WeakSet().add(X)", type: "object", right: "{}", others: ["7", "null", 'Symbol.for("shared")'] },
  { form: "new WeakMap().set(X, 1)", type: "object", right: "{}", others: ["7", "undefined"] },
  { form: "new WeakRef(X)", type: "object", right: "{}", others: ["7"] },
  {
    form: "JSON.stringify(X)",
    type: "object",
    right: "{ member: 1 }",
    others: [
      "7n",
      "{ member: 7n }",
      "cycle()",
      `{ toJSON() { note("toJSON"); return 1; } }`,
      `{ get member() { note("getter"); return 1; } }`,
    ],
  },
  { form: "JSON.parse(X)", type: "string", right: '"1"', others: ['"{"', "undefined", "Symbol()", noisy('"1"')] },
  { form: "new RegExp(X)", type: "string", right: '"a"', others: ['"("', "Symbol()", noisy('"a"')] },
  { form: "/a/.test(X)", type: "string", right: '"a"', others: ["Symbol()", noisy('"a"')] },
  {
    form: "Real.readsPrivate(X)",
    type: "Real",
    right: "new Real()",
    others: ["{}", "null", "7", "Object.create(Real.prototype)"],
  },
  { form: "Real.writesPrivate(X)", type: "Real", right: "new Real()", others: ["{}", "null"] },
  { form: "Real.callsPrivate(X)", type: "Real", right: "new Real()", others: ["{}", "Object.create(Real.prototype)"] },
  { form: "Real.asksPrivate(X)", type: "object", right: "new Real()", others: ["7", "null", "undefined"] },
  { form: "Real.prototype.method.call(X)", type: "Real", right: "new Real()", others: ["{}", "null"] },
  {
    form: "Map.prototype.get.call(X, 1)",
    type: "Map<number, number>",
    right: "new Map()",
    others: ["{}", "new Set()", "null"],
  },
  { form: 'Reflect.get(Map.prototype, "size", X)', type: "Map<number, number>", right: "new Map()", others: ["{}"] },
  {
    form: 'Reflect.get(Uint8Array.prototype, "length", X)',
    type: "Uint8Array",
    right: "new Uint8Array(1)",
    others: ["{}", "[]"],
  },
  { form: "Symbol.keyFor(X)", type: "symbol", right: "Symbol()", others: ['"text"', "undefined"] },
  { form: "Symbol.prototype.toString.call(X)", type: "symbol", right: "Symbol()", others: ['"text"'] },
  { form: "Number.prototype.toFixed.call(X)", type: "number", right: "7", others: ['"7"', "{}"] },
  { form: "new Promise(X)", type: "() => void", right: "() => {}", others: ["7", "undefined"] },
  { form: "new Proxy(X, {})", type: "object", right: "{}", others: ["7", "null"] },
  { form: "new Date(X)", type: "number", right: "0", others: ["Symbol()", noisy("0")] },
  { form: "new Date(X).toISOString()", type: "number", right: "0", others: ["NaN", "8.64e15 + 1"] },
  { form: "readsBeforeItIsDeclared(X)", type: "boolean", right: "false", others: ["true"] },
  { form: "asksTypeBeforeItIsDeclared(X)", type: "boolean", right: "false", others: ["true"] },
  { form: "namesClassBeforeItIsDeclared(X)", type: "boolean", right: "false", others: ["true"] },
  { form: "new (belowThatMaySkipSuper(X))()", type: "boolean", right: "false", others: ["true"] },
  {
    form: "new (belowThatMayReturn(X))()",
    type: "object | undefined",
    right: "undefined",
    others: ["7", "null", '"text"'],
  },
];

const prelude = `let notes: string[] = [];
function note(text: string): void {
  notes.push(text);
}
class Real {
  #hidden = 1;
  #secret() { return 1; }
  constructor(..._given: number[]) {}
  method() { return this.#hidden; }
  static readsPrivate(given: Real) { return given.#hidden; }
  static writesPrivate(given: Real) { return (given.#hidden = 2); }
  static callsPrivate(given: Real) { return given.#secret(); }
  static asksPrivate(given: object) { return #hidden in given; }
}
const real = new Real();
const given: { off: boolean; key: string; none: number; one: number } = JSON.parse('{ "off": false, "key": "member", "none": 0, "one": 1 }');
function ignores(..._unread: unknown[]): void {}
function holds(..._unread: unknown[]): boolean {
  return true;
}
const key: string = given.key;
function holder<T>(member: T): { member: T } {
  return { member };
}
function cycle(): object {
  const ring: { self?: object } = {};
  ring.self = ring;
  return ring;
}
function takesPattern({ member }: { member: number }) {
  return member;
}
function takesList([first]: number[]) {
  return first;
}
function readsBeforeItIsDeclared(early: boolean) {
  const read = () => late;
  if (early) read();
  const late = 1;
  return read();
}
function asksTypeBeforeItIsDeclared(early: boolean) {
  const ask = () => typeof late;
  if (early) ask();
  let late = 1;
  return ask() + late;
}
function namesClassBeforeItIsDeclared(early: boolean) {
  const name = () => Late;
  if (early) name();
  class Late {}
  return typeof name();
}
function belowThatMaySkipSuper(skips: boolean) {
  return class extends Real {
    constructor() {
      if (!skips) super();
    }
  };
}
function belowThatMayReturn(result: unknown) {
  return class extends Real {
    constructor() {
      super();
      return result as any;
    }
  };
}
function fails(): never {
  throw new EvalError("fails");
}
function show(value: unknown): string {
  return value === null ? "null" : typeof value === "object" || typeof value === "function" || typeof value === "symbol" ? typeof value : String(value);
}`;

// `E` the operation. What stands here is written inside the scene, where the operand is in scope.
export const places: [string, string][] = [
  ["statement", ""],
  ["field", "class Holder {\n    unread = E;\n  }\n  new Holder();"],
  ["static-field", "class Holder {\n    static unread = E;\n  }"],
  ["static-block", "class Holder {\n    static {\n      E;\n    }\n  }"],
  ["member", "const literal = { unread: E, read: 1 };\n  note(String(literal.read));"],
  ["element", "const list = [E, 1];\n  note(String(list.length));"],
  ["argument", "ignores(E);"],
  ["default", "function withDefault(unread: unknown = E) {}\n  withDefault();"],
  ["pattern-default", "const { unread = E } = {} as { unread?: unknown };"],
  ["result", "function answers() {\n    return E;\n  }\n  answers();"],
  ["arrow", "const answers = () => E;\n  answers();"],
  ["method", "const literal = {\n    answers() {\n      return E;\n    },\n  };\n  literal.answers();"],
  ["constructor", "class Maker {\n    constructor() {\n      E;\n    }\n  }\n  new Maker();"],
  [
    "constructor-field",
    "class Maker {\n    kept: unknown;\n    constructor() {\n      this.kept = E;\n    }\n  }\n  new Maker();",
  ],
  ["getter", "const literal = {\n    get asked() {\n      return E;\n    },\n  };\n  literal.asked;"],
  ["key", "const literal = { [String(E)]: 1 };"],
  ["callback", "[1].forEach(() => {\n    E;\n  });"],
  ["map", "[1, 2].map(() => E);"],
  ["generator", "function* steps() {\n    yield 1;\n    E;\n  }\n  for (const step of steps()) note(String(step));"],
  ["never-started", "function* steps() {\n    E;\n    yield 1;\n  }\n  steps();"],
  ["no-turn", "for (let turn = 0; turn < given.none; turn++) {\n    E;\n  }"],
  ["one-turn", "for (let turn = 0; turn < given.one; turn++) {\n    E;\n  }"],
  ["three-turns", "for (let turn = 0; turn < 3; turn++) {\n    E;\n  }"],
  ["loop-test", "for (let turn = 0; turn < 2 && holds(E); turn++) {}"],
  ["twice", "E;\n  E;"],
  ["twice-kept", "const first = E;\n  const second = E;\n  note(show(first) + show(second));"],
  ["behind-a-test", 'if (typeof x === "number" && given.off) note("number");\n  else {\n    E;\n  }'],
  ["not-taken", "if (given.off) {\n    E;\n  }"],
  ["finally", 'try {\n    note("tried");\n  } finally {\n    E;\n  }'],
  ["void", "note(String(void E));"],
  ["typeof", "note(typeof typeof E);"],
  ["both-ways", 'note(E ? "same" : "same");'],
  ["overwritten", "let value: unknown = E;\n  value = 1;\n  note(String(value));"],
  ["in-a-text", 'const text = "a" + String(E) + "b";'],
  ["short-circuit", "given.off && E;"],
  ["other-side", "given.off || E;"],
  ["optional", "(given.off ? undefined : ignores)?.(E);"],
];

export const origins = ["any", "declared", "both", "constant", "branch", "try", "module", "field"] as const;
type Origin = (typeof origins)[number];

export type Scene = {
  operation: Operation;
  other: string;
  origin: Origin;
  isUsed: boolean;
  hasTry: boolean;
  rightComesFirst: boolean;
  place?: string;
};

function write(scene: Scene, at: number): string {
  const { operation, other, origin, isUsed, hasTry, rightComesFirst } = scene;
  const name = `scene${at}`;
  const operand = origin === "module" ? `${name}Variable` : origin === "field" ? "box.held" : "x";
  const isBlock = operation.form.startsWith("{");
  const filled = operation.form.replace(/\bX\b/g, operand);
  // TypeScript rejects a list literal as a condition.
  const placeName = scene.place === "both-ways" && operation.form.startsWith("[...") ? "void" : scene.place;
  const place = placeName ? places.find(([name]) => name === placeName)![1] : "";
  const step = place
    ? place.replace(/\bE\b/g, () => `(${filled})`).replace(/\bx\b/g, operand)
    : isBlock
      ? filled.replace(/\bR = /g, isUsed ? "result = " : "")
      : isUsed
        ? `result = ${filled};`
        : /^[{`(]|^function|^class/.test(filled)
          ? `void ${filled};`
          : `${filled};`;
  const guarded = hasTry
    ? `try {\n    ${step}\n    note("behind");\n  } catch (error) {\n    note("caught " + (error as Error).name);\n  }`
    : `${step}\n  note("behind");`;
  const type = operation.type;
  const arrival = "arrives";
  const isStored = /\bX\+\+/.test(operation.form);
  const head: Record<Origin, [string, string]> = {
    any: ["x: any", ""],
    declared: [`x: ${type}`, ""],
    both: [`${arrival}: ${type} | Other`, `${isStored ? "let" : "const"} x = ${arrival} as ${type};`],
    constant: [`${arrival}: unknown`, `${isStored ? "let" : "const"} x: ${type} = ${arrival} as ${type};`],
    branch: [`${arrival}: unknown`, `let x = ${arrival} as ${type};\n  if (given.off) x = ${operation.right};`],
    try: [
      `${arrival}: unknown`,
      `let x = ${arrival} as ${type};\n  try {\n    fails();\n    x = ${operation.right};\n  } catch {}`,
    ],
    module: [`${arrival}: unknown`, `${name}Variable = ${arrival} as ${type};`],
    field: [`${arrival}: unknown`, `const box = new ${name}Box();\n  box.held = ${arrival} as ${type};`],
  };
  const outside =
    origin === "module"
      ? `let ${name}Variable: ${type} = ${operation.right};\n`
      : origin === "field"
        ? `class ${name}Box {\n  held: ${type} = ${operation.right};\n}\n`
        : origin === "both"
          ? ""
          : "";
  const [parameter, opening] = head[origin];
  const run = (value: string) => `notes = [];
try {
  note(show(${name}(${value} as any)));
} catch (error) {
  note("thrown " + (error as Error).name);
}
console.log("${at}: " + notes.join(" "));`;
  return `${outside}function ${name}(${parameter}): unknown {
  let result: unknown = "unused";
  ${opening}
  note("in front");
  ${guarded}
  return result;
}
${rightComesFirst ? run(`(${operation.right})`) + "\n" : ""}${run(`(${other})`)}`;
}

export function writeProgram(scenes: Scene[]): string {
  return `// ${scenes.length} scenes: an operand of the kind its type does not name arrives at an operation.
type Other = undefined | null | number | string | bigint | symbol | boolean | object;
${prelude}
${scenes.map(write).join("\n")}
`;
}

export function everyScene(): Scene[] {
  const scenes: Scene[] = [];
  for (const operation of operations)
    for (const other of operation.others)
      for (const origin of origins)
        for (const isUsed of [false, true])
          for (const hasTry of [false, true])
            for (const rightComesFirst of [false, true])
              scenes.push({ operation, other, origin, isUsed, hasTry, rightComesFirst });
  return scenes;
}

export function everySceneInAPlace(): Scene[] {
  const scenes: Scene[] = [];
  for (const operation of operations) {
    if (operation.form.startsWith("{") || /\bX(\+\+| = |\.\w+ = |\[0\] = )/.test(operation.form)) continue;
    for (const other of operation.others.slice(0, 3))
      for (const [place] of places.slice(1))
        for (const origin of ["declared", "any", "branch", "module"] as const)
          for (const rightComesFirst of [false, true])
            scenes.push({ operation, other, origin, isUsed: false, hasTry: false, rightComesFirst, place });
  }
  return scenes;
}

// The same at the top of a module, where what is made may be kept for whoever asks first. `E` the operation; the operand is a variable of the module.
export const placesInModules: [string, string][] = [
  ["constant", "const unread = E;"],
  ["export", "export const unread = E;"],
  ["variable", "let unread: unknown = E;\nexport function never() {\n  return unread;\n}"],
  ["read-late", 'const late = E;\nnote("behind");\nnote(show(late));'],
  ["member", "const literal = { unread: E };"],
  ["exported-member", "export const literal = { unread: E };"],
  ["element", "export const list = [E];"],
  ["stored-member", "const literal: { unread?: unknown } = {};\nliteral.unread = E;"],
  ["member-of-function", "const made = Object.assign(() => 1, { unread: 0 as unknown });\nmade.unread = E;"],
  ["static-field", "class Holder {\n  static unread = E;\n}"],
  ["exported-static-field", "export class Holder {\n  static unread = E;\n}"],
  ["static-block", "export class Holder {\n  static {\n    E;\n  }\n}"],
  ["key", "export class Holder {\n  [String(E)]() {}\n}"],
  ["static-key", "export class Holder {\n  static [String(E)]() {}\n}"],
  ["argument-of-maker", "const made = holder(E);"],
  ["new", "class Maker {\n  constructor(public kept: unknown) {}\n}\nexport const made = new Maker(E);"],
  ["statement", "E;"],
  ["map", "export const table = new Map([[1, E]]);"],
  ["closure-beside", "const unread = E;\nexport const reads = () => unread;"],
];

export type ModuleScene = {
  operation: Operation;
  other: string;
  origin: "declared" | "branch" | "try";
  place: string;
  isRight: boolean;
};

export function writeModule({ operation, other, origin, place, isRight }: ModuleScene): string {
  const arrives = `(${isRight ? operation.right : other}) as any`;
  const isBlock = operation.form.startsWith("{");
  const opening = {
    declared: `const x: ${operation.type} = ${arrives};`,
    branch: `let x: ${operation.type} = ${arrives};\nif (given.off) x = ${operation.right};`,
    try: `let x: ${operation.type} = ${arrives};\ntry {\n  fails();\n  x = ${operation.right};\n} catch {}`,
  }[origin].replace(/^const(?= x)/, /\bX\+\+/.test(operation.form) ? "let" : "const");
  const filled = operation.form.replace(/\bX\b/g, "x");
  const body = isBlock
    ? filled
        .slice(1, -1)
        .trim()
        .replace(/\bR = ([^;]*);/g, "note(show($1));")
    : placesInModules.find(([name]) => name === place)![1].replace(/\bE\b/g, () => `(${filled})`);
  return `// An operand of one kind or the other arrives at an operation at the top of a module.
import { Real, real, given, key, holder, cycle, takesPattern, takesList, readsBeforeItIsDeclared, asksTypeBeforeItIsDeclared, namesClassBeforeItIsDeclared, belowThatMaySkipSuper, belowThatMayReturn, fails, show, note, ignores, holds } from "./shared";
ignores(Real, real, given, key, holder, cycle, takesPattern, takesList, readsBeforeItIsDeclared, asksTypeBeforeItIsDeclared, namesClassBeforeItIsDeclared, belowThatMaySkipSuper, belowThatMayReturn, fails, show, holds);
${opening}
note("in front");
${body}
note("at the end");
`;
}

export function writeModules(scenes: ModuleScene[], folder: string): Record<string, string> {
  const files: Record<string, string> = {
    [`${folder}/shared.ts`]: prelude
      .replace(/^(class|const|function) /gm, "export $1 ")
      .replace(
        "let notes: string[] = [];",
        'let notes: string[] = [];\nexport function takeNotes(): string {\n  const taken = notes.join(" ");\n  notes = [];\n  return taken;\n}',
      ),
  };
  scenes.forEach((scene, at) => (files[`${folder}/scene${at}.ts`] = writeModule(scene)));
  files[`${folder}.ts`] =
    `// Loads ${scenes.length} modules one after the other and prints what each noted and how it ended.
import { takeNotes } from "./${folder}/shared";
${scenes.map((_, at) => `try {\n  await import("./${folder}/scene${at}");\n  console.log("${at}: " + takeNotes());\n} catch (error) {\n  console.log("${at}: " + takeNotes() + " thrown " + (error as Error).name);\n}`).join("\n")}
`;
  return files;
}

export function everyModuleScene(): ModuleScene[] {
  const scenes: ModuleScene[] = [];
  for (const operation of operations) {
    const isBlock = operation.form.startsWith("{");
    if (isBlock && /\bfor \(/.test(operation.form)) continue;
    for (const other of operation.others.slice(0, 3))
      for (const [place] of isBlock ? placesInModules.slice(0, 1) : placesInModules)
        for (const origin of ["declared", "branch", "try"] as const)
          for (const isRight of [false, true]) scenes.push({ operation, other, origin, place, isRight });
  }
  return scenes;
}

export function generate(random: Random): string {
  const scenes: Scene[] = [];
  const count = random.between(10, 24);
  for (let at = 0; at < count; at++) {
    const operation = random.pick(operations);
    scenes.push({
      operation,
      other: random.pick(operation.others),
      origin: random.pick(origins),
      isUsed: random.chance(0.4),
      hasTry: random.chance(0.5),
      rightComesFirst: random.chance(0.6),
      place: operation.form.startsWith("{") || random.chance(0.4) ? undefined : random.pick(places)[0],
    });
  }
  return writeProgram(scenes);
}
