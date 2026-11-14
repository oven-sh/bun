// Classes with private and public fields: how they are declared, times how they are filled, times what reads them, times the receiver, times the place, times what else the class has, times what happens on the way.
//
//   bun write-private-field-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<fields>--<filled>--<read>--<receiver>--<place>--<extra>--<event>.mjs, .cjs or .ts
//   bun write-private-field-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// The fields of `Own`; `#a` is always there.
const fields: [name: string, text: string][] = [
  ["private", "#a = 1;\n#b = 2;"],
  ["undefined", "#a;\n#b;"],
  ["public-and-private", "x = 1;\n#a = 2;\n#b = 0.5;"],
  ["computed", "#a = made();\n#b = this.#a + 1;"],
  ["lists", "#a = [1, 2];\n#b = [];"],
  ["texts", "#a = 'a';\n#b = 'b';"],
  ["many", "#a = 1;\n#b = 2;\n#c = 3;\n#d = 4;\n#e = 5;\n#f = 6;\n#g = 7;"],
  ["accessors", "#held = 1;\nget #a() {\n  return this.#held;\n}\nset #a(value) {\n  this.#held = value;\n}\n#b = 3;"],
  ["method", "#a = 1;\n#b = 1;\n#step(v) {\n  return (this.#a += +v || 1);\n}"],
  ["static", "static #count = 0;\n#a = Own.#count++;\n#b = 2;\nstatic count() {\n  return Own.#count;\n}"],
  ["functions", "#a = () => this.#b;\n#b = 4;"],
];
const filled: [name: string, text: string][] = [
  ["nothing", ""],
  ["constructor", "constructor(v) {\n  SUPER\n  this.#a = v;\n}"],
  ["both", "constructor(v) {\n  SUPER\n  this.#a = v;\n  this.#b = v;\n}"],
  ["branch", "constructor(v) {\n  SUPER\n  if (v) this.#a = v;\n  else this.#b = 'else';\n}"],
  ["method", "constructor(v) {\n  SUPER\n  this.fill(v);\n}\nfill(v) {\n  this.#a = v;\n  this.late = v;\n}"],
  ["looped", "constructor(v) {\n  SUPER\n  for (let k = 0; k < 3; k++) this.#b = k;\n  this.#a = v;\n}"],
  [
    "read-first",
    "constructor(v) {\n  SUPER\n  const before = this.#a;\n  this.#a = [before, v].length + (+v || 0);\n}",
  ],
  ["returned", "constructor(v) {\n  SUPER\n  if (v === 2) return Object.create(Own.prototype);\n  this.#a = v;\n}"],
  ["arrow", "constructor(v) {\n  SUPER\n  const fill = value => (this.#a = value);\n  fill(v);\n}"],
];
// `read(o, v)` is a static method; `o` may be no instance.
const reads: [name: string, text: string][] = [
  ["field", "return o.#a;"],
  ["sum", "return +o.#a + +o.#b;"],
  ["stepped", "return o.#a++;"],
  ["added", "return (o.#a += v);"],
  ["written", "o.#a = v;\nreturn o.#a;"],
  ["in", "return #a in o;"],
  ["in-then-field", "return #a in o ? o.#a : 'no';"],
  ["optional", "return o?.#a;"],
  ["nullish", "return (o.#b ??= v);"],
  ["twice", "const one = o.#a;\no.#a = v;\nreturn [one, o.#a].join('/');"],
  ["destructured", "return (([one]) => one)([o.#a]);"],
  ["closure", "const look = () => o.#a;\no.#a = v;\nreturn look();"],
  ["looped", "let sum = 0;\nfor (let k = 0; k < 3; k++) {\n  sum += +o.#b || 1;\n  o.#b = k;\n}\nreturn sum;"],
  ["deep", "return ((one, two) => one.#a === two.#a)(o, o);"],
  ["swapped", "[o.#a, o.#b] = [o.#b, o.#a];\nreturn o.#a;"],
  ["element", "return o.#a?.[0] ?? o.#a;"],
];
const receivers: [name: string, text: string][] = [
  ["instance", "new Own(v)"],
  ["child", "new Child(v)"],
  ["other-class", "new Other(v)"],
  ["literal", "{ a: 1 }"],
  ["nothing", "undefined"],
  ["proxy", "new Proxy(new Own(v), {})"],
  ["inherits", "Object.create(new Own(v))"],
  ["sometimes", "i % 2 ? new Own(v) : new Child(v)"],
  ["frozen", "Object.freeze(new Own(v))"],
  ["list", "kept[i % kept.length]"],
  ["shared", "shared"],
  ["class", "Own"],
  ["given-back", "new Given(shared)"],
];
const places: [name: string, text: string][] = [
  ["loop", "for (let i = 0; i < 4; i++) {\n  STEP\n}"],
  ["long", "for (let i = 0; i < 60; i++) {\n  STEP\n}"],
  ["once", "const i = 1;\n{\n  STEP\n}"],
  ["tried", "for (let i = 0; i < 4; i++) {\n  try {\n    STEP\n  } catch (error) {\n    out.push(error.name);\n  }\n}"],
  ["callback", "[0, 1, 2].forEach(i => {\n  STEP\n});"],
  ["function", "const step = i => {\n  STEP\n};\nfor (let i = 0; i < 4; i++) step(i);"],
];
const given: [name: string, text: string][] = [
  ["integer", "i"],
  ["double", "i + 0.5"],
  ["text", "'t' + i"],
  ["object", "{ i }"],
  ["mixed", "i > 1 ? 'm' : i"],
  ["nothing", "i ? undefined : 1"],
];
const events: [name: string, text: string][] = [
  ["none", ""],
  ["made-twice", ""],
  ["public-added", "if (i === 2 && o && typeof o === 'object' && Object.isExtensible(o)) o.more = i;"],
  ["prototype", "if (i === 2 && o && typeof o === 'object' && Object.isExtensible(o)) Object.setPrototypeOf(o, {});"],
  ["frozen", "if (i === 2 && o && typeof o === 'object') Object.freeze(o);"],
  ["parent", ""],
];
const total = fields.length * filled.length * reads.length * receivers.length * places.length * given.length * events.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const read = pick(reads);
  const field = pick(fields);
  const receiver = pick(receivers);
  const fill = pick(filled);
  const event = pick(events);
  const value = pick(given);
  const place = pick(places);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const isBelow = event[0] === "parent" || receiver[0] === "given-back";
  const isMadeTwice = event[0] === "made-twice";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => (part ? indent(part, by) : ""));
  const own = [field[1], within(fill[1], "SUPER", isBelow ? "super(v);" : ""), `static read(o, v) {\n${indent(read[1], "  ")}\n}`, "look() {\n  return [this.#a, this.#b];\n}"].filter(Boolean).join("\n").replaceAll(/\n\s*\n/g, "\n"); // prettier-ignore
  const declared = `class Own${isBelow ? " extends Given" : ""} {\n${indent(own, "  ")}\n}`;
  const step = [`const v = ${value[1]};`, `const o = ${receiver[1]};`, ...(event[1] ? [event[1]] : []), "const answer = Own.read(o, v);", "if (out.length < 24) out.push(show(answer));"].join("\n"); // prettier-ignore
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (typeof value === "function" ? "f" : Array.isArray(value) ? "[" + value.map(show) + "]" : typeof value === "object" && value ? "(" + Object.keys(value) + ")" : Object.is(value, -0) ? "-0" : String(value));',
    "const out = [];",
    ...(/made\(/.test(declared) ? ["let count = 0;\nconst made = () => ++count;"] : []),
    ...(isBelow
      ? ["class Given {\n  constructor(value) {\n    if (value && typeof value === 'object') return value;\n  }\n}"]
      : []),
    ...(isMadeTwice ? [`const make = () => {\n${indent(declared, "  ")}\n  return Own;\n};\nconst First = make();\nconst Own = make();`] : [declared]), // prettier-ignore
    "class Child extends Own {\n  y = 9;\n}",
    `class Other {\n  #a = 8;\n  #b = 7;\n  look() {\n    return [this.#a, this.#b];\n  }\n}`,
    ...(/\bkept\b/.test(step)
      ? [`const kept = [new Own(1), new Child(0.5), ${isMadeTwice ? "new First(3)" : "new Own('k')"}];`]
      : []),
    ...(/\bshared\b/.test(step) ? ["const shared = new Own(5);"] : []),
    "function work() {",
    indent(within(place[1], "STEP", step), "  "),
    "}",
    "for (let round = 0; round < 2; round++) {",
    "  try {",
    "    work();",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    "const last = new Own(6);",
    "out.push(last.look ? show(last.look()) : 'none', show(last));",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${field[0]}--${fill[0]}--${read[0]}--${receiver[0]}--${place[0]}--${value[0]}--${event[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
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
