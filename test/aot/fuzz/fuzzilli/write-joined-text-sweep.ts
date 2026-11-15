// Texts that are joined and then asked: the parts, times how they are joined, times what the text is asked, times how it grows, times the loop, times how the answers are kept, times the function around.
//
//   bun write-joined-text-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<part>--<part>--<joined>--<asked>--<grown>--<loop>--<kept>--<function>.mjs, .cjs or .ts
//   bun write-joined-text-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `i` counts, `p` is a text and `n` a number.
const parts: [name: string, text: string][] = [
  ["letter", "'a'"],
  ["words", "'one two'"],
  ["empty", "''"],
  ["wide", "'\\u00e9\\u4e00'"],
  ["pair", "'\\u{1F600}'"],
  ["half-pair", "'\\ud83d'"],
  ["index", "i"],
  ["number", "n"],
  ["fraction", "n / 2"],
  ["negative", "-i"],
  ["minus-zero", "-0"],
  ["large", "n * 1e21"],
  ["truth", "i > 1"],
  ["nothing", "undefined"],
  ["null", "null"],
  ["given", "p"],
  ["object", "held"],
  ["list", "[i, p]"],
  ["slice", "p.slice(i & 1)"],
  ["character", "p[i % 3]"],
  ["code", "String.fromCharCode(97 + i)"],
  ["nested", "`<${i}>`"],
  ["long", "long"],
  ["bigint", "10n ** 20n"],
];
// `A` and `B` are the parts; the text is `s`.
const joined: [name: string, text: string][] = [
  ["plus", "const s = '' + A + B;"],
  ["template", "const s = `${A}${B}`;"],
  ["between", "const s = `${A}-${B}`;"],
  ["added", "let s = '';\ns += A;\ns += B;"],
  ["concat", "const s = ''.concat(A, B);"],
  ["list", "const s = [A, B].join('');"],
  ["list-with-comma", "const s = [A, B, A].join(', ');"],
  ["three", "const s = '[' + A + ':' + B + ']';"],
  ["repeated", "const s = `${A}`.repeat(2) + B;"],
  ["padded", "const s = `${A}`.padStart(4, '.') + `${B}`.padEnd(3, '*');"],
  ["text-of", "const s = String(A) + String(B);"],
  ["front", "const s = B + ('' + A);"],
  ["kept-text", "const first = '' + A;\nconst s = first + B + first;"],
];
const asked: [name: string, text: string][] = [
  ["itself", "s"],
  ["length", "s.length"],
  ["index", "s.indexOf('a')"],
  ["index-of-part", "s.indexOf(`${B}`)"],
  ["last-index", "s.lastIndexOf('e')"],
  ["includes", "s.includes('1')"],
  ["starts", "s.startsWith(`${A}`)"],
  ["ends", "s.endsWith(`${B}`)"],
  ["code", "s.charCodeAt(i)"],
  ["character", "s[i] + s.at(-1)"],
  ["code-point", "s.codePointAt(0)"],
  ["slice", "s.slice(1, 4) + '|' + s.slice(-2)"],
  ["substring", "s.substring(3, 1)"],
  ["split", "s.split('').length + s.split('a').join('#')"],
  ["upper", "s.toUpperCase()"],
  ["trimmed", "s.trim().length"],
  ["replaced", "s.replace('a', 'XX') + s.replaceAll('o', '0')"],
  ["compared", "(s < 'one') + ' ' + (s === `${A}${B}`)"],
  ["spread", "[...s].length"],
  ["as-number", "+s"],
  ["json", "JSON.stringify(s)"],
  ["key", "({ [s]: i })[s] + Object.keys({ [s]: 1 })[0]"],
  ["in-set", "new Set([s, `${A}${B}`]).size"],
  ["locale", "s.localeCompare('one')"],
  ["normal", "s.normalize().length + s.isWellFormed()"],
  ["search", "s.search(/[a-e]\\d?/)"],
];
const grown: [name: string, text: string][] = [
  ["nothing", ""],
  ["onto-all", "all += s;"],
  ["in-front", "all = s + all;"],
  ["between", "all = all.slice(0, 4) + s + all.slice(4, 30);"],
  ["pushed", "pieces.push(s);\nall = pieces.join('');"],
  ["if-longer", "if (s.length > all.length) all = s;"],
  ["doubled", "all = (all + all + s).slice(0, 60);"],
];
// `STEP` in a turn.
const loops: [name: string, text: string][] = [
  ["for", "for (let i = 0; i < 4; i++) {\n  STEP\n}"],
  ["once", "{\n  const i = n | 0;\n  STEP\n}"],
  ["nested", "for (let k = 0; k < 2; k++) {\n  for (let i = 0; i < 3; i++) {\n    STEP\n  }\n}"],
  ["callback", "[0, 1, 2].forEach(i => {\n  STEP\n});"],
  ["many", "for (let i = 0; i < 20; i++) {\n  STEP\n}"],
  ["of", "for (const i of [3, 0.5, -1]) {\n  STEP\n}"],
];
const kept: [name: string, text: string][] = [
  ["pushed", "out.push(ANSWER);"],
  ["added", "sum += '' + (ANSWER) + ';';"],
  ["field", "box.v = ANSWER;\nout.push(box.v);"],
  ["counted", "const answer = ANSWER;\ntable.set(answer, (table.get(answer) ?? 0) + 1);"],
  ["returned", "out.push((() => ANSWER)());"],
];
// `BODY` is what is done with `p` and `n`.
const functions: [name: string, text: string][] = [
  ["function", "function run(p, n) {\n  BODY\n}"],
  ["arrow", "const run = (p, n) => {\n  BODY\n};"],
  ["generator", "function* steps(p, n) {\n  yield n;\n  BODY\n}\nconst run = (p, n) => [...steps(p, n)].length;"],
];
const total = parts.length ** 2 * joined.length * asked.length * grown.length * loops.length * kept.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const ask = pick(asked);
  const first = pick(parts);
  const join = pick(joined);
  const second = pick(parts);
  const keep = pick(kept);
  const loop = pick(loops);
  const grow = pick(grown);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const fill = (text: string) => text.replaceAll(/\b[AB]\b(?!')/g, letter => (letter === "A" ? first[1] : second[1]));
  const turn = `try {\n${indent(`${fill(join[1])}\n${grow[1] ? grow[1] + "\n" : ""}${keep[1].replace("ANSWER", fill(ask[1]))}`, "  ")}\n} catch (error) {\n  out.push(error.name);\n}`;
  const body = `let all = '';\nconst pieces = [];\n${within(loop[1], "STEP", turn)}\nout.push(all.length, all.slice(0, 40));`;
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    'let sum = "";',
    "const box = { v: 0 };",
    "const table = new Map();",
    "const held = { toString: () => 'h', valueOf: () => 7 };",
    'const long = "abcdefghij".repeat(3);',
    within(form[1], "BODY", body),
    "for (const [p, n] of [['abc', 1], ['x\\u00e9', 2.5], ['', -3]]) {",
    "  try {",
    "    run(p, n);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(JSON.stringify(out.map(String).join(" ").slice(0, 1500)), JSON.stringify(sum.slice(0, 500)), JSON.stringify([...table].slice(0, 20).map(String)));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${first[0]}--${second[0]}--${join[0]}--${ask[0]}--${grow[0]}--${loop[0]}--${keep[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
