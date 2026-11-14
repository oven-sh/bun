// Texts that are cleaned and cut by everyday patterns: the pattern, times what is done with it, times the text, times how the result is used, times how the pattern is held, times the loop, times the function around.
//
//   bun write-trimmed-text-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<pattern>--<deed>--<text>--<used>--<held>--<loop>--<function>.mjs, .cjs or .ts
//   bun write-trimmed-text-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const patterns: [name: string, text: string][] = [
  ["both-ends", "/^\\s+|\\s+$/g"],
  ["start", "/^\\s+/"],
  ["end", "/\\s+$/"],
  ["end-many", "/[\\s\\uFEFF\\xA0]+$/g"],
  ["start-many", "/^[\\s\\uFEFF\\xA0]+/"],
  ["trim", "/^[\\s\\uFEFF\\xA0]+|[\\s\\uFEFF\\xA0]+$/g"],
  ["spaces", "/\\s+/g"],
  ["space", "/\\s/g"],
  ["one-space", "/ /g"],
  ["slashes", "/\\/+/g"],
  ["last-slash", "/\\/$/"],
  ["first-slash", "/^\\//"],
  ["dashes", "/-/g"],
  ["upper", "/[A-Z]/g"],
  ["camel", "/-([a-z])/g"],
  ["kebab", "/([a-z])([A-Z])/g"],
  ["digits", "/\\d+/g"],
  ["not-word", "/[^\\w]+/g"],
  ["quotes", "/^['\"]|['\"]$/g"],
  ["lines", "/\\r?\\n/g"],
  ["tags", "/<[^>]*>/g"],
  ["amp", "/[&<>\"']/g"],
  ["extension", "/\\.[^.]+$/"],
  ["braces", "/\\{(\\w+)\\}/g"],
  ["comma", "/\\s*,\\s*/"],
  ["zeros", "/^0+(?=\\d)/"],
  ["thousands", "/\\B(?=(\\d{3})+$)/g"],
  ["escape", "/[.*+?^${}()|[\\]\\\\]/g"],
  ["word-start", "/\\b\\w/g"],
  ["comment", "/\\/\\*[^]*?\\*\\//g"],
  ["empty", "/(?:)/g"],
  ["text", "'a'"],
];
// `s` is the text and P the pattern; the result is `t`.
const deeds: [name: string, text: string][] = [
  ["removed", "const t = s.replace(P, '');"],
  ["to-dash", "const t = s.replace(P, '-');"],
  ["to-group", "const t = s.replace(P, '[$1]');"],
  ["to-whole", 'const t = s.replace(P, "<$&|$`|$\'>");'],
  [
    "by-function",
    "const t = s.replace(P, (all, one) => (one === undefined ? all.length : String(one).toUpperCase()));",
  ],
  ["by-upper", "const t = s.replace(P, all => all.toUpperCase());"],
  ["by-lower", "const t = s.replace(P, (all, ...others) => '_' + all.toLowerCase());"],
  ["by-table", "const t = s.replace(P, c => table[c] ?? c);"],
  ["by-place", "const t = s.replace(P, (...all) => all[all.length - 2] + ':');"],
  ["split", "const t = s.split(P).join('|');"],
  ["split-filtered", "const t = s.split(P).filter(Boolean).join('|');"],
  ["split-first", "const [t = 'none'] = s.split(P, 1);"],
  ["match-count", "const t = String((s.match(P) ?? []).length);"],
  ["matches", "const t = String(s.match(P));"],
  ["search", "const t = String(s.search(P));"],
  ["twice", "const t = s.replace(P, '').replace(P, '+');"],
  ["chain", "const t = s.replace(P, '').trim().split(' ').pop();"],
  ["trimmed", "const t = s.trim().replace(P, '').trimEnd();"],
  ["test", "const t = String(typeof P === 'string' ? s.includes(P) : new RegExp(P.source).test(s));"],
];
const texts: [name: string, text: string][] = [
  ["spaces", "'  ab  '"],
  ["many", "' \\t\\n a  b\\u00a0c \\r\\n '"],
  ["path", "'/a//b/c.tar.gz/'"],
  ["names", "'fooBar-baz-Qux_1'"],
  ["numbers", "'0012345678.50'"],
  ["markup", "'<p class=\"x\">a & b</p>'"],
  ["template", "'{a} and {b1}{c}'"],
  ["list", "'a , b,c ,, d'"],
  ["lines", "'one\\r\\ntwo\\n/* x\\ny */three'"],
  ["empty", "''"],
  ["only-spaces", "'    '"],
  ["wide", "' \\u{1F600}\\u00e9a\\u4e00 b '"],
  ["quoted", "\"'it is'\""],
  ["odd", "'a.b*c+d?[e](f)$^'"],
  ["long", "' word-Word 12 '.repeat(6)"],
  ["given", "' ' + given + ' '"],
];
const used: [name: string, text: string][] = [
  ["kept", "out.push(t);"],
  ["length", "out.push(t.length, t[0]);"],
  ["compared", "out.push(t === s, t < 'b');"],
  ["key", "table[t] = (table[t] ?? 0) + 1;"],
  ["added", "all += t + ';';"],
  ["number", "out.push(+t, parseInt(t));"],
  ["again", "const u = t.replace(P, '#');\nout.push(u);"],
  ["in-list", "pieces.push(...t.split('-'));"],
];
// P becomes the name of what is declared.
const held: [name: string, declared: string, name_: string][] = [
  ["literal", "", ""],
  ["outside", "const pattern = LITERAL;", "pattern"],
  ["in-list", "const patterns = [/q/g, LITERAL];", "patterns[1]"],
  ["in-field", "const box = { re: LITERAL };", "box.re"],
  ["static", "class Own {\n  static re = LITERAL;\n}", "Own.re"],
];
// `STEP` in a turn.
const loops: [name: string, text: string][] = [
  ["once", "{\n  const s = TEXT;\n  STEP\n}"],
  ["of-list", "for (const s of [TEXT, 'a-b c', '', TEXT + '/']) {\n  STEP\n}"],
  ["counted", "for (let i = 0; i < 5; i++) {\n  const s = TEXT + (i & 1 ? i : ' ');\n  STEP\n}"],
  ["mapped", "[TEXT, ' x '].map(s => {\n  STEP\n});"],
  ["grows", "let s = TEXT;\nfor (let i = 0; i < 4; i++) {\n  STEP\n  s = (t + ' ' + i).slice(0, 80);\n}"],
];
const functions: [name: string, text: string][] = [
  ["function", "function run(given) {\n  BODY\n}"],
  ["arrow", "const run = given => {\n  BODY\n};"],
  ["method", "class Runner {\n  run(given) {\n    BODY\n  }\n}\nconst run = given => new Runner().run(given);"],
];
const total = patterns.length * deeds.length * texts.length * used.length * held.length * loops.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const deed = pick(deeds);
  const pattern = pick(patterns);
  const text = pick(texts);
  const use = pick(used);
  const hold = pick(held);
  const loop = pick(loops);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const literal = pattern[1];
  const name = hold[2] || literal;
  const step = `${deed[1]}\n${use[1]}`.split(/\bP\b/).join(name);
  const body = within(loop[1], "STEP", step).split("TEXT").join(text[1]);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    "const pieces = [];",
    'let all = "";',
    'const table = { "&": "&amp;", "<": "&lt;", " ": "_" };',
    ...(hold[1] ? [hold[1].split("LITERAL").join(literal)] : []),
    within(form[1], "BODY", body),
    "for (const given of ['x y', 7, '\\u00e9-1']) {",
    "  try {",
    "    run(given);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(JSON.stringify(out.map(String).join(" ").slice(0, 1500)), JSON.stringify(all.slice(0, 600)), JSON.stringify(pieces).slice(0, 400), JSON.stringify(table).slice(0, 400));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${pattern[0]}--${deed[0]}--${text[0]}--${use[0]}--${hold[0]}--${loop[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
