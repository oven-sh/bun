// The least loops that carry texts: what becomes of one text, times what becomes of another, times the condition, times what is read of them, times the loop, times the first texts, with nothing beside.
//
//   bun write-carried-text-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<change>--<change>--<condition>--<read>--<loop>--<first>.mjs, .cjs or .ts
//   bun write-carried-text-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// S is the text; the other is O; `i` counts, n is given.
const changes: [name: string, text: string][] = [
  ["nothing", ";"],
  ["cut-front", "S = S.slice(1);"],
  ["cut-end", "S = S.slice(0, -1);"],
  ["last-part", "S = S.slice(-3);"],
  ["middle", "S = S.substring(1, 4);"],
  ["grown", "S += 'x';"],
  ["grown-by-counter", "S += i;"],
  ["grown-by-other", "S += O;"],
  ["grown-in-front", "S = i + S;"],
  ["character", "S += O[i] ?? '-';"],
  ["one-character", "S = O[i % 3] ?? '';"],
  ["code", "S += String.fromCharCode(97 + i);"],
  ["upper", "S = S.toUpperCase();"],
  ["trimmed", "S = S.trim();"],
  ["replaced", "S = S.replace('a', 'bb');"],
  ["repeated", "S = S.repeat(2).slice(0, 12);"],
  ["template", "S = `${S}.${i}`;"],
  ["exchanged", "[S, O] = [O, S];"],
  ["taken", "S = O;"],
  ["emptied", "S = '';"],
  ["constant", "S = 'abc';"],
  ["split", "S = S.split('').reverse().join('');"],
  ["number", "S = String(S.length);"],
  ["wide", "S += '\\u00df\\u4e00';"],
  ["part-of-other", "S = O.slice(i);"],
  ["nothing-there", "S = i === 2 ? undefined ?? 'u' : S;"],
];
// T is changed where C holds.
const conditions: [name: string, text: string][] = [["always", "C"], ["long", "if (S.length > 5) {\n  C\n}"], ["short", "if (S.length < 4) {\n  C\n}"], ["starts", "if (S[0] === 'a') {\n  C\n}"], ["character", "if (S[i] === 'b') {\n  C\n}"], ["equal", "if (S === O) {\n  C\n}"], ["includes", "if (S.includes('x')) {\n  C\n}"], ["odd", "if (i & 1) {\n  C\n}"], ["code", "if (S.charCodeAt(i) > 98) {\n  C\n}"], ["less", "if (S < O) {\n  C\n}"], ["truth", "if (S) {\n  C\n}"]]; // prettier-ignore
const reads: [name: string, text: string][] = [["length", "sum += S.length;"], ["character", "out += S[i] ?? '?';"], ["code", "sum += S.charCodeAt(0) | 0;"], ["last", "out += S.at(-1) ?? '';"], ["equal", "if (S === 'abc') sum++;"], ["nothing", ";"], ["search", "sum += S.indexOf('b');"], ["kept", "kept.push(S);"], ["nullish", "shared = S[n] ?? '?';\nout += shared;"], ["key", "counts[S] = (counts[S] ?? 0) + 1;"]]; // prettier-ignore
const loops: [name: string, text: string][] = [["four", "for (let i = 0; i < 4; i++) {\n  DO\n}"], ["given", "for (let i = 0; i < n; i++) {\n  DO\n}"], ["of-length", "for (let i = 0; i < s.length && i < 9; i++) {\n  DO\n}"], ["down", "for (let i = Math.min(s.length, 6) - 1; i >= 0; i--) {\n  DO\n}"], ["while", "let i = 0;\nwhile (s && i < 7) {\n  DO\n  i++;\n}"], ["nested", "for (let k = 0; k < 2; k++) {\n  for (let i = 0; i < 3; i++) {\n    DO\n  }\n}"], ["many", "for (let i = 0; i < 40; i++) {\n  DO\n}"]]; // prettier-ignore
const firsts: [name: string, text: string][] = [["given", "let t = '';"], ["both-given", "let t = s + 'q';"], ["part", "let t = s.slice(2);"], ["number", "let t = '' + n;"], ["joined", "let t = [s, n].join('');"]]; // prettier-ignore
const total = changes.length ** 2 * conditions.length * reads.length * loops.length * firsts.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const one = pick(changes);
  const condition = pick(conditions);
  const two = pick(changes);
  const read = pick(reads);
  const loop = pick(loops);
  const first = pick(firsts);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const of = (text: string, s: string, o: string) => text.replaceAll(/(?<!\.)\b[SO]\b/g, letter => (letter === "S" ? s : o)); // prettier-ignore
  const step = `${of(read[1], "t", "s")}\n${of(one[1], "t", "s")}\n${within(of(condition[1], "t", "s"), "C", of(two[1], "s", "t"))}\nif (s.length > 40) s = s.slice(-20);\nif (t.length > 40) t = t.slice(-20);`;
  const any = isTyped ? ": string" : "";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "let shared = '';",
    "const kept = [];",
    "const counts = {};",
    `function run(s${any}, n${isTyped ? ": number" : ""}) {\n  ${first[1]}\n  let out = '';\n  let sum = 0;\n${indent(within(loop[1], "DO", step), "  ")}\n  return JSON.stringify([s, t, out, sum]);\n}`,
    "for (const [s, n] of [['abcabc', 3], ['', 2], ['\\u00dfa\\u4e00b x', 5]]) console.log(run(s, n));",
    "console.log(JSON.stringify(kept).slice(0, 400), JSON.stringify(counts).slice(0, 300));",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${one[0]}--${two[0]}--${condition[0]}--${read[0]}--${loop[0]}--${first[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
