// `Object.defineProperty(target, key, { .. })` with the descriptor written as a literal may be compiled to one operation
// that never makes the literal. What the definition does depends on four things, and each scene picks all four: the target
// (a literal, an instance, a list, a function, a frozen object, a proxy, no object at all), the key (a field, a new name, an
// index, a symbol, a value that is no string), the property that is already there (none, data or accessor, configurable or
// not) and the descriptor (any mix of the six members, some of them invalid). Some scenes define every name of a literal in
// a for-in loop, as bundlers do for exports. Afterwards the property's descriptor, a read, a store and a delete are printed.
import type { Random } from "./random";

const targets = [
  "{}",
  "{ a: 1, b: 2 }",
  "new Point(1, 2)",
  "new Point(1, 2)",
  "Object.assign(new Point(1, 2), { extra: 3 })",
  "new WithAccessor()",
  "[1, 2]",
  "function () {}",
  "Object.create(null)",
  'Object.create({ a: "inherited" })',
  "Object.freeze({ a: 1 })",
  "Object.seal({ a: 1 })",
  "Object.preventExtensions({ a: 1 })",
  "Object.preventExtensions(new Point(1, 2))",
  "new Proxy({ a: 1 }, {})",
  "new Proxy({}, { defineProperty: () => false })",
  "new Map()",
  "5",
  "null",
  'hidden("text")',
];

const keys = ['"a"', '"a"', '"b"', '"extra"', '"fresh"', "0", '"0"', "5", '"length"', 'Symbol.for("s")', 'hidden("a")', 'hidden("fresh")', "undefined", "null", "1.5", "-0", "true", '{ toString: () => "a" }', '"__proto__"', '"prototype"', '"name"']; // prettier-ignore

/** Statements that run before the definition. `target` and `key` are in scope. */
const before = [
  "",
  "",
  "",
  "target[key] = 1;",
  "Object.defineProperty(target, key, { value: 1 });",
  "Object.defineProperty(target, key, { value: 1, configurable: true });",
  "Object.defineProperty(target, key, { value: 1, writable: true });",
  "Object.defineProperty(target, key, { value: 1, enumerable: true, configurable: true, writable: true });",
  'Object.defineProperty(target, key, { get: () => "old getter", configurable: true });',
  'Object.defineProperty(target, key, { get: () => "old getter" });',
  "Object.defineProperty(target, key, { set() {}, enumerable: true, configurable: true });",
  "delete target[key];",
];

const values = [
  "value: 2",
  "value: 2",
  "value: 1",
  "value: undefined",
  "value",
  "value: () => 3",
  "value: NaN",
  "value: -0",
  '["value"]: 2',
];
const getters = [
  'get: () => "new getter"',
  'get() {\n      return "new getter";\n    }',
  "get: undefined",
  "get: 5",
  "get: shared",
];
const setters = ["set() {}", "set: undefined", "set(stored) {\n      log.push(stored);\n    }", 'set: "no function"'];
const flags = ["true", "true", "false", "false", "undefined", "0", '"yes"', "flag"];

/** Calls that define. DESCRIPTOR is the literal. */
const forms = [
  "Object.defineProperty(target, key, DESCRIPTOR)",
  "Object.defineProperty(target, key, DESCRIPTOR)",
  "Object.defineProperty(target, key, DESCRIPTOR) === target",
  "Reflect.defineProperty(target, key, DESCRIPTOR)",
  "Object.defineProperties(target, { [key]: DESCRIPTOR }) === target",
  "define(target, key, DESCRIPTOR)",
];

/** Literals whose names a loop defines on a target. */
const walked = [
  "{ one: () => 1, two: () => 2 }",
  "{ one: () => 1, 2: () => 2, 1: () => 3, two: () => 4 }",
  "{ a: () => 1, b: () => 2 }",
  "{ one: () => 1, __proto__: { inherited: () => 5 } }",
  "{ one: () => 1, get two() {\n      return () => 2;\n    } }",
  "{ one: () => 1, ...more }",
  "{ one: () => 1, one: () => 2 }",
  '{ one: () => 1, ["t" + "wo"]: () => 2 }',
  "{ one: 1, two: undefined }",
  "{}",
];

/** Bodies of the loop. `all` is the literal, `name` the key of this turn. */
const turns = [
  "Object.defineProperty(target, name, { get: all[name], enumerable: true });",
  "Object.defineProperty(target, name, { enumerable: true, get: () => all[name]() });",
  "Object.defineProperty(target, name, { get: all[name], enumerable: true, configurable: true, set: stored => (all[name] = () => stored) });",
  "Object.defineProperty(target, name, { value: all[name], writable: false });",
  "Object.defineProperty(target, name, { __proto__: null, value: all[name], enumerable: true });",
  "if (!Object.hasOwn(target, name)) Object.defineProperty(target, name, { get: all[name], enumerable: true });",
];

/** Statements that change the walked literal: in front of the walk, or in a turn ahead of the definition. */
const changesOfWalked = [
  "delete all.two;",
  "delete all.one;",
  "all.late = () => 7;",
  "all.two = () => 8;",
  "all[3] = () => 9;",
  'Object.defineProperty(all, "two", { enumerable: false });',
  'Object.defineProperty(all, "two", { get: () => () => 10, enumerable: true, configurable: true });',
  "Object.setPrototypeOf(all, { above: () => 11 });",
  "Object.freeze(all);",
  "change(all);",
];

export function generate(random: Random): string {
  const descriptor = () => {
    const members: string[] = [];
    if (random.chance(0.15)) members.push("__proto__: null");
    if (random.chance(0.55)) members.push(random.pick(values));
    if (random.chance(0.3)) members.push(random.pick(getters));
    if (random.chance(0.2)) members.push(random.pick(setters));
    for (const name of ["writable", "enumerable", "configurable"])
      if (random.chance(name === "writable" ? 0.35 : 0.5)) members.push(`${name}: ${random.pick(flags)}`);
    if (random.chance(0.08)) members.push("...spread");
    const [first, ...rest] = members;
    // `__proto__: null` stays in front, where libraries write it.
    const ordered = first === "__proto__: null" ? [first, ...random.shuffled(rest)] : random.shuffled(members);
    return ordered.length ? `{ ${ordered.join(", ")} }` : "{}";
  };
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const rounds = random.pick([1, 1, 3, 300]);
    if (random.chance(0.25)) {
      // The walk may be written out name by name only while nothing changes the literal from its creation to the last turn.
      const inTurn = random.chance(0.3)
        ? `if (turn++ === ${random.pick([0, 0, 1])}) ${random.pick(changesOfWalked)}\n    `
        : "";
      const inFront = random.chance(0.3) ? random.pick(changesOfWalked) : "";
      const isNamed = inFront !== "" || random.chance(0.3);
      const literal = random.pick(walked);
      // A helper that is nothing but the loop, as bundlers write it, is what the compiler looks for.
      scenes.push(`function exportAll${scene}(target, all) {
  ${inTurn ? "let turn = 0;\n  " : ""}for (const name in all) {
    ${inTurn}${random.pick(turns)}
  }
}
{
  let last;
  for (let round = 0; round < ${rounds}; round++) {
    last = told(() => {
      const target = ${random.pick(targets.slice(0, 14))};
      ${isNamed ? `const all = ${literal};\n      ${inFront}\n      exportAll${scene}(${random.chance(0.15) ? "all" : "target"}, all);` : `exportAll${scene}(target, ${literal});`}
      return Reflect.ownKeys(target).map(name => shown(target, name)).join(" ; ");
    });
  }
  console.log("scene ${scene}", last);
}`);
      continue;
    }
    scenes.push(`function scene${scene}(flag, value) {
  const target = ${random.pick(targets)};
  const key = ${random.pick(keys)};
  const prepared = told(() => {
    ${random.pick(before)}
  });
  const answer = told(() => ${random.pick(forms).replace("DESCRIPTOR", descriptor())});
  return [
    prepared,
    answer === target ? "the target" : answer,
    told(() => shown(target, key)),
    told(() => ((target[key] = 9), target[key])),
    told(() => delete target[key]),
    told(() => shown(target, key)),
    told(() => Reflect.ownKeys(target).map(String).join("+")),
  ]
    .map(String)
    .join(" | ");
}
{
  const answers = new Set();
  for (let round = 0; round < ${rounds}; round++) answers.add(scene${scene}(round % 2 === 0, round % 3));
  console.log("scene ${scene}", [...answers].join(" || "), log.splice(0).join());
}`);
  }
  return `const hidden = name => process.argv[9] ?? name;
const log = [];
const shared = () => "shared getter";
const spread = { enumerable: true, value: "from the spread" };
const more = { two: () => 2, three: () => 3 };
class Point {
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
}
class WithAccessor {
  b = 2;
  get a() {
    return "accessor of the class";
  }
  set a(stored) {
    log.push("setter of the class " + String(stored));
  }
}
function change(all) {
  delete all.two;
  all.changed = () => 12;
}
function define(target, key, descriptor) {
  return Object.defineProperty(target, key, descriptor) === target;
}
function shown(target, key) {
  const found = Object.getOwnPropertyDescriptor(target, key);
  if (!found) return "absent, reads " + String(told(() => target[key]));
  const parts = [];
  for (const name of ["value", "get", "set", "writable", "enumerable", "configurable"]) {
    if (!(name in found)) continue;
    const part = found[name];
    parts.push(name + "=" + (typeof part === "function" ? "function " + String(told(part)) : Object.is(part, -0) ? "-0" : String(part)));
  }
  return String(key) + ": " + parts.join(",");
}
function told(ask) {
  try {
    return ask();
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
