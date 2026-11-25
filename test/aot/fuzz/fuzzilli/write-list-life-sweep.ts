// Lists that are made in every iteration and are given up or kept: how one is made, times how it is filled, times how it is read, times who keeps it, times when it is kept, times the kind of elements, times the loop, times the function around.
//
//   bun write-list-life-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<made>--<filled>--<read>--<kept>--<moment>--<kind>--<loop>--<function>.mjs, .cjs or .ts
//   bun write-list-life-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `l` is the list; `i` counts and V is an element.
const made: [name: string, text: string][] = [
  ["empty", "const l = [];"],
  ["literal", "const l = [V, V, V];"],
  ["pair", "const l = [i, V];"],
  ["sized", "const l = new Array(4);"],
  ["sized-by-counter", "const l = new Array(i + 2);"],
  ["filled", "const l = new Array(3).fill(V);"],
  ["from", "const l = Array.from({ length: 3 }, (_, k) => k + i);"],
  ["copied", "const l = [...base];"],
  ["sliced", "const l = base.slice(i & 1);"],
  ["mapped", "const l = base.map(x => x + i);"],
  ["filtered", "const l = base.filter(x => x > i);"],
  ["joined", "const l = base.concat(V);"],
  ["split", "const l = `${i},a,b`.split(',');"],
  ["keys", "const l = Object.keys({ a: 1, b: i });"],
  ["words", "const l = new Int32Array(4);"],
  ["doubles", "const l = new Float64Array(4);"],
  ["rest", "const l = gather(i, V);"],
  ["swept", "shared.length = 0;\nconst l = shared;"],
  ["declared-outside", "outer = [V];\nconst l = outer;"],
  ["of-both", "const l = i & 1 ? [] : [V];"],
  ["of-objects", "const l = [{ v: i }, { v: V }];"],
];
const filled: [name: string, text: string][] = [
  ["pushed", "if (l.push) l.push(V);"],
  ["pushed-in-loop", "for (let k = 0; k < 5; k++) l[k] = V;"],
  ["pushes", "for (let k = 0; k < i + 2; k++) l.push?.(k);"],
  ["at-length", "l[l.length] = V;"],
  ["element", "l[1] = V;"],
  ["gap", "l[5] = V;"],
  ["sum", "for (let k = 0; k < 4; k++) l[k] = (l[k] ?? 0) + (l[k - 1] ?? 1);"],
  ["popped", "l.pop?.();"],
  ["shifted", "l.shift?.();"],
  ["shortened", "if (Array.isArray(l)) l.length = 1;"],
  ["nothing", ""],
  ["in-front", "l.unshift?.(V);"],
  ["from-last", "if (last) for (let k = 0; k < last.length; k++) l[k] = last[k];"],
  ["sorted", "l.sort();"],
];
const reads: [name: string, text: string][] = [
  ["sum", "for (let k = 0; k < l.length; k++) sum += +l[k] || 0;"],
  ["of", "for (const x of l) sum += +x || 0;"],
  ["joined", "out.push(l.join('/'));"],
  ["holes", "for (let k = 0; k < l.length; k++) if (!(k in l)) holes++;"],
  ["first", "out.push(show(l[0]), show(l[l.length - 1]));"],
  ["past-end", "out.push(show(l[l.length]), show(l[7]));"],
  ["reduced", "sum += l.reduce((all, x) => all + (+x || 0), 0);"],
  ["greatest", "out.push(show(Math.max(...l)));"],
  ["found", "out.push(l.indexOf(V), l.includes(undefined));"],
  ["spread", "out.push([...l, i].length);"],
  ["destructured", "const [one, two = 'd', ...others] = l;\nout.push(show(one), show(two), others.length);"],
  ["json", "out.push(JSON.stringify(l));"],
  ["nothing", "sum++;"],
  ["handed", "sum += weigh(l);"],
];
const kept: [name: string, text: string][] = [
  ["nobody", ""],
  ["last", "last = l;"],
  ["pushed", "all.push(l);"],
  ["field", "box.v = l;"],
  ["closure", "calls.push(() => l.length);"],
  ["map", "table.set(i, l);"],
  ["wrapped", "all.push({ l });"],
  ["part", "all.push(l.slice(0, 1));"],
  ["returned", "last = give(l);"],
  ["element", "all.push([l[0]]);"],
];
// KEEP is the keeping.
const moments: [name: string, text: string][] = [["always", "KEEP"], ["sometimes", "if (i === 2) {\n  KEEP\n}"], ["first", "if (i === 0) {\n  KEEP\n}"], ["if-long", "if (l.length > 3) {\n  KEEP\n}"], ["caught", "try {\n  fail(i);\n} catch {\n  KEEP\n}"]]; // prettier-ignore
const kinds: [name: string, text: string][] = [["integer", "i"], ["double", "i / 2"], ["text", "'t' + i"], ["object", "held"], ["nothing", "undefined"], ["of-both", "(i & 1 ? 0.5 : i)"]]; // prettier-ignore
// `STEP` in a turn.
const loops: [name: string, text: string][] = [
  ["for", "for (let i = 0; i < 5; i++) {\n  STEP\n}"],
  ["many", "for (let i = 0; i < 70; i++) {\n  STEP\n}"],
  ["callback", "[0, 1, 2, 3].forEach(i => {\n  STEP\n});"],
  ["nested", "for (let round = 0; round < 2; round++) {\n  for (let i = 0; i < 4; i++) {\n    STEP\n  }\n}"],
  ["while", "let i = 0;\nwhile (i < 5) {\n  STEP\n  i++;\n}"],
];
const functions: [name: string, text: string][] = [
  ["function", "function run(base) {\n  BODY\n}"],
  ["arrow", "const run = base => {\n  BODY\n};"],
  ["async", "async function run(base) {\n  await null;\n  BODY\n}"],
  ["generator", "function* steps(base) {\n  yield base;\n  BODY\n}\nconst run = base => [...steps(base)].length;"],
];
const total = made.length * filled.length * reads.length * kept.length * moments.length * kinds.length * loops.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const make = pick(made);
  const read = pick(reads);
  const keep = pick(kept);
  const fill = pick(filled);
  const kind = pick(kinds);
  const moment = pick(moments);
  const loop = pick(loops);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && form[0] !== "async";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const step = [make[1], fill[1], read[1], keep[1] ? within(moment[1], "KEEP", keep[1]) : ""].filter(Boolean).join("\n").replaceAll(/\bV\b/g, kind[1]); // prettier-ignore
  const body = [
    "let sum = 0;\nlet holes = 0;\nlet last = null;\nlet outer = [];",
    "const all = [];\nconst calls = [];\nconst table = new Map();\nconst box = { v: null };\nconst shared = [];",
    within(loop[1], "STEP", step),
    "out.push(show(sum), holes, show(last), show(box.v), all.map(show).join(';'), calls.map(call => call()).join(), [...table.values()].map(show).join(';'));",
  ].join("\n");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : value && typeof value === "object" && "length" in value ? "[" + Array.from(value, (x, k) => (k in value ? show(x) : "hole")).join("|") + "]" : value && typeof value === "object" ? "{" + Object.entries(value).map(([key, x]) => key + show(x)).join("|") + "}" : String(value).slice(0, 14));',
    "const out = [];",
    ...(/gather\(/.test(step) ? ["const gather = (...given) => given;"] : []),
    ...(/weigh\(/.test(step) ? ["const weigh = list => list.length;"] : []),
    ...(/give\(/.test(step) ? ["const give = list => list;"] : []),
    ...(/fail\(/.test(step) ? ["const fail = i => {\n  if (i & 1) throw i;\n};"] : []),
    ...(/\bheld\b/.test(step) ? ["const held = { h: 1 };"] : []),
    within(form[1], "BODY", body),
    "for (const base of [[1, 2, 3], [0.5, 4], []]) {",
    "  try {",
    `    ${form[0] === "async" ? "await " : ""}run(base);`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 2200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${make[0]}--${fill[0]}--${read[0]}--${keep[0]}--${moment[0]}--${kind[0]}--${loop[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
