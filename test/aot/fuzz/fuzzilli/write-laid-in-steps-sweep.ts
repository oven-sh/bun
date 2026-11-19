// The least programs of members that are laid one by one: each kind of object, times three steps, times their order, times how the members are read between the steps.
//
//   bun write-laid-in-steps-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<maker>--<steps>--<order>--<read>--<when>--<place>.mjs, .cjs or .ts
//   bun write-laid-in-steps-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const makers: [name: string, text: string, on: string, early: string, late: string][] = [
  ["function", "function Base(a) {\n  this.a = a;\n}", "Base.prototype", "new Base(5)", "new Base(7)"],
  [
    "factory",
    "function Base(a) {\n  this.a = a;\n}\nfunction make(a) {\n  return new Base(a);\n}",
    "Base.prototype",
    "make(5)",
    "make(7)",
  ],
  [
    "class",
    "class Base {\n  constructor(a) {\n    this.a = a;\n  }\n}",
    "Base.prototype",
    "new Base(5)",
    "new Base(7)",
  ],
  ["class-field", "class Base {\n  a = 3;\n  b;\n}", "Base.prototype", "new Base()", "new Base()"],
  [
    "heir",
    "class Root {\n  a = 1;\n}\nclass Base extends Root {\n  b = 2;\n}",
    "Root.prototype",
    "new Base()",
    "new Base()",
  ],
  [
    "heir-own",
    "class Root {\n  a = 1;\n}\nclass Base extends Root {\n  b = 2;\n}",
    "Base.prototype",
    "new Base()",
    "new Root()",
  ],
  [
    "function-heir",
    "function Root(a) {\n  this.a = a;\n}\nfunction Base(a) {\n  Root.call(this, a);\n}\nBase.prototype = Object.create(Root.prototype);\nBase.prototype.constructor = Base;",
    "Root.prototype",
    "new Base(5)",
    "new Base(7)",
  ],
  ["created", "const root = { a: 4 };", "root", "Object.create(root)", "Object.create(root)"],
  [
    "literal",
    "const root = { a: 4 };\nconst one = { a: 1, __proto__: root };",
    "root",
    "one",
    "{ a: 2, __proto__: root }",
  ],
  ["itself", "const one = { a: 1 };\nconst other = { a: 2 };", "one", "one", "other"],
  ["static", "class Base {\n  static a = 1;\n}\nclass Heir extends Base {}", "Base", "Heir", "Base"],
  [
    "replaced",
    "function Base(a) {\n  this.a = a;\n}\nBase.prototype = {\n  k() {\n    return 1;\n  },\n};",
    "Base.prototype",
    "new Base(5)",
    "new Base(7)",
  ],
  [
    "without-new",
    "function Base(a) {\n  const t = Object.create(Base.prototype);\n  t.a = a;\n  return t;\n}",
    "Base.prototype",
    "Base(5)",
    "Base(7)",
  ],
  ["list", "class Base extends Array {}", "Base.prototype", "new Base()", "Base.of(1)"],
  ["bare", "const root = Object.create(null);", "root", "Object.create(root)", "Object.create(root)"],
  [
    "two-classes",
    "class Base {\n  a = 1;\n}\nclass Other {\n  a = 2;\n}",
    "Base.prototype",
    "new Base()",
    "new Other()",
  ],
];
// Each lays the member KEY, NAME as a text, on ON.
const steps: string[] = [
  "Object.defineProperty(ON, NAME, {\n  get() {\n    return NAME + this.a;\n  },\n  configurable: true,\n});",
  "Object.defineProperty(ON, NAME, { value: 4, writable: true, configurable: true });",
  "Object.defineProperty(ON, NAME, { value() {\n  return NAME + this.a;\n}, configurable: true });",
  "ON.KEY = function () {\n  return NAME + this.a;\n};",
  "ON.KEY = v => NAME + v;",
  "ON.KEY = 3;",
  "ON[NAME] = NAME;",
  "Object.assign(ON, { KEY: 6 });",
  "Object.assign(ON, { KEY() {\n  return this.a;\n} });",
  "early.KEY = 8;",
  "delete ON.KEY;",
  "ON.__defineGetter__(NAME, function () {\n  return this.a;\n});",
  "Object.defineProperties(ON, { KEY: { get: () => 9, configurable: true }, z: { value: 1, configurable: true } });",
  "Object.setPrototypeOf(ON, { KEY: 'above' });",
  "Reflect.defineProperty(ON, NAME, { get: () => 2, configurable: true });",
  "Object.defineProperty(early, NAME, { get: () => 'own', configurable: true });",
  "ON.KEY ??= 5;",
  "Reflect.set(ON, NAME, 7);",
  "Object.defineProperty(ON, NAME, {\n  set(v) {\n    said.push('set');\n  },\n  configurable: true,\n});",
  "ON.KEY = undefined;",
];
const orders: string[] = ["p q r", "r q p", "q p r", "p p q", "q r q", "p r p"];
const reads: string[] = [
  "t => [t.p, t.q, t.r].map(tell).join()",
  "t => [t.q, t.p].map(tell).join()",
  "t => tell(t.p) + tell(t.q) + tell(t.r)",
  "t => `${typeof t.p} ${typeof t.q}`",
  "t => ('p' in t) + ' ' + ('q' in t)",
  "t => {\n  const { p, q = 'none', r } = t;\n  return [p, q, r].map(tell).join();\n}",
  "t => names.map(k => tell(t[k])).join()",
  "t => tell(typeof t.p === 'function' ? t.p(1) : t.p ?? t.q ?? 'no')",
  "t => {\n  try {\n    return tell(t.p?.(2)) + tell(t.q);\n  } catch (e) {\n    return e.name;\n  }\n}",
  "t => {\n  let s = '';\n  for (const k in t) s += k;\n  return s;\n}",
  "t => (t.p ? 'p' : t.q ? 'q' : t.r ? 'r' : 'no')",
  "t => [Object.hasOwn(t, 'p'), tell(t.q)].join()",
  "t => tell(t.r) + tell(t.r) + tell(t.p)",
  "t => {\n  t.w = t.q;\n  return tell(t.w) + tell(t.p);\n}",
  "t => tell([t.p, t.q][0]) + [t.r, t.q].length",
  "t => {\n  let s = '';\n  for (let i = 0; i < 3; i++) s += tell(i ? t.q : t.p);\n  return s;\n}",
];
// Which instances the members are read of, and when.
const whens = ["both", "early", "late", "between", "behind"];
const places = ["build", "twice", "top", "each", "caught"];
const total = makers.length * steps.length ** 2 * 10 * orders.length * reads.length * whens.length * places.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 30_000_001;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const maker = pick(makers);
  const laid = [pick(steps), pick(steps), pick(steps.slice(0, 10))];
  const order = pick(orders);
  const read = pick(reads);
  const when = pick(whens);
  const place = pick(places);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const names = order.split(" ");
  const step = (text: string, name: string) => {
    const set = text
      .replaceAll("ON", () => maker[2])
      .replaceAll("KEY", name)
      .replaceAll("NAME", `'${name}'`);
    return `try {\n${indent(set, "  ")}\n} catch (e) {\n  out += e.name;\n}`;
  };
  const asked = "for (const t of objects) out += read(t) + ';';\nout += ' ';";
  const inner = [
    maker[1],
    `const early = ${maker[3]};`,
    `const objects = [${when === "late" ? "" : "early"}];`,
    "let out = '';",
    `const read = ${read};`,
    ...(when === "both" || when === "late" ? [`objects.push(${maker[4]});`] : []),
    ...(when === "behind" ? [] : [asked]),
    step(laid[0], names[0]),
    ...(when === "behind" ? [] : [asked]),
    ...(when === "between" ? [`objects.push(${maker[4]});`] : []),
    step(laid[1], names[1]),
    ...(when === "behind" ? [`objects.push(${maker[4]});`] : []),
    asked,
    step(laid[2], names[2]),
    asked,
  ].join("\n");
  const build = `function build() {\n${indent(inner, "  ")}\n  return out;\n}`;
  const run = {
    build: "say(build());",
    twice: "say(build());\nsay(build());",
    top: "say(out);",
    each: "[1, 2].forEach(() => say(build()));",
    caught: "try {\n  say(build());\n} catch (e) {\n  say(e.name);\n}",
  }[place];
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(isCommon && cell % 2 ? ["'use strict';"] : []),
    "const said = [];",
    'const tell = v => (typeof v === "function" ? "function" : Array.isArray(v) ? "list" + v.length : typeof v === "object" && v ? "object" : String(v));',
    "const say = text => void said.push(text);",
    "const names = ['p', 'q', 'r'];",
    place === "top" ? inner : build,
    run,
    'console.log(said.join(" | ").slice(0, 1600));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${maker[0]}--${laid.map(text => steps.indexOf(text)).join("-")}--${names.join("")}--${reads.indexOf(read)}--${when}--${place}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(8, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
