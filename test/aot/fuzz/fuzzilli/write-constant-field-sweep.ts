// Fields that one constant fills, and the roads on which another value gets there: where the field is, times the constant, times the road, times when, times how the field is read, times the loop, times the function around.
//
//   bun write-constant-field-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<home>--<constant>--<road>--<moment>--<read>--<loop>--<function>.mjs, .cjs or .ts
//   bun write-constant-field-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `o` holds the field `limit`, filled by K; O is a name for the holder that reads it.
const homes: [name: string, text: string, read: string][] = [
  ["literal", "const o = { limit: K, other: 2 };", "o.limit"],
  ["static", "class C {\n  static limit = K;\n  static other = 2;\n}\nconst o = C;", "C.limit"],
  [
    "static-read-by-this",
    "class C {\n  static limit = K;\n  static get() {\n    return this.limit;\n  }\n}\nconst o = C;",
    "C.get()",
  ],
  [
    "instance",
    "class C {\n  constructor() {\n    this.limit = K;\n    this.other = 2;\n  }\n}\nconst o = new C();",
    "o.limit",
  ],
  ["class-field", "class C {\n  limit = K;\n  other = 2;\n}\nconst o = new C();", "o.limit"],
  ["prototype", "class C {}\nC.prototype.limit = K;\nconst o = C.prototype;\nconst one = new C();", "one.limit"],
  ["above", "class Above {\n  static limit = K;\n}\nclass C extends Above {}\nconst o = Above;", "C.limit"],
  ["function", "function C() {}\nC.limit = K;\nconst o = C;", "C.limit"],
  ["nested", "const all = { config: { limit: K } };\nconst o = all.config;", "all.config.limit"],
  ["list", "const o = [1, 2];\no.limit = K;", "o.limit"],
  ["frozen-outside", "const all = Object.freeze({ config: { limit: K } });\nconst o = all.config;", "all.config.limit"],
  ["exported-like", "const exports_ = {};\nexports_.limit = K;\nconst o = exports_;", "exports_.limit"],
  ["table", "const all = { a: { limit: K }, b: { limit: 9 } };\nconst o = all.a;", "all['a'].limit"],
  [
    "accessor",
    "const o = {\n  held: K,\n  get limit() {\n    return this.held;\n  },\n  set limit(value) {\n    this.held = value;\n  },\n};",
    "o.limit",
  ],
  ["assigned-later", "const o = {};\no.limit = K;", "o.limit"],
  [
    "defined",
    "const o = Object.defineProperty({}, 'limit', { value: K, writable: true, configurable: true, enumerable: true });",
    "o.limit",
  ],
];
const constants: [name: string, text: string][] = [["integer", "3"], ["double", "2.5"], ["text", "'k'"], ["truth", "true"], ["nothing", "undefined"], ["null", "null"], ["large", "4294967296"], ["list", "[1, 2]"], ["function", "x => x + 1"]]; // prettier-ignore
const roads: [name: string, text: string][] = [
  ["none", ""],
  ["stored", "o.limit = 7;"],
  ["by-key", "o[['li', 'mit'].join('')] = 7;"],
  ["by-given-key", "change(o, 'limit');"],
  ["assigned", "Object.assign(o, { limit: 7 });"],
  ["reflected", "Reflect.set(o, 'limit', 7);"],
  ["defined", "Object.defineProperty(o, 'limit', { value: 7, configurable: true, writable: true });"],
  ["getter", "Object.defineProperty(o, 'limit', { get: () => 7, configurable: true });"],
  ["removed", "delete o.limit;"],
  ["stepped", "o.limit++;"],
  ["added", "o.limit += 0.5;"],
  ["in-a-loop", "for (const key of Object.keys(o)) o[key] = 7;"],
  ["destructured", "({ a: o.limit } = { a: 7 });"],
  ["loop-target", "for (o.limit of [5, 7]);"],
  ["passed-on", "fill({ set limit(value) {} });\nfill(o);"],
  ["several", "Object.defineProperties(o, { limit: { value: 7, writable: true, configurable: true } });"],
  ["through-heir", "const heir = Object.create(o);\nheir.limit = 7;"],
  ["frozen", "Object.freeze(o);\ntry {\n  o.limit = 7;\n} catch {}"],
  ["nullish", "o.limit ??= 7;"],
  ["kind-changed", "o.limit = 'seven';"],
  ["other-field", "o.other = 7;"],
  ["parent-changed", "Object.setPrototypeOf(o, { limit: 8, above: 1 });\ndelete o.limit;"],
];
// CHANGE is the road, WORK the reading.
const moments: [name: string, text: string][] = [["before", "CHANGE\nWORK"], ["after", "WORK\nCHANGE\nWORK"], ["in-callback", "WORK\n[1].forEach(() => {\n  CHANGE\n});\nWORK"], ["later", "WORK\nif (given > 1) {\n  CHANGE\n}\nWORK"], ["in-function", "const alter = () => {\n  CHANGE\n};\nWORK\nalter();\nWORK"], ["between-iterations", "for (let round = 0; round < 3; round++) {\n  WORK\n  if (round === 1) {\n    CHANGE\n  }\n}"]]; // prettier-ignore
// X is the field.
const reads: [name: string, text: string][] = [
  ["shown", "out.push(show(X));"],
  ["compared", "if (i < X) count++;"],
  ["equal", "if (X === 7) count += 10;"],
  ["added", "sum += +X || 0;"],
  ["product", "sum += i * X || 0;"],
  ["kept", "const kept = X;\nout.push(show(kept));"],
  ["called", "out.push(typeof X === 'function' ? show(X(i)) : 'n');"],
  [
    "switched",
    "switch (X) {\n  case 3:\n    count++;\n    break;\n  case 7:\n    count += 100;\n    break;\n  default:\n    count += 1000;\n}",
  ],
  ["text", "out.push(`${show(X)}!`);"],
  ["length", "out.push(show(X?.length));"],
  ["bound", "for (let k = 0; k < X && k < 5; k++) count++;"],
  ["choice", "out.push(X ? 'y' : 'n');"],
];
// `STEP` in a turn.
const loops: [name: string, text: string][] = [["for", "for (let i = 0; i < 5; i++) {\n  STEP\n}"], ["once", "{\n  const i = 2;\n  STEP\n}"], ["helper", "const help = i => {\n  STEP\n};\nfor (let i = 0; i < 4; i++) help(i);"], ["callback", "[0, 1, 2].forEach(i => {\n  STEP\n});"], ["many", "for (let i = 0; i < 90; i++) {\n  STEP\n}"]]; // prettier-ignore
const functions: [name: string, text: string][] = [
  ["outside", "HOME\nfunction run(given) {\n  BODY\n}"],
  ["inside", "function run(given) {\n  HOME\n  BODY\n}"],
  ["arrow", "HOME\nconst run = given => {\n  BODY\n};"],
  ["method", "HOME\nclass Runner {\n  run(given) {\n    BODY\n  }\n}\nconst run = given => new Runner().run(given);"],
];
const total = homes.length * constants.length * roads.length * moments.length * reads.length * loops.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const road = pick(roads);
  const home = pick(homes);
  const read = pick(reads);
  const moment = pick(moments);
  const constant = pick(constants);
  const loop = pick(loops);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const work = `{\n${indent(within(loop[1], "STEP", read[1].replaceAll(/\bX\b/g, home[2])), "  ")}\n}`;
  const change = road[1] ? `try {\n${indent(road[1], "  ")}\n} catch (error) {\n  out.push(error.name);\n}` : "sum++;";
  const body = within(within(moment[1], "WORK", work), "CHANGE", change);
  const text = within(within(form[1], "BODY", body), "HOME", home[1].replaceAll(/\bK\b/g, constant[1]));
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : typeof value === "function" ? "f" : String(value).slice(0, 20));',
    "const out = [];",
    "let count = 0;",
    "let sum = 0;",
    ...(/change\(/.test(road[1]) ? ["const change = (holder, key) => {\n  holder[key] = 7;\n};"] : []),
    ...(/fill\(/.test(road[1]) ? ["const fill = holder => {\n  holder.limit = 7;\n};"] : []),
    text,
    "for (const given of [0, 2]) {",
    "  try {",
    "    run(given);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1500), count, sum);',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${home[0]}--${constant[0]}--${road[0]}--${moment[0]}--${read[0]}--${loop[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
