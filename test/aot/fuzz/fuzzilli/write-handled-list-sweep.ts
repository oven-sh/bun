// Lists that are made in front of, inside, and behind what may throw, and read by the handler: how a list is made, times how it is filled, times what throws, times where, times the handler, times how the list is opened, times what is stored behind that, times the loop, times the function around.
//
//   bun write-handled-list-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<made>--<filled>--<throws>--<handler>--<opened>--<stored>--<loop>--<function>.mjs, .cjs or .ts
//   bun write-handled-list-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `l` is the list.
const made: [name: string, text: string][] = [
  ["pair", "let l = [i, v];"],
  ["empty", "let l = [];"],
  ["one", "let l = [v];"],
  ["counted", "let l = new Array(4);"],
  ["filled", "let l = new Array(4).fill(v);"],
  ["of", "let l = Array.of(i, v, i + 1);"],
  ["from", "let l = Array.from({ length: 4 }, (_, k) => k + i);"],
  ["spread", "let l = [...given, i];"],
  ["sliced", "let l = given.slice(0, 3);"],
  ["joined", "let l = given.concat([i]);"],
  ["nested", "let l = [[i], [v]];"],
  ["of-objects", "let l = [{ v: i }, { v }];"],
  ["in-field", "const box = { list: [i, v] };\nlet l = box.list;"],
  ["of-rest", "let l = rest(i, v);"],
  ["split", "let l = `${i},${i + 1}`.split(',');"],
  ["words", "let l = new Int32Array(4);"],
  ["doubles", "let l = [0.5, i / 2];"],
  ["holes", "let l = [i, , v];"],
  ["mapped", "let l = given.map(x => x + i);"],
  ["either", "let l = i & 1 ? [i] : [v, v];"],
  ["outer", "let l = kept;"],
  ["late", "let l;\nif (i >= 0) l = [i, i, v];"],
];
const filled: [name: string, text: string][] = [
  ["nothing", ""],
  ["pushed", "if (l.push) l.push(i, v);"],
  ["element", "l[1] = v;"],
  ["counted", "for (let k = 0; k < 3; k++) l[k] = k + i;"],
  ["at-length", "l[l.length] = i;"],
  ["read-back", "l[0] = l[1];"],
  ["replaced", "l = [...l, i];"],
  ["shortened", "l.length = 1;"],
  ["swapped", "[l[0], l[1]] = [l[1], l[0]];"],
  ["added", "l[0] += 1;"],
  ["handed", "hand(l);"],
  ["captured", "const read = () => l.length;\nsum += read();"],
];
// May throw; `i` counts.
const throws: [name: string, text: string][] = [
  ["call", "fail(i);"],
  ["statement", "if (i === 2) throw new RangeError('r');"],
  ["null", "sum += (i === 2 ? null : { v: 1 }).v;"],
  ["missing", "if (i > 0) nothing.missing();"],
  ["getter", "sum += trap.v;"],
  ["length", "new Array(i === 2 ? -1 : 1);"],
  ["json", "JSON.parse(i === 2 ? '{' : '1');"],
  ["number", "if (i === 1) throw i;"],
  ["list", "if (i === 1) throw l;"],
  ["element", "sum += l[i].length;"],
  ["iterator", "for (const x of i === 2 ? 5 : []) sum += x;"],
  ["conversion", "sum += +(i === 1 ? Symbol.iterator : 2);"],
  ["destructured", "const { v: inner } = i === 2 ? undefined : { v: 1 };\nsum += inner;"],
  ["never", "sum += i;"],
  ["from-callback", "l.forEach?.(x => fail(x));"],
];
// `TRY` may throw, `OPEN` reads the list.
const handlers: [name: string, text: string][] = [
  ["caught", "MAKE\ntry {\n  TRY\n  FILL\n} catch {\n  out.push('c');\n}\nOPEN"],
  ["caught-reads", "MAKE\ntry {\n  FILL\n  TRY\n} catch (error) {\n  out.push(error?.name ?? 'n');\n  OPEN\n}"],
  ["made-inside", "try {\n  MAKE\n  FILL\n  TRY\n  OPEN\n} catch {\n  out.push('c');\n}"],
  ["finally", "MAKE\ntry {\n  try {\n    FILL\n    TRY\n  } finally {\n    OPEN\n  }\n} catch {\n  out.push('f');\n}"],
  ["both", "MAKE\ntry {\n  TRY\n} catch {\n  FILL\n} finally {\n  OPEN\n}"],
  [
    "thrown-on",
    "try {\n  MAKE\n  try {\n    TRY\n    FILL\n  } catch (error) {\n    OPEN\n    throw error;\n  }\n} catch {\n  out.push('o');\n}",
  ],
  ["continues", "MAKE\ntry {\n  FILL\n  TRY\n  OPEN\n} catch {\n  sum++;\n  if (i < 2) sum += 2;\n}"],
  ["opened-inside", "MAKE\nFILL\ntry {\n  OPEN\n  TRY\n} catch {\n  sum += 100;\n}"],
  ["made-in-handler", "try {\n  TRY\n} catch {\n  MAKE\n  FILL\n  OPEN\n}"],
  ["replaced-in-handler", "MAKE\ntry {\n  FILL\n  TRY\n} catch {\n  l = [9, 8];\n}\nOPEN"],
  ["two", "MAKE\ntry {\n  TRY\n} catch {\n  sum++;\n}\ntry {\n  FILL\n  OPEN\n} catch {\n  sum += 10;\n}"],
];
const opened: [name: string, text: string][] = [
  ["of", "for (const x of l) sum += +x || 0;"],
  ["counted", "for (let k = 0; k < l.length; k++) sum += +l[k] || 0;"],
  ["each", "l.forEach(x => (sum += +x || 0));"],
  ["pair", "const [first, second] = l;\nout.push(show(first), show(second));"],
  ["joined", "out.push(l.join('/'));"],
  ["spread", "out.push([...l].length);"],
  ["length", "sum += l.length;"],
  ["reduced", "sum += l.reduce((all, x) => all + (+x || 0), 0);"],
  ["kept", "kept = l;"],
  ["first", "out.push(show(l[0]));"],
  ["rest", "const [, ...others] = l;\nout.push(others.length);"],
  ["argument", "out.push(show(Math.max(...l)));"],
  ["entries", "for (const [k, x] of l.entries()) sum += k + (+x || 0);"],
  ["json", "out.push(JSON.stringify(l));"],
  ["searched", "out.push(l.indexOf(i), l.includes(v));"],
  ["fails-inside", "for (const x of l) if (x === 2) fail(x);"],
  ["of-literal", "for (const x of [1, 2]) sum += x;"],
  ["of-literal-of-both", "for (const x of [i, v]) sum += +x || 0;"],
  ["entries-of-literal", "for (const [k, x] of [5, 6].entries()) sum += k * x;"],
  ["of-row", "for (const x of rows[i] ?? []) sum += x;"],
  ["of-either", "for (const x of i & 1 ? l : given) sum += +x || 0;"],
  ["of-called", "for (const x of choose(l)) sum += +x || 0;"],
  ["of-fixed", "for (const x of fixed) sum += x;"],
  ["of-slice", "for (const x of given.slice(i)) sum += x;"],
  ["nested", "for (const x of [1, 2]) for (const y of [x, i]) sum += y;"],
  ["keys", "for (const k of l.keys()) sum += k;"],
];
const stored: [name: string, text: string][] = [
  ["element", "target[i] = sum;"],
  ["nothing", ""],
  ["pushed", "target.push(sum);"],
  ["added", "target[i] = (target[i] ?? 0) + sum;"],
  ["words", "words[i] = sum;"],
  ["in-given", "given[i] = sum;"],
  ["field", "held.v = sum;"],
  ["list", "target[i] = [sum, i];"],
];
// `STEP` in a turn.
const loops: [name: string, text: string][] = [
  ["for", "for (let i = 0; i < 4; i++) {\n  STEP\n}"],
  ["of-list", "for (let i = 0; i < given.length; i++) {\n  STEP\n}"],
  ["while", "let i = 0;\nwhile (i < 4) {\n  STEP\n  i++;\n}"],
  ["of", "for (const i of [2, 0, 1]) {\n  STEP\n}"],
  ["callback", "[0, 1, 2].forEach(i => {\n  STEP\n});"],
  ["nested", "for (let k = 0; k < 2; k++) {\n  for (let i = 0; i < 3; i++) {\n    STEP\n  }\n}"],
  ["once", "{\n  const i = 2;\n  STEP\n}"],
  ["in-try", "try {\n  for (let i = 0; i < 4; i++) {\n    STEP\n  }\n} catch {\n  out.push('outer');\n}"],
  ["do", "let i = 0;\ndo {\n  STEP\n} while (++i < 3);"],
];
// `BODY` is what is done with `v` and `given`.
const functions: [name: string, text: string][] = [
  ["function", "function run(v, given) {\n  BODY\n}"],
  ["arrow", "const run = (v, given) => {\n  BODY\n};"],
  ["async", "async function run(v, given) {\n  await null;\n  BODY\n}"],
  [
    "generator",
    "function* steps(v, given) {\n  yield v;\n  BODY\n}\nconst run = (v, given) => [...steps(v, given)].length;",
  ],
  [
    "method",
    "class Runner {\n  run(v, given) {\n    BODY\n  }\n}\nconst run = (v, given) => new Runner().run(v, given);",
  ],
];
const total = made.length * filled.length * throws.length * handlers.length * opened.length * stored.length * loops.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const list = pick(made);
  const handler = pick(handlers);
  const open = pick(opened);
  const store = pick(stored);
  const thrown = pick(throws);
  const fill = pick(filled);
  const loop = pick(loops);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && form[0] !== "async";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const throwing = handler[0] === "made-in-handler" || handler[0] === "thrown-on" ? thrown[1].replace(/throw l;/, "throw [i];").replace(/\bl\b/g, "given") : thrown[1]; // prettier-ignore
  const step = [["MAKE", list[1]], ["FILL", fill[1] || "sum++;"], ["TRY", throwing], ["OPEN", store[1] ? `${open[1]}\n${store[1]}` : open[1]]].reduce((text, [hole, part]) => within(text, hole, part), handler[1]); // prettier-ignore
  const body = [
    "let sum = 0;",
    "let kept = [v, 1];",
    ...(/target/.test(step) ? ["const target = [0, 0, 0];"] : []),
    ...(/words/.test(step) ? ["const words = new Float64Array(5);"] : []),
    ...(/held/.test(step) ? ["const held = { v: 1 };"] : []),
    within(loop[1], "STEP", step),
    "out.push(sum, show(kept));",
    ...(/target/.test(step) ? ["out.push(target.join('/'));"] : []),
    ...(/words/.test(step) ? ["out.push(words.join('/'));"] : []),
    ...(/held/.test(step) ? ["out.push(held.v);"] : []),
  ].join("\n");
  const call = form[0] === "async" ? "await run(v, [1, 2, 3]);" : "run(v, [1, 2, 3]);";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : String(value).slice(0, 30));',
    "const out = [];",
    ...(/fail\(/.test(body) ? ["const fail = value => {\n  if (value === 2) throw new TypeError('f');\n};"] : []),
    ...(/rows/.test(body) ? ["const rows = [[1, 2], [3], null, [0.5, 7]];"] : []),
    ...(/fixed/.test(body) ? ["const fixed = [2, 4];"] : []),
    ...(/choose\(/.test(body) ? ["const choose = list => list;"] : []),
    ...(/hand\(/.test(body) ? ["const hand = list => {\n  list[0] = 7;\n};"] : []),
    ...(/rest\(/.test(body) ? ["const rest = (...all) => all;"] : []),
    ...(/nothing\./.test(body) ? ["const nothing = {};"] : []),
    ...(/trap\./.test(body)
      ? [
          "let asked = 0;\nconst trap = {\n  get v() {\n    if (asked++ & 1) throw new EvalError('g');\n    return asked;\n  },\n};",
        ]
      : []),
    within(form[1], "BODY", body),
    "for (const v of [3, 1.5, 'x']) {",
    "  try {",
    `    ${call}`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${fill[0]}--${thrown[0]}--${handler[0]}--${open[0]}--${store[0]}--${loop[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
