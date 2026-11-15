// The least programs of a text that a table was asked with: each way to make the text, times each table and what it answers, times each use of the answer afterwards.
//
//   bun write-asked-text-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<maker>--<table>--<use>--<base>--<place>.mjs, .cjs or .ts
//   bun write-asked-text-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `base` is a text, `i` a number; each gives the key `k`.
const makers: string[] = [
  "base",
  "base.slice(i, i + 3)",
  "base.substring(1, 4 + i)",
  "base.split(' ')[i]",
  "base.split('')[i]",
  "base[i]",
  "base.charAt(i)",
  "base.at(-1 - i)",
  "base + i",
  "`${base}-${i}`",
  "base + base",
  "base.toUpperCase()",
  "base.toLowerCase()",
  "base.trim()",
  "base.replace('a', 'b')",
  "base.replace(/[aeiou]/g, '')",
  "base.padStart(12 + i, '*')",
  "base.repeat(i)",
  "base.match(/\\w+/)?.[0]",
  "/(\\w)(\\w*)/.exec(base)?.[2]",
  "[base, i].join('/')",
  "[...base][i]",
  "String.fromCharCode(97 + i)",
  "String.fromCodePoint(0x1f600 + i)",
  "String(i)",
  "i",
  "i + 0.5",
  "JSON.parse(JSON.stringify({ t: base })).t",
  "JSON.parse('[\"k' + i + '\"]')[0]",
  "Object.keys({ [base]: 1 })[0]",
  "encodeURIComponent(base)",
  "base.normalize()",
  "base.concat(i, 'z')",
  "base.split(',').pop()",
  "base.slice(0, -1 - i)",
  "base.slice(i)",
  "base.slice(i).slice(1)",
  "(base + 'tail').slice(2, 5)",
  "[...base.matchAll(/./gu)][i]?.[0]",
  "new String(base).valueOf()",
];
// Each asks a table with `k` and leaves an answer in `v`.
const tables: string[] = [
  "const t = new Set([base, 'a', 'bet', 1]);\nconst v = t.has(k) ? k : 'no';",
  "const t = new Set();\nt.add(k);\nconst v = t.has(k) ? k : 'no';",
  "const t = new Set();\nfor (const c of base) t.add(c);\nconst v = t.has(k) ? k : 'no';",
  "const t = new Map([[base, 'whole'], ['a', 1]]);\nconst v = t.get(k) ?? k;",
  "const t = new Map();\nt.set(k, i);\nt.set(k, (t.get(k) ?? 0) + 1);\nconst v = t.get(k);",
  "const t = new Map();\nt.set(k, k);\nconst v = t.get(k);",
  "const t = new Map();\nconst list = t.get(k) ?? [];\nlist.push(k);\nt.set(k, list);\nconst v = t.get(k)[0];",
  "const t = { a: 1, bet: 'b' };\nconst v = t[k] ?? k;",
  "const t = {};\nt[k] = k;\nconst v = t[k];",
  "const t = {};\nt[k] = (t[k] ?? 0) + 1;\nconst v = t[k];",
  "const t = Object.create(null);\nt[k] = [k];\nconst v = t[k][0];",
  "const t = {};\nt[k] = 1;\ndelete t[k];\nconst v = k in t ? 'still' : k;",
  "const t = { [k]: k };\nconst v = Object.keys(t)[0];",
  "const t = { [k]: i };\nlet v = 'none';\nfor (const n in t) v = n;",
  "const t = [base, 'a', k];\nconst v = t[t.indexOf(k)];",
  "const t = [base, 'a', 1];\nconst v = t.includes(k) ? k : 'out';",
  "let v = k;\nswitch (k) {\n  case 'a':\n    v = 'first';\n    break;\n  case base:\n    v = 'whole';\n    break;\n  case 1:\n    v = 'one';\n}",
  "const v = k === base ? 'same' : k;",
  "const t = new Set([base, 'a']);\nt.delete(k);\nconst v = t.size > 1 ? k : t.size;",
  "const t = new Map([[k, () => k]]);\nconst v = t.get(k)();",
  "const t = new Map([[k, { name: k }]]);\nconst v = t.get(k).name;",
  "const t = new Set([k]);\nconst [v] = t;",
  "const t = new Map([[k, k]]);\nlet v;\nfor (const [a, b] of t) v = a === b ? a : 'apart';",
  "const t = new Map([[k, 1]]);\nconst v = [...t.keys()].join('+');",
  "const t = Object.groupBy([k, base], x => x);\nconst v = t[k]?.[0];",
  "const t = Map.groupBy([k, 'a'], x => x);\nconst v = t.get(k)?.[0];",
  "const t = Object.fromEntries([[k, k]]);\nconst v = t[k];",
  "const t = new Set([k]).union(new Set([base]));\nconst v = t.has(k) ? k : 0;",
  "const t = JSON.parse(JSON.stringify({ [k]: k }));\nconst v = t[k];",
  "const t = new Map();\nconst v = t.has(k) ? t.get(k) : (t.set(k, k), k);",
  "const t = known;\nconst v = t.has(k) ? k : (t.add(k), 'new');",
  "const t = counts;\nt[k] = (t[k] | 0) + 1;\nconst v = t[k] > 1 ? k : t[k];",
];
const uses: string[] = [
  "say(typeof v);",
  "say(typeof v === 'function' ? 'fn' : typeof v === 'string' ? 'str' : 'other');",
  "say(v instanceof RegExp || typeof v === 'function' ? 'branch' : 'plain');",
  "say(Array.isArray(v), v instanceof Object);",
  "say(typeof v === 'object' && v !== null);",
  "say(v === k);",
  "say(v == base, v != k);",
  "say(v?.length);",
  "say(v?.[0]);",
  "say(v ? 'yes' : 'no');",
  "say(v + 1);",
  "say(`<${v}>`);",
  "say(v < base, v > k);",
  "say(String(v).charCodeAt(0));",
  "say(v?.at?.(-1));",
  "say(v?.startsWith?.('a'));",
  "say(v?.split?.('').length);",
  "say([v].includes(k));",
  "say(new Set([v]).has(k));",
  "say(known.has(v));",
  "say(Object.is(v, k));",
  "say(JSON.stringify(v));",
  "say([v, k, base].sort().join());",
  "say(typeof v?.then);",
  "say(v && v.name);",
  "say(Number(v) || 0);",
  "say(v?.toUpperCase?.());",
  "say(v?.slice?.(1));",
  "say(v?.slice?.(1) === k?.slice?.(1));",
  "say(Symbol.for(String(v)) === Symbol.for(String(k)));",
  "say(v?.constructor?.name);",
  "say(typeof v === 'string' && /^\\w+$/.test(v));",
  "said.push(v);",
  "const { length } = v ?? '';\nsay(length);",
  "say([...String(v)].length);",
  "say(typeof v === typeof k);",
];
const bases: [name: string, text: string][] = [
  ["ordinary", "'alpha beta,gamma'"],
  ["short", "'a'"],
  ["pair", "'ab'"],
  ["long", "'the quick brown fox jumps over the lazy dog '.repeat(8)"],
  ["latin", "'caf\\u00e9 na\\u00efve'"],
  ["wide", "'\\u2192 \\u00e4 \\ud83d\\ude00 z'"],
  ["digits", "'1234567'"],
  ["empty", "''"],
  ["handed", "given"],
  ["index", "'0'"],
  ["name", "'constructor length'"],
];
const places: [name: string, text: string][] = [
  ["in-loop", "const base = BASE;\nfor (let i = 0; i < n; i++) {\n  const k = MAKER;\n  BODY\n}"],
  ["whole-loop", "for (let i = 0; i < n; i++) {\n  const base = BASE;\n  const k = MAKER;\n  BODY\n}"],
  [
    "helper",
    "const base = BASE;\nconst make = i => MAKER;\nfor (let i = 0; i < n; i++) {\n  const k = make(i);\n  BODY\n}",
  ],
  ["once", "const base = BASE;\nconst i = 1;\nconst k = MAKER;\nBODY"],
  ["each", "const base = BASE;\n[0, 1, 2].forEach(i => {\n  const k = MAKER;\n  BODY\n});"],
  [
    "kept",
    "const base = BASE;\nconst keys = [];\nfor (let i = 0; i < n; i++) keys.push(MAKER);\nfor (let i = 0; i < n; i++) {\n  const k = keys[i];\n  BODY\n}",
  ],
];
const total = makers.length * tables.length * uses.length * bases.length * places.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 1_900_801;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const maker = pick(makers);
  const table = pick(tables);
  const use = pick(uses);
  const base = pick(bases);
  const place = pick(places);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const put = (text: string, hole: string, part: string) => text.replaceAll(hole, () => part);
  const inner = `${table}\n${use}`;
  const all = inner + maker;
  const body = within(put(put(place[1], "BASE", base[1]), "MAKER", maker), "BODY", inner);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const said = [];",
    'const tell = v => (typeof v === "function" ? "function" : Object.is(v, -0) ? "-0" : Array.isArray(v) ? "list" + v.length : typeof v === "object" && v ? "object" : String(v).slice(0, 24));',
    'const say = (...values) => void said.push(values.map(tell).join(":"));',
    ...(/\bknown\b/.test(all) ? ["const known = new Set(['a', 'bet']);"] : []),
    ...(/\bcounts\b/.test(all) ? ["const counts = {};"] : []),
    `function run(given, n) {\n${indent(body, "  ")}\n}`,
    "function said0(of) {\n  try {\n    of();\n  } catch (error) {\n    say(error.name);\n  }\n}",
    "said0(() => run('handed text', 4));",
    "said0(() => run('b', 3));",
    'console.log(said.map(tell).join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${makers.indexOf(maker)}--${tables.indexOf(table)}--${uses.indexOf(use)}--${base[0]}--${place[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
