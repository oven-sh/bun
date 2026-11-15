// What constructors make: the constructor's kind, times what it does before its fields, times the fields, times how it ends, times who constructs, times what is asked of the object.
//
//   bun write-construction-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<kind>--<before>--<fields>--<end>--<maker>--<ask>.mjs or .cjs
//   bun write-construction-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `BEFORE`, `FIELDS` and `END` are the body; `n` is the argument.
const kinds: [name: string, text: string][] = [
  ["function", "function Made(n) {\n  BEFORE\n  FIELDS\n  END\n}"],
  ["class", "class Made {\n  constructor(n) {\n    BEFORE\n    FIELDS\n    END\n  }\n}"],
  [
    "heir",
    "class Base {\n  constructor(n) {\n    this.base = n;\n  }\n}\nclass Made extends Base {\n  constructor(n) {\n    super(n);\n    BEFORE\n    FIELDS\n    END\n  }\n}",
  ],
  [
    "heir-late",
    "class Base {\n  constructor(n) {\n    this.base = n;\n  }\n}\nclass Made extends Base {\n  constructor(n) {\n    const early = n + 1;\n    if (early > 100) kept.push(early);\n    super(early);\n    BEFORE\n    FIELDS\n    END\n  }\n}",
  ],
  [
    "with-fields",
    "class Made {\n  first = 1;\n  second = [];\n  constructor(n) {\n    BEFORE\n    FIELDS\n    END\n  }\n}",
  ],
  [
    "with-private",
    "class Made {\n  #secret = 3;\n  constructor(n) {\n    BEFORE\n    FIELDS\n    this.secret = this.#secret + n;\n    END\n  }\n}",
  ],
  [
    "of-function",
    "function Base(n) {\n  this.base = n;\n}\nfunction Made(n) {\n  Base.call(this, n);\n  BEFORE\n  FIELDS\n  END\n}\nMade.prototype = Object.create(Base.prototype);",
  ],
  [
    "with-prototype",
    "function Made(n) {\n  BEFORE\n  FIELDS\n  END\n}\nMade.prototype.x = 50;\nMade.prototype.tell = function () {\n  return this.x;\n};",
  ],
  [
    "with-setter",
    "class Made {\n  set x(value) {\n    this.kept = value * 2;\n  }\n  get x() {\n    return this.kept;\n  }\n  constructor(n) {\n    BEFORE\n    FIELDS\n    END\n  }\n}",
  ],
  ["of-list", "class Made extends Array {\n  constructor(n) {\n    super();\n    BEFORE\n    FIELDS\n    END\n  }\n}"],
  [
    "of-error",
    'class Made extends Error {\n  constructor(n) {\n    super("m" + n);\n    BEFORE\n    FIELDS\n    END\n  }\n}',
  ],
  ["factory", "const Made = function (n) {\n  BEFORE\n  FIELDS\n  END\n};"],
];
const befores: [name: string, text: string][] = [
  ["nothing", ""],
  ["kept", "kept.push(this);"],
  ["call", "touch(n);"],
  ["throws-sometimes", 'if (n === 3) throw new RangeError("n");'],
  ["returns-sometimes", "if (n === 2) return;"],
  ["other-sometimes", "if (n === 2) return { other: true };"],
  ["makes-another", "if (n > 0 && n < 3) this.inner = new Made(0);"],
  ["loop", "let sum = 0;\nfor (let i = 0; i < n; i++) sum += i;\nthis.sum = sum;"],
  ["closure", "this.ask = () => this.x;"],
  ["list", "this.list = [n, n * 0.5];"],
  ["target", "this.target = new.target === Made;"],
  ["tried", "try {\n  touch(n);\n} catch {\n  this.caught = true;\n}"],
];
const fields: [name: string, text: string][] = [
  ["one", "this.x = n;"],
  ["two", "this.x = n;\nthis.y = n + 0.5;"],
  ["text", 'this.x = "t" + n;'],
  ["by-kind", "this.x = n & 1 ? n : n + 0.25;"],
  ["sometimes", "this.x = n;\nif (n > 1) this.more = 1;"],
  ["other-order", "if (n & 1) {\n  this.x = n;\n  this.y = 1;\n} else {\n  this.y = 1;\n  this.x = n;\n}"],
  ["written-twice", "this.x = 0;\nthis.x = n;\nthis.x += 1;"],
  ["of-other", "this.y = n;\nthis.x = this.y * 2;"],
  ["object", "this.x = { v: n };"],
  ["itself", "this.x = this;"],
  ["nothing", "this.x = undefined;"],
  ["counted", "this.x = ++made;"],
  ["deleted", "this.x = n;\nthis.gone = 1;\ndelete this.gone;"],
  ["many", "this.x = n;\nthis.a = 1;\nthis.b = 2;\nthis.c = 3;\nthis.d = 4;\nthis.e = 5;\nthis.f = 6;\nthis.g = 7;"],
  ["assigned", "Object.assign(this, { x: n, z: 2 });"],
  ["defined", 'Object.defineProperty(this, "x", { value: n, enumerable: n > 1 });'],
];
const ends: [name: string, text: string][] = [
  ["nothing", ""],
  ["returns-this", "return this;"],
  ["returns-number", "return RETURN5;"],
  ["returns-object", "return { x: 40, tell: 1 };"],
  ["returns-sometimes", "if (n > 2) return { x: 41 };"],
  ["frozen", "Object.freeze(this);"],
  ["sealed", "Object.seal(this);"],
  ["kept", "kept.push(this);"],
  ["returns-kept", "kept.push(this);\nreturn kept[0];"],
  ["throws", 'if (n === 4) throw new TypeError("e");'],
  ["call", "touch(this.x);"],
];
// `show` tells an object.
const makers: [name: string, text: string][] = [
  ["new", "const one = new Made(n);\nASK"],
  ["loop", "for (let i = 0; i < 4; i++) {\n  const one = new Made(i);\n  ASK\n}"],
  ["list", "for (const one of [new Made(n), new Made(n + 1)]) {\n  ASK\n}"],
  ["mapped", "for (const one of [1, 2, 3].map(k => new Made(k))) {\n  ASK\n}"],
  ["reflect", "const one = Reflect.construct(Made, [n]);\nASK"],
  [
    "other-target",
    "class Other {\n  tell() {\n    return 9;\n  }\n}\nconst one = Reflect.construct(Made, [n], Other);\nASK",
  ],
  ["spread", "const one = new Made(...[n, 1]);\nASK"],
  ["no-argument", "const one = new Made();\nASK"],
  ["unused", "new Made(n);\nconst one = { x: kept.length };\nASK"],
  ["field", "const holder = { one: new Made(n) };\nconst one = holder.one;\nASK"],
  ["returned", "const make = k => new Made(k);\nconst one = make(n);\nASK"],
  ["chosen", "const one = n & 1 ? new Made(n) : new Made(0);\nASK"],
];
const asks: [name: string, text: string][] = [
  ["fields", "notes.push(show(one));"],
  ["x", "notes.push(show(one.x));"],
  ["sum", "notes.push(one.x + (one.y ?? 1));"],
  ["instance", "notes.push(one instanceof Made, Object.getPrototypeOf(one) === Made.prototype);"],
  ["keys", "notes.push(Object.keys(one).join());"],
  ["kept", "notes.push(kept.includes(one), kept.length);"],
  ["written", "one.x = 8;\none.late = 1;\nnotes.push(show(one.x), Object.keys(one).length);"],
  ["frozen", "notes.push(Object.isFrozen(one), Object.isSealed(one));"],
  ["method", "notes.push(typeof one.tell, one.tell?.call?.(one));"],
  ["constructor", "notes.push(one.constructor === Made, one.constructor.name);"],
];
const total = kinds.length * befores.length * fields.length * ends.length * makers.length * asks.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const kind = pick(kinds);
  const before = pick(befores);
  const field = pick(fields);
  const end = pick(ends);
  const maker = pick(makers);
  const ask = pick(asks);
  const isSloppy = cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const isHeir = /extends/.test(kind[1]);
  // A heir that returns a primitive throws.
  const body = kind[1]
    .replace("BEFORE", () => before[1])
    .replace("FIELDS", () => field[1])
    .replace("END", () => end[1].replace("RETURN5", isHeir ? "undefined" : "5"))
    .split("\n").filter(line => line.trim()).join("\n"); // prettier-ignore
  const lines = [
    "const notes = [];",
    "const kept = [];",
    "let made = 0;",
    'const show = (value, depth = 0) => (typeof value === "function" ? "function" : depth > 2 ? "deep" : Array.isArray(value) ? "[" + Array.from(value, each => show(each, depth + 1)).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name], depth + 1)).join() + "}" : String(value));',
    'const touch = value => {\n  if (value === 4) throw new EvalError("t");\n  made += 10;\n};',
    body,
    "function work(n) {",
    indent(maker[1].replace("ASK", () => ask[1]), "  "),
    "}",
    "for (const n of [1, 2, 3, 4]) {",
    "  try {",
    "    work(n);",
    "  } catch (error) {",
    "    notes.push(error.name);",
    "  }",
    "}",
    'console.log(notes.map(each => show(each)).join(" ").slice(0, 900), made, kept.length);',
  ]; // prettier-ignore
  return {
    name: `${kind[0]}--${before[0]}--${field[0]}--${end[0]}--${maker[0]}--${ask[0]}.${isSloppy ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
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
