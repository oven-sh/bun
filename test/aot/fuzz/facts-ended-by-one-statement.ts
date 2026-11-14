// What a build finds out about a whole program holds because no statement of the program says otherwise: a class has no class below it, a
// field always holds numbers, a method is never replaced, a list has no holes, a function has one caller, a variable is never stored again,
// an object is frozen nowhere. Each program here relies on one such fact in a loop, and has one statement that ends it: early, between two
// rounds, inside a round, or never (the control). The statement is everyday code: a subclass, a deleted cache entry, an option that is
// missing, a default laid on a prototype, a handler that is stored and called later. Programs are short, so that little else covers for the fact.
import type { Random } from "./random";

type Scene = {
  /** Declarations. `T` is the type annotation of a value, or nothing in JavaScript. */
  declare: string;
  /** Runs once a round, with the round's number in `round`; it logs. */
  use: string;
  /** Statements that end the fact. Each may name `round`. */
  ends: string[];
};

const t = (typed: boolean, type: string) => (typed ? `: ${type}` : "");
const as = (typed: boolean, type = "any") => (typed ? ` as ${type}` : "");

const scenes: Record<string, (random: Random, typed: boolean) => Scene> = {
  // A class without a class below it; its methods are never replaced.
  "class-method": (random, typed) => {
    const any = (text: string) => (typed ? `(${text} as any)` : text);
    const how = random.pick([
      "total += shape.area();",
      "const area = shape.area(); total += area;",
      "total += shape.size * shape.area();",
      "if (shape instanceof Shape) total += shape.area(); else total -= 1;",
    ]);
    return {
      declare: `class Shape {
  size${t(typed, "number")};
  static made = 0;
  constructor(size${t(typed, "number")}) { this.size = size; Shape.made++; }
  area()${t(typed, "number")} { return this.size * this.size; }
  get label()${t(typed, "string")} { return "shape " + this.size; }
  double()${t(typed, "number")} { return this.area() * 2; }
}
const shapes${t(typed, "Shape[]")} = [new Shape(1), new Shape(2), new Shape(3)];
function measure(list${t(typed, "Shape[]")})${t(typed, "number")} {
  let total = 0;
  for (const shape of list) { ${how} }
  return total;
}`,
      use: `log(measure(shapes), shapes[0].label, shapes[0].double(), Shape.made, Object.keys(shapes[1]).join());`,
      ends: [
        `class Square extends Shape { area()${t(typed, "number")} { return 100 + this.size; } } shapes.push(new Square(4));`,
        `class Named extends Shape { name = "n"; } shapes.push(new Named(5));`,
        `class Wide extends Shape { get label() { return "wide " + this.size; } } shapes[0] = new Wide(7);`,
        `${any("Shape.prototype")}.area = function (${typed ? "this: Shape" : ""}) { return this.size + 1000; };`,
        `Object.defineProperty(Shape.prototype, "area", { value() { return 77; }, configurable: true, writable: true });`,
        `Object.assign(Shape.prototype, { area() { return 55; } });`,
        `${any("shapes[1]")}.area = () => 11;`,
        `Object.defineProperty(shapes[2], "area", { value: () => 13 });`,
        `delete ${any("Shape.prototype")}.double; ${any("Shape.prototype")}.double = () => 3;`,
        `Object.defineProperty(Shape.prototype, "label", { get() { return "other"; } });`,
        `Object.defineProperty(shapes[0], "label", { value: "own" });`,
        `Object.setPrototypeOf(shapes[1], { area() { return 5; }, double() { return 6; }, label: "l" });`,
        `Object.setPrototypeOf(shapes[0], class extends Shape { area() { return 31; } }.prototype);`,
        `shapes.push(Reflect.construct(Shape, [6], class extends Shape { area() { return 41; } })${as(typed, "Shape")});`,
        `shapes.push(Object.create(Shape.prototype, { size: { value: 9 } }));`,
        `shapes.push(Object.assign(Object.create(shapes[0]), { size: 12 }));`,
        `shapes.push({ size: 2, area: () => 21, label: "record", double: () => 1 }${as(typed)});`,
        `${any("shapes[0]")}.size = undefined;`,
        `${any("shapes[0]")}.size = "4";`,
        `${any("shapes[0]")}.size = 1.5;`,
        `${any("shapes[0]")}.size = { valueOf: () => 6 };`,
        `delete ${any("shapes[2]")}.size;`,
        `Object.defineProperty(shapes[1], "size", { get() { return 8; } });`,
        `Object.freeze(shapes[0]); try { shapes[0].size = 50; log("stored"); } catch (e) { log((e${as(typed)}).constructor.name); }`,
        `${any("shapes[0]")}.extra = round; ${any("shapes[0]")}.area = undefined; ${any("shapes[0]")}.area = () => round;`,
        `${any("Shape")}.made = "many";`,
        `delete ${any("Shape")}.made;`,
        `Object.defineProperty(Shape, Symbol.hasInstance, { value: () => false });`,
        `const key = ["ar", "ea"].join(""); ${any("Shape.prototype")}[key] = () => 17;`,
        `for (const key of ["size"]) ${any("shapes[1]")}[key] = 2.25;`,
      ],
    };
  },
  // A record with fields of one kind each, made in one place.
  record: (random, typed) => {
    const any = (text: string) => (typed ? `(${text} as any)` : text);
    const make = random.pick([
      `return { id, score: id * 2, tag: "t" + id };`,
      `const made = { id, score: id * 2, tag: "t" + id }; return made;`,
      `const made${t(typed, "any")} = {}; made.id = id; made.score = id * 2; made.tag = "t" + id; return made;`,
      `return Object.assign({}, { id, score: id * 2, tag: "t" + id });`,
    ]);
    return {
      declare: `${typed ? "interface Row { id: number; score: number; tag: string; note?: string }\n" : ""}function make(id${t(typed, "number")})${t(typed, "Row")} { ${make} }
const rows${t(typed, "Row[]")} = [make(1), make(2), make(3)];
function sum(list${t(typed, "Row[]")})${t(typed, "number")} {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].score + list[i].tag.length;
  return total;
}
function bump(row${t(typed, "Row")}) { row.score += 1; }`,
      use: `rows.forEach(bump); log(sum(rows), JSON.stringify(rows[0]), "note" in rows[1], Object.keys(rows[2]).join());`,
      ends: [
        `rows.push({ id: 9, score: 1.5, tag: "x" });`,
        `rows.push({ tag: "first", score: 3, id: 9 });`,
        `rows.push(JSON.parse('{"id":4,"score":"7","tag":"json"}'));`,
        `rows.push(JSON.parse('{"tag":"json","id":4,"score":7}'));`,
        `rows.push({ ...rows[0], note: "copied" });`,
        `rows.push({ ...rows[0], score: ${typed ? "null as any" : "null"} });`,
        `rows.push(Object.fromEntries([["id", 1], ["score", 2], ["tag", "e"]])${as(typed)});`,
        `rows[0].note = "noted";`,
        `${any("rows[1]")}.score = undefined;`,
        `${any("rows[1]")}.score = "2";`,
        `${any("rows[1]")}.score = -0; log(Object.is(rows[1].score, -0));`,
        `${any("rows[1]")}.tag = ["a", "b"];`,
        `delete ${any("rows[2]")}.score;`,
        `delete ${any("rows[2]")}.tag; rows[2].tag = "again";`,
        `Object.defineProperty(rows[0], "score", { get: () => 40, set() {} });`,
        `Object.defineProperty(rows[0], "score", { value: 41, writable: false });`,
        `Object.defineProperty(rows[0], "tag", { value: "hidden", enumerable: false });`,
        `Object.freeze(rows[1]); try { bump(rows[1]); log("bumped"); } catch (e) { log((e${as(typed)}).constructor.name); rows[1] = make(5); }`,
        `Object.setPrototypeOf(rows[2], { note: "inherited" });`,
        `${any("rows[2]")}.__proto__ = { note: "inherited", extra: 1 };`,
        `const key = round % 2 ? "score" : "id"; ${any("rows[0]")}[key] = "by key";`,
        `for (const key in rows[0]) ${any("rows[0]")}[key] = key;`,
        `[rows[0].score, rows[1].score] = [0.5, 1e300];`,
        `({ length: rows[2].score } = "abcd");`,
        `for (rows[0].score of [3, 4.5]);`,
        `Reflect.set(rows[1], "score", NaN);`,
        `structuredClone(rows).forEach(row => rows.push(row));`,
        `rows.push(new (class { id = 3; score = 9; tag = "instance"; })());`,
        `rows.push(Object.create({ id: 1, score: 6, tag: "above" }));`,
        `rows.push(new Proxy(make(8), {}));`,
      ],
    };
  },
  // A list without holes, of one kind.
  list: (random, typed) => {
    const any = (text: string) => (typed ? `(${text} as any)` : text);
    const first = random.pick([
      "[1, 2, 3, 4]",
      "[1.5, 2.5, 3.5]",
      `["a", "b", "c"]`,
      "Array.from({ length: 4 }, (_, i) => i)",
      "new Array(4).fill(7)",
    ]);
    const how = random.pick([
      "for (let i = 0; i < list.length; i++) text += list[i] + ',';",
      "for (const value of list) text += value + ',';",
      "list.forEach((value, i) => { text += i + ':' + value + ','; });",
      "text = list.map(value => value + '!').join();",
      "for (const i in list) text += i + '=' + list[i] + ',';",
      "const [head, ...rest] = list; text = head + '|' + rest;",
      "text = list.reduce((sum, value) => sum + '+' + value, '');",
    ]);
    return {
      declare: `const items${t(typed, "any[]")} = ${first};
function show(list${t(typed, "any[]")})${t(typed, "string")} {
  let text = "";
  ${how}
  return text + list.length;
}`,
      use: `log(show(items), items.indexOf(undefined${as(typed)}), items.includes(undefined${as(typed)}));`,
      ends: [
        `delete items[1];`,
        `items[items.length + 2] = items[0];`,
        `items.length += 2;`,
        `items.length = 1;`,
        `items.push("text");`,
        `items.push(0.25);`,
        `items.push(undefined);`,
        `items.push({});`,
        `items[0] = -0;`,
        `items[-1] = 5; log(${any("items")}[-1]);`,
        `items[4294967294] = 1; log(items.length); items.length = 3;`,
        `${any("items")}.extra = "named";`,
        `Object.defineProperty(items, 1, { get: () => "got", configurable: true, enumerable: true });`,
        `Object.freeze(items); try { items.push(1); } catch (e) { log((e${as(typed)}).constructor.name); }`,
        `Object.setPrototypeOf(items, class extends Array { map() { return ["mapped"]${as(typed)}; } }.prototype);`,
        `${any("items")}[Symbol.iterator] = function* () { yield "own"; };`,
        `${any("items")}.forEach = () => log("own forEach"); ${any("items")}.map = () => ["own map"];`,
        `${any("items")}.constructor = Set;`,
        `items.splice(1, 1); items.unshift("front");`,
        `items.sort(() => 1).reverse(); items.copyWithin(0, 1);`,
        `items.reverse(); delete items[0];`,
        `${any("items")}["1"] = "by text"; ${any("items")}["01"] = "named";`,
        `Object.assign(items, { 0: null, 5: "five" });`,
      ],
    };
  },
  // A function with one caller and one callee.
  "function": (random, typed) => {
    const any = (text: string) => (typed ? `(${text} as any)` : text);
    const body = random.pick([
      "return a * 2 + b;",
      "return a > b ? a : b;",
      "const c = a + b; return c / 2;",
      "let s = 0; for (let i = 0; i < a; i++) s += b; return s;",
      "if (a === 2) return b; return a;",
    ]);
    return {
      declare: `let calls = 0;
function combine(a${t(typed, "number")}, b${t(typed, "number")} = 3)${t(typed, "number")} { calls++; ${body} }
const table${t(typed, "Record<string, any>")} = { combine };
let current${t(typed, "any")} = combine;
function drive(n${t(typed, "number")})${t(typed, "any")} {
  let total${t(typed, "any")} = 0;
  for (let i = 0; i < n; i++) total += combine(i, i + 1);
  return total;
}`,
      use: `log(drive(4), current(2), table.combine(1, 2), calls, combine.length, typeof combine);`,
      ends: [
        `log(${any("combine")}("5", 2));`,
        `log(${any("combine")}(1.5, 2.5));`,
        `log(${any("combine")}());`,
        `log(${any("combine")}(undefined, null));`,
        `log(${any("combine")}(2n, 3n));`,
        `log(${any("combine")}({ valueOf: () => 4 }, 1));`,
        `log([1, 2, 3].map(combine${as(typed)}).join());`,
        `log(combine.call(null, 3, 4), combine.apply(null, [5, 6]${as(typed)}), combine.bind(null, 7)(8));`,
        `log(Reflect.apply(combine, undefined, ["a", "b"]));`,
        `log(new ${any("combine")}(1, 2) instanceof combine);`,
        `current = (a${t(typed, "any")}) => a + "!";`,
        `table.combine = () => "replaced";`,
        `${any("combine")}.note = "noted"; log(${any("combine")}.note, Object.keys(combine).join());`,
        `${any("combine")}.prototype = { shown: 1 }; log(new ${any("combine")}(1, 1).shown);`,
        `Object.defineProperty(combine, "length", { value: 9 });`,
        `Object.setPrototypeOf(combine, { call: () => "called" }); log(${any("combine")}.call(1));`,
        `const key = "com" + "bine"; log(table[key](4, 5)); table[key] = null; table[key] = combine;`,
        `const stored = [combine]; log(stored[0](6, 1), stored.map(f => f(1, 1)).join());`,
        `log([3, 1, 2].sort(combine${as(typed)}).join());`,
        `log("a-b".replace(/-/g, combine${as(typed)}));`,
        `Object.assign(combine, { tag: "t" }); Object.freeze(combine); log(${any("combine")}.tag);`,
        `log(Array.from([1, 2], combine${as(typed)}).join(), Object.entries({ x: 1 }).flatMap(combine${as(typed)}).length);`,
      ],
    };
  },
  // Variables that are stored once, read in functions.
  variable: (random, typed) => {
    const kind = random.pick([
      "5",
      "1.5",
      `"text"`,
      "{ a: 1 }",
      "[1, 2]",
      "() => 4",
      "true",
      "null",
      "new Map([[1, 2]])",
    ]);
    return {
      declare: `let setting${t(typed, "any")} = ${kind};
let seen = 0;
const limit${t(typed, "any")} = { value: 3 };
function read()${t(typed, "any")} { seen++; return typeof setting === "function" ? setting() : setting; }
function rounds(n${t(typed, "number")})${t(typed, "string")} {
  let text = "";
  for (let i = 0; i < n; i++) { text += String(read()) + typeof setting + limit.value + ";"; }
  return text;
}
function makeCounter() { let count = 0; return { next: () => ++count, reset(to${t(typed, "any")}) { count = to; }, get now() { return count; } }; }
const counter = makeCounter();`,
      use: `log(rounds(3), seen, counter.next(), counter.next(), counter.now);`,
      ends: [
        `setting = round;`,
        `setting = "changed " + round;`,
        `setting = undefined;`,
        `setting = () => "called";`,
        `[setting] = ["by pattern"];`,
        `({ setting = "default" } = {}${as(typed)});`,
        `for (setting of [1, "last"]);`,
        `for (setting in { key: 1 });`,
        `(() => { setting = [9]; })();`,
        `[7].forEach(value => { setting = value; });`,
        `try { throw "thrown"; } catch (e) { setting = e; }`,
        `setting ??= "filled"; setting ||= "filled"; setting &&= "both";`,
        `limit.value = "three"${as(typed)};`,
        `delete limit.value;`,
        `counter.reset("a");`,
        `counter.reset(0.5);`,
        `counter.reset(2147483647);`,
        `Object.defineProperty(limit, "value", { get: () => ++seen });`,
        `setting = new Proxy({}, { get: (_, key) => (key === Symbol.toPrimitive ? () => "proxied" : undefined) });`,
      ],
    };
  },
  // What a call may touch: a callee that changes something at times.
  effects: (random, typed) => {
    const read = random.pick(["state.count", "state.items.length", "state.items[0]", "state.name", "total0"]);
    const between = random.pick([
      "step(state, i)",
      "state.hook(i)",
      "`${{ toString: () => { step(state, i); return ''; } }}`",
      "state.bump",
      "[1].forEach(() => step(state, i))",
      "JSON.stringify({ toJSON: () => step(state, i) })",
    ]);
    const end = random.pick([
      "s.count += 10;",
      "s.items.push(i);",
      "s.items[0] = 'first';",
      "s.items.length = 0; s.items.push(8, 9);",
      "s.name = 'n' + i;",
      "total0 = i;",
      "state = { ...s, count: -1 };",
      "s.items = [i, i];",
      "delete (s" + as(typed) + ").name;",
      "throw new Error('at ' + i);",
      "Object.freeze(s.items);",
    ]);
    return {
      declare: `let total0${t(typed, "any")} = 0;
let on = false;
let state${t(typed, "any")} = { count: 1, items: [5, 6, 7], name: "s", hook: (i${t(typed, "number")}) => step(state, i), get bump() { return step(this, 2); } };
function step(s${t(typed, "any")}, i${t(typed, "number")})${t(typed, "number")} {
  let work = 0;
  for (let k = 0; k < 5; k++) work = (work * 31 + k + i) | 0;
  if (on && i === 2) { ${end} }
  return work;
}
function run(n${t(typed, "number")})${t(typed, "string")} {
  let text = "";
  try {
    for (let i = 0; i < n; i++) {
      text += ${read};
      const value = ${between};
      text += "/" + ${read} + (value ? "" : "0") + " ";
    }
  } catch (e) { text += (e${as(typed)}).message; }
  return text;
}`,
      use: `log(run(5), state.count, String(state.items), state.name, total0);`,
      ends: [
        "on = true;",
        "on = true; state = { count: 2, items: [1.5, 'x'], name: undefined, hook: () => 0, bump: 1 };",
        "state.hook = () => { on = true; return 1; };",
      ],
    };
  },
  // Code that is reached by a name that is made at run time, by a protocol, or late.
  reach: (random, typed) => {
    const any = (text: string) => (typed ? `(${text} as any)` : text);
    const call = random.pick([
      `handlers["on" + kind](round)`,
      `Object.values(handlers)[round % 3](round)`,
      `String(new Printed(round))`,
      `\`\${new Printed(round)}\``,
      `+new Printed(round)`,
      `[...new Printed(round)${as(typed)}].join()`,
      `JSON.stringify(new Printed(round))`,
      `Reflect.get(new Printed(round), "late")`,
      `new (makers.get(kind)${as(typed)})(round).value`,
      `${any("new Printed(round)")}["la" + "te"]`,
      `Object.entries(new Printed(round)).join()`,
      `new Printed(round) < new Printed(round + 1)`,
    ]);
    return {
      declare: `let kind = "Open";
const handlers${t(typed, "Record<string, (n: number) => any>")} = { onOpen: n => "open " + n, onClose: n => "close " + n, onError(n) { return "error " + (n + 1); } };
class Made { value${t(typed, "any")}; constructor(value${t(typed, "any")}) { this.value = value; } }
class OtherMade { value${t(typed, "any")}; constructor(value${t(typed, "any")}) { this.value = "other " + value; } }
const makers${t(typed, "Map<string, any>")} = new Map${typed ? "<string, any>" : ""}([["Open", Made], ["Close", OtherMade]]);
class Printed {
  n${t(typed, "number")};
  constructor(n${t(typed, "number")}) { this.n = n; }
  toString() { return "printed " + this.n; }
  valueOf() { return this.n; }
  toJSON() { return { json: this.n }; }
  get late() { return "late " + this.n; }
  *[Symbol.iterator]() { yield this.n; yield kind; }
}`,
      use: `log(kind, ${call});`,
      ends: [
        `kind = "Close";`,
        `kind = "Error"; makers.set("Error", function (${typed ? "this: any, " : ""}v${t(typed, "any")}) { this.value = v; });`,
        `handlers.onOpen = handlers.onError;`,
        `makers.set("Open", OtherMade);`,
        `${any("Printed.prototype")}.toString = () => "replaced";`,
        `${any("Printed.prototype")}[Symbol.toPrimitive] = (hint${t(typed, "string")}) => (hint === "number" ? 42 : "primitive");`,
        `${any("Printed.prototype")}.toJSON = undefined;`,
        `delete ${any("Printed.prototype")}.toJSON; delete ${any("Printed.prototype")}.valueOf;`,
        `${any("Printed.prototype")}[Symbol.iterator] = function* () { yield "other"; };`,
        `Object.defineProperty(Printed.prototype, "late", { value: "data" });`,
      ],
    };
  },
  // Coroutines that wait at times, values that change over a wait.
  coroutine: (random, typed) => {
    const wait = random.pick([
      "await null",
      "await Promise.resolve(i)",
      "await { then: (f" + t(typed, "any") + ") => f(i) }",
      "await new Promise" + (typed ? "<void>" : "") + "(resolve => queueMicrotask(resolve))",
    ]);
    return {
      declare: `let slow = false;
const shared${t(typed, "any")} = { n: 0, list: [1, 2] };
async function work(i${t(typed, "number")})${t(typed, "Promise<any>")} {
  const before = shared.n;
  if (slow && i % 2) ${wait};
  shared.n += i;
  return before + ":" + shared.n + ":" + shared.list.length;
}
function* steps(n${t(typed, "number")})${t(typed, "Generator<any, any, any>")} {
  let got${t(typed, "any")} = 0;
  try { for (let i = 0; i < n; i++) got = (yield i + shared.n) ?? got; return "end " + got; } finally { shared.list.push(n); }
}
async function drive(n${t(typed, "number")}) {
  const texts${t(typed, "any[]")} = [];
  for (let i = 0; i < n; i++) texts.push(work(i));
  shared.n += 100;
  return (await Promise.all(texts)).join(" ");
}
function walk(n${t(typed, "number")}) { let text = ""; for (const value of steps(n)) { if (value > 1000) break; text += value + ","; } return text; }`,
      use: `log(await drive(4), walk(3), shared.n, shared.list.join());`,
      ends: [
        "slow = true;",
        "shared.n = 0.5;",
        `shared.n = "text";`,
        "shared.n = 999;",
        "shared.list = 'abc';",
        "slow = true; shared.list.length = 0;",
        `const g = steps(2); g.next(); g.return("early"); log(shared.list.length);`,
        `try { const g = steps(2); g.next(); g.throw(new Error("in")); } catch (e) { log((e${as(typed)}).message); }`,
      ],
    };
  },
  // An object that is kept by somebody and changed later; a closure that outlives its maker.
  escape: (random, typed) => {
    const keep = random.pick([
      "kept.push(made);",
      "keeper = made;",
      "registry.set(made.id, made);",
      "made.self = made;",
      "later(() => { made.v += 1; });",
      "Object.assign(holder, { made });",
      "holder['ma' + 'de'] = made;",
    ]);
    return {
      declare: `const kept${t(typed, "any[]")} = [];
let keeper${t(typed, "any")} = null;
const registry = new Map${typed ? "<any, any>" : ""}();
const holder${t(typed, "any")} = {};
const queue${t(typed, "(() => void)[]")} = [];
function later(f${t(typed, "() => void")}) { queue.push(f); }
let keeps = false;
function build(id${t(typed, "number")})${t(typed, "any")} {
  const made${t(typed, "any")} = { id, v: id * 2, inner: { w: id } };
  if (keeps && id === 2) { ${keep} }
  let sum = 0;
  for (let i = 0; i < 3; i++) { sum += made.v + made.inner.w; change(i); }
  return sum;
}
function change(i${t(typed, "number")}) {
  for (const made of kept) made.v = "kept " + i;
  if (keeper) keeper.inner = { w: 0.5 };
  for (const made of registry.values()) delete made.v;
  if (holder.made) holder.made.v = null;
  while (queue.length) queue.pop()${typed ? "!" : ""}();
}`,
      use: `let text = ""; for (let id = 1; id < 4; id++) text += build(id) + " "; log(text);`,
      ends: ["keeps = true;", "keeps = true; kept.push({ v: 0 });", "registry.set(0, { v: 1 });"],
    };
  },
  // Accessors of a literal and of a class that are entered in a loop.
  accessor: (random, typed) => {
    const any = (text: string) => (typed ? `(${text} as any)` : text);
    const holder = random.pick([
      `const gauge${t(typed, "any")} = { raw: 1, get level() { return this.raw * 2; }, set level(v${t(typed, "any")}) { this.raw = v + 1; } };`,
      `class Gauge { raw${t(typed, "any")} = 1; get level() { return this.raw * 2; } set level(v${t(typed, "any")}) { this.raw = v + 1; } }\nconst gauge${t(typed, "any")} = new Gauge();`,
      `function makeGauge()${t(typed, "any")} { let raw${t(typed, "any")} = 1; return { get level() { return raw * 2; }, set level(v) { raw = v + 1; }, get raw() { return raw; } }; }\nconst gauge${t(typed, "any")} = makeGauge();`,
      `const gauge${t(typed, "any")} = { raw: 1 };\nObject.defineProperty(gauge, "level", { get() { return this.raw * 2; }, set(v) { this.raw = v + 1; }, configurable: true, enumerable: true });`,
      `const gauge${t(typed, "any")} = { raw: 1, get level() { return 7; } };`,
    ]);
    return {
      declare: `${holder}
function drive(g${t(typed, "any")}, n${t(typed, "number")})${t(typed, "string")} {
  let text = "";
  for (let i = 0; i < n; i++) { try { g.level = i; } catch (e) { text += "!"; } text += g.level + ","; }
  return text;
}`,
      use: `log(drive(gauge, 4), gauge.raw, Object.keys(gauge).join(), JSON.stringify(gauge));`,
      ends: [
        `Object.defineProperty(gauge, "level", { get: () => 99, configurable: true });`,
        `Object.defineProperty(gauge, "level", { get: () => 98, set(v) { log("set", v); }, configurable: true });`,
        `Object.defineProperty(gauge, "level", { value: 5, writable: true, configurable: true });`,
        `delete gauge.level; gauge.level = 4;`,
        `delete gauge.level;`,
        `Object.setPrototypeOf(gauge, { get level() { return 31; }, set level(v) { log("above", v); } });`,
        `Object.defineProperty(Object.getPrototypeOf(gauge) === Object.prototype ? gauge : Object.getPrototypeOf(gauge), "level", { get: () => 55, set() {}, configurable: true });`,
        `Object.freeze(gauge);`,
        `const key = "lev" + "el"; Object.defineProperty(gauge, key, { set: v => log("only set", v), get: undefined, configurable: true });`,
        `gauge.__defineGetter__("level", () => "got");`,
        `gauge.raw = "text";`,
        `Object.assign(gauge, { level: 12 });`,
        `const copy = { ...gauge }; copy.level = 3; log(copy.level, copy.raw);`,
        `const heir = Object.create(gauge); heir.level = 8; log(heir.level, heir.raw, gauge.raw);`,
      ],
    };
  },
  // Functions as objects: names laid on them, their prototype property, constructors written as functions.
  "function-object": (random, typed) => {
    const any = (text: string) => (typed ? `(${text} as any)` : text);
    return {
      declare: `${typed ? "type Anything = any;\n" : ""}function Point(${typed ? "this: any, " : ""}x${t(typed, "any")}, y${t(typed, "any")}) { this.x = x; this.y = y; }
Point.prototype.sum = function (${typed ? "this: any" : ""}) { return this.x + this.y; };
Point.prototype.name = "point";
const make = (x${t(typed, "any")}, y${t(typed, "any")}) => new ${any("Point")}(x, y);
const points${t(typed, "any[]")} = [make(1, 2), make(3, 4)];
const plain = (n${t(typed, "any")}) => n + 1;
function total(list${t(typed, "any[]")}) { let text = ""; for (const point of list) text += point.sum() + point.name + (point instanceof Point) + ";"; return text; }`,
      use: `points.push(make(round, 1)); log(total(points), plain(round), Object.keys(plain).join(), Object.keys(Point).join(), ${any("plain")}.extra, ${any("Point")}.extra);`,
      ends: [
        `Point.prototype = { sum: () => "new sum", name: "new" }${as(typed)};`,
        `Point.prototype.sum = () => "replaced";`,
        `Point.prototype.sum = 5; Point.prototype.sum = function (${typed ? "this: any" : ""}) { return -this.x; };`,
        `delete Point.prototype.name;`,
        `Object.assign(Point.prototype, { name: "assigned", sum() { return "assigned sum"; } });`,
        `Object.defineProperty(Point.prototype, "sum", { get() { return () => "from getter"; }, configurable: true });`,
        `Object.defineProperty(Point, "prototype", { value: { sum: () => 1, name: "defined" } });`,
        `Object.setPrototypeOf(Point.prototype, { name: "inherited" }); delete Point.prototype.name;`,
        `points[0].sum = () => "own"; points[1].name = "own name";`,
        `points[0].constructor = null; log(points[0].constructor, points[1].constructor === Point);`,
        `${any("plain")}.extra = 1;`,
        `Object.assign(plain, { extra: "assigned", more: 2 });`,
        `for (const key of ["extra", "other"]) ${any("plain")}[key] = key;`,
        `Object.defineProperty(plain, "ex" + "tra", { value: 7, enumerable: true });`,
        `((f${t(typed, "any")}) => { f.extra = "through a parameter"; })(round % 2 ? plain : Point);`,
        `${any("Point")}.extra = { deep: 1 }; ${any("Point")}.extra.deep = 2;`,
        `Reflect.set(plain, "extra", plain);`,
        `Object.setPrototypeOf(plain, { extra: "above" });`,
        `Object.defineProperty(plain, "name", { value: "renamed" }); log(plain.name);`,
        `delete ${any("plain")}.name; delete ${any("plain")}.length; log(plain.name, plain.length);`,
        `const bound = ${any("Point")}.bind(null, 9); points.push(new bound(1));`,
        `class Below extends ${any("Point")} { sum() { return "below " + super.sum(); } } points.push(new Below(5, 6));`,
        `points.push(Reflect.construct(${any("Point")}, [1, 1], plain.constructor));`,
        `points.push(Object.create(Point.prototype)); points[points.length - 1].x = "a"; points[points.length - 1].y = "b";`,
        `log(typeof ${any("plain")}.prototype, Object.getOwnPropertyNames(Point).sort().join());`,
      ],
    };
  },
  // The static side of classes, and classes whose base is picked while the program runs.
  "static-side": (random, typed) => {
    const any = (text: string) => (typed ? `(${text} as any)` : text);
    const base = random.pick(["Plain", "pick()", "(flag ? Plain : Other)", "mix(Plain)"]);
    return {
      declare: `let flag = true;
class Plain { static kind${t(typed, "any")} = "plain"; static count = 0; static make()${t(typed, "any")} { this.count++; return new this(); } describe()${t(typed, "any")} { return "P"; } }
class Other { static kind${t(typed, "any")} = "other"; static make()${t(typed, "any")} { return new this(); } describe()${t(typed, "any")} { return "O"; } }
function pick()${t(typed, "any")} { return flag ? Plain : Other; }
function mix(B${t(typed, "any")})${t(typed, "any")} { return class extends B { mixed() { return "M"; } describe() { return "M" + super.describe(); } }; }
function define()${t(typed, "any")} { return class Derived extends ${base} { describe()${t(typed, "any")} { return "D" + super.describe(); } static label() { return "L" + super.kind; } }; }
let Current${t(typed, "any")} = define();`,
      use: `const made = Current.make(); log(made.describe(), Current.label(), Current.kind, Current.count, made instanceof Plain, made instanceof Other, Object.getOwnPropertyNames(Current).join());`,
      ends: [
        `flag = false; Current = define();`,
        `Current = define();`,
        `Object.setPrototypeOf(Current, Other);`,
        `Object.setPrototypeOf(Current.prototype, Other.prototype);`,
        `Plain.kind = 5;`,
        `${any("Plain")}.make = () => new Other();`,
        `${any("Plain")}["ki" + "nd"] = "by key";`,
        `Object.assign(Plain, { kind: "assigned", extra: 1 });`,
        `Object.defineProperty(Plain, "kind", { get: () => "got", configurable: true });`,
        `delete ${any("Plain")}.kind;`,
        `Current.kind = "own";`,
        `Current.label = () => "replaced";`,
        `${any("Plain.prototype")}.describe = () => "patched";`,
        `for (const key of ["kind", "more"]) ${any("Current")}[key] = key;`,
        `Object.freeze(Plain); try { Plain.count = 100; } catch (e) { log("frozen"); }`,
        `Current = class extends Current { static kind = "third"; describe() { return "T" + super.describe(); } };`,
        `Current = { make: () => ({ describe: () => "R" }), label: () => "record", kind: 0 };`,
        `Object.defineProperty(Other, Symbol.hasInstance, { value: () => true });`,
      ],
    };
  },
  // Records that are used as dictionaries, spreads, optional fields, options with defaults.
  dictionary: (random, typed) => {
    const how = random.pick([
      "counts[word] = (counts[word] ?? 0) + 1;",
      "if (word in counts) counts[word]++; else counts[word] = 1;",
      "counts = { ...counts, [word]: (counts[word] || 0) + 1 };",
      "Object.assign(counts, { [word]: counts[word] ? counts[word] + 1 : 1 });",
      "(groups[word] ||= []).push(word.length); counts[word] = groups[word].length;",
    ]);
    const start = random.pick([
      "{}",
      "{ the: 0 }",
      "{ total: 0, the: 1 }",
      "Object.create(null)",
      "{ __proto__: null, a: 1 }",
    ]);
    return {
      declare: `let counts${t(typed, "any")} = ${start};
const groups${t(typed, "any")} = {};
const words = ["the", "a", "of", "the", "constructor", "total"];
let extra${t(typed, "string[]")} = [];
function count(list${t(typed, "string[]")}) { for (const word of list) { ${how} } }
function options(given${t(typed, "any")}) { const { size = 3, name = "none", ...rest } = { color: "red", ...given }; return size + name + JSON.stringify(rest); }`,
      use: `count(words); count(extra); log(Object.entries(counts).map(([k, v]) => k + v).join(), options({ size: round }), options({ name: undefined, color: null }), "toString" in counts, counts.missing);`,
      ends: [
        `extra = ["toString", "valueOf"];`,
        `extra = ["0", "1", "10", "02"];`,
        `extra = ["__proto__"];`,
        `delete counts.the;`,
        `counts.the = "text";`,
        `counts = { the: 1.5 };`,
        `counts = Object.freeze({ ...counts });`,
        `Object.defineProperty(counts, "a", { value: 9, writable: false, enumerable: true, configurable: true });`,
        `counts = new Proxy(counts, {});`,
        `for (const key in counts) if (key.length > 2) delete counts[key];`,
        `counts = JSON.parse(JSON.stringify(counts));`,
        `log(options({ get size() { return 9; }, [Symbol.iterator]: 1, 5: "five" }));`,
        `log(options(Object.create({ size: "inherited" })), options("text"), options([1, 2]), options(null));`,
        `const { the, ...others } = counts; counts = { others, the };`,
        `counts = Object.fromEntries(Object.entries(counts).reverse());`,
        `counts = Object.groupBy(words, word => word); extra = [];`,
      ],
    };
  },
  // Functions of the language that are reached by another road than their written name.
  builtins: (random, typed) => {
    const any = (text: string) => (typed ? `(${text} as any)` : text);
    const calls = random.shuffled([
      `call("padStart", "a", 5, "x")`,
      `call("at", [1, 2, 3], -1)`,
      `call("toFixed", 1.005, 2)`,
      `call("flat", [1, [2, [3]]], 2)`,
      `call("has", new Set([1]), 1)`,
      `call("getTime", new Date(5))`,
      `call("test", /b/, "abc")`,
      `call("replace", "a-b", "-", "+")`,
      `call("match", "abcabc", "b")`,
      `call("split", "a,b", ",")`,
      `[-1, 2].map(Math.abs).join()`,
      `["1", "2", "x"].map(Number).join()`,
      `["a", "b"].map(String.prototype.toUpperCase.call, String.prototype.toUpperCase).join()`,
      `Reflect.apply(Math.max, null, [1, 5, 3])`,
      `${any("Math")}["hy" + "pot"](3, 4)`,
      `${any(`"abc"`)}["toUpper" + "Case"]()`,
      `${any("[3, 1, 2]")}["so" + "rt"]().join()`,
      `${any("Object")}["ke" + "ys"]({ a: 1, b: 2 }).join()`,
      `(/(\\d+)-(\\d+)/.exec("10-20"), RegExp.$1 + RegExp.$2)`,
      `"x1y22".replace(/\\d+/g, m => m.length + "")`,
      `"abc".search("c")`,
      `[..."a1b2".matchAll(/[a-z]/g)].length`,
      `Object.getOwnPropertyNames(Reflect).length > 10`,
      `Object.keys(Object.getOwnPropertyDescriptors({ a: 1 }).a).join()`,
      `JSON.stringify([..."aé"].map(c => c.codePointAt(0)))`,
      `[...new Map([[1, 2]]).entries()].join()`,
      `new (${any("[Map, Set, Date]")}[1])([1, 1, 2]).size`,
      `String(Symbol.for("s").description)`,
      `${any("globalThis")}["parse" + "Int"]("42px")`,
      `[1, 2, 3].reduce(Math.max).toString()`,
      `["b", "a"].sort(new Intl.Collator("en").compare).join()`,
      `Array.from("ab", c => c + c).join()`,
      `Object.fromEntries(new URLSearchParams("a=1&b=2")).b`,
      `[10, 9].toSorted().join()`,
      `(5).toString(2).padStart(8, "0")`,
      `Number.prototype.toString.call(255, 16)`,
      `structuredClone(new Map([["k", [1]]])).get("k")[0]`,
      `Function.prototype.call.call(Array.prototype.slice, [1, 2, 3], 1).join()`,
    ]);
    return {
      declare: `function call(name${t(typed, "string")}, receiver${t(typed, "any")}, ...args${t(typed, "any[]")}) { return receiver[name](...args); }
function named(receiver${t(typed, "any")}) { return receiver.trim ? receiver.trim() : receiver.join ? receiver.join("+") : receiver.size; }`,
      use: `log(${calls.slice(0, 3).join(", ")}, named(" t "));`,
      ends: [
        `log(named([1, 2]));`,
        `log(named(new Map([[1, 1]])));`,
        `log(${calls[3]}, ${calls[4]});`,
        `log(${calls[5]});`,
        `log(${calls[6]}); log(${calls[7]});`,
        `log(${calls[8]});`,
      ],
    };
  },
  // Calls in tail position, callbacks that are kept, closures that outlive the call that made them.
  closures: (random, typed) => {
    const any = (text: string) => (typed ? `(${text} as any)` : text);
    const keep = random.pick([
      "saved.push(f);",
      "last = f;",
      "table[name] = f;",
      "queueMicrotask(() => f(1));",
      "saved.push(() => f(2));",
      "return f;",
      "if (f === last) log('same'); last = f;",
      "saved.push(f.bind(null, 3));",
      "({ f }).f(0); last = { f }.f;",
    ]);
    return {
      declare: `"use strict";
const saved${t(typed, "any[]")} = [];
let last${t(typed, "any")} = null;
const table${t(typed, "any")} = {};
let keeps = false;
function each(list${t(typed, "any[]")}, f${t(typed, "any")}, name = "n")${t(typed, "any")} { for (const value of list) f(value); if (keeps) { ${keep} } return list.length; }
function outer(k${t(typed, "number")}) {
  let sum = 0, seen = "";
  const size = each([1, 2, 3], (v${t(typed, "any")}) => { sum += v * k; seen += v; });
  const counter = { n: k };
  each([1], () => { counter.n++; });
  return [sum, seen, counter.n, typeof size].join("/");
}
function isEven(n${t(typed, "number")})${t(typed, "any")} { return n === 0 ? true : isOdd(n - 1); }
let isOdd${t(typed, "any")} = (n${t(typed, "number")}) => (n === 0 ? false : isEven(n - 1));
function loop(n${t(typed, "number")}, acc${t(typed, "any")}, step${t(typed, "any")})${t(typed, "any")} { if (n === 0) return acc; return step(n, acc, (m${t(typed, "any")}, a${t(typed, "any")}) => loop(m, a, step)); }`,
      use: `log(outer(round), isEven(51), loop(20, 0, (n${t(typed, "any")}, a${t(typed, "any")}, next${t(typed, "any")}) => next(n - 1, a + n)), saved.map(f => f(5)).join(), last ? String(last(6)) : "", Object.keys(table).join());`,
      ends: [
        "keeps = true;",
        "keeps = true; outer(9); keeps = false;",
        `isOdd = (n${t(typed, "any")}) => "odd " + n;`,
        `log(isEven(20000));`,
        `log(loop(2000, "", (n${t(typed, "any")}, a${t(typed, "any")}, next${t(typed, "any")}) => (n % 500 ? next(n - 1, a) : next(n - 1, a + n + ","))));`,
        `each([1], isEven${as(typed)}); log(each([], null));`,
        `log(each([() => 1, () => 2], (f${t(typed, "any")}) => saved.push(f)));`,
        `isOdd = isEven.bind(null); log(isEven(4));`,
        `last = function (${typed ? "this: any, " : ""}n${t(typed, "any")}) { return this === undefined ? n : typeof this; };`,
      ],
    };
  },
  // A value that belongs to one of several classes, told apart in a loop.
  shapes: (random, typed) => {
    const any = (text: string) => (typed ? `(${text} as any)` : text);
    const told = random.pick([
      "thing.area()",
      `thing.kind === "circle" ? thing.r * 3 : thing.kind === "box" ? thing.w * thing.h : thing.area()`,
      "(thing instanceof Circle ? thing.r : thing instanceof Box ? thing.w : -1)",
      `("r" in thing ? thing.r : thing.w)`,
      `(thing.kind.length + (thing.r ?? thing.w))`,
      "thing.scale(2).area()",
    ]);
    return {
      declare: `class Circle { kind = "circle"; r${t(typed, "number")}; constructor(r${t(typed, "number")}) { this.r = r; } area()${t(typed, "any")} { return this.r * 3; } scale(k${t(typed, "number")})${t(typed, "any")} { return new Circle(this.r * k); } }
class Box { kind = "box"; w${t(typed, "number")}; h${t(typed, "number")}; constructor(w${t(typed, "number")}, h${t(typed, "number")}) { this.w = w; this.h = h; } area()${t(typed, "any")} { return this.w * this.h; } scale(k${t(typed, "number")})${t(typed, "any")} { return new Box(this.w * k, this.h); } }
class Tri { kind = "tri"; w${t(typed, "number")}; constructor(w${t(typed, "number")}) { this.w = w; } area()${t(typed, "any")} { return this.w / 2; } scale(k${t(typed, "number")})${t(typed, "any")} { return new Tri(this.w * k); } }
const things${t(typed, "any[]")} = [new Circle(1), new Box(2, 3), new Tri(4)];
function sum(list${t(typed, "any[]")})${t(typed, "any")} { let total${t(typed, "any")} = 0; for (const thing of list) total += ${told}; return total; }`,
      use: `log(sum(things), things.map(thing => thing.kind).join(), things.map(thing => thing.constructor.name).join());`,
      ends: [
        `things.push(new (class Star extends Circle { area() { return 100; } })(2));`,
        `things.push(new (class Tall extends Box { scale() { return this; } })(1, 9));`,
        `things[0].kind = "box"; things[0].w = 7; things[0].h = 2;`,
        `things[1].kind = undefined; things[1].kind = "round";`,
        `${any("Box.prototype")}.area = () => 1000;`,
        `things[2].area = () => 2000;`,
        `things.push({ kind: "circle", r: 5, area: () => 5, scale() { return this; } });`,
        `things.push(JSON.parse('{"kind":"box","w":3,"h":4}')); things[things.length - 1].area = () => 12; things[things.length - 1].scale = () => things[1];`,
        `things.push(Object.assign(new Circle(3), { r: "3" }));`,
        `things.push(Object.setPrototypeOf({ kind: "tri", w: 6 }, Tri.prototype));`,
        `Object.setPrototypeOf(things[2], Circle.prototype); things[2].r = 8;`,
        `Object.defineProperty(things[1], "kind", { get: () => "circle" }); things[1].r = 4;`,
        `things.push(structuredClone(things[0])); things[things.length - 1].area = () => 3; things[things.length - 1].scale = () => things[0];`,
        `things.length = 1; things.push(new Proxy(new Box(1, 1), {}));`,
        `delete things[0].r; things[0].r = 1.5;`,
        `things.sort((a, b) => b.kind.localeCompare(a.kind)); Object.freeze(things[0]);`,
      ],
    };
  },
};

const names = Object.keys(scenes);

export function generate(random: Random, typed: boolean): string {
  const name = random.pick(names);
  const scene = scenes[name](random, typed);
  const when = random.pick(["early", "between", "between", "inside", "never"]);
  const end = random.pick(scene.ends);
  const second = random.chance(0.25) ? random.pick(scene.ends) : "";
  const isAsync = name === "coroutine";
  const rounds = random.between(3, 5);
  const at = random.between(1, rounds - 1);
  const lines = [
    `// ${name}: ${when}`,
    "function log(...values" +
      t(typed, "any[]") +
      ') { console.log(values.map(value => (Array.isArray(value) ? value.join() : String(value))).join(" | ")); }',
    scene.declare,
  ];
  const shield = (text: string) => `try { ${text} } catch (e) { log("threw", (e${as(typed)}).constructor.name); }`;
  const ended = `function endFact(round${t(typed, "number")}) { ${shield(end)}${second ? " " + shield(second) : ""} }`;
  if (when !== "never" || random.chance(0.5)) lines.push(ended);
  if (when === "early") lines.push("endFact(0);");
  const body = `${when === "inside" ? `if (round === ${at}) endFact(round); ` : ""}${shield(scene.use)}${when === "between" ? ` if (round === ${at}) endFact(round);` : ""}`;
  const form = random.below(3);
  if (isAsync)
    lines.push(`async function main() { for (let round = 0; round < ${rounds}; round++) { ${body} } }`, "main();");
  else if (form === 0) lines.push(`for (let round = 0; round < ${rounds}; round++) { ${body} }`);
  else if (form === 1)
    lines.push(`function play(round${t(typed, "number")}) { ${body} }`, `for (let i = 0; i < ${rounds}; i++) play(i);`);
  else lines.push(`Array.from({ length: ${rounds} }, (_, round) => { ${body} });`);
  return lines.join("\n") + "\n";
}
