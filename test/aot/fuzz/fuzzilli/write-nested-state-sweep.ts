// What loops inside loops change step by step: what the inner loop changes, times what is changed in front of it, times what is changed behind it, times the inner loop, times the outer loop, times the first values, times what is read between, times the function around.
//
//   bun write-nested-state-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<inner change>--<front>--<behind>--<inner>--<outer>--<first>--<between>--<function>.mjs, .cjs or .ts
//   bun write-nested-state-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `i` counts outside and `q` inside; the state is a, t, l, o, m, w, k, b.
const changes: [name: string, text: string][] = [
  ["sum", "a += l[q & 3] ?? 1;"],
  ["sum-of-both", "a += i * q;"],
  ["fraction", "a += 0.5;"],
  ["product", "a = a * 2 + q;"],
  ["truncated", "a = (a + q * 3) | 0;"],
  ["text", "t += q;"],
  ["text-in-front", "t = q + t;"],
  ["element", "l[q & 3] += 1;"],
  ["element-of-counter", "l[k++ & 7] = q;"],
  ["element-of-double", "l[q & 3] = a + 0.5;"],
  ["pushed", "l.push(q);"],
  ["popped", "l.pop();"],
  ["shifted", "l.push(l.shift());"],
  ["field", "o.v += q;"],
  ["field-of-double", "o.v = o.v / 2 + i;"],
  ["two-fields", "o.v = o.w;\no.w = q;"],
  ["map", "m.set(q, (m.get(q) ?? 0) + 1);"],
  ["word", "w[q & 3] += i + 1;"],
  ["counter", "k++;"],
  ["counter-down", "k -= 2;"],
  ["big", "b = b * 3n + 1n;"],
  ["greatest", "if (l[q & 3] > a) a = l[q & 3];"],
  ["swapped", "[l[0], l[1]] = [l[1], l[0]];"],
  ["by-call", "a = step(a, q);"],
  ["by-closure", "more(q);"],
  ["by-method", "o.add(q);"],
  ["kind", "a = q & 1 ? a : a + 0.25;"],
  ["nothing", "if (q > 90) a = 0;"],
];
const inners: [name: string, text: string][] = [
  ["two", "for (let q = 0; q < 2; q++) {\n  IN\n}"],
  ["five", "for (let q = 0; q < 5; q++) {\n  IN\n}"],
  ["given", "for (let q = 0; q < n; q++) {\n  IN\n}"],
  ["to-outer", "for (let q = 0; q <= i; q++) {\n  IN\n}"],
  ["of-list", "for (let q = 0; q < l.length && q < 9; q++) {\n  IN\n}"],
  ["of", "for (const q of [1, 0, 2]) {\n  IN\n}"],
  ["while", "let q = 0;\nwhile (q < 3) {\n  IN\n  q++;\n}"],
  ["breaks", "for (let q = 0; ; q++) {\n  IN\n  if (q > 1) break;\n}"],
  ["continues", "for (let q = 0; q < 4; q++) {\n  if (q === i) continue;\n  IN\n}"],
  ["down", "for (let q = 3; q-- > 0; ) {\n  IN\n}"],
  ["deeper", "for (let r = 0; r < 2; r++) {\n  for (let q = 0; q < 2; q++) {\n    IN\n  }\n}"],
  ["twice", "for (let q = 0; q < 2; q++) {\n  IN\n}\nfor (let q = 0; q < 3; q++) {\n  IN\n}"],
  ["no-loop", "{\n  const q = 1;\n  IN\n}"],
  ["callback", "[0, 1].forEach(q => {\n  IN\n});"],
];
const outers: [name: string, text: string][] = [
  ["three", "for (let i = 0; i < 3; i++) {\n  ALL\n}"],
  ["given", "for (let i = 0; i < n; i++) {\n  ALL\n}"],
  ["many", "for (let i = 0; i < 40; i++) {\n  ALL\n}"],
  ["of", "for (const i of [2, 0, 1]) {\n  ALL\n}"],
  ["while", "let i = 0;\nwhile (i < 3) {\n  ALL\n  i++;\n}"],
  ["once", "{\n  const i = 1;\n  ALL\n}"],
  ["leaves", "for (let i = 0; i < 5; i++) {\n  ALL\n  if (a > 20) break;\n}"],
  ["two", "for (let i = 0; i < 2; i++) {\n  ALL\n}\nfor (let i = 5; i > 3; i--) {\n  ALL\n}"],
];
const firsts: [name: string, text: string][] = [["integers", "let a = 0;\nconst l = [1, 2, 3, 4];"], ["doubles", "let a = 0.5;\nconst l = [0.5, 1.5, 2.5, 3.5];"], ["of-both", "let a = 1;\nconst l = [1, 0.5, 3, -0];"], ["given", "let a = n;\nconst l = given;"], ["empty", "let a = 0;\nconst l = [];"], ["edge", "let a = 2147483640;\nconst l = [2147483647, 1, -2147483648, 3];"]]; // prettier-ignore
const between: [name: string, text: string][] = [["nothing", ""], ["read", "seen.push(show(a), l.length);"], ["copied", "const before = a;\nseen.push(show(before));"], ["captured", "readers.push(() => a);"], ["fails", "try {\n  fail(i);\n} catch {\n  k += 10;\n}"], ["sum", "let s = 0;\nfor (let r = 0; r < l.length; r++) s += l[r];\nseen.push(show(s));"]]; // prettier-ignore
const functions: [name: string, text: string][] = [["function", "function run(n, given) {\n  BODY\n}"], ["arrow", "const run = (n, given) => {\n  BODY\n};"], ["generator", "function* steps(n, given) {\n  yield n;\n  BODY\n}\nconst run = (n, given) => [...steps(n, given)].length;"], ["async", "async function run(n, given) {\n  await null;\n  BODY\n}"]]; // prettier-ignore
const total = changes.length ** 3 * inners.length * outers.length * firsts.length * between.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const inside = pick(changes);
  const inner = pick(inners);
  const behind = pick(changes);
  const first = pick(firsts);
  const outer = pick(outers);
  const front = pick(changes);
  const among = pick(between);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && form[0] !== "async";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const ofOuter = (text: string) => text.replaceAll(/\bq\b/g, "i");
  const all = [ofOuter(front[1]), `{\n${indent(within(inner[1], "IN", inside[1]), "  ")}\n}`, among[1], ofOuter(behind[1])].filter(Boolean).join("\n"); // prettier-ignore
  const uses = (word: RegExp) => word.test(all);
  const any = isTyped ? ": any" : "";
  const body = [
    first[1],
    "let t = '';\nlet k = 0;\nlet b = 1n;\nconst o = {\n  v: 1,\n  w: 2,\n  add(x) {\n    this.v += x;\n    return this;\n  },\n};\nconst m = new Map();\nconst w = new Int32Array(4);\nconst seen = [];\nconst readers = [];",
    ...(uses(/more\(/) ? ["const more = x => {\n  a += x;\n};"] : []),
    within(outer[1], "ALL", all),
    "out.push(show(a), t.slice(0, 60), l.map(show).join(), l.length, show(o.v), show(o.w), [...m].join(';'), w.join(), k, String(b).slice(-12), seen.join(), readers.map(read => show(read())).join());",
  ].join("\n");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : String(value).slice(0, 18));',
    "const out = [];",
    ...(uses(/step\(/) ? [`const step = (a${any}, q${any}) => a + q;`] : []),
    ...(uses(/fail\(/)
      ? ["let calls = 0;\nconst fail = i => {\n  if (calls++ % 3 === 1) throw new Error('f' + i);\n};"]
      : []),
    within(form[1], "BODY", body),
    "for (const n of [2, 3.5, 1]) {",
    "  try {",
    `    ${form[0] === "async" ? "await " : ""}run(n, [4, n, 1]);`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 2600));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${inside[0]}--${front[0]}--${behind[0]}--${inner[0]}--${outer[0]}--${first[0]}--${among[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
