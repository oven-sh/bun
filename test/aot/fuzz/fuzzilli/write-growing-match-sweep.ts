// The least loops that grow a text and ask a pattern of it: how the text grows, times the pattern, times how it is asked, times what becomes of the answer, times what happens to the text, times the loop.
//
//   bun write-growing-match-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<grown>--<pattern>--<asked>--<answer>--<way>--<loop>.mjs, .cjs or .ts
//   bun write-growing-match-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `t` is the text, `i` counts, R the pattern, Y the answer.
const growths: [name: string, text: string][] = [
  ["letter", "t += 'a';"],
  ["counter", "t += i;"],
  ["of-list", "t += ['a', 'b1', ' c', '\\n'][i & 3];"],
  ["in-front", "t = i + t;"],
  ["both", "t = '<' + t + '>';"],
  ["template", "t = `${t},${i}`;"],
  ["character", "t += String.fromCharCode(97 + i);"],
  ["wide", "t += i & 1 ? '\\u00e9' : 'x';"],
  ["far", "t += '\\ud83d\\ude00';"],
  ["joined", "t = [t, i].join('-');"],
  ["concat", "t = t.concat('b', i);"],
  ["element", "t += s[i % 7];"],
  ["repeated", "if (t.length < 60) t += t;"],
  ["sometimes", "if (i & 1) t += 'ab';"],
  ["code-of-itself", "t += t[i] ?? '!';"],
  ["number", "t += i / 2;"],
];
const patterns: [name: string, text: string][] = [
  ["end", "/a$/"],
  ["start", "/^a/"],
  ["digits", "/\\d+/"],
  ["digits-end", "/\\d$/"],
  ["class", "/[a-c]+/"],
  ["group", "/(a)(b)?/"],
  ["named", "/(?<x>b)\\d/"],
  ["global", "/a/g"],
  ["sticky", "/a/y"],
  ["global-digits", "/\\d/g"],
  ["case", "/A/i"],
  ["unicode", "/\\p{L}/u"],
  ["any", "/./s"],
  ["lines", "/^c/m"],
  ["empty", "/(?:)/"],
  ["look-behind", "/(?<=a)b/"],
  ["made", "new RegExp('a' + c)"],
  ["literal-text", "/b1 c/"],
  ["either", "/a|\\d{2}/"],
  ["back", "/(.)\\1/"],
  ["indices", "/a+/d"],
];
const asks: [name: string, text: string][] = [
  ["test", "R.test(t)"],
  ["exec", "R.exec(t)"],
  ["match", "t.match(R)"],
  ["search", "t.search(R)"],
  ["replace", "t.replace(R, '_')"],
  ["replace-called", "t.replace(R, x => x.length)"],
  ["split", "t.split(R)"],
  ["exec-index", "R.exec(t)?.index"],
  ["exec-group", "R.exec(t)?.[1]"],
  ["exec-input", "R.exec(t)?.input"],
  ["match-all", "[...t.matchAll(new RegExp(R, 'g'))]"],
  ["test-slice", "R.test(t.slice(1))"],
  ["test-other", "R.test(s)"],
  ["test-function", "asks(R, t)"],
  ["included", "t.includes('a1')"],
  ["ended", "t.endsWith('a')"],
];
const answers: [name: string, text: string][] = [
  ["listed", "l.push(say(Y));"],
  ["counted", "if (Y) n2++;"],
  ["branch", "if (Y) t += '#';\nelse l.push(i);"],
  ["emptied", "if (Y) t = '';"],
  ["kept", "last = Y;"],
  ["cut", "if (Y) t = t.slice(1);"],
  ["break", "if (Y && i > 2) break;"],
];
const ways: [name: string, text: string][] = [
  ["nothing", ""],
  ["last-index", "R.lastIndex = 0;"],
  ["last-index-asked", "l.push(R.lastIndex);"],
  ["compared", "if (t === s) l.push('=');"],
  ["length", "n2 += t.length;"],
  ["first", "l.push(t[0]);"],
  ["held", "held[i & 1] = t;"],
];
const loops: [name: string, text: string][] = [
  ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"],
  ["eight", "for (let i = 0; i < 8; i++) {\n  IN\n}"],
  ["while", "let i = -1;\nwhile (++i < n) {\n  IN\n}"],
  ["nested", "for (let j = 0; j < 2; j++)\n  for (let i = 0; i < n; i++) {\n    IN\n  }"],
  ["of", "for (const i of [0, 3, 1, 2]) {\n  IN\n}"],
];
const total = growths.length * patterns.length * asks.length * answers.length * ways.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 823_201;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const growth = pick(growths);
  const ask = pick(asks);
  const pattern = pick(patterns);
  const answer = pick(answers);
  const loop = pick(loops);
  const way = pick(ways);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const isHeld = cell % 5 !== 2;
  const r = isHeld ? "r" : `(${pattern[1]})`;
  const turn = [growth[1], answer[1].replaceAll(/\bY\b/g, ask[1]), way[1]].filter(Boolean).join("\n").replaceAll(/\bR\b/g, r); // prettier-ignore
  const body = within(loop[1], "IN", turn);
  const has = (word: RegExp) => word.test(body);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(has(/\basks\(/) ? ["function asks(r, t) {\n  return r.test(t);\n}"] : []),
    'const say = v => (Array.isArray(v) ? v.length + ":" + v.join("~") + "@" + (v.index ?? "") : String(v));',
    "function run(n, c, s) {",
    "  let t = '';",
    "  let n2 = 0;",
    "  let last = null;",
    "  const l = [];",
    ...(has(/\bheld\b/) ? ["  const held = ['', ''];"] : []),
    ...(isHeld && has(/\br\b/) ? [`  const r = ${pattern[1]};`] : []),
    indent(body, "  "),
    `  return [t, n2, say(last), l.join()${has(/\bheld\b/) ? ", held.join()" : ""}].join("/");`,
    "}",
    "const out = [];",
    "for (const [n, c, s] of [[3, 'b', 'abc123x'], [8, '1', 'aa b1 c'], [5, '', '']]) {",
    "  try {",
    "    out.push(run(n, c, s));",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${growth[0]}--${pattern[0]}--${ask[0]}--${answer[0]}--${way[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
