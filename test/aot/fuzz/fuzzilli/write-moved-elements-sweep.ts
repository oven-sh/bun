// The least programs of a loop that moves elements: each target, times each source, times each move, times each loop, times where its counters start.
//
//   bun write-moved-elements-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<target>--<source>--<move>--<loop>--<at>--<from>.mjs, .cjs or .ts
//   bun write-moved-elements-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `s` is what is read, `t` what is written, `j` the counter of the loop, `at` and `from` counters beside it.
const targets: string[] = [
  "const t = [];",
  "const t = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2];",
  "const t = new Array(12);",
  "const t = new Array(12).fill(0);",
  "const t = new Array(12).fill(0.5);",
  "const t = ['p', 'q', 'r', 's', 't', 'u', 'v', 'w'];",
  "const t = {};",
  "const t = s;",
  "const t = s.slice();",
  "const t = new Uint8Array(12);",
  "const t = new Int16Array(12);",
  "const t = new Float64Array(12);",
  "const t = new Float32Array(12);",
  "const t = new Uint8ClampedArray(12);",
  "const t = new Int32Array(8);",
  "const t = Object.freeze([1, 2, 3, 4]);",
  "const t = [1, , 3];",
  "const t = new BigInt64Array(8);",
  "const t = new Uint32Array(new ArrayBuffer(64), 4, 8);",
  "const b = s.buffer ?? new ArrayBuffer(64);\nconst t = new Uint8Array(b);",
  "class L extends Array {}\nconst t = new L();",
  "const t = Object.create([1, 2, 3]);",
  "const t = new Map();",
  "const t = [[0], [1], [2]];",
];
const sources: string[] = [
  "const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];",
  "const s = [0.5, 1.5, -0, 2.5, NaN, 3, 4, 5, 6, 7, 8, 9];",
  "const s = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];",
  "const s = [1, , 3, , 5, 6, 7, 8];",
  "const s = [1, 2];",
  "const s = [];",
  "const s = [1, 'x', null, undefined, {}, 2.5, true, 8];",
  "const s = new Uint8Array([1, 2, 3, 250, 255, 6, 7, 8, 9, 10, 11, 12]);",
  "const s = new Float64Array([0.5, -0, 1e300, NaN, 4, 5, 6, 7, 8, 9, 10, 11]);",
  "const s = new Int32Array([-1, 2147483647, -2147483648, 4, 5, 6, 7, 8]);",
  "const s = 'abcdefghijkl';",
  "const s = made();",
  "const s = { 0: 'z', 1: 'y', 2: 'x' };",
  "const s = new Int8Array(new Int8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer, 2);",
];
const moves: string[] = [
  "t[j] = s[j];",
  "t[at++] = s[j];",
  "t[at] = s[j];\nat++;",
  "t[at + j] = s[j];",
  "t[j] = s[from++];",
  "t[j] = s[from + j];",
  "t[at++] = s[from++];",
  "t[j] = s[j + 1];",
  "t[j + 1] = s[j];",
  "t[j] = s[n - 1 - j];",
  "t[n - 1 - j] = s[j];",
  "t[j - 1] = s[j];",
  "t[j * 2] = s[j];",
  "t[j] = s[j * 2];",
  "t[j] = s[j & 3];",
  "t[j] = t[j + 1];",
  "t[j + 1] = t[j];",
  "t[j] = 0;",
  "t[at++] = 5;",
  "t[j] = at;",
  "t[j] = s[j];\nt[j + 1] = s[j + 1];",
  "t[at++] = s[j];\nat += 1;",
  "t[j] = s[j];\nfrom--;",
  "t[at - 1000] = s[j];\nat++;",
  "t[j | 0] = s[j | 0];",
  "t[j >>> 0] = s[j];",
  "t[at++] = t[from++];",
  "[t[j]] = [s[j]];",
  "t[j] ??= s[j];",
  "t[j] = s[j] ?? 0;",
  "t.push?.(s[j]);",
  "t[j] = s[j] + 0;",
  "t[at--] = s[j];",
  "const v = s[j];\nt[j] = v;",
  "t[j] = last;\nlast = s[j];",
  "if (j in s) t[j] = s[j];",
  "t[`${j}`] = s[j];",
  "t[at = at + 1] = s[j];",
];
const loops: string[] = [
  "for (let j = 0; j < n; j++) {\n  MOVE\n}",
  "for (let j = 0; j < s.length; j++) {\n  MOVE\n}",
  "for (let j = n; j--; ) {\n  MOVE\n}",
  "for (let j = n - 1; j >= 0; j--) {\n  MOVE\n}",
  "let j = 0;\nwhile (j < n) {\n  MOVE\n  j++;\n}",
  "let j = 0;\ndo {\n  MOVE\n} while (++j < n);",
  "for (let j = 2; j < n; j += 2) {\n  MOVE\n}",
  "for (let j = from, end = from + n; j < end; j++) {\n  MOVE\n}",
  "for (let j = 0, m = Math.min(n, s.length); j < m; ++j) {\n  MOVE\n}",
  "for (let j = 0; j < n; j++, steps++) {\n  MOVE\n}",
  "for (let i = 0; i < 20; i++) at++;\nfor (let j = 0; j < n; j++) {\n  MOVE\n}",
  "for (let i = 0; i < 2; i++)\n  for (let j = 0; j < n; j++) {\n    MOVE\n  }",
  "for (let j = 0; j < n; j++) {\n  MOVE\n  if (j === 4) break;\n}",
  "for (let j = 0; j < n; j++) {\n  if (j === 2) continue;\n  MOVE\n}",
  "for (let j = 0; j !== n; j++) {\n  MOVE\n}",
  "var j;\nfor (j = 0; j < n; j++) {\n  MOVE\n}\nsay(j);",
];
const starts: string[] = [
  "0",
  "1",
  "5",
  "-1",
  "-3",
  "2147483640",
  "2147483647",
  "1000",
  "given",
  "given | 0",
  "(given | 0) + 1000",
  "0.5",
  "4294967290",
  "given + 1",
  "+given",
  "Number(given) * 2",
];
const total = targets.length * sources.length * moves.length * loops.length * starts.length * 4;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 8_171_521;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const target = pick(targets);
  const source = pick(sources);
  const move = pick(moves);
  const loop = pick(loops);
  const start = pick(starts);
  const other = pick([0, 1, 7, 11]);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const last = starts[(starts.indexOf(start) + other) % starts.length];
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const said = [];",
    'const tell = v => (typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "object" : String(v));',
    'const say = (...values) => void said.push(values.map(tell).join(":"));',
    'const show = o => Object.entries(o).slice(0, 14).map(([k, v]) => k + "=" + tell(v)).join();',
    ...(/made\(/.test(source) ? ["const made = () => Array.from({ length: 12 }, (_, i) => i * 3);"] : []),
    "let steps = 0;",
    "let last = 0;",
    `function run(given, n) {\n${indent(`let at = ${start};\nlet from = ${last};\n${source}\n${target}\ntry {\n${indent(within(target === "const t = s;" ? loop.replace("j < s.length;", "j < s.length && j < 20;") : loop, "MOVE", move), "  ")}\n} catch (e) {\n  say(e.name);\n}\nsay(at, from, show(t), t.length);\nif (s !== t) say(show(s));`, "  ")}\n}`,
    "function said0(of) {\n  try {\n    of();\n  } catch (error) {\n    say(error.name);\n  }\n}",
    "said0(() => run(0, 8));",
    cell % 5 < 2
      ? "said0(() => run(2147483640, 9));"
      : cell % 5 < 4
        ? "said0(() => run(3, 5));"
        : "said0(() => run('2', 4));",
    "said0(() => run(1, 0));",
    'console.log(said.join(" ").slice(0, 1600), steps, tell(last));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${targets.indexOf(target)}--${sources.indexOf(source)}--${moves.indexOf(move)}--${loops.indexOf(loop)}--${starts.indexOf(start)}--${other}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
