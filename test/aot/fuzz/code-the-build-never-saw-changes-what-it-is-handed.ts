// A program writes a file when it runs and loads it by a path that only the run knows: the build never saw that code, and Bun interprets it. The file is handed what compiled code made and holds,
// changes it in every way that JavaScript allows, and compiled code goes on reading it. Everything answers as in plain Bun.
//
//   the file     .js, .mjs, .cjs or .ts; loaded by import(), by import() of a file: URL, by require(), by createRequire() or by import.meta.require(); ahead of the loop that reads, in the middle of it, or twice
//   declared     the program knows the file as `any`, or by an interface that tells the truth, or by one that does not: what is declared a number comes back as a text, as nothing, as an object
//   handed       an instance of a class with declared fields, a record, a list of whole numbers, of fractions, of records, a Map, a list of bytes, a function that closes over a variable, the class itself;
//                as an argument, as a member of one object that holds them all, through a global, through an emitter of node:events that both sides import
//   done to it   a field gets a value of another kind; a name is added, deleted, turned into an accessor or a constant; the object is frozen, sealed, given another prototype;
//                a list gets a hole, a fraction, a text, another length, an element far out, is sorted, emptied; a Map is cleared while it is walked; the bytes are handed on and leave nothing behind;
//                a method of the class is replaced, a class below it is declared in the file and its instance comes back; the closure is called with what it does not expect, or from inside its own call;
//                the file throws half way; it answers with a proxy, with an object of the same names in another order, with an object whose getters count
//   then         the loop reads on, the fields are printed with their kinds, stored to again, and all of it once more behind a collection
//   the other way  compiled code uses what the file made: a class of the program stands below a class of the file; records come out of the file, one in seven of another make; its generator is walked, its promise awaited;
//                it calls a callback of the program for each element, at once, in a microtask, in a timer; it throws an error, a text, nothing, through frames of the program that hold a finally
//
// The program loads code by a name that the build cannot know, which changes what the compiler may take for granted in the whole build: it stands alone in its build.
import type { Random } from "./random";

const prelude = `import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

// A folder for each way the program is run, so that two of them may run at once.
const folder = join(process.cwd(), "never-seen-" + basename(process.execPath) + (process.env.BUN_JSC_slowPathAllocsBetweenGCs ?? ""));
mkdirSync(folder, { recursive: true });
process.on("exit", () => rmSync(folder, { recursive: true, force: true }));
function laid(name: string, text: string): string {
  const path = join(folder, name);
  writeFileSync(path, text);
  return path;
}
function show(value: unknown, depth = 0): string {
  if (typeof value === "string") return JSON.stringify(value.length > 60 ? value.slice(0, 60) + ".." + value.length : value);
  if (typeof value === "function") return "function";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 2) return "..";
  if (Array.isArray(value)) {
    let text = "";
    for (let i = 0; i < value.length && i < 12; i++) text += (i ? ", " : "") + (i in value ? show(value[i], depth + 1) : "hole");
    return "[" + text + (value.length > 12 ? ", .. " + value.length : "") + "]";
  }
  if (value instanceof Map) return "Map(" + value.size + ")";
  if (ArrayBuffer.isView(value)) return "bytes(" + value.byteLength + ")";
  return "{" + Reflect.ownKeys(value).map(key => String(key) + ": " + show(Reflect.get(value, key), depth + 1)).join(", ") + "}";
}
function attempt(name: string, run: () => unknown): void {
  try {
    console.log(name, show(run()));
  } catch (error) {
    console.log(name, "throws", error instanceof Error ? error.constructor.name : typeof error);
  }
}
type Link = { next: Link | null; n: number };
type Pair = { x: number; y: number; tag?: string };
class Thing {
  count: number;
  ratio: number;
  label: string;
  on: boolean;
  link: Link;
  late?: number;
  #hidden = 3;
  constructor(i: number) {
    this.count = i;
    this.ratio = i / 4;
    this.label = "t" + i;
    this.on = (i & 1) === 0;
    this.link = { next: null, n: i };
  }
  total(): number {
    return this.count + this.ratio + this.label.length + this.link.n + (this.late ?? 0) + this.#hidden;
  }
  bump(): number {
    return (this.count += 1);
  }
  get double(): number {
    return this.count * 2;
  }
  static made = 0;
  static make(i: number): Thing {
    Thing.made++;
    return new Thing(i);
  }
}
const emitter = new EventEmitter();`;

interface Handed {
  name: string;
  type: string;
  make: string;
  /** One turn of the loop that reads it: an expression of `o` and `i` that is a number in plain TypeScript. */
  turns: string[];
  /** Printed afterwards. */
  looks: string[];
  /** Stores by compiled code afterwards. */
  stores: string[];
  /** Bodies of `function (o, i)` in the file. */
  changes: string[];
}

const toAnObject = (fields: string[]) => [
  ...fields.flatMap(field => [`o.${field} = "text";`, `o.${field} = undefined;`, `o.${field} = { valueOf() { return 7; } };`, `o.${field} = 0.5;`, `o.${field} = -0;`, `o.${field} = 2 ** 40;`, `o.${field} = null;`, `o.${field} = 9n;`, `delete o.${field};`]),
  ...fields.flatMap(field => [
    `let reads = 0; Object.defineProperty(o, "${field}", { get() { return ++reads; }, set(value) { reads = 100; }, configurable: true, enumerable: true });`,
    `Object.defineProperty(o, "${field}", { value: 41, writable: false });`,
    `Object.defineProperty(o, "${field}", { enumerable: false });`,
  ]),
  `o.added = i;`,
  `o[Symbol.for("added")] = i; o[7] = "seven";`,
  `for (let n = 0; n < 40; n++) o["more" + n] = n;`,
  `Object.freeze(o);`,
  `Object.seal(o);`,
  `Object.preventExtensions(o);`,
  `Object.setPrototypeOf(o, null);`,
  `Object.setPrototypeOf(o, { total() { return -1; }, bump() { return -2; }, late: 77, tag: "from above" });`,
  `Object.setPrototypeOf(o, new Proxy(Object.getPrototypeOf(o), { get(target, key, receiver) { return key === "late" || key === "tag" ? 5 : Reflect.get(target, key, receiver); } }));`,
  `throw new RangeError("half way");`,
];

const handed: Handed[] = [
  {
    name: "thing",
    type: "Thing",
    make: "new Thing(3)",
    turns: ["o.count + o.ratio", "o.total()", "o.bump()", "o.link.n + o.count", "o.label.length + (o.late ?? 1)", "o.double", "(o.on ? 1 : 2) + o.count"],
    looks: ["o.count", "typeof o.count", "o.ratio", "o.label", "o.on", "o.link", "o.late", "o.total()", "o.double", "Object.keys(o)", "o instanceof Thing", "Object.isFrozen(o)", "JSON.stringify(o)"],
    stores: ["o.count = 5", "o.ratio = 1.5", `o.label = "again"`, "o.late = 8", "o.link = { next: o.link, n: 2 }", "o.count++", "o.on = !o.on"],
    changes: [
      ...toAnObject(["count", "ratio", "label", "on", "link", "late"]),
      `o.link.n = "deep";`,
      `o.link = null;`,
      `o.link.next = o.link;`,
      `o.total = function () { return 1000; };`,
      `o.constructor.prototype.total = function () { return this.count * 100; };`,
      `Object.defineProperty(o.constructor.prototype, "double", { get() { return "doubled"; }, configurable: true });`,
      `o.constructor.prototype.bump = () => 0.25;`,
      `o.constructor.made = "many";`,
      `Object.defineProperty(o.constructor.prototype, "late", { get() { return 12; }, set(value) {}, configurable: true });`,
    ],
  },
  {
    name: "pair",
    type: "Pair",
    make: "{ x: 1, y: 2 }",
    turns: ["o.x + o.y", "o.x * o.y + i", "(o.tag ?? \"\").length + o.x", "(o.x += 1)", "o.y - o.x"],
    looks: ["o.x", "o.y", "o.tag", "typeof o.x", "Object.keys(o)", `"x" in o`, "JSON.stringify(o)", "({ ...o })", "Object.isSealed(o)"],
    stores: ["o.x = 4", "o.y = 0.5", `o.tag = "set"`, "o.x++", "delete o.tag"],
    changes: toAnObject(["x", "y", "tag"]),
  },
  {
    name: "wholes",
    type: "number[]",
    make: "[1, 2, 3, 4, 5, 6, 7, 8]",
    turns: ["o[i % o.length] + 1", "o.length", "o[0] + o[o.length - 1]", "o.reduce((sum, each) => sum + each, 0)", "o.map(each => each * 2)[1]", "o.indexOf(3)", "(o[1] = i)", "o.push(i)"],
    looks: ["o", "o.length", "typeof o[2]", "o.map(each => each + 1)", "o.filter(each => each > 2).length", "o.join()", "2 in o", "o.includes(NaN)", "[...o].length", "o.slice(1, 3)", "Object.isFrozen(o)"],
    stores: ["o[0] = 9", "o[2] = 0.5", "o.push(1)", "o.length = 3", "o.pop()", "o[o.length] = 4"],
    changes: [
      `o[2] = 0.5;`,
      `o[2] = "text";`,
      `o[2] = undefined;`,
      `o[2] = -0;`,
      `o[2] = NaN;`,
      `o[2] = { valueOf() { return 3; } };`,
      `delete o[2];`,
      `o.length = 0;`,
      `o.length = 2;`,
      `o.length = 50;`,
      `o[5000] = 1;`,
      `o.push("last");`,
      `o.push(1.5, 2.5);`,
      `o.unshift(0.25);`,
      `o.splice(1, 3);`,
      `o.splice(1, 0, "in", "between");`,
      `o.sort((a, b) => b - a);`,
      `o.reverse();`,
      `o.fill(0.5);`,
      `o.fill("f", 2, 4);`,
      `o.copyWithin(0, 4);`,
      `Object.freeze(o);`,
      `Object.seal(o);`,
      `Object.preventExtensions(o);`,
      `Object.defineProperty(o, 1, { get() { return 11; }, configurable: true });`,
      `Object.defineProperty(o, "length", { writable: false });`,
      `Object.setPrototypeOf(o, { __proto__: Array.prototype, 2: "from above", map() { return ["mine"]; } });`,
      `Object.setPrototypeOf(o, null);`,
      `o.named = "beside the elements";`,
      `o.constructor = { [Symbol.species]: function (n) { return { length: 0, made: n }; } };`,
      `throw new RangeError("half way");`,
    ],
  },
  {
    name: "fractions",
    type: "number[]",
    make: "[0.5, 1.5, 2.5, 3.5]",
    turns: ["o[i % o.length] * 2", "o[0] + o[1]", "o.reduce((sum, each) => sum + each, 0)", "(o[1] = i / 2)", "Math.floor(o[2])"],
    looks: ["o", "typeof o[1]", "o.map(each => each * 2)", "o.indexOf(2.5)", "o.includes(NaN)", "1 in o", "o.join()"],
    stores: ["o[0] = 1", "o[1] = 0.25", "o.push(2)", "o.length = 2"],
    changes: [`o[1] = "text";`, `o[1] = undefined;`, `o[1] = NaN;`, `delete o[1];`, `o[1] = {};`, `o.length = 0;`, `o[900] = 0.5;`, `o.push(null);`, `o.fill(1);`, `o.sort();`, `Object.freeze(o);`, `o.splice(0, 2, 7);`, `Object.defineProperty(o, 0, { get() { return 0.125; } });`],
  },
  {
    name: "pairs",
    type: "Pair[]",
    make: "[{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }]",
    turns: ["o[i % o.length].x", "o.reduce((sum, each) => sum + each.x + each.y, 0)", "o[0].x + o[o.length - 1].y", "(o[1].x += 1)", "o.map(each => each.y)[0]"],
    looks: ["o", "o.map(each => each.x)", "o.filter(each => each.y > 2).length", "o.find(each => each.x === 3)", "JSON.stringify(o)"],
    stores: ["o[0].x = 7", "o[1] = { x: 0, y: 0 }", "o.push({ x: 9, y: 9 })", `o[0].tag = "t"`],
    changes: [
      `o[1] = { y: 40, x: 30 };`,
      `o[1] = { x: "text", y: 4 };`,
      `o[1] = { get x() { return 13; }, y: 1 };`,
      `o[1] = Object.create({ x: 21, y: 22 });`,
      `o[1].x = 0.5; o[2].y = "y";`,
      `delete o[1].x;`,
      `o[1] = new Proxy({ x: 1, y: 1 }, { get(target, key) { return key === "x" ? 99 : target[key]; } });`,
      `o[0].extra = 1; delete o[0].y;`,
      `o.push({ x: 1 });`,
      `Object.freeze(o[0]);`,
      `o[1] = o[0];`,
      `o.length = 1;`,
      `o[1] = Object.assign(() => 1, { x: 2, y: 3 });`,
    ],
  },
  {
    name: "table",
    type: "Map<number, number>",
    make: "new Map([[1, 10], [2, 20], [3, 30]])",
    turns: ["o.get(1 + (i % 3)) ?? -1", "o.size", "[...o.values()].reduce((sum, each) => sum + each, 0)", "(o.set(i % 5, i), o.size)"],
    looks: ["o.size", "[...o]", "o.get(2)", "typeof o.get(1)", "o.has(3)"],
    stores: ["o.set(1, 1)", "o.delete(2)", "o.set(9, 0.5)"],
    changes: [`o.clear();`, `o.set(1, "text");`, `o.set("1", 5);`, `o.delete(2);`, `o.set(2, undefined);`, `o.get = () => 55;`, `for (const key of o.keys()) if (key < 50) o.set(key + 100, key);`, `Object.setPrototypeOf(o, { __proto__: Map.prototype, get size() { return 1000; } });`, `Object.freeze(o); o.set(8, 8);`],
  },
  {
    name: "bytes",
    type: "Uint8Array",
    make: "new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])",
    turns: ["o[i % 8] ?? -1", "o.length", "o.byteLength + (o[0] ?? 0)", "(o[1] = i)", "o.reduce((sum, each) => sum + each, 0)"],
    looks: ["o.length", "o[0]", "o[7]", "o.byteOffset", "[...o]", "o.subarray(2).length"],
    stores: ["o[0] = 300", "o[9] = 1", "o.fill(2)", "o.set([1, 2], 1)"],
    changes: [`o.buffer.transfer();`, `structuredClone(o.buffer, { transfer: [o.buffer] });`, `o.fill(255);`, `o[0] = 1.9;`, `o.extra = 1;`, `Object.setPrototypeOf(o, { __proto__: Uint8Array.prototype, get length() { return 2; } });`, `o.sort().reverse();`, `new Uint32Array(o.buffer)[0] = 0xffffffff;`],
  },
  {
    name: "closure",
    type: "(step: number) => number",
    make: "(() => {\n    let held = 0;\n    let calls = 0;\n    return (step: number): number => {\n      calls++;\n      held += step;\n      return held + calls;\n    };\n  })()",
    turns: ["o(1)", "o(i)", "o(i & 3) + o(0)"],
    looks: ["o(0)", "typeof o(1)", "o.length", "o.name", "Object.keys(o)"],
    stores: ["o(2)", "o(0.5)"],
    changes: [`o("text");`, `o();`, `o(0.5);`, `o({ valueOf() { return 2; } });`, `o.call(null, 1, 2, 3);`, `new o(1);`, `o(o);`, `o.extra = 1;`, `Object.defineProperty(o, "name", { value: "renamed" });`, `o(2 ** 53);`, `o(-0);`, `o(1n);`, `o(null);`, `[1, 2, 3].forEach(o);`],
  },
];

// What comes back where the program declares a number.
const answers = [`return 1;`, `return 0.5;`, `return "text";`, `return undefined;`, `return null;`, `return { valueOf() { return 6; } };`, `return -0;`, `return NaN;`, `return 2 ** 31;`, `return 3n;`, `return o;`, `return [1];`, `return i & 1 ? 1 : "odd one out";`];

const extensions = ["js", "mjs", "cjs", "ts"] as const;

function scene(random: Random, index: number): string {
  const thing = random.pick(handed);
  const extension = random.pick(extensions);
  const isCommon = extension === "cjs";
  const changes = random.sample(thing.changes, random.between(1, 3));
  const answer = random.chance(0.4) ? random.pick(answers) : `return 1;`;
  const typed = (names: string) => (extension === "ts" ? names.split(", ").map(name => `${name}: any`).join(", ") : names);
  const through = random.weighted([[5, "argument"], [2, "holder"], [1, "global"], [2, "emitter"]] as const); // prettier-ignore
  const functions = changes.map((body, at) => `function change${at}(${typed("o, i")}) {\n  ${body}\n}`);
  const inner = `${changes.map((_, at) => `  if (i === at + ${at * 3}) change${at}(o, i);`).join("\n")}\n  ${answer}`;
  const body =
    through === "holder"
      ? `function visit(${typed("all, i, at")}) {\n  const o = all.held;\n${inner}\n}`
      : through === "global"
        ? `function visit(${typed("nothing, i, at")}) {\n  const o = globalThis.handedOver${index};\n${inner}\n}`
        : through === "emitter"
          ? `let last = 1;\nfunction heard(${typed("o, i, at")}) {\n${inner}\n}\nfunction visit(${typed("emitter, i, at")}) {\n  if (!emitter.listenerCount("turn${index}")) emitter.on("turn${index}", (${typed("o, i, at")}) => void (last = heard(o, i, at)));\n  return last;\n}`
          : `function visit(${typed("o, i, at")}) {\n${inner}\n}`;
  const below =
    thing.name === "thing" && random.chance(0.5)
      ? `function below(${typed("Base")}) {\n  return new (class extends Base {\n    ${random.pick([`count = "shadowed";`, `extra = 1;`, `total() { return super.total() + 0.5; }`, `get ratio() { return 8; } set ratio(value) {}`, `constructor(${typed("i")}) { super(i); delete this.label; }`])}\n  })(4);\n}`
      : `function below(${typed("Base")}) {\n  return ${random.pick([`new Base(4)`, `Object.create(Base.prototype)`, `Reflect.construct(Base, [4], class Other {})`, `new Proxy(new Base(4), {})`, `{ count: 1, ratio: 2, label: "l", on: true, link: { next: null, n: 1 }, total() { return 3; }, bump() { return 4; }, double: 5 }`])};\n}`;
  const text = `${functions.join("\n")}\n${body}\n${below}\n${isCommon ? "module.exports = { visit, below };" : "export { visit, below };"}\n`;
  const path = `path${index}`;
  const load = isCommon
    ? random.pick([`require(${path})`, `createRequire(import.meta.url)(${path})`, `import.meta.require(${path})`, `(await import(${path})).default`])
    : random.pick([`await import(${path})`, `await import(pathToFileURL(${path}).href)`, `require(${path})`, `createRequire(join(folder, "x.js"))(${path})`, `import.meta.require(${path})`]);
  const declared = random.weighted([[2, "any"], [3, `{ visit(o: ${through === "holder" ? `{ held: ${thing.type} }` : through === "emitter" ? "EventEmitter" : through === "global" ? "null" : thing.type}, i: number, at: number): number; below(Base: typeof Thing): Thing }`]] as const); // prettier-ignore
  const given = through === "holder" ? "{ held: o }" : through === "global" ? "null" : through === "emitter" ? "emitter" : "o";
  const turns = random.pick([30, 200, 2000]);
  const at = random.between(0, turns - 8);
  const late = random.chance(0.3);
  const turn = random.sample(thing.turns, random.between(1, 2));
  const looks = random.sample(thing.looks, random.between(3, 6));
  const stores = random.sample(thing.stores, random.between(1, 3));
  const printed = (label: string) => looks.map(look => `  attempt(${JSON.stringify(`${index} ${label} ${look}`)}, () => ${look});`).join("\n");
  return `const ${path} = laid(${JSON.stringify(`file${index}.${extension}`)}, ${JSON.stringify(text)});
${late ? `let file${index}: ${declared} | undefined;` : `const file${index}: ${declared} = ${load};`}
${late ? "async " : ""}function read${index}(o: ${thing.type}): ${late ? "Promise<string>" : "string"} {
  let sum = 0;
  let kinds = "";
  for (let i = 0; i < ${turns}; i++) {
${late ? `    if (i === ${Math.max(0, at - 2)}) file${index} = ${load};\n    if (!file${index}) {\n      sum += ${turn[0]};\n      continue;\n    }` : ""}
    try {
${through === "emitter" ? `      emitter.emit("turn${index}", o, i, ${at});\n` : ""}      const answered = file${index}.visit(${given}, i, ${at});
      if (typeof answered !== "number" && !kinds.includes(typeof answered)) kinds += " " + typeof answered;
      sum += answered;
${turn.map(each => `      sum += ${each};`).join("\n")}
    } catch (error) {
      if (!kinds.includes("threw")) kinds += " threw " + (error instanceof Error ? error.constructor.name : typeof error);
    }
  }
  return show(sum) + kinds;
}
{
  const o: ${thing.type} = ${thing.make};
${through === "global" ? `  (globalThis as any).handedOver${index} = o;\n` : ""}  console.log(${JSON.stringify(`${index} ${thing.name} ${through} read`)}, ${late ? "await " : ""}read${index}(o));
${printed("then")}
${stores.map(store => `  attempt(${JSON.stringify(`${index} store ${store}`)}, () => ${store});`).join("\n")}
  Bun.gc(true);
${printed("at the end")}
${
  thing.name === "thing"
    ? `  attempt("${index} below", () => {
    const made = file${index}!.below(Thing);
    let sum = 0;
    for (let i = 0; i < 300; i++) sum += made.count + made.total() + made.ratio + made.bump();
    return [sum, made instanceof Thing, typeof made.count, made.label, Object.keys(made)];
  });
  attempt("${index} a new one", () => {
    const fresh = Thing.make(2);
    return [fresh.total(), fresh.double, fresh.bump(), fresh.late, Thing.made];
  });`
    : ""
}
}`;
}

const made = `class Base {
  constructor(n) {
    this.n = n;
    this.kind = "base";
  }
  size() {
    return this.n;
  }
  get twice() {
    return this.n * 2;
  }
  static make(n) {
    return new this(n);
  }
}
function record(i) {
  return i % 7 === 6 ? ODD : { a: i, b: i / 2 };
}
function* steps(n) {
  for (let i = 0; i < n; i++) yield i % 5 === 4 ? STEP : i;
}
async function later(value) {
  await null;
  return value;
}
function each(list, call) {
  for (let i = 0; i < list.length; i++) call(list[i], i, list);
  return list.length;
}
function soon(call) {
  queueMicrotask(() => call("microtask"));
  setTimeout(() => call("timer"), 0);
  return Promise.resolve().then(() => call("then"));
}
function fails(kind) {
  throw kind === 0 ? new RangeError("of the file") : kind === 1 ? "text" : kind === 2 ? null : kind === 3 ? { code: 7 } : new (class Own extends Error {})("own");
}
`;

// Compiled code uses what the file made.
function theOtherWay(random: Random, index: number): string {
  const isCommon = random.chance(0.3);
  const names = "Base, record, steps, later, each, soon, fails";
  const text =
    made.replace("ODD", random.pick([`{ b: i, a: i }`, `{ a: "odd", b: i }`, `{ a: i }`, `{ a: i, b: i, c: i }`, `Object.create({ a: i, b: 1 })`, `{ get a() { return i; }, b: 0.5 }`, `[i, i]`, `null`])).replace("STEP", random.pick([`i / 2`, `"step"`, `undefined`, `-0`, `2 ** 31`, `{ valueOf() { return 1; } }`])) +
    (isCommon ? `module.exports = { ${names} };\n` : `export { ${names} };\n`);
  const path = `path${index}`;
  const load = isCommon ? random.pick([`require(${path})`, `createRequire(import.meta.url)(${path})`]) : random.pick([`await import(${path})`, `require(${path})`, `await import(pathToFileURL(${path}).href)`]);
  const turns = random.pick([50, 700]);
  const inTheCallback = random.pick(["", "if (i === 1) all.push(0.5);", "if (i === 1) all.length = 2;", "if (i === 0) all[2] = each / 2;", `if (i === 2) throw new RangeError("of the program");`, "if (i === 1) all.reverse();"]);
  return `interface Made${index} {
  Base: { new (n: number): { n: number; kind: string; size(): number; readonly twice: number }; make(n: number): { n: number; size(): number } };
  record(i: number): { a: number; b: number };
  steps(n: number): Generator<number>;
  later<T>(value: T): Promise<T>;
  each(list: number[], call: (each: number, i: number, all: number[]) => void): number;
  soon(call: (when: string) => void): Promise<void>;
  fails(kind: number): never;
}
const ${path} = laid(${JSON.stringify(`made${index}.${isCommon ? "cjs" : random.pick(["js", "mjs", "ts"])}`)}, ${JSON.stringify(text)});
const made${index}: Made${index} = ${load};
class Mine${index} extends made${index}.Base {
  extra: number = 1;
  constructor(n: number) {
    super(n);
    this.extra += n;
  }
  override size(): number {
    return super.size() + this.extra;
  }
}
attempt("${index} below the file's class", () => {
  let sum = 0;
  for (let i = 0; i < ${turns}; i++) {
    const mine = new Mine${index}(i);
    sum += mine.size() + mine.twice + mine.n + mine.extra + mine.kind.length;
  }
  const one = Mine${index}.make(3);
  return [sum, one instanceof Mine${index}, one.size(), Object.keys(one)];
});
attempt("${index} records", () => {
  let sum = 0;
  for (let i = 0; i < ${turns}; i++) {
    const each = made${index}.record(i);
    sum += each.a + each.b;
  }
  return sum;
});
attempt("${index} steps", () => {
  let sum = 0;
  for (const step of made${index}.steps(${turns})) sum += step;
  return sum;
});
attempt("${index} each", () => {
  let sum = 0;
  const list = [1, 2, 3, 4, 5];
  const count = made${index}.each(list, (each, i, all) => {
    ${inTheCallback}
    sum += each;
  });
  return [sum, count, list];
});
for (let kind = 0; kind < 5; kind++) {
  let passed = "";
  try {
    try {
      passed += "in ";
      made${index}.fails(kind);
    } finally {
      passed += "finally ";
    }
  } catch (error) {
    passed += error instanceof Error ? error.constructor.name + " " + error.message : show(error);
  }
  console.log(${index}, "fails", kind, passed);
}
{
  const held = new Thing(${index});
  console.log(${index}, "later", (await made${index}.later(held)) === held, held.total());
  const order: string[] = [];
  await made${index}.soon(when => void order.push(when));
  order.push("awaited");
  await new Promise<void>(resolve => setTimeout(resolve, 5));
  console.log(${index}, "order", order.join(" "));
}`;
}

export function generate(random: Random): string {
  return [prelude, ...Array.from({ length: random.between(1, 3) }, (_, index) => (random.chance(0.3) ? theOtherWay(random, index) : scene(random, index)))].join("\n") + "\n";
}
