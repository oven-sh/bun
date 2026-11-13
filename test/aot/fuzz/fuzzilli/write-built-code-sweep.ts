// Functions made out of texts that are put together from tables: the table, times how the text is put together, times how it becomes a function, times who changes the table, times when, times what is called with what, times the loop, times the function around.
//
//   bun write-built-code-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<table>--<text>--<made>--<changed>--<moment>--<called>--<loop>--<function>.cjs or .mjs
//   bun write-built-code-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `rows` holds rows of a sign and a name; `row` is one.
const tables: [name: string, text: string][] = [
  ["literal", "const rows = [['+', 'add'], ['-', 'sub'], ['*', 'mul']];"],
  ["var", "var rows = [['+', 'add'], ['-', 'sub']];"],
  ["assigned", "let rows;\nrows = [['+', 'add'], ['*', 'mul']];"],
  ["pushed", "const rows = [];\nfor (const sign of ['+', '-']) rows.push([sign, 'f']);"],
  ["mapped", "const rows = ['+', '-', '*'].map((sign, at) => [sign, 'f' + at]);"],
  ["split", "const rows = '+ add,- sub'.split(',').map(part => part.split(' '));"],
  ["entries", "const rows = Object.entries({ '+': 'add', '-': 'sub' });"],
  ["outside", "const rows = shared;"],
  ["given", "const rows = given;"],
  ["frozen", "const rows = Object.freeze([Object.freeze(['+', 'add']), Object.freeze(['-', 'sub'])]);"],
  ["spread", "const base = [['+', 'add']];\nconst rows = [...base, ['-', 'sub']];"],
  ["of-map", "const rows = [...new Map([['+', 'add'], ['-', 'sub']])];"],
];
// The code of a function of a and b.
const texts: [name: string, text: string][] = [
  ["plus", "'(function ' + row[1] + '(a, b) { return a ' + row[0] + ' b; })'"],
  ["template", "`(function ${row[1]}(a, b) { return a ${row[0]} b; })`"],
  ["replaced", "'(function (a, b) { return a # b; })'.replace('#', row[0])"],
  ["replaced-by-function", "'(function (a, b) { return a # b; })'.replace(/#/g, () => row[0])"],
  ["joined", "['(function (a, b) { return a', row[0], 'b; })'].join(' ')"],
  ["arrow", "`((a, b) => a ${row[0]} b)`"],
  ["concat", "'(function (a, b) { return a '.concat(row[0], ' b; })')"],
  ["chosen", "row[0] === '+' ? '((a, b) => a + b)' : '((a, b) => a - b)'"],
  ["with-closure", "`((a, b) => a ${row[0]} b + outer)`"],
  ["helper", "write(row)"],
  ["numbered", "`((a, b) => (a ${row[0]} b) * ${at + 1})`"],
];
// T is the text; the function is `made`.
const makings: [name: string, text: string][] = [
  ["eval", "const made = eval(T);"],
  ["indirect", "const made = (0, eval)(T.replace(' + outer', ''));"],
  ["new-function", "const made = new Function('a', 'b', 'return ' + T.replace(' + outer', '') + '(a, b);');"],
  ["function", "const made = Function('return ' + T.replace(' + outer', ''))();"],
  ["eval-kept", "const text = T;\nconst made = eval(text);"],
  ["eval-var", "eval('var put = ' + T);\nconst made = put;"],
  ["eval-in-arrow", "const made = (() => eval(T))();"],
  ["cached", "const made = (cache[T] ??= eval(T));"],
];
// What another does to the table.
const changed: [name: string, text: string][] = [
  ["nothing", "seen++;"],
  ["sign", "rows[0][0] = swap('-');"],
  ["pushed", "rows.push([swap('%'), 'rem']);"],
  ["popped", "rows.pop();"],
  ["row", "rows[0] = [swap('&'), 'and'];"],
  ["by-helper", "alter(rows);"],
  ["reversed", "rows.reverse();"],
  ["length", "rows.length = 1;"],
  ["sorted", "rows.sort((x, y) => (x[0] < y[0] ? -1 : 1));"],
  ["replace-replaced", "seen += '+'.replace(/\\+/, '-').length;"],
];
// CHANGE is the change and USE the loop over the table.
const moments: [name: string, text: string][] = [
  ["before", "CHANGE\nUSE"],
  ["between", "USE\nCHANGE\nUSE"],
  ["in-callback", "[1].forEach(function () {\n  CHANGE\n});\nUSE"],
  [
    "kept-callback",
    "const kept = [];\nconst keeper = { forEach: call => kept.push(call) };\nkeeper.forEach(() => {\n  CHANGE\n});\nfor (const call of kept) call();\nUSE",
  ],
  ["by-name", "(function self(n) {\n  if (n) self(n - 1);\n  else {\n    CHANGE\n  }\n})(2);\nUSE"],
  ["never", "const unused = () => {\n  CHANGE\n};\nUSE\nseen += typeof unused === 'function' ? 1 : 0;"],
  ["in-turn", "for (let round = 0; round < 2; round++) {\n  USE\n  if (round === 0) {\n    CHANGE\n  }\n}"],
  ["caught", "try {\n  CHANGE\n} catch (error) {\n  out.push(error.name);\n}\nUSE"],
];
const called: [name: string, text: string][] = [
  ["numbers", "out.push(show(made(7, 3)));"],
  ["texts", "out.push(show(made('7', '3')));"],
  ["several", "for (let i = 0; i < 3; i++) out.push(show(made(i, i + 0.5)));"],
  ["summed", "sum += made(at, 2);"],
  ["name", "out.push(made.name, made.length, show(made(1, 2)));"],
  ["kept", "functions.push(made);"],
  ["by-table", "byName[row[1]] = made;"],
  ["callback", "out.push(show([1, 2, 3].reduce(made)));"],
];
// MAKE makes and calls.
const loops: [name: string, text: string][] = [
  ["of", "{\n  let at = 0;\n  for (const row of rows) {\n    MAKE\n    at++;\n  }\n}"],
  ["counted", "for (let at = 0; at < rows.length; at++) {\n  const row = rows[at];\n  MAKE\n}"],
  ["callback", "rows.forEach((row, at) => {\n  MAKE\n});"],
  ["first", "{\n  const at = 0;\n  const [row] = rows;\n  MAKE\n}"],
];
const functions: [name: string, text: string][] = [
  ["function", "function run(given, outer) {\n  BODY\n}"],
  ["top", "BLOCK"],
  ["arrow", "const run = (given, outer) => {\n  BODY\n};"],
];
const total = tables.length * texts.length * makings.length * changed.length * moments.length * called.length * loops.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const text = pick(texts);
  const change = pick(changed);
  const table = pick(tables);
  const moment = pick(moments);
  const making = pick(makings);
  const use = pick(called);
  const loop = pick(loops);
  const form = pick(functions);
  const isCommon = cell % 2 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const make = `try {\n${indent(`${making[1].replaceAll(/\bT\b/g, () => `(${text[1]})`)}\n${use[1]}`, "  ")}\n} catch (error) {\n  out.push(error.name);\n}`;
  const work = `${table[1]}\n${within(within(moment[1], "USE", within(loop[1], "MAKE", make)), "CHANGE", change[1])}\nout.push(functions.map(made => show(made(5, 2))).join(), Object.keys(byName).join('/'));`;
  const lines = [
    'const show = value => (Object.is(value, -0) ? "-0" : String(value).slice(0, 20));',
    "const out = [];",
    "let seen = 0;",
    "let sum = 0;",
    "const functions = [];",
    "const byName = {};",
    "const cache = {};",
    "const swap = sign => [sign, sign][Date.now() > 5 ? 1 : 0];",
    "const shared = [['+', 'add'], ['-', 'sub']];",
    ...(/write\(/.test(text[1]) ? ["const write = row => '((a, b) => a ' + row[0] + ' b)';"] : []),
    ...(/alter\(/.test(change[1]) ? ["const alter = list => {\n  list[0][0] = swap('/');\n};"] : []),
    ...(form[0] === "top"
      ? [
          "{\n  const given = [['*', 'mul'], ['+', 'add']];\n  const outer = 1;\n  try {",
          indent(work, "    "),
          "  } catch (error) {\n    out.push(error.name);\n  }\n}",
        ]
      : [
          within(form[1], "BODY", work),
          "for (const outer of [1, 0.5]) {",
          "  try {",
          "    run([['*', 'mul'], ['+', 'add']], outer);",
          "  } catch (error) {",
          "    out.push(error.name);",
          "  }",
          "}",
        ]),
    'console.log(out.join(" ").slice(0, 1500), sum);',
  ];
  return {
    name: `${table[0]}--${text[0]}--${making[0]}--${change[0]}--${moment[0]}--${use[0]}--${loop[0]}--${form[0]}.${isCommon ? "cjs" : "mjs"}`,
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
