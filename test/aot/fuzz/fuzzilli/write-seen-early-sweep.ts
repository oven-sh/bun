// The least programs of an object that is seen before it is whole: each way to hand it out, times each look at it, times what makes it, times what it gets later.
//
//   bun write-seen-early-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<way>--<look>--<place>--<later>--<run>.mjs, .cjs or .ts
//   bun write-seen-early-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// SELF is the object that is not whole yet, `x` a value.
const ways: string[] = [
  "see(SELF);",
  "see(SELF || x);",
  "see(x && SELF);",
  "see(SELF ?? x);",
  "see(x || SELF);",
  "see((0, SELF));",
  "see(x ? SELF : null);",
  "see(x ? null : SELF);",
  "see([SELF][0]);",
  "see({ v: SELF }.v);",
  "see((t => t)(SELF));",
  "see(...[SELF]);",
  "see(SELF !== null && SELF);",
  "let o2 = x;\no2 ||= SELF;\nsee(o2);",
  "let o3;\no3 ??= SELF;\nsee(o3);",
  "let o4 = null;\nif (x) o4 = SELF;\nsee(o4 ?? SELF);",
  "for (const o of [SELF]) see(o);",
  "[SELF].forEach(see);",
  "try {\n  throw SELF;\n} catch (e) {\n  see(e);\n}",
  "const go = () => see(SELF);\ngo();",
  "const { o = SELF } = {};\nsee(o);",
  "const [o = SELF] = [];\nsee(o);",
  "((o = SELF) => see(o))();",
  "see(Object(SELF));",
  "see(new Map([[1, SELF]]).get(1));",
  "(function () {\n  see(arguments[0]);\n})(SELF);",
  "switch (x) {\n  case undefined:\n    break;\n  default:\n    see(SELF);\n}",
  "kept = SELF;\nsee(kept);",
  "kept = SELF || kept;\nsee(kept);",
  "see(Reflect.apply(v => v, null, [SELF]));",
  "see(x === x ? SELF : x);",
  "see((x, SELF));",
  "see(((SELF)));",
  "see(pass(SELF || null));",
  "see(pass(x) && SELF);",
  "box.v = SELF;\nsee(box.v);",
  "list.push(SELF);\nsee(list.at(-1));",
  "const same = SELF;\nsee(same || x);",
  "see(`${x}` && SELF);",
  "see(!x || SELF);",
  "see(x > 0 && SELF || SELF);",
  "see.call(SELF, SELF);",
  "see.call(null, SELF ?? x);",
  "see(SELF instanceof Object ? SELF : x);",
  "see(typeof SELF === 'object' && SELF);",
  "do {\n  see(SELF || x);\n} while (false);",
  "see(x ?? SELF);",
  "(x || SELF) && see(SELF);",
];
const looks: string[] = [
  "typeof v.size",
  "v.size?.length",
  "tell(v.size)",
  "'size' in v",
  "Object.keys(v).join()",
  "v.size === undefined ? 'none' : 'some'",
  "JSON.stringify(v)",
  "v.m?.()",
  "v.lid ?? 'empty'",
  "(v.size = v.size ?? 4)",
  "[v.size, v.lid].length + typeof v.lid",
  "(typeof v.size === 'function' ? 1 : v.size + 1)",
  "v.size ? 'y' : 'n'",
  "Object.hasOwn(v, 'size') + '' + tell(v.size)",
  "delete v.size",
  "({ ...v }).size",
  "typeof v.size === 'string' ? v.size.length : 'not'",
  "(() => { const { size, lid = 'd' } = v; return tell(size) + tell(lid); })()",
];
const places: [name: string, text: string, self: string][] = [
  [
    "constructor-function",
    "function Make(x) {\n  EARLY\n  this.size = LATE;\n  this.lid = x;\n}\nconst make = x => new Make(x);",
    "this",
  ],
  [
    "class",
    "class Make {\n  constructor(x) {\n    EARLY\n    this.size = LATE;\n    this.lid = x;\n  }\n}\nconst make = x => new Make(x);",
    "this",
  ],
  [
    "behind-first",
    "class Make {\n  constructor(x) {\n    this.lid = x;\n    EARLY\n    this.size = LATE;\n  }\n}\nconst make = x => new Make(x);",
    "this",
  ],
  [
    "field",
    "class Make {\n  lid = 1;\n  seen = early(this, 2);\n  size = 'f';\n}\nfunction early(self, x) {\n  EARLY\n  return 0;\n}\nconst make = x => {\n  const o = new Make();\n  o.late = LATE;\n  return o;\n};",
    "self",
  ],
  [
    "heir",
    "class Root {\n  constructor(x) {\n    EARLY\n    this.lid = x;\n  }\n}\nclass Make extends Root {\n  constructor(x) {\n    super(x);\n    this.size = LATE;\n  }\n}\nconst make = x => new Make(x);",
    "this",
  ],
  [
    "heir-fields",
    "class Root {\n  constructor(x) {\n    EARLY\n  }\n}\nclass Make extends Root {\n  size = 's';\n  lid = 2;\n}\nconst make = x => {\n  const o = new Make(x);\n  o.late = LATE;\n  return o;\n};",
    "this",
  ],
  [
    "behind-super",
    "class Root {\n  lid = 0;\n}\nclass Make extends Root {\n  constructor(x) {\n    super();\n    EARLY\n    this.size = LATE;\n  }\n}\nconst make = x => new Make(x);",
    "this",
  ],
  [
    "literal",
    "const make = x => {\n  const self = {};\n  EARLY\n  self.size = LATE;\n  self.lid = x;\n  return self;\n};",
    "self",
  ],
  [
    "literal-field",
    "const make = x => {\n  const self = { lid: x };\n  EARLY\n  self.size = LATE;\n  return self;\n};",
    "self",
  ],
  [
    "created",
    "const make = x => {\n  const self = Object.create({ m: () => 'up' });\n  EARLY\n  self.size = LATE;\n  self.lid = x;\n  return self;\n};",
    "self",
  ],
  [
    "method",
    "class Make {\n  start(x) {\n    EARLY\n    this.size = LATE;\n    this.lid = x;\n    return this;\n  }\n}\nconst make = x => new Make().start(x);",
    "this",
  ],
  [
    "own-method",
    "function Make(x) {\n  this.m = () => 'own' + tell(this.size);\n  EARLY\n  this.size = LATE;\n}\nconst make = x => new Make(x);",
    "this",
  ],
  [
    "factory",
    "function Make(x) {\n  if (!new.target) return new Make(x);\n  EARLY\n  this.size = LATE;\n}\nconst make = x => Make(x);",
    "this",
  ],
  [
    "local-class",
    "const make = x => {\n  class Make {\n    constructor() {\n      EARLY\n      this.size = LATE;\n    }\n  }\n  return new Make();\n};",
    "this",
  ],
  [
    "reflected",
    "class Make {\n  constructor(x) {\n    EARLY\n    this.size = LATE;\n  }\n}\nconst make = x => Reflect.construct(Make, [x]);",
    "this",
  ],
];
const lates: string[] = ["'a' + x", "x", "x + 0.5", "{ x }", "undefined", "[x, 2]", "x > 1 ? 's' : 5", "() => x"];
const runs: string[] = [
  "said0(() => see(make(1)));\nsaid0(() => see(make(2)));",
  "said0(() => {\n  for (let i = 0; i < 4; i++) see(make(i));\n});",
  "said0(() => make('t'));\nsaid0(() => make(null));",
  "said0(() => [1, 0, 3].map(make).forEach(o => say(typeof o.size, typeof o.lid)));",
];
const total = ways.length * looks.length * places.length * lates.length * runs.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 259_201;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const way = pick(ways);
  const look = pick(looks);
  const place = pick(places);
  const late = pick(lates);
  const run = pick(runs);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const early = way.replaceAll("SELF", place[2]);
  const block = /^(const|let) /m.test(early) ? `{\n${indent(early, "  ")}\n}` : early;
  const made = within(place[1], "EARLY", block).replaceAll("LATE", () => late);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(isCommon && cell % 2 ? ["'use strict';"] : []),
    "const said = [];",
    'const tell = v => (typeof v === "function" ? "function" : Object.is(v, -0) ? "-0" : Array.isArray(v) ? "list" + v.length : typeof v === "object" && v ? "object" : String(v));',
    'const say = (...values) => void said.push(values.map(tell).join(":"));',
    "let kept = null;",
    "const box = {};",
    "const list = [];",
    "const pass = v => v;",
    `function look(v) {\n  return ${look};\n}`,
    "function see(v) {\n  try {\n    say(v === null || v === undefined || typeof v !== 'object' ? typeof v : look(v));\n  } catch (e) {\n    say(e.name);\n  }\n}",
    made,
    "function said0(of) {\n  try {\n    of();\n  } catch (error) {\n    say(error.name);\n  }\n}",
    run,
    'console.log(said.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${ways.indexOf(way)}--${looks.indexOf(look)}--${place[0]}--${lates.indexOf(late)}--${runs.indexOf(run)}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
