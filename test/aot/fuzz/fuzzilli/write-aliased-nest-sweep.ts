// The least nests of loops in which the inner loop reads a list and the outer one stores into it, perhaps under another name: the list, times its names, times the inner loop, times what it reads, times what is stored, times where, times the outer loop.
//
//   bun write-aliased-nest-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<names>--<inner>--<read>--<stored>--<where>--<outer>.mjs, .cjs or .ts
//   bun write-aliased-nest-sweep.ts count
//
// What an inner loop reads may be read in front of the outer one only where nothing in the outer one stores into it.
import { mkdirSync, writeFileSync } from "node:fs";

const lists: [name: string, text: string][] = [
  ["integers", "[3, 1, 2, 5, 4, 0, 7, 6]"],
  ["fractions", "[3.5, 1.25, 2, 5.5, 4, 0.5, 7, 6]"],
  ["texts", "['d', 'b', 'c', 'f', 'e', 'a', 'h', 'g']"],
  ["kinds", "[3, 1.5, 'c', 5, null, 0, 7, true]"],
  ["hole", "[3, , 2, 5, 4, 0, 7, 6]"],
  ["pushed", "pushed(8)"],
  ["made", "Array.from({ length: 8 }, (_, k) => (k * 5) % 8)"],
  ["filled", "new Array(8).fill(2)"],
  ["words", "new Int32Array([3, 1, 2, 5, 4, 0, 7, 6])"],
  ["bytes", "new Uint8Array([3, 1, 2, 5, 4, 0, 7, 6])"],
  ["doubles", "new Float64Array([3.5, 1.25, 2, 5.5, 4, 0.5, 7, 6])"],
  ["floats", "new Float32Array([3.5, 1.25, 2, 5.5, 4, 0.5, 7, 6])"],
  ["big", "[3e9, 1, 2, 5, 4, 0, 7, 6]"],
];
// L is the list; R is how the inner loop names it, W how it is stored through.
const names: [name: string, front: string, parameters: string, call: string, r: string, w: string][] = [
  ["one", "", "r, n", "L, n", "r", "r"],
  ["two-parameters", "const l = L;", "r, w, n", "l, l, n", "r", "w"],
  ["apart", "", "r, w, n", "L, L, n", "r", "w"],
  ["either", "const l = L;\nconst m = L;", "r, w, n", "l, n > 2 ? l : m, n", "r", "w"],
  ["of-file", "const l = L;", "w, n", "l, n", "l", "w"],
  ["only-file", "const l = L;", "n", "n", "l", "l"],
  ["let-of-file", "let l = L;\nconst again = () => {\n  l = L;\n};\nagain();", "w, n", "l, n", "l", "w"],
  ["field", "const box = { l: L };", "w, n", "box.l, n", "box.l", "w"],
  ["stored-by-field", "const box = { l: L };", "r, n", "box.l, n", "r", "box.l"],
  ["two-fields", "const l = L;\nconst box = { r: l, w: l };", "b, n", "box, n", "b.r", "b.w"],
  ["rows", "const l = L;\nconst rows = [l, l, L];", "rows, n", "rows, n", "rows[0]", "rows[1]"],
  ["row-of-turn", "const l = L;\nconst rows = [l, L, l];", "rows, n", "rows, n", "rows[0]", "rows[i % 3]"],
  [
    "instance",
    "class C {\n  constructor() {\n    this.l = L;\n  }\n}\nconst c = new C();",
    "c, n",
    "c, n",
    "c.l",
    "c.l",
  ],
  ["constant-alias", "", "r, n", "L, n", "r", "other(r)"],
];
const inners: [name: string, text: string][] = [
  ["four", "for (let k = 0; k < 4; k++) {\n  READ\n}"],
  ["two", "for (let k = 0; k < 2; k++) {\n  READ\n}"],
  ["one", "for (let k = 0; k < 1; k++) {\n  READ\n}"],
  ["eight", "for (let k = 0; k < 8; k++) {\n  READ\n}"],
  ["given", "for (let k = 0; k < n; k++) {\n  READ\n}"],
  ["to-outer", "for (let k = 0; k <= i; k++) {\n  READ\n}"],
  ["length", "for (let k = 0; k < R.length; k++) {\n  READ\n}"],
  ["down", "for (let k = 3; k >= 0; k--) {\n  READ\n}"],
  ["while", "let k = 0;\nwhile (k < 3) {\n  READ\n  k++;\n}"],
  ["do", "let k = 0;\ndo {\n  READ\n} while (++k < 3);"],
  ["none", "{\n  const k = i & 3;\n  READ\n}"],
  ["leaves", "for (let k = 0; k < 4; k++) {\n  if (k === 3) break;\n  READ\n}"],
  ["callee", "s = sum(R, s, i);"],
  ["callee-given", "s = sumTo(R, s, i, 3);"],
  ["closure", "const each = () => {\n  for (let k = 0; k < 3; k++) {\n    READ\n  }\n};\neach();"],
  ["nested", "for (let j = 0; j < 2; j++)\n  for (let k = 0; k < 2; k++) {\n    READ\n  }"],
];
const reads: [name: string, text: string][] = [
  ["sum", "s += R[k];"],
  ["of-outer", "s += R[i & 7];"],
  ["first", "s += R[0];"],
  ["difference", "s += R[k] - R[0];"],
  ["product", "s += R[k] * R[i & 7];"],
  ["greatest", "if (R[k] > s) s = R[k];"],
  ["counted", "if (R[k] > R[i & 7]) s++;"],
  ["indirect", "s += R[R[k] & 7];"],
  ["xor", "s ^= R[k];"],
  ["length", "s += R.length;"],
  ["last", "s += R[R.length - 1];"],
  ["kept", "last = R[k];"],
];
const stores: [name: string, text: string][] = [
  ["of-outer", "W[i & 7] = i * 3;"],
  ["sum", "W[i & 7] = s;"],
  ["first", "W[0] = i + 9;"],
  ["counted", "W[0]++;"],
  ["added", "W[i & 7] += 2;"],
  ["fraction", "W[0] = i + 0.5;"],
  ["text", "W[1] = 't' + i;"],
  ["undefined", "W[1] = undefined;"],
  ["exchanged", "[W[0], W[1]] = [W[1], W[0]];"],
  ["next", "W[(i + 1) & 7] = W[i & 7];"],
  ["pushed", "if (W.length < 30) W.push?.(i);"],
  ["popped", "W.pop?.();"],
  ["shorter", "W.length = 3;"],
  ["filled", "W.fill(i);"],
  ["reversed", "W.reverse();"],
  ["sorted", "W.sort();"],
  ["removed", "delete W[2];"],
  ["callee", "put(W, i);"],
  ["nothing", ";"],
];
const wheres: [name: string, text: string][] = [
  ["behind", "INNER\nSTORE"],
  ["in-front", "STORE\nINNER"],
  ["between", "INNER\nSTORE\ns += SECOND;"],
  ["sometimes", "INNER\nif (i & 1) {\n  STORE\n}"],
  ["once", "INNER\nif (i === 1) {\n  STORE\n}"],
  ["in-try", "INNER\ntry {\n  STORE\n} catch {\n  s++;\n}"],
];
const outers: [name: string, text: string][] = [
  ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["five", "for (let i = 0; i < 5; i++) {\n  IN\n}"],
  ["while", "let i = 0;\nwhile (i < n) {\n  IN\n  i++;\n}"],
  ["length", "for (let i = 0; i < R.length && i < 9; i++) {\n  IN\n}"],
  ["twice", "for (let q = 0; q < 2; q++)\n  for (let i = 0; i < n; i++) {\n    IN\n  }"],
  ["of", "for (const i of [0, 2, 1, 3]) {\n  IN\n}"],
];
const total =
  lists.length * names.length * inners.length * reads.length * stores.length * wheres.length * outers.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 11_000_009;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const inner = pick(inners);
  const name = pick(names);
  const store = pick(stores);
  const read = pick(reads);
  const list = pick(lists);
  const where = pick(wheres);
  const outer = pick(outers);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const [, front, parameters, call, r, w] = name;
  const named = (text: string) => text.replaceAll(/\bR\b/g, r).replaceAll(/\bW\b/g, w);
  const turn = within(within(where[1], "INNER", within(inner[1], "READ", read[1])), "STORE", store[1]).replaceAll(
    "SECOND",
    "R[0]",
  );
  const body = named(within(outer[1], "IN", turn.split("\n").filter(line => line.trim() !== ";").join("\n"))); // prettier-ignore
  const uses = (word: RegExp) => word.test(body + front + call + list[1]);
  const made = (text: string) => text.replaceAll(/\bL\b/g, list[1]);
  const reading = read[1].replaceAll(/\bR\b/g, "x").replaceAll("last = ", "s += ");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(/\bpushed\(/.test(list[1])
      ? ["function pushed(n) {\n  const made = [];\n  for (let k = 0; k < n; k++) made.push(k * 3);\n  return made;\n}"]
      : []),
    ...(uses(/\bsum\(/)
      ? [`function sum(x, s, i) {\n  for (let k = 0; k < 3; k++) {\n    ${reading}\n  }\n  return s;\n}`]
      : []),
    ...(uses(/\bsumTo\(/)
      ? [`function sumTo(x, s, i, m) {\n  for (let k = 0; k < m; k++) {\n    ${reading}\n  }\n  return s;\n}`]
      : []),
    ...(uses(/\bput\(/) ? ["function put(x, i) {\n  x[0] = i + 5;\n}"] : []),
    ...(uses(/\bother\(/) ? ["function other(x) {\n  return x;\n}"] : []),
    ...(front ? [made(front)] : []),
    `function run(${parameters}) {\n  let s = 0;\n  let last = 0;\n${indent(body, "  ")}\n  return s + "/" + last;\n}`,
    "const out = [];",
    "for (const n of [2, 4, 3]) {",
    "  try {",
    `    out.push(run(${made(call)}));`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${name[0]}--${inner[0]}--${read[0]}--${store[0]}--${where[0]}--${outer[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
