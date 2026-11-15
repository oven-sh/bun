// Runs of stores of numbers one after the other without a branch between them, one of them of another kind: what is stored into, times what the stores compute, times the odd one, times where it stands, times how many there are, times what stands between, times the first values, times the loop, times how the results are looked at.
//
//   bun write-straight-store-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<holder>--<computed>--<odd>--<place>--<count>--<between>--<first>--<loop>--<look>.mjs, .cjs or .ts
//   bun write-straight-store-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// What is declared of the first values F, and the place of the number k (a constant).
const holders: [name: string, text: string, place: (k: number) => string][] = [
  ["list", "const T = [F];", k => `T[${k}]`],
  ["copied", "const T = [F].slice();", k => `T[${k}]`],
  ["given", "const T = given.slice();\nT.push(F);", k => `T[${k}]`],
  ["rows", "const rows = [[F], [F]];\nconst T = rows[1];", k => `rows[1][${k}]`],
  ["two-lists", "const T = [F];\nconst U = [F];", k => (k & 1 ? `U[${k}]` : `T[${k}]`)],
  ["same-list", "const T = [F];\nconst U = given.length > 2 ? T : [F];", k => (k & 1 ? `U[${k}]` : `T[${k}]`)],
  ["doubles", "const T = new Float64Array([F]);", k => `T[${k}]`],
  ["floats", "const T = new Float32Array([F]);", k => `T[${k}]`],
  ["words", "const T = new Int32Array([F]);", k => `T[${k}]`],
  ["unsigned", "const T = new Uint32Array([F]);", k => `T[${k}]`],
  [
    "fields",
    "const all = [F];\nconst T = { f0: all[0], f1: all[1], f2: all[2], f3: all[3], f4: all[4], f5: all[5], f6: all[6], f7: all[7], f8: all[8] };",
    k => `T.f${k}`,
  ],
  ["instance", "const T = new State([F]);", k => `T.f${k}`],
  ["empty", "const T = [];", k => `T[${k}]`],
  ["made", "const T = new Array(9);\nT[4] = [F][4];", k => `T[${k}]`],
  ["outside", "shared.length = 0;\nshared.push(F);\nconst T = shared;", k => `shared[${k}]`],
  ["of-field", "const box = { list: [F] };\nconst T = box.list;", k => `box.list[${k}]`],
  ["variables", "let [t0, t1, t2, t3, t4, t5, t6, t7, t8] = [F];", k => `t${k}`],
];
// What is stored in the place k; `a` and `b` are places, `g` is a number.
const computed: [name: string, text: (k: number, a: string, b: string) => string][] = [
  ["sum", (k, a, b) => `${a} + ${b}`],
  ["difference", (k, a, b) => `${a} - ${b}`],
  ["product", (k, a) => `${a} * 1.5`],
  ["doubled", (k, a) => `${a} * 2`],
  ["truncated", (k, a, b) => `(${a} + ${b}) | 0`],
  ["wide-truncated", (k, a, b) => `(${a} + ${1295307597 + k} + ${b}) | 0`],
  ["unsigned", (k, a, b) => `(${a} + ${b}) >>> 0`],
  ["shifted", (k, a, b) => `(${a} << ${k}) | (${b} >>> ${9 - k})`],
  ["imul", (k, a) => `Math.imul(${a}, ${k + 3})`],
  ["divided", (k, a) => `${a} / 2`],
  ["greatest", (k, a, b) => `Math.max(${a}, ${b})`],
  ["root", (k, a) => `Math.sqrt(${a})`],
  ["constant", k => `${k * 3}`],
  ["fraction", k => `${k}.5`],
  ["of-given", (k, a) => `${a} + g`],
  ["added-to", (k, a, b) => `${a} + g * ${b}`],
  ["carried", (k, a, b) => `${a} + (${b} >>> 0 < ${k + 2} ? 1 : 0)`],
  ["of-both", (k, a, b) => (k & 1 ? `${a} | 0` : `${b} * 0.5`)],
];
const odd: [name: string, text: (a: string, b: string) => string][] = [
  ["not-a-number", () => "NaN"],
  ["remainder", (a, b) => `${a} % ${b}`],
  ["by-zero", a => `${a} / 0`],
  ["floor", a => `Math.floor(${a})`],
  ["minus-zero", () => "-0"],
  ["negated", a => `-${a}`],
  ["nothing", () => "undefined"],
  ["text", a => "`${" + a + "}`"],
  ["truth", a => `${a} > 1`],
  ["wide", () => "4294967296"],
  ["edge", () => "2147483648"],
  ["called", a => `half(${a})`],
  ["called-any", a => `any(${a})`],
  ["object", a => `{ valueOf: () => ${a} }`],
  ["missing", () => "given[99]"],
  ["power", (a, b) => `${a} ** ${b}`],
  ["parsed", a => `parseInt(${a})`],
  ["null", () => "null"],
  ["none", (a, b) => `${a} + ${b}`],
];
const places: [name: string, of: (count: number) => number][] = [
  ["first", () => 0],
  ["second", () => 1],
  ["middle", count => count >> 1],
  ["last", count => count - 1],
];
const counts: [name: string, count: number][] = [["two", 2], ["four", 4], ["six", 6], ["nine", 9]]; // prettier-ignore
// Stands in front of the last store.
const between: [name: string, text: string][] = [
  ["nothing", ""],
  ["call", "seen += half(g);"],
  ["reader", "seen += +read();"],
  ["read", "seen += +P0;"],
  ["branch", "if (g > 1) seen++;"],
  ["kept", "const before = P1;\nseen += +before;"],
  ["swap", "[P0, P1] = [P1, P0];"],
  ["stepped", "P1++;"],
  ["compound", "P0 += g;"],
];
const first: [name: string, text: string][] = [
  ["integers", "1, 2, 3, 4, 5, 6, 7, 8, 9"],
  ["doubles", "0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5"],
  ["both", "1, 0.5, 3, 1e10, 5, -0, 7, NaN, 9"],
  ["wide", "4294967295, 2147483648, -2147483648, 1, 2, 3, 2147483647, 65536, 0"],
  ["zeros", "0, 0, 0, 0, 0, 0, 0, 0, 0"],
];
// `STEP` in a turn.
const loops: [name: string, text: string][] = [
  ["once", "{\n  STEP\n}"],
  ["for", "for (let i = 0; i < 5; i++) {\n  STEP\n}"],
  ["given", "for (let i = 0; i < given.length; i++) {\n  STEP\n}"],
  ["twice", "{\n  STEP\n}\n{\n  STEP\n}"],
  ["nested", "for (let k = 0; k < 2; k++) {\n  for (let i = 0; i < given.length; i++) {\n    STEP\n  }\n}"],
  ["callback", "given.forEach(() => {\n  STEP\n});"],
  ["caught", "try {\n  STEP\n} catch {\n  seen = -1;\n}"],
];
const looks: [name: string, text: string][] = [
  ["each", "ALL.map(show).join()"],
  ["json", "JSON.stringify(ALL)"],
  ["sum", "show(ALL.reduce((sum, value) => sum + value, 0))"],
  ["held", "ALL.map(value => value === undefined).join() + ALL.map(show).join()"],
];
const total = holders.length * computed.length * odd.length * places.length * counts.length * between.length * first.length * loops.length * looks.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const holder = pick(holders);
  const strange = pick(odd);
  const compute = pick(computed);
  const count = pick(counts);
  const place = pick(places);
  const value = pick(first);
  const among = pick(between);
  const loop = pick(loops);
  const look = pick(looks);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const at = holder[2];
  const strangeAt = place[1](count[1]);
  const stores: string[] = [];
  for (let k = 0; k < count[1]; k++) {
    const [a, b] = [at((k + 1) % 9), at((k + 4) % 9)];
    if (k === count[1] - 1 && among[1]) stores.push(among[1].replaceAll("P0", at(0)).replaceAll("P1", at(1)));
    stores.push(`${at(k)} = ${k === strangeAt ? strange[1](a, b) : compute[1](k, a, b)};`);
  }
  const all = `[${Array.from({ length: 9 }, (_, k) => at(k)).join(", ")}]`;
  const body = [
    holder[1].replaceAll(/\bF\b/g, value[1]),
    "let seen = 0;",
    ...(/read\(/.test(among[1]) ? [`const read = () => ${at(0)};`] : []),
    within(loop[1], "STEP", stores.join("\n")),
    `out.push(${look[1].replaceAll("ALL", all)}, show(seen));`,
  ].join("\n");
  const any = isTyped ? ": any" : "";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : String(value).slice(0, 30));',
    "const out = [];",
    ...(/half\(/.test(body) ? [`const half = (value${any}) => value / 2;`] : []),
    ...(/any\(/.test(body) ? [`const any = (value${any}) => (out.length > 2 ? 'x' : value);`] : []),
    ...(/shared/.test(body) ? ["const shared = [];"] : []),
    ...(/State/.test(body)
      ? [
          "class State {\n  constructor(all) {\n    this.f0 = all[0];\n    this.f1 = all[1];\n    this.f2 = all[2];\n    this.f3 = all[3];\n    this.f4 = all[4];\n    this.f5 = all[5];\n    this.f6 = all[6];\n    this.f7 = all[7];\n    this.f8 = all[8];\n  }\n}",
        ]
      : []),
    `function run(g${any}, given${any}) {\n${indent(body, "  ")}\n}`,
    "for (const [g, given] of [[1, [1]], [2.5, [1, 2, 3]], [-1, [0.5, 2]]]) {",
    "  try {",
    "    run(g, given);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${holder[0]}--${compute[0]}--${strange[0]}--${place[0]}--${count[0]}--${among[0]}--${value[0]}--${loop[0]}--${look[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
