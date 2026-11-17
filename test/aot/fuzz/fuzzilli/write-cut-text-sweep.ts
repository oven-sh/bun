// Texts that are walked and cut as parsers do: how a place is read, times how the place moves, times what is tested, times how a piece is cut, times what is done with the piece, times the text, times the loop, times the function around.
//
//   bun write-cut-text-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<read>--<moved>--<tested>--<cut>--<used>--<text>--<loop>--<function>.mjs, .cjs or .ts
//   bun write-cut-text-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `s` is the text, `at` the place, `c` what is read.
const reads: [name: string, text: string][] = [
  ["code", "const c = s.charCodeAt(at);"],
  ["character", "const c = s[at];"],
  ["char-at", "const c = s.charAt(at);"],
  ["code-point", "const c = s.codePointAt(at);"],
  ["at", "const c = s.at(at);"],
  ["slice", "const c = s.slice(at, at + 1);"],
  ["substring", "const c = s.substring(at, at + 1);"],
  ["helper", "const c = peek(s, at);"],
  ["next-two", "const c = s[at] + (s[at + 1] ?? '');"],
  ["code-of-character", "const c = s[at]?.charCodeAt(0);"],
  ["from-code", "const c = String.fromCharCode(s.charCodeAt(at));"],
  ["from-list", "const c = letters[at];"],
];
const moved: [name: string, text: string][] = [["one", "at++;"], ["plus", "at += 1;"], ["wide", "at += c > 65535 ? 2 : 1;"], ["length", "at += String(c).length || 1;"], ["skip", "at += c === ' ' || c === 32 ? 2 : 1;"], ["search", "{\n  const next = s.indexOf(' ', at + 1);\n  at = next < 0 ? s.length + 1 : next;\n}"]]; // prettier-ignore
// Is this the end of a piece?
const tested: [name: string, text: string][] = [
  ["space", "c === ' ' || c === 32"],
  ["digit", "(c >= 48 && c <= 57) || (c >= '0' && c <= '9')"],
  ["letter", "(c >= 97 && c <= 122) || (c >= 'a' && c <= 'z')"],
  ["in-text", "',; '.includes(typeof c === 'number' ? String.fromCharCode(c) : c)"],
  ["switch", "isEnd(c)"],
  ["table", "ends[c] === 1"],
  ["set", "endSet.has(c)"],
  ["pattern", "/[\\s,]/.test(typeof c === 'number' ? String.fromCodePoint(c) : c)"],
  ["compare", "c < 'b' || c < 98"],
  ["upper", "typeof c === 'string' && c.toUpperCase() !== c.toLowerCase()"],
  ["of-code", "(c | 0) === 44"],
  ["equal-any", "c == 44 || c == ','"],
];
const cuts: [name: string, text: string][] = [
  ["slice", "const piece = s.slice(start, at);"],
  ["substring", "const piece = s.substring(start, at);"],
  ["substr", "const piece = s.substr(start, at - start);"],
  ["built", "const piece = built;\nbuilt = '';"],
  ["from-front", "const piece = s.slice(0, at).slice(start);"],
  ["split", "const piece = s.split('').slice(start, at).join('');"],
  ["trimmed", "const piece = s.slice(start, at).trim();"],
  ["lower", "const piece = s.slice(start, at).toLowerCase();"],
];
const used: [name: string, text: string][] = [
  ["pushed", "out.push(piece);"],
  ["counted", "counts[piece] = (counts[piece] ?? 0) + 1;"],
  ["number", "sum += +piece || 0;"],
  ["in-map", "table.set(piece, (table.get(piece) || 0) + 1);"],
  ["object", "tokens.push({ type: c, value: piece, start, end: at });"],
  ["joined", "all += piece + '|';"],
  ["compared", "if (piece === 'ab' || piece === 'x1') hits++;"],
  ["length", "sum += piece.length;"],
  [
    "switch",
    "switch (piece) {\n  case 'ab':\n    hits += 1;\n    break;\n  case '':\n    hits += 10;\n    break;\n  case '12':\n    hits += 100;\n}",
  ],
  ["first", "out.push(piece[0], piece.length);"],
  ["parsed", "sum += parseInt(piece, 10) || 0;"],
];
const texts: [name: string, text: string][] = [
  ["words", "'ab cd, 12 x1;ab  q'"],
  ["numbers", "'1,22,333 ,4.5'"],
  ["empty", "''"],
  ["wide", "'\\u00e9a b\\u4e00,c \\u{1F600}d'"],
  ["one", "'a'"],
  ["only-ends", "', ,; '"],
  ["long", "'alpha beta,gamma '.repeat(4)"],
  ["joined", "'ab ' + given + ',12'"],
  ["part", "'xx ab cd,12 yy'.slice(3, -3)"],
];
// TURN is a step of the walk.
const loops: [name: string, text: string][] = [
  ["while", "while (at < s.length) {\n  TURN\n}"],
  ["for", "for (; at < s.length; ) {\n  TURN\n}"],
  ["length-kept", "const end = s.length;\nwhile (at < end) {\n  TURN\n}"],
  ["past-end", "while (at <= s.length) {\n  TURN\n}"],
  ["endless", "for (;;) {\n  if (at >= s.length) break;\n  TURN\n}"],
  ["do", "if (s) {\n  do {\n    TURN\n  } while (at < s.length);\n}"],
  ["fixed", "for (let turn = 0; turn < 12 && at < s.length; turn++) {\n  TURN\n}"],
];
const functions: [name: string, text: string][] = [
  ["function", "function run(s, given) {\n  BODY\n}"],
  [
    "class",
    "class Parser {\n  run(s, given) {\n    BODY\n  }\n}\nconst parser = new Parser();\nconst run = (s, given) => parser.run(s, given);",
  ],
  [
    "generator",
    "function* steps(s, given) {\n  yield 0;\n  BODY\n}\nconst run = (s, given) => [...steps(s, given)].length;",
  ],
  ["arrow", "const run = (s, given) => {\n  BODY\n};"],
];
const total = reads.length * moved.length * tested.length * cuts.length * used.length * texts.length * loops.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const read = pick(reads);
  const test = pick(tested);
  const use = pick(used);
  const cut = pick(cuts);
  const loop = pick(loops);
  const text = pick(texts);
  const move = pick(moved);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const turn = [
    read[1],
    `if (${test[1]}) {`,
    indent(`${cut[1]}\n${use[1]}\nstart = at + 1;`, "  "),
    ...(cut[0] === "built" ? ["} else built += c;"] : ["}"]),
    move[1],
  ].join("\n");
  const body = [
    "let at = 0;\nlet start = 0;\nlet built = '';\nlet sum = 0;\nlet hits = 0;\nlet all = '';\nconst counts = {};\nconst table = new Map();\nconst tokens = [];",
    ...(/letters/.test(read[1]) ? ["const letters = [...s];"] : []),
    within(loop[1], "TURN", turn),
    "out.push('=', s.slice(start), built, sum, hits, all, JSON.stringify(counts), JSON.stringify([...table]), JSON.stringify(tokens));",
  ].join("\n");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    ...(/peek\(/.test(turn) ? ["const peek = (text, at) => text.charCodeAt(at);"] : []),
    ...(/isEnd\(/.test(turn)
      ? [
          "const isEnd = c => {\n  switch (c) {\n    case 32:\n    case 44:\n    case ' ':\n    case ',':\n      return true;\n  }\n  return false;\n};",
        ]
      : []),
    ...(/\bends\[/.test(turn) ? ["const ends = { 32: 1, 44: 1, ' ': 1, ',': 1 };"] : []),
    ...(/endSet/.test(turn) ? ["const endSet = new Set([32, 44, ' ', ',']);"] : []),
    within(form[1], "BODY", body),
    "for (const given of ['q', 7, '\\u00e9']) {",
    "  try {",
    `    run(${text[1]}, given);`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(JSON.stringify(out.map(String).join(" ").slice(0, 2500)));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${read[0]}--${move[0]}--${test[0]}--${cut[0]}--${use[0]}--${text[0]}--${loop[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
