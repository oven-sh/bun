// Patterns whose steps are replaced: the pattern, times what is replaced, times on what it is replaced and when, times the operation, times how its answer is read, times the text, times the function around.
//
//   bun write-pattern-protocol-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<pattern>--<replaced>--<moment>--<operation>--<read>--<text>--<function>.mjs, .cjs or .ts
//   bun write-pattern-protocol-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const patterns: [name: string, text: string][] = [
  ["groups", "/(a)(b)?/"],
  ["global", "/(a)(b)?/g"],
  ["sticky", "/a(b)?/y"],
  ["named", "/(?<first>a)(?<second>b)?/"],
  ["made", "new RegExp('(a)(b)?', flags)"],
  ["indices", "/(a)(b)?/d"],
  ["unicode", "/(a)(b)?/u"],
  ["plain", "/a/"],
  ["either", "/a|b/g"],
  ["of-class", "new Pattern('(a)(b)?', 'g')"],
  ["anchored", "/^(a+)(.*)$/"],
];
// What stands in place of a member of `r`; `R` is what it is put on.
const replaced: [name: string, text: string][] = [
  ["nothing", "R;"],
  ["exec-own-list", "let turns = 0;\nR.exec = () => (turns++ < 7 ? [7, 8, 9] : null);"],
  ["exec-of-numbers", "let turns = 0;\nR.exec = text => (turns++ < 5 ? [text.length, 0.5, , 3] : null);"],
  ["exec-counts", "let turns = 0;\nR.exec = () => (turns++ < 2 ? ['a', turns] : null);"],
  ["exec-null", "R.exec = () => null;"],
  ["exec-object", "let turns = 0;\nR.exec = () => (++turns % 4 ? { 0: 'o', 1: 'p', index: 1, length: 2 } : null);"],
  [
    "exec-calls-own",
    "const own = RegExp.prototype.exec;\nR.exec = function (text) {\n  return own.call(this, text + 'ab');\n};",
  ],
  [
    "exec-changes-answer",
    "const own = RegExp.prototype.exec;\nR.exec = function (text) {\n  const answer = own.call(this, text);\n  if (answer) answer[1] = 5;\n  return answer;\n};",
  ],
  [
    "exec-shortens",
    "const own = RegExp.prototype.exec;\nR.exec = function (text) {\n  const answer = own.call(this, text);\n  if (answer) answer.length = 1;\n  return answer;\n};",
  ],
  ["exec-throws", "R.exec = () => {\n  throw new TypeError('e');\n};"],
  ["exec-number", "R.exec = () => 5;"],
  ["test", "R.test = () => 'tested';"],
  ["symbol-replace", "Object.defineProperty(R, Symbol.replace, { value: () => 'replaced', configurable: true });"],
  ["symbol-match", "Object.defineProperty(R, Symbol.match, { value: () => ['m', 1], configurable: true });"],
  ["symbol-match-all", "Object.defineProperty(R, Symbol.matchAll, { value: () => [['x', 2]], configurable: true });"],
  ["symbol-split", "Object.defineProperty(R, Symbol.split, { value: () => ['s', 't'], configurable: true });"],
  ["symbol-search", "Object.defineProperty(R, Symbol.search, { value: () => 42, configurable: true });"],
  ["flags", "Object.defineProperty(R, 'flags', { get: () => '', configurable: true });"],
  ["global-flag", "Object.defineProperty(R, 'global', { value: false, configurable: true });"],
  ["last-index", "r.lastIndex = 1;"],
  ["last-index-object", "r.lastIndex = { valueOf: () => 1 };"],
  ["last-index-read-only", "Object.defineProperty(r, 'lastIndex', { writable: false });"],
  ["constructor", "R.constructor = function () {\n  return /b/g;\n};"],
  ["not-a-pattern", "Object.defineProperty(r, Symbol.match, { value: false, configurable: true });"],
  ["frozen", "Object.freeze(r);"],
];
// What `R` is, and when the change comes: `CHANGE` is it, `RUN` is the turn. `k` counts.
const moments: [name: string, on: string, text: string][] = [
  ["own-first", "r", "CHANGE\nfor (let k = 0; k < 3; k++) {\n  RUN\n}"],
  ["own-between", "r", "for (let k = 0; k < 6; k++) {\n  if (k === 3) {\n    CHANGE\n  }\n  RUN\n}"],
  [
    "own-in-a-call",
    "r",
    "const change = () => {\n  CHANGE\n};\nfor (let k = 0; k < 4; k++) {\n  RUN\n  if (k === 1) change();\n}",
  ],
  [
    "above",
    "above",
    "const above = Object.create(RegExp.prototype);\nObject.setPrototypeOf(r, above);\nCHANGE\nfor (let k = 0; k < 3; k++) {\n  RUN\n}",
  ],
  [
    "above-between",
    "above",
    "const above = Object.create(RegExp.prototype);\nObject.setPrototypeOf(r, above);\nfor (let k = 0; k < 6; k++) {\n  RUN\n  if (k === 2) {\n    CHANGE\n  }\n}",
  ],
  ["once", "r", "const k = 0;\nCHANGE\n{\n  RUN\n}"],
  ["of-caller", "r", "for (let k = 0; k < 3; k++) {\n  if (k === given) {\n    CHANGE\n  }\n  RUN\n}"],
  ["behind", "r", "for (let k = 0; k < 3; k++) {\n  RUN\n}\nCHANGE\nconst k = 9;\n{\n  RUN\n}"],
];
// `r` is the pattern and `s` the text; the answer is `m`.
const operations: [name: string, text: string][] = [
  ["exec", "const m = r.exec(s);"],
  ["match", "const m = s.match(r);"],
  ["test", "const m = r.test(s);"],
  ["match-all", "const m = [...s.matchAll(r)];"],
  ["replace", "const m = s.replace(r, 'x');"],
  ["replace-by-function", "const m = s.replace(r, (...all) => all.length);"],
  ["replace-all", "const m = s.replaceAll(r, '[$1]');"],
  ["split", "const m = s.split(r);"],
  ["split-some", "const m = s.split(r, 2);"],
  ["search", "const m = s.search(r);"],
  ["by-symbol", "const m = r[Symbol.match](s);"],
  ["called", "const m = RegExp.prototype.test.call(r, s);"],
  ["exec-loop", "let m = null;\nfor (let turn = 0, found; turn < 4 && (found = r.exec(s)); turn++) m = found;"],
  ["exec-asked", "const m = r.exec?.(s);"],
  ["found", "const { exec } = r;\nconst m = exec.call(r, s);"],
];
const reads: [name: string, text: string][] = [
  ["shown", "out.push(show(m));"],
  ["first", "out.push(show(m?.[0]));"],
  ["second", "out.push(show(m?.[1]));"],
  ["third", "out.push(show(m?.[2]));"],
  ["by-index", "for (let i = 0; m && i < m.length; i++) out.push(show(m[i]));"],
  ["indexed-fixed", "for (let i = 0; i < 4; i++) out.push(show(m?.[i]));"],
  ["place", "out.push(show(m?.index), show(m?.input));"],
  ["groups", "out.push(show(m?.groups?.first), show(m?.groups?.second));"],
  ["length", "out.push(show(m?.length));"],
  ["destructured", "const [all, one = 'none', two] = m ?? [];\nout.push(show(all), show(one), show(two));"],
  ["iterated", "if (typeof m === 'object') for (const x of m ?? []) out.push(show(x));"],
  ["truth", "out.push(m ? 'yes' : 'no');"],
  ["typed", "out.push(typeof m, Array.isArray(m));"],
  ["numbers", "out.push(show(+m?.[1]), show(m?.[0] + 1));"],
  ["after", "out.push(show(r.lastIndex), show(m));"],
  ["spread", "out.push(show([...(Object(m)[Symbol.iterator] ? m : [])].join('/')));"],
];
const texts: [name: string, text: string][] = [
  ["several", "'xabab a'"],
  ["starts", "'ab'"],
  ["none", "'zzz'"],
  ["empty", "''"],
  ["wide", "'\\u{1F600}aab'"],
  ["number", "String(given) + 'aba'"],
];
// `BODY` is what is done with `given`.
const functions: [name: string, text: string][] = [
  ["function", "function run(given, flags) {\n  BODY\n}"],
  ["arrow", "const run = (given, flags) => {\n  BODY\n};"],
  ["pattern-outside", "function run(given, flags) {\n  BODY\n}"],
  [
    "method",
    "class Runner {\n  run(given, flags) {\n    BODY\n  }\n}\nconst run = (given, flags) => new Runner().run(given, flags);",
  ],
];
const total = patterns.length * replaced.length * moments.length * operations.length * reads.length * texts.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const operation = pick(operations);
  const change = pick(replaced);
  const read = pick(reads);
  const moment = pick(moments);
  const pattern = pick(patterns);
  const text = pick(texts);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const isOutside = form[0] === "pattern-outside" && !/flags/.test(pattern[1]);
  const declared = `const r = ${pattern[1]};`;
  const turn = `try {\n${indent(`${operation[1]}\n${read[1]}`, "  ")}\n} catch (error) {\n  out.push(error.name);\n}`;
  const body = [
    ...(isOutside ? [] : [declared]),
    `const s = ${text[1]};`,
    within(within(moment[2], "RUN", turn), "CHANGE", change[1].replaceAll(/\bR\b/g, moment[1])),
  ].join("\n");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + value.map(show).join("|") + "]" : typeof value === "object" && value ? "{" + Object.keys(value).join("|") + "}" : String(value).slice(0, 30));',
    "const out = [];",
    ...(/Pattern/.test(pattern[1])
      ? [
          "class Pattern extends RegExp {\n  exec(text) {\n    const answer = super.exec(text);\n    if (answer) answer.mine = 1;\n    return answer;\n  }\n}",
        ]
      : []),
    ...(isOutside ? [declared] : []),
    within(form[1], "BODY", body),
    "for (const [given, flags] of [[0, 'g'], [2, ''], [1, 'y']]) {",
    "  try {",
    "    run(given, flags);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1500));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${pattern[0]}--${change[0]}--${moment[0]}--${operation[0]}--${read[0]}--${text[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
