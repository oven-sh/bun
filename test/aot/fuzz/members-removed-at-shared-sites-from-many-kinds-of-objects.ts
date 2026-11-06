// A few functions remove a member: one under a written name, one under another, one under a key it is handed. Objects of many kinds and shapes
// go through them for a hundred rounds and more: literals, instances, heirs, lists, functions, frozen and sealed objects, accessors, proxies,
// objects with very many members, with index and symbol keys. Members are added again in other orders, collections run in between, and late in
// the run a prototype or a long-lived object changes. After each removal the program lists and reads what is left.
import type { Random } from "./random";

const makers = [
  `() => ({ x: 1 })`,
  `() => ({ x: 1, y: 2 })`,
  `() => ({ y: 2, x: 1 })`,
  `() => ({ a: 0, x: 1, y: 2, z: 3 })`,
  `() => ({ a: 0, b: 1 })`,
  `() => ({})`,
  `() => new Point(1, 2)`,
  `() => new Point(1.5, "two")`,
  `() => Object.assign(new Point(1, 2), { extra: 3 })`,
  `() => Object.assign(new Point(1, 2), { extra: 3, more: 4, z: 5 })`,
  `() => new Below(1, 2)`,
  `() => new Fields()`,
  `() => new Lone()`,
  `() => Object.create(parent)`,
  `() => Object.assign(Object.create(parent), { x: "own" })`,
  `() => Object.create(null)`,
  `() => Object.assign(Object.create(null), { x: 1, y: 2 })`,
  `() => Object.create(Point.prototype)`,
  `() => Object.assign([1, 2, 3], { x: 1 })`,
  `() => [1, 2, 3]`,
  `() => Object.assign(function () {}, { x: 1, y: 2 })`,
  `() => Object.assign(() => {}, { y: 2 })`,
  `() => Object.freeze({ x: 1, y: 2 })`,
  `() => Object.seal({ x: 1, y: 2 })`,
  `() => Object.preventExtensions({ x: 1, y: 2 })`,
  `() => Object.defineProperty({ y: 2 }, "x", { value: 1, configurable: false, enumerable: true })`,
  `() => Object.defineProperty({ y: 2 }, "x", { value: 1, configurable: true, enumerable: false })`,
  `() => ({ get x() {\nreturn "got";\n}, y: 2 })`,
  `() => ({ y: 2, set x(value) {} })`,
  `() => new Proxy({ x: 1, y: 2 }, {})`,
  `() => new Proxy({ x: 1, y: 2 }, { deleteProperty(target, key) {\nsay("trap " + String(key));\nreturn Reflect.deleteProperty(target, key);\n} })`,
  `() => new Proxy({ x: 1 }, { deleteProperty: () => false })`,
  `() => many(40)`,
  `() => many(200)`,
  `() => worn()`,
  `() => ({ 0: "zero", 1: "one", x: 1 })`,
  `() => ({ [tag]: "by symbol", x: 1, y: 2 })`,
  `() => new Map([["x", 1]])`,
  `() => Object.assign(new Map(), { x: 1 })`,
  `() => new Uint8Array(3)`,
  `() => (function () {\nreturn arguments;\n})(1, 2)`,
  `() => JSON.parse('{"x":1,"y":2}')`,
  `() => ({ ...{ x: 1, y: 2 } })`,
  `() => new Error("made")`,
  `() => /x/g`,
  `() => "text"`,
  `() => 7`,
  `() => held[round % held.length]`,
] as const;

const keys = [
  `"x"`,
  `"y"`,
  `"z"`,
  `"extra"`,
  `"absent"`,
  `"k" + (round % 7)`,
  `0`,
  `1`,
  `"0"`,
  `"length"`,
  `tag`,
  `other`,
  `round % 2 ? "x" : "y"`,
  `round % 3`,
  `"name"`,
  `"message"`,
  `"lastIndex"`,
] as const;

const steps = [
  () => `tell("x", () => removeX(o));`,
  () => `tell("x", () => removeX(o));`,
  () => `tell("y", () => removeY(o));`,
  (random: Random) => `tell("key", () => removeKey(o, ${random.pick(keys)}));`,
  (random: Random) => `tell("key", () => removeKey(o, ${random.pick(keys)}));`,
  () => `tell("twice", () => removeX(o) + " " + removeX(o));`,
  () => `tell("reflect", () => Reflect.deleteProperty(o, "x"));`,
  () => `tell("adds x", () => (o.x = round));`,
  () => `tell("adds y", () => (o.y = "again"));`,
  () => `tell("adds both", () => {\no.y = 1;\no.x = 2;\n});`,
  () => `tell("adds new", () => (o["n" + (round % 5)] = round));`,
  () =>
    `tell("defines", () => typeof Object.defineProperty(o, "x", { value: round, configurable: round % 2 === 0, enumerable: true, writable: true }));`,
  () => `tell("freezes", () => typeof Object.freeze(o));`,
  () => `tell("seals", () => typeof Object.seal(o));`,
  () => `if (round % 16 === 7) Bun.gc(true);`,
  () => `if (round % 32 === 9) Bun.gc(false);`,
] as const;

const looks = [
  `tell("keys", () => Object.keys(o).join());`,
  `tell("keys", () => Object.keys(o).join());`,
  `tell("walked", () => {\nconst found = [];\nfor (const key in o) found.push(key);\nreturn found.join();\n});`,
  `tell("own", () => Reflect.ownKeys(o).map(String).join());`,
  `tell("has", () => ("x" in o) + " " + Object.hasOwn(o, "x") + " " + ("y" in o));`,
  `tell("reads", () => String(o.x) + " " + String(o.y));`,
  `tell("sum", () => o.x + o.y);`,
  `tell("text", () => JSON.stringify(o));`,
  `tell("method", () => o.sum());`,
  `tell("copy", () => Object.keys({ ...o }).join());`,
  `tell("entries", () => Object.entries(o).join("|"));`,
] as const;

const events = [
  `parent.x = "moved";`,
  `delete parent.x;`,
  `Object.defineProperty(parent, "x", { get: () => "from a getter above", configurable: true });`,
  `Point.prototype.x = "on the prototype";`,
  `Object.defineProperty(Point.prototype, "y", { get: () => "getter on the prototype", configurable: true });`,
  `Object.freeze(held[0]);`,
  `Object.seal(held[1]);`,
  `Object.setPrototypeOf(held[2], parent);`,
  `for (let n = 0; n < 80; n++) held[3]["w" + n] = n;`,
] as const;

export function generate(random: Random): string {
  const chosen = random.sample(makers, random.between(3, 9));
  const rounds = random.pick([45, 80, 150, 400]);
  const late = random.between(34, rounds - 1);
  const body = [
    ...Array.from({ length: random.between(1, 4) }, () => random.pick(steps)(random)),
    random.pick(looks),
    ...Array.from({ length: random.between(0, 3) }, () => random.pick(steps)(random)),
    random.pick(looks),
    random.pick(looks),
  ];
  return `const seen = new Set();
const tag = Symbol("tag");
const other = Symbol("other");
const parent = { x: "inherited", sum() {
return "parent's";
} };
let where = "";
let round = 0;
class Point {
constructor(x, y) {
this.x = x;
this.y = y;
}
sum() {
return this.x + this.y;
}
}
class Below extends Point {
constructor(x, y) {
super(x, y);
this.z = 3;
}
}
class Fields {
y = 2;
x = 1;
extra = 3;
}
class Lone {
x = 1;
}
function many(count) {
const made = {};
for (let n = 0; n < count; n++) made["k" + n] = n;
made.x = 1;
made.y = 2;
return made;
}
function worn() {
const made = { a: 1, x: 1, b: 2, y: 2 };
delete made.a;
delete made.b;
return made;
}
function say(line) {
seen.add(where + " " + line);
}
function tell(label, run) {
try {
say(label + ": " + String(run()));
} catch (error) {
say(label + ": threw " + error.constructor.name);
}
}
function removeX(o) {
return delete o.x;
}
function removeY(o) {
return delete o.y;
}
function removeKey(o, key) {
return delete o[key];
}
const held = [{ x: 1, y: 2 }, new Point(1, 2), { y: 2, x: 1, z: 3 }, new Fields(), many(30)];
const makers = [
${chosen.join(",\n")},
];
for (round = 0; round < ${rounds}; round++) {
if (round === ${late}) {
try {
${random.pick(events)}
} catch (error) {
seen.add("the change threw " + error.constructor.name);
}
}
const which = ${random.pick(["round % makers.length", "(round * 7) % makers.length", "round < 40 ? 0 : round % makers.length", "(round >> 3) % makers.length"])};
where = which + (round < ${late} ? "" : " late") + (round < 33 ? "" : " warm");
let o;
try {
o = makers[which]();
} catch (error) {
say("the maker threw " + error.constructor.name);
continue;
}
${body.join("\n")}
}
console.log([...seen].join("\\n"));
`;
}
