// The base of a class returns an object that exists already, so the fields of the class are defined on that object. Objects of one maker are changed in several ways and handed to the
// class one after the other, so that what the run time remembers of one object meets the next.
//
//   the maker     a literal with and without a method, an empty literal, a class, no prototype, a hundred properties added and deleted, stores one by one, a list, a function
//   the classes   one or two, below a class or a function that returns what it is given, with one to five fields of thirteen kinds of value
//   the change    a property that is read-only, hidden, not configurable or an accessor, frozen, sealed, not extensible, a property deleted or stored with another kind of value, a prototype with the name
//   looked at     nothing but whether it threw, `in`, `delete`, the keys, a read, the descriptors
import type { Random } from "./random";

const names = ["a", "b", "c", "d", "k", "z"];
const values = [
  "1",
  "2",
  "7",
  '"field"',
  '"t"',
  "1.5",
  "undefined",
  "null",
  "true",
  "{ x: 1 }",
  "[1]",
  "2147483648",
  "() => 1",
];

const changes: ((name: string) => string)[] = [
  () => "o => o",
  () => "o => o",
  name =>
    `o => Object.defineProperty(o, "${name}", { value: 0, writable: false, enumerable: false, configurable: false })`,
  name =>
    `o => Object.defineProperty(o, "${name}", { value: 0, writable: true, enumerable: true, configurable: false })`,
  name =>
    `o => Object.defineProperty(o, "${name}", { value: 0, writable: false, enumerable: true, configurable: true })`,
  name =>
    `o => Object.defineProperty(o, "${name}", { value: 0, writable: true, enumerable: false, configurable: true })`,
  name => `o => Object.defineProperty(o, "${name}", { get() { return 5; }, configurable: false })`,
  name =>
    `o => Object.defineProperty(o, "${name}", { get() { return 5; }, set(v) { console.log("setter"); }, configurable: true })`,
  () => "o => Object.freeze(o)",
  () => "o => Object.seal(o)",
  () => "o => Object.preventExtensions(o)",
  name => `o => { delete o.${name}; return o; }`,
  name => `o => { delete o.${name}; return Object.preventExtensions(o); }`,
  name => `o => { Object.preventExtensions(o); delete o.${name}; return o; }`,
  name => `o => { delete o.${name}; return Object.seal(o); }`,
  name => `o => { delete o.${name}; o.${name} = 9; return o; }`,
  name => `o => { o.${name} = "other"; return o; }`,
  name => `o => { o.${name} = 1.5; return o; }`,
  () => "o => { o.extra = 1; return o; }",
  () => "o => { o.extra = 1; delete o.extra; return o; }",
  name => `o => Object.setPrototypeOf(o, { set ${name}(v) { console.log("setter above"); } })`,
  name => `o => Object.setPrototypeOf(o, Object.freeze({ ${name}: 0 }))`,
];

const describe =
  'Reflect.ownKeys(o).map(k => { const d = Reflect.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? typeof d.value === "object" || typeof d.value === "function" ? typeof d.value : String(d.value) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(" ")';

export function generate(random: Random): { file: string; text: string } {
  const lines: string[] = [];
  if (random.chance(0.5)) lines.push('"use strict";');
  const own = random.sample(names, random.below(5));
  const spelled = own.map(name => `${name}: ${random.pick(["1", "2", "3", '"s"', "0.5"])}`).join(", ");
  lines.push(
    random.pick([
      `function create() { return { ${spelled} }; }`,
      `function create() { return { ${spelled} }; }`,
      `function create() { return { ${spelled} }; }`,
      `function create() { return { m() { return 1; }${spelled && ", " + spelled} }; }`,
      "function create() { return {}; }",
      "function create() { return {}; }",
      `class Made { ${own.map(name => `${name} = 1;`).join(" ")} }\nfunction create() { return new Made(); }`,
      `function create() { return Object.assign(Object.create(null), { ${spelled} }); }`,
      `function create() { const o = { ${spelled} }; for (let i = 0; i < 100; i++) o["p" + i] = i; for (let i = 0; i < 100; i++) delete o["p" + i]; return o; }`,
      `function create() { const o = {}; ${own.map(name => `o.${name} = 1;`).join(" ")} return o; }`,
      "function create() { return [1, 2]; }",
      "function create() { return function () {}; }",
    ]),
  );
  lines.push("class Base { constructor(o) { return o; } }");
  const classes = random.between(1, 2);
  for (let index = 0; index < classes; index++) {
    const fields = random.sample(names, random.pick([1, 1, 2, 3, 4, 4, 5]));
    lines.push(
      `class Stamp${index} extends ${random.pick(["Base", "function (given) { return given; }"])} { ${fields.map(name => `${name} = ${random.pick(values)};`).join(" ")} }`,
    );
  }
  const watched = random.pick(names);
  const seen = random.pick([
    '""',
    '""',
    `"${watched}" in o`,
    `delete o.${watched}`,
    "Reflect.ownKeys(o).join()",
    describe,
    `String(o.${watched})`,
  ]);
  lines.push(
    "function attempt(label, Class, o) {",
    "  let said;",
    '  try { new Class(o); said = "defined"; } catch (e) { said = e.name; }',
    "  let seen;",
    `  try { seen = ${seen}; } catch (e) { seen = e.name; }`,
    "  console.log(label, said, seen);",
    "}",
  );
  const turns = random.pick([0, 0, 1, 2, 40]);
  if (turns) lines.push(`for (let i = 0; i < ${turns}; i++) new Stamp0(create());`);
  const isWrittenOut = random.chance(0.4);
  for (let index = 0, count = random.between(1, 6); index < count; index++) {
    const stamp = `Stamp${random.below(classes)}`;
    const change = random.pick(changes)(random.pick(names));
    lines.push(
      isWrittenOut
        ? `{ const o = (${change})(create()); let said; try { new ${stamp}(o); said = "defined"; } catch (e) { said = e.name; } let seen; try { seen = ${seen}; } catch (e) { seen = e.name; } console.log(${index}, said, seen); }`
        : `attempt(${index}, ${stamp}, (${change})(create()));`,
    );
  }
  return { file: "main.js", text: lines.join("\n") + "\n" };
}
