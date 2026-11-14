// Shapes of patterns on texts that fit, almost fit, and do not fit: the start, times the part in front, times the middle, times how often, times the part behind, times the end, times the flags, times what is done with it.
//
//   bun write-pattern-shape-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<start>--<front>--<middle>--<often>--<behind>--<end>--<flags>--<use>.mjs, .cjs or .ts
//   bun write-pattern-shape-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const starts: [name: string, text: string][] = [
  ["anywhere", ""],
  ["first", "^"],
  ["word", "\\b"],
  ["behind-a", "(?<=a)"],
  ["not-behind-x", "(?<!x)"],
  ["ahead", "(?=[ab])"],
  ["not-ahead", "(?!b)"],
  ["inside-word", "\\B"],
];
const parts: [name: string, text: string][] = [
  ["nothing", ""],
  ["letter", "a"],
  ["two-letters", "ab"],
  ["class", "[a-c]"],
  ["not-class", "[^a\\s]"],
  ["digit", "\\d"],
  ["space", "\\s"],
  ["any", "."],
  ["letter-some", "a+"],
  ["letter-many", "b*"],
  ["letter-once", "x?"],
  ["few", "\\w+?"],
  ["counted", "[ab]{2}"],
  ["between", "\\d{1,3}"],
  ["wide", "\\u00e9"],
  ["escaped", "\\."],
  ["line", "\\n"],
];
// `(` and `)` count as groups.
const middles: [name: string, text: string][] = [
  ["letter", "c"],
  ["group", "(b)"],
  ["group-of-two", "(a|b)"],
  ["bare-group", "(?:ab|a)"],
  ["words", "(?:abc|ab|b|1)"],
  ["words-in-group", "(foo|for|f|abc)"],
  ["nested", "((a)|(b))"],
  ["class", "[\\w.]"],
  ["empty-choice", "(a|)"],
  ["back", "(a)b?\\1"],
  ["named", "(?<n>a|b)"],
  ["number", "(\\d+(?:\\.\\d+)?)"],
  ["ahead-in-group", "(a(?=b))"],
  ["of-class-and-word", "([a-c]+|\\d)"],
  ["not", "(?:(?!b).)"],
  ["quoted", "(?:\"[^\"]*\"|'[^']*')"],
];
const often: [name: string, text: string][] = [
  ["once", ""],
  ["some", "+"],
  ["many", "*"],
  ["maybe", "?"],
  ["few", "+?"],
  ["many-few", "*?"],
  ["two", "{2}"],
  ["two-or-more", "{2,}"],
  ["to-two", "{0,2}"],
];
const ends: [name: string, text: string][] = [["anywhere", ""], ["last", "$"], ["word", "\\b"], ["ahead", "(?=b|$)"], ["not-ahead", "(?!a)"]]; // prettier-ignore
const flags: [name: string, text: string][] = [["none", ""], ["all", "g"], ["any-case", "i"], ["all-any-case", "gi"], ["lines", "gm"], ["sticky", "y"], ["unicode", "gu"], ["dots", "gs"], ["indices", "d"], ["sets", "gv"]]; // prettier-ignore
// `r` is the pattern and `s` a text.
const uses: [name: string, text: string][] = [
  ["test", "out.push(r.test(s) ? 1 : 0);"],
  ["exec", "const m = r.exec(s);\nout.push(m ? m.index + m.map(show).join('|') : '-');"],
  ["match", "out.push(show(s.match(r)));"],
  ["match-all", "for (const m of s.matchAll(new RegExp(r.source, 'g'))) out.push(m.index, show(m[0]));"],
  ["replace", "out.push(s.replace(r, '[$&]'));"],
  ["replace-groups", "out.push(s.replace(r, '<$1>'));"],
  ["replace-by-function", "out.push(s.replace(r, (all, ...others) => all.length + show(others[0])));"],
  ["removed", "out.push(s.replace(r, ''));"],
  ["split", "out.push(s.split(r).map(show).join('/'));"],
  ["search", "out.push(s.search(r));"],
  [
    "turns",
    "r.lastIndex = 0;\nfor (let m, turns = 0; turns < 5 && (m = r.exec(s)); turns++) {\n  out.push(m.index, show(m[1]));\n  if (!r.global && !r.sticky) break;\n  if (m[0] === '') r.lastIndex++;\n}",
  ],
  ["from-an-index", "r.lastIndex = 2;\nout.push(show(r.exec(s)), r.lastIndex);"],
  [
    "test-then-cut",
    "let rest = s;\nfor (let turns = 0; turns < 6 && rest; turns++) {\n  r.lastIndex = 0;\n  const m = r.exec(rest);\n  if (!m) break;\n  out.push(m[0]);\n  rest = rest.slice(m.index + (m[0].length || 1));\n}",
  ],
  ["read-groups", "const m = r.exec(s);\nif (m) for (let i = 0; i < m.length; i++) out.push(m[i] ?? '?');"],
  ["statics", "if (r.test(s)) out.push(RegExp.$1, RegExp.lastMatch);"],
];
const total = starts.length * parts.length * middles.length * often.length * parts.length * ends.length * flags.length * uses.length; // prettier-ignore
const texts = ["", "a", "b", "ab", "abc", "aab", "abab", "xab", "ba c", "a1b22.5c", "foo for f", "c", "ABC", "\\u00e9a\\u00e9b", "a\\nb\\nab", "'a' \\\"b c\\\" 'd", "aaaabbbb", "\\u{1F600}a\\u{1F600}", "  ab  ", "x.y.z", "1.5", "12345"]; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const middle = pick(middles);
  const use = pick(uses);
  const front = pick(parts);
  const count = pick(often);
  const behind = pick(parts);
  const start = pick(starts);
  const flag = pick(flags);
  const end = pick(ends);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const source = `${start[1]}${front[1]}${count[1] && middle[1].length > 1 && !/^(\(.*\)|\[[^\]]*\])$/.test(middle[1]) ? `(?:${middle[1]})` : middle[1]}${count[1]}${behind[1]}${end[1]}`;
  const declared =
    cell % 5 === 0
      ? `const r = new RegExp(${JSON.stringify(source)}, "${flag[1]}");`
      : `const r = /${source}/${flag[1]};`;
  const wide = flag[1].includes("u") || flag[1].includes("v");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Array.isArray(value) ? "[" + value.map(show).join("|") + "]" : String(value));',
    "const out = [];",
    declared,
    `function run(s) {\n${indent(use[1], "  ")}\n}`,
    `const texts = [${texts.map(text => `"${text}"`).join(", ")}];`,
    `for (let round = 0; round < 2; round++) {`,
    "  for (const s of texts) {",
    "    r.lastIndex = 0;",
    "    try {",
    "      run(s);",
    "    } catch (error) {",
    "      out.push(error.name);",
    "    }",
    "  }",
    "}",
    `console.log(JSON.stringify(out.join(" ")).slice(0, 2500)${wide ? ", r.unicode" : ""});`,
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${start[0]}--${front[0]}--${middle[0]}--${count[0]}--${behind[0]}--${end[0]}--${flag[0]}--${use[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
