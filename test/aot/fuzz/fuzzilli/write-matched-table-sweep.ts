// Tables of patterns that are tried one after the other, as routers and lexers do: how the patterns are held, times how one is tried, times how its groups are read, times what is made of them, times which patterns, times the texts, times what happens between, times the function around.
//
//   bun write-matched-table-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<held>--<tried>--<read>--<made>--<patterns>--<texts>--<between>--<function>.mjs, .cjs or .ts
//   bun write-matched-table-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// The patterns are the list `all`. `TRY` is what is done with `r` (a pattern), `name` and `s`; a break leaves the table.
const held: [name: string, text: string, loop: string][] = [
  ["list", "const table = all;", "let name = 0;\nfor (const r of table) {\n  name++;\n  TRY\n}"],
  [
    "counted",
    "const table = all;",
    "for (let name = 0; name < table.length; name++) {\n  const r = table[name];\n  TRY\n}",
  ],
  [
    "fields",
    "const table = all.map((re, at) => ({ re, name: 'n' + at }));",
    "for (const route of table) {\n  const { name } = route;\n  const r = route.re;\n  TRY\n}",
  ],
  ["pairs", "const table = all.map((re, at) => ['p' + at, re]);", "for (const [name, r] of table) {\n  TRY\n}"],
  ["map", "const table = new Map(all.map((re, at) => ['m' + at, re]));", "for (const [name, r] of table) {\n  TRY\n}"],
  [
    "object",
    "const table = Object.fromEntries(all.map((re, at) => ['o' + at, re]));",
    "for (const name in table) {\n  const r = table[name];\n  TRY\n}",
  ],
  [
    "instances",
    "class Layer {\n  constructor(re, at) {\n    this.re = re;\n    this.name = 'l' + at;\n  }\n}\nconst table = all.map((re, at) => new Layer(re, at));",
    "for (const layer of table) {\n  const name = layer.name;\n  const r = layer.re;\n  TRY\n}",
  ],
  ["one", "const [only] = all;", "for (let name = 0; name < 1; name++) {\n  const r = only;\n  TRY\n}"],
  [
    "either",
    "const [one, two = /q/] = all;",
    "for (let name = 0; name < 2; name++) {\n  const r = name ? two : one;\n  TRY\n}",
  ],
  [
    "given",
    "const table = all;",
    "for (let name = 0; name < table.length; name++) {\n  const r = choose(table, name);\n  TRY\n}",
  ],
  ["set", "const table = new Set(all);", "let name = 9;\nfor (const r of table) {\n  name--;\n  TRY\n}"],
  [
    "literals",
    "",
    "for (const [name, r] of [['x', /^(a+)(b)?/], ['y', /^(\\d)(\\w)?(-)?/], ['z', /^(\\s+)()/]]) {\n  TRY\n}",
  ],
];
// `m` is the answer.
const tried: [name: string, text: string][] = [
  ["exec", "const m = r.exec(s);\nif (!m) continue;"],
  ["exec-then", "let m;\nif (s != null) m = r.exec(s);\nif (!m) continue;"],
  ["match", "const m = s.match(r);\nif (!m) continue;"],
  ["assigned", "let m;\nif (!(m = r.exec(s))) continue;"],
  [
    "in-while",
    "let m;\nlet turns = 0;\nr.lastIndex = 0;\nwhile (turns++ < 1 && (m = r.exec(s))) count += m.length;\nm = r.exec(s);\nif (!m) continue;",
  ],
  ["by-helper", "const m = attempt(r, s);\nif (!m) continue;"],
  ["test-first", "if (!r.test(s)) continue;\nr.lastIndex = 0;\nconst m = r.exec(s);\nif (!m) continue;"],
  ["nullish", "const m = r.exec(s) ?? [];"],
  ["kept", "last = r.exec(s);\nif (!last) continue;\nconst m = last;"],
  ["all", "const [m] = [...s.matchAll(new RegExp(r.source, 'g'))];\nif (!m) continue;"],
  [
    "by-replace",
    "const m = [];\ns.replace(r, (...given) => {\n  for (const x of given) m.push(x);\n  return '';\n});\nif (m.length === 0) continue;",
  ],
];
// Puts what is read into `found`.
const reads: [name: string, text: string][] = [
  ["from-one", "for (let i = 1; i < m.length; i++) found.push(m[i]);"],
  ["from-zero", "for (let i = 0; i < m.length; i++) found.push(m[i]);"],
  ["if-there", "for (let i = 1; i < m.length; i++) {\n  if (m[i] !== undefined) found.push(m[i]);\n}"],
  ["if-truth", "for (let i = 0; i < m.length; i++) if (m[i]) found.push(m[i]);"],
  ["or", "for (let i = 1; i < m.length; i++) found.push(m[i] ?? '-');"],
  ["fixed-count", "for (let i = 0; i < 4; i++) found.push(m[i]);"],
  ["lengths", "for (let i = 1; i < m.length; i++) count += (m[i] ?? '').length;"],
  ["keyed", "for (let i = 1; i < m.length; i++) box['k' + i] = m[i];\nfound.push(JSON.stringify(box));"],
  [
    "named-by",
    "const keys = ['one', 'two', 'three'];\nfor (let i = 1; i < m.length; i++) {\n  const key = keys[i - 1];\n  if (m[i] !== undefined || !Object.hasOwn(box, key)) box[key] = m[i];\n}\nfound.push(JSON.stringify(box));",
  ],
  ["sliced", "found.push(...m.slice(1));"],
  ["destructured", "const [whole, one, two = 'none'] = m;\nfound.push(whole, one, two);"],
  ["fixed", "found.push(m[0], m[1], m[2]);"],
  ["place", "found.push(m[0], m.index, m.length);"],
  ["iterated", "for (const x of m) found.push(x);"],
  ["backwards", "for (let i = m.length - 1; i > 0; i--) found.push(m[i]);"],
  [
    "two-loops",
    "for (let i = 0; i < m.length; i++) count += m[i] === undefined ? 0 : 1;\nfor (let i = 0; i < m.length; i++) found.push(m[i]);",
  ],
  ["changed", "m[1] = 'changed';\nfor (let i = 0; i < m.length; i++) found.push(m[i]);"],
  ["converted", "for (let i = 1; i < m.length; i++) found.push(+m[i]);"],
  ["compared", "for (let i = 0; i < m.length; i++) if (m[i] === s[0] || m[i] > 'b') found.push(i, m[i]);"],
  ["called", "for (let i = 0; i < m.length; i++) found.push(decode(m[i]));"],
  ["each", "m.forEach((x, i) => found.push(i, x));"],
  [
    "groups",
    "for (const key in m.groups ?? {}) found.push(key, m.groups[key]);\nfor (let i = 0; i < m.length; i++) found.push(m[i]);",
  ],
];
const made: [name: string, text: string][] = [
  ["joined", "out.push(name + ':' + found.join('|'));\nbreak;"],
  ["shown", "out.push(name, found.map(show).join());"],
  ["cut", "out.push(name + show(found[0]));\ns = s.slice(m[0]?.length || 1);"],
  ["returned", "return out.push(name, found.map(show).join('/'));"],
  ["counted", "count += found.length;\nout.push(count);"],
  ["object", "out.push(JSON.stringify({ name, found }));\nbreak;"],
  ["stored", "kept.push(found);\nout.push(kept.length);"],
];
const patterns: [name: string, text: string][] = [
  ["routes", "[/^\\/a(?:\\/(\\w+))?(?:\\/(\\w+))?$/, /^\\/b\\/(\\d+)(\\.json)?$/, /^(.*)$/]"],
  ["tokens", "[/^(\\d+)(\\.\\d+)?/, /^([a-z]+)(\\()?/, /^(\\s+)()/]"],
  ["no-groups", "[/^a+/, /b/, /\\d/]"],
  ["many-groups", "[/(a)(b)?(c)?(d)?(\\/)?/, /^(\\/)(\\w)(\\d)?/]"],
  ["one", "[/^(\\w+)(?:=(\\w+))?(?:;(\\w+))?/]"],
  ["sticky", "[/(a)(b)?/y, /(\\/)(\\w)?/y, /(\\d)/y]"],
  ["global", "[/(\\w)(\\d)?/g, /(\\/)/g]"],
  ["named", "[/(?<first>\\w)(?<second>\\d)?/, /(?<first>\\/)/]"],
  ["made", "['(a)(b)?', '(\\\\d)(\\\\w)?', '(\\\\/)'].map(source => new RegExp(source))"],
  ["wide", "[/(\\p{L})(\\d)?/u, /([^a-z])(.)?/u]"],
  ["of-both", "[/(a)(b)?/, new RegExp('(\\\\d+)(x)?', 'i'), /(\\/)(a)?(\\/)?/]"],
];
const texts: [name: string, text: string][] = [
  ["paths", "['/a/one/two', '/a/one', '/a', '/b/12.json', '/b/3', '/c']"],
  ["tokens", "['12.5 foo( 7', 'bar 3.25', '7 x', '']"],
  ["short", "['a', 'ab', 'abc', 'b=c;d', '1']"],
  ["wide", "['\\u00e9a1', '\\u{1F600}b2', 'abcd/']"],
  ["parts", "'a1/b2/ab/7x'.split('/')"],
];
// Comes in front of every text; `turn` counts.
const between: [name: string, text: string][] = [
  ["nothing", ""],
  ["exec-stored-on-other", "if (turn === 2) other.exec = text => [text];"],
  [
    "exec-stored-on-own",
    "let turns = 0;\n  if (turn === 2) all[0].exec = text => (turns++ < 5 ? [text, 'own'] : null);",
  ],
  ["other-pattern", "count += /(x)(y)?/.exec('xx').length;"],
  ["last-index", "for (const r of all) r.lastIndex = 0;"],
  ["field", "all[0].fast = turn;"],
  ["legacy", "count += RegExp.$1.length;"],
];
// `BODY` is what is done with `s`.
const functions: [name: string, text: string][] = [
  ["function", "function run(s) {\n  BODY\n}"],
  ["arrow", "const run = s => {\n  BODY\n};"],
  [
    "method",
    "class Runner {\n  run(s) {\n    BODY\n  }\n}\nconst runner = new Runner();\nconst run = s => runner.run(s);",
  ],
  ["twice", "function run(s) {\n  for (let round = 0; round < 2; round++) {\n    BODY\n  }\n}"],
];
const total = held.length * tried.length * reads.length * made.length * patterns.length * texts.length * between.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const read = pick(reads);
  const hold = pick(held);
  const attempt = pick(tried);
  const pattern = pick(patterns);
  const product = pick(made);
  const text = pick(texts);
  const among = pick(between);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const turn = `${attempt[1]}\nconst found = [];\n${/\bbox\b/.test(read[1]) ? "const box = {};\n" : ""}${read[1]}\n${product[1]}`;
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : String(value).slice(0, 30));',
    "const out = [];",
    "const kept = [];",
    "let count = 0;",
    "let last = null;",
    `const all = ${pattern[1]};`,
    ...(/attempt\(/.test(attempt[1]) ? ["const attempt = (pattern, text) => pattern.exec(text);"] : []),
    ...(/choose\(/.test(hold[2]) ? ["const choose = (list, at) => list[at];"] : []),
    ...(/decode\(/.test(read[1])
      ? ["const decode = text => (typeof text === 'string' ? text.toUpperCase() : text);"]
      : []),
    ...(/other\./.test(among[1]) ? ["const other = { exec: null };"] : []),
    ...(hold[1] ? [hold[1]] : []),
    within(form[1], "BODY", within(hold[2], "TRY", turn)),
    "let turn = 0;",
    `for (const s of ${text[1]}) {`,
    ...(among[1] ? [`  ${among[1]}`] : []),
    "  turn++;",
    "  try {",
    "    run(s);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1500), count, kept.length);',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${hold[0]}--${attempt[0]}--${read[0]}--${product[0]}--${pattern[0]}--${text[0]}--${among[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
