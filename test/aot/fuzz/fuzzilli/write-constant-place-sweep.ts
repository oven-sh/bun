// The least programs of an element at a constant place in a loop: each list, times each loop, times what skips a part of an iteration, times two deeds with the element.
//
//   bun write-constant-place-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<loop>--<skip>--<deed>--<deed>--<after>.mjs, .cjs or .ts
//   bun write-constant-place-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const lists: string[] = [
  "const a = new Array(n).fill(1);",
  "const a = [1, 2, 3, 4, 5];",
  "const a = [0.5, 1.5, 2.5, 3.5];",
  "const a = [];",
  "const a = [7];",
  "const a = Array.from({ length: n }, (_, i) => i);",
  "const a = new Float64Array(n);",
  "const a = new Int32Array([1, 2, 3, 4, 5, 6]);",
  "const a = new Uint8Array(n).fill(200);",
  "const a = ['p', 'q', 'r', 's'];",
  "const a = [1, 'x', null, 2.5];",
  "const a = [{ v: 1 }, { v: 2 }, { v: 3 }];",
  "const a = [1, , 3];",
  "const a = given ? [1, 2, 3, 4, 5, 6] : [0.5, 2];",
  "const o = { a: [1, 2, 3, 4] };\nlet a = o.a;",
  "const rows = [[1, 2, 3, 4], [5, 6, 7, 8]];\nlet a = rows[0];",
  "const a = made();",
  "const a = new Array(n);",
  "const a = [true, false, true];",
  "const a = [1n, 2n, 3n];",
];
const loops: string[] = [
  "for (const x of [0, 3, 1, 7, 1]) {\n  SKIP\n  ONE\n  TWO\n}",
  "for (let x = 0; x < n; x++) {\n  SKIP\n  ONE\n  TWO\n}",
  "for (let i = 0; i < 6; i++) {\n  const x = i % 3;\n  SKIP\n  ONE\n  TWO\n}",
  "let x = 0;\nwhile (x < 5) {\n  ONE\n  x++;\n  SKIP\n  TWO\n}",
  "for (let x = n; x > 0; x--) {\n  ONE\n  SKIP\n  TWO\n}",
  "for (const x of list) {\n  SKIP\n  ONE\n  TWO\n}",
  "for (let i = 0; i < 2; i++)\n  for (let x = 0; x < 4; x++) {\n    SKIP\n    ONE\n    TWO\n  }",
  "list.forEach(x => {\n  ONE\n  TWO\n});",
  "for (let i = 0; i < 9; i++) {\n  const x = list[i % list.length];\n  SKIP\n  ONE\n  TWO\n}",
  "do {\n  ONE\n  TWO\n  x0++;\n} while (x0 < 4);",
];
const skips: string[] = [
  "if (x >= a.length) continue;",
  "if (x === 1) continue;",
  "if (x > 5) break;",
  "if (!(x in a)) continue;",
  "if (a[x] === undefined) continue;",
  "if (a[0] === 99) break;",
  "if (x === 2) a[0] = 5;",
  "try {\n  if (x === 1) throw x;\n} catch {\n  a[1] = 6;\n}",
  "",
  "if (x & 1) a[x] = a[0];\nelse continue;",
  "fuel--;\nif (fuel < 0) break;",
  "if (x === 3 && given) a.length = 2;",
];
// `a` is the list, `x` a place, `k` a place that nobody knows.
const deeds: string[] = [
  "const spare = a[x];\na[x] = a[0];\na[0] = spare;",
  "a[0] = a[x];",
  "a[x] = a[0];",
  "a[0]++;",
  "a[0] += x;",
  "a[0] = a[1];",
  "a[1] = a[0];",
  "[a[0], a[x]] = [a[x], a[0]];",
  "sum += a[0];",
  "a[0] = x;",
  "a[x] = x;",
  "a[a.length - 1] = a[0];",
  "if (a[0] > a[1]) {\n  const t = a[0];\n  a[0] = a[1];\n  a[1] = t;\n}",
  "a.push?.(a[0]);",
  "a[2] = a[0];\na[0] = a[2];",
  "a[0] = a[0];",
  "last = a[0];\na[0] = a[x];\na[x] = last;",
  "touch(a);",
  "a[x + 1] = a[x];",
  "a[0] = (a[0] | 0) + (a[1] | 0);",
  "sum += a[x] === a[0] ? 1 : 2;",
  "a[0] ??= 3;",
  "a.reverse?.();",
  "a.fill?.(a[0], 1, 2);",
  "a[x]--;",
  "b[0] = a[0];\na[0] = b[1];",
  "delete a[1];",
  "a[0] = -a[0];",
  "const { 0: first, 1: next } = a;\na[1] = first;\na[0] = next;",
  "a.shift?.();",
  "a[k] = a[0];\na[0] = k;",
  "if (x === 2) a = b;",
  "o2.f = a[0];\na[0] = o2.f;",
  "",
  "",
  "",
];
const afters: string[] = [
  "say(show(a));",
  "say(a[0], a[1]);\nsay(show(a));",
  "say(sum, a.length);\nsay(show(a));",
  "say(show(a), show(b));",
  "say(show([...a]));",
  "return show(a);",
];
const total = lists.length * loops.length * skips.length * deeds.length * deeds.length * afters.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 11_664_001;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const list = pick(lists);
  const loop = pick(loops);
  const skip = pick(skips);
  const one = pick(deeds);
  const two = pick(deeds);
  const after = pick(afters);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const block = (text: string) => (/^(const|let) /m.test(text) ? `{\n${indent(text, "  ")}\n}` : text);
  const hasLoop = !/forEach|do \{/.test(loop);
  const body = within(within(within(loop, "SKIP", hasLoop ? skip : "sum++;"), "ONE", block(one)), "TWO", block(two));
  const bound = loop.startsWith("do") ? body.replaceAll(/\bx\b/g, "x0") : body;
  const all = list + body + after;
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const said = [];",
    'const tell = v => (typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "o" + v.v : String(v));',
    'const say = (...values) => void said.push(values.map(tell).join(":"));',
    'const show = l => Object.entries(l).slice(0, 14).map(([k, v]) => k + "=" + tell(v)).join() + "/" + l.length;',
    ...(/\bmade\(/.test(all) ? ["const made = () => Array.from({ length: 6 }, (_, i) => i * 2);"] : []),
    ...(/\btouch\(/.test(all) ? ["const touch = l => void (l[0] = l[l.length - 1]);"] : []),
    ...(/\bo2\b/.test(all) ? ["const o2 = { f: 0 };"] : []),
    `function run(given, n, k, list) {\n${indent(`${list.replace(/^const a\b/m, two.includes("a = b") || one.includes("a = b") ? "let a" : "const a")}\nconst b = [8, 9];\nlet sum = 0;\nlet last = 0;\nlet fuel = 30;\nlet x0 = 0;\n${cell % 4 === 2 ? `try {\n${indent(bound, "  ")}\n} catch (e) {\n  say(e.name);\n}` : bound}\n${after}`, "  ")}\n}`,
    "function said0(of) {\n  try {\n    const v = of();\n    if (v) say(v);\n  } catch (error) {\n    say(error.name);\n  }\n}",
    "said0(() => run(0, 5, 2, [0, 3, 1, 7, 1]));",
    "said0(() => run(1, 3, 1, [2, 0, 0, 5]));",
    cell % 2 ? "said0(() => run(1, 8, 0, [1, 1]));" : "said0(() => run(0, 0, 1, []));",
    'console.log(said.join(" ").slice(0, 1600));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${lists.indexOf(list)}--${loops.indexOf(loop)}--${skips.indexOf(skip)}--${deeds.indexOf(one)}--${deeds.indexOf(two)}--${afters.indexOf(after)}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
