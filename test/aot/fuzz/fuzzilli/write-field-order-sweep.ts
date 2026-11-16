// Objects whose fields come in one order here and in another there: how they are made, times where they meet, times what is done to a field, times what is asked, times the two kinds of values, times the loop, times the function around.
//
//   bun write-field-order-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<made>--<met>--<deed>--<asked>--<value>--<value>--<loop>--<function>.mjs, .cjs or .ts
//   bun write-field-order-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `make(k)` is the object; V and W are values.
const made: [name: string, text: string][] = [
  [
    "two-branches",
    "function make(k) {\n  const o = {};\n  if (k & 1) {\n    o.a = V;\n    o.b = W;\n  } else {\n    o.b = W;\n    o.a = V;\n  }\n  return o;\n}",
  ],
  ["two-literals", "const make = k => (k & 1 ? { a: V, b: W } : { b: W, a: V });"],
  [
    "class-two-branches",
    "class Made {\n  constructor(k) {\n    this.first = k;\n    if (k & 1) {\n      this.a = V;\n      this.b = W;\n    } else {\n      this.b = W;\n      this.a = V;\n    }\n  }\n}\nconst make = k => new Made(k);",
  ],
  [
    "function-two-branches",
    "function Made(k) {\n  if (k % 3 === 0) this.b = W;\n  this.a = V;\n  if (k % 3) this.b = W;\n}\nconst make = k => new Made(k);",
  ],
  ["sometimes", "function make(k) {\n  const o = { a: V };\n  if (k & 1) o.b = W;\n  o.c = k;\n  return o;\n}"],
  [
    "late",
    "class Made {\n  constructor(k) {\n    this.a = V;\n  }\n  more(k) {\n    if (k & 1) this.c = k;\n    this.b = W;\n    return this;\n  }\n}\nconst make = k => new Made(k).more(k);",
  ],
  [
    "returns-early",
    "class Made {\n  constructor(k) {\n    this.a = V;\n    if (k === 2) return;\n    this.b = W;\n    if (k > 3) return;\n    this.c = k;\n  }\n}\nconst make = k => new Made(k);",
  ],
  [
    "switch",
    "function make(k) {\n  const o = { c: k };\n  switch (k % 3) {\n    case 0:\n      o.a = V;\n    case 1:\n      o.b = W;\n      break;\n    default:\n      o.b = W;\n      o.a = V;\n  }\n  return o;\n}",
  ],
  [
    "fields-and-more",
    "class Made {\n  a = V;\n  b;\n  constructor(k) {\n    if (k & 1) this.c = k;\n    this.b = W;\n  }\n}\nconst make = k => new Made(k);",
  ],
  [
    "heirs",
    "class Above {\n  constructor(k) {\n    if (k & 1) this.b = W;\n  }\n}\nclass Made extends Above {\n  constructor(k) {\n    super(k);\n    this.a = V;\n    this.b = W;\n  }\n}\nconst make = k => new Made(k);",
  ],
  [
    "two-classes",
    "class One {\n  constructor() {\n    this.a = V;\n    this.b = W;\n  }\n}\nclass Two {\n  constructor() {\n    this.b = W;\n    this.a = V;\n  }\n}\nconst make = k => (k & 1 ? new One() : new Two());",
  ],
  ["assigned", "const make = k => Object.assign({}, k & 1 ? { a: V, b: W } : { b: W, a: V });"],
  ["spread", "const make = k => ({ ...(k & 1 ? { b: W } : {}), a: V, b: W });"],
  [
    "taken-away",
    "function make(k) {\n  const o = { a: V, b: W, c: 1 };\n  if (k & 1) {\n    delete o.a;\n    o.a = V;\n  }\n  return o;\n}",
  ],
  [
    "built-keys",
    "function make(k) {\n  const o = {};\n  for (const key of k & 1 ? ['a', 'b'] : ['b', 'a']) o[key] = key === 'a' ? V : W;\n  return o;\n}",
  ],
  ["parsed", 'const make = k => JSON.parse(k & 1 ? \'{"a":1,"b":2.5}\' : \'{"b":2.5,"a":1}\');'],
  [
    "with-accessor",
    "function make(k) {\n  const o = { a: V };\n  if (k === 2) Object.defineProperty(o, 'b', { get: () => W, set: value => out.push('set'), enumerable: true, configurable: true });\n  else o.b = W;\n  return o;\n}",
  ],
  [
    "helper",
    "const fill = (o, k) => {\n  if (k & 1) o.b = W;\n  o.a = V;\n  o.b = W;\n  return o;\n};\nconst make = k => fill({}, k);",
  ],
  [
    "caught",
    "class Made {\n  constructor(k) {\n    try {\n      this.a = V;\n      if (k === 2) throw 1;\n      this.b = W;\n    } catch {\n      this.c = k;\n      this.b = W;\n    }\n  }\n}\nconst make = k => new Made(k);",
  ],
];
// `o` is the object of the turn `k`.
const met: [name: string, before: string, text: string][] = [
  ["made", "", "const o = make(k);"],
  ["in-list", "const all = [0, 1, 2, 3].map(make);", "const o = all[k & 3];"],
  ["kept", "let o = make(0);", "if (k & 1) o = make(k);"],
  ["in-map", "const all = new Map([0, 1, 2, 3].map(k => [k, make(k)]));", "const o = all.get(k & 3);"],
  ["either", "const one = make(1);\nconst two = make(2);", "const o = k & 1 ? one : two;"],
  ["handed", "const pass = o => o;", "const o = pass(make(k));"],
  ["in-field", "const box = { v: make(1) };", "if (k === 2) box.v = make(k);\nconst o = box.v;"],
  ["sorted", "const all = [3, 1, 2, 0].map(make).sort((x, y) => (+x.a || 0) - (+y.a || 0));", "const o = all[k & 3];"],
];
const deeds: [name: string, text: string][] = [
  ["nothing", ""],
  ["stepped", "o.a++;"],
  ["fraction", "o.a += 0.5;"],
  ["overflow", "o.a = 2147483647;\no.a += k;"],
  ["text", "if (k === 2) o.a = 't';"],
  ["object", "if (k === 1) o.b = { v: k };"],
  ["minus-zero", "o.a = -0;"],
  ["not-a-number", "o.a = NaN;"],
  ["taken-away", "if (k === 1) delete o.b;"],
  ["more", "o['n' + k] = k;"],
  ["swapped", "[o.a, o.b] = [o.b, o.a];"],
  ["frozen", "if (k === 2) Object.freeze(o);\no.a = 9;"],
  ["itself", "o.b = o.a;"],
  ["nothing-there", "o.a = undefined;"],
  ["product", "o.a *= o.b;"],
];
const asked: [name: string, text: string][] = [
  ["both", "out.push(show(o.a), show(o.b), show(o.c));"],
  ["sum", "sum += o.a + o.b;"],
  ["keys", "out.push(Object.keys(o).join('/'));"],
  ["json", "out.push(JSON.stringify(o));"],
  ["in-loop", "for (const key in o) out.push(key, show(o[key]));"],
  ["destructured", "const { b, a, ...others } = o;\nout.push(show(a), show(b), Object.keys(others).join());"],
  ["copied", "const copy = { ...o, z: 1 };\nout.push(show(copy.a), Object.keys(copy).join('/'));"],
  ["compared", "out.push(o.a === o.b, o.a < o.b);"],
  ["optional", "out.push(show(o?.c ?? 'none'), 'b' in o);"],
  ["entries", "out.push(Object.entries(o).map(entry => entry.map(show).join('=')).join('&'));"],
  ["counted", "counts[o.a] = (counts[o.a] ?? 0) + 1;"],
  ["pushed", "list.push(o.a, o.b);"],
  ["truncated", "sum += (o.a | 0) + (o.b >>> 0);"],
  ["called", "out.push(show(ask(o)));"],
];
const values: [name: string, text: string][] = [
  ["integer", "1"],
  ["counter", "k"],
  ["fraction", "0.5"],
  ["half-counter", "k / 2"],
  ["text", "'s'"],
  ["null", "null"],
  ["object", "held"],
  ["either", "(k > 1 ? 0.5 : 1)"],
  ["list", "[k]"],
  ["nothing", "undefined"],
];
// `STEP` in a turn.
const loops: [name: string, text: string][] = [
  ["for", "for (let k = 0; k < 5; k++) {\n  STEP\n}"],
  ["many", "for (let k = 0; k < 60; k++) {\n  STEP\n}"],
  ["callback", "[0, 1, 2, 3].forEach(k => {\n  STEP\n});"],
  ["once", "{\n  const k = 1;\n  STEP\n}"],
  ["nested", "for (let round = 0; round < 2; round++) {\n  for (let k = 0; k < 4; k++) {\n    STEP\n  }\n}"],
];
const functions: [name: string, text: string][] = [
  ["function", "function run(k) {\n  BODY\n}"],
  ["arrow", "const run = k => {\n  BODY\n};"],
  ["outside", "function run(k) {\n  BODY\n}"],
];
const total = made.length * met.length * deeds.length * asked.length * values.length ** 2 * loops.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const maker = pick(made);
  const deed = pick(deeds);
  const ask = pick(asked);
  const first = pick(values);
  const meeting = pick(met);
  const second = pick(values);
  const loop = pick(loops);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const declared = maker[1]
    .replace("class Two {\n  constructor() {", "class Two {\n  constructor(k) {")
    .replace("class One {\n  constructor() {", "class One {\n  constructor(k) {")
    .replace("new One() : new Two()", "new One(k) : new Two(k)")
    .replace("  a = V;\n  b;", /\bk\b/.test(first[1]) ? "  a = 7;\n  b;" : "  a = V;\n  b;")
    .replaceAll(/\b[VW]\b/g, letter => (letter === "V" ? first[1] : second[1]));
  const turn = `try {\n${indent(`${meeting[2]}\n${deed[1] ? deed[1] + "\n" : ""}${ask[1]}`, "  ")}\n} catch (error) {\n  out.push(error.name);\n}`;
  const body = `${meeting[1] ? meeting[1] + "\n" : ""}let sum = 0;\n${within(loop[1], "STEP", turn)}\nout.push(show(sum));`;
  const isOutside = form[0] === "outside";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "{" + Object.keys(value).join("|") + "}" : String(value).slice(0, 24));',
    "const out = [];",
    "const list = [];",
    "const counts = {};",
    ...(/\bheld\b/.test(declared) ? ["const held = { h: 1 };"] : []),
    ...(/ask\(/.test(ask[1]) ? ["const ask = o => o.b ?? o.a;"] : []),
    ...(isOutside ? [declared] : []),
    within(form[1], "BODY", isOutside ? body : `${declared}\n${body}`),
    "for (const k of [0, 3]) {",
    "  try {",
    "    run(k);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1800), list.map(show).join().slice(0, 300), JSON.stringify(counts).slice(0, 300));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${maker[0]}--${meeting[0]}--${deed[0]}--${ask[0]}--${first[0]}--${second[0]}--${loop[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
