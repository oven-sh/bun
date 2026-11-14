// The least programs in which two things are done in loops: one change, times another, on the same thing or on one of its own, times where the two stand, times the outer loop, times the inner loop, with nothing beside.
//
//   bun write-bare-pair-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<change>--<change>--<shared or own>--<places>--<outer>--<inner>--<value>.mjs, .cjs or .ts
//   bun write-bare-pair-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";
import { changes } from "./bare-changes.ts";

// A and B are the changes; LOOP is the inner loop, with IN in it.
const placing: [name: string, text: string, inside: string][] = [
  ["inside-and-behind", "LOOP\nB", "A"],
  ["inside-and-in-front", "B\nLOOP", "A"],
  ["both-inside", "LOOP", "A\nB"],
  ["both-outside", "A\nB", ""],
  ["two-loops", "LOOP\nLOOP2", "A"],
  ["around", "B\nLOOP\nB", "A"],
  ["if-odd", "LOOP\nif (i & 1) {\n  B\n}", "A"],
];
const outers: [name: string, text: string][] = [["three", "for (let i = 0; i < 3; i++) {\n  ALL\n}"], ["given", "for (let i = 0; i < n; i++) {\n  ALL\n}"], ["while", "let i = 0;\nwhile (i < 3) {\n  ALL\n  i++;\n}"], ["of", "for (const i of [2, 0, 1]) {\n  ALL\n}"], ["once", "{\n  const i = 1;\n  ALL\n}"], ["many", "for (let i = 0; i < 12; i++) {\n  ALL\n}"], ["caught", "for (let i = 0; i < 3; i++) {\n  try {\n    ALL\n  } catch {\n    break;\n  }\n}"]]; // prettier-ignore
const inners: [name: string, text: string][] = [["two", "for (let q = 0; q < 2; q++) {\n  IN\n}"], ["given", "for (let q = 0; q < n; q++) {\n  IN\n}"], ["to-outer", "for (let q = 0; q <= i; q++) {\n  IN\n}"], ["none", "{\n  const q = i;\n  IN\n}"], ["while", "let q = 0;\nwhile (q < 2) {\n  IN\n  q++;\n}"], ["breaks", "for (let q = 0; ; q++) {\n  if (q > 1) break;\n  IN\n}"]]; // prettier-ignore
const values: [name: string, text: string][] = [["outer", "i"], ["inner", "q"], ["double", "0.5"], ["element", "l[c]"], ["text", "'t'"]]; // prettier-ignore
const total = changes.length ** 2 * 2 * placing.length * outers.length * inners.length * values.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const first = pick(changes);
  const place = pick(placing);
  const second = pick(changes);
  const inner = pick(inners);
  const outer = pick(outers);
  const value = pick(values);
  const isShared = pick([true, false]);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const names = (declared: string) => [...declared.matchAll(/^(?:const|let) (\w+)/gm)].map(match => match[1]);
  // Shared where the second's things are all things of the first, declared as lists, as numbers, or alike.
  const kindOf = (declared: string) => declared.replaceAll(/\[[^\]]*\]/g, "[]").replaceAll(/\b[\d.]+\b/g, "0");
  const isClosure = first[0] === "closure" || second[0] === "closure";
  const canShare = isShared && !isClosure && names(second[1]).length > 0 && kindOf(first[1]) === kindOf(second[1]);
  const rename = (text: string) =>
    canShare ? text : names(second[1]).reduce((all, name) => all.replaceAll(new RegExp(`(?<![\\w']|(?<!\\.\\.)\\.)${name}\\b(?!:)`, "g"), `${name}2`), text); // prettier-ignore
  const ofOuter = (text: string) => text.replaceAll(/\bq\b/g, "i");
  const a = first[2].replaceAll(/\bV\b/g, value[1]);
  const b = rename(second[2].replaceAll(/\bV\b/g, value[1]));
  const isInside = place[0] === "both-inside";
  const inside = within(within(place[2], "A", a), "B", b);
  const loop = `{\n${indent(within(inner[1], "IN", inside), "  ")}\n}`;
  const loop2 = `{\n${indent(within(inner[1], "IN", b), "  ")}\n}`;
  const all = within(within(within(within(place[1], "LOOP", loop), "LOOP2", loop2), "A", ofOuter(a)), "B", isInside ? b : ofOuter(b)); // prettier-ignore
  const body = [
    ...(/\bl\b/.test(a + b) ? ["const l = [1, 2, 3];"] : []),
    first[1],
    ...(canShare ? [] : [rename(second[1])]),
    within(outer[1], "ALL", all),
    `return ${first[3]}${canShare ? "" : ` + '|' + ${rename(second[3])}`};`,
  ].join("\n");
  const any = isTyped ? ": number" : "";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    `function run(c${any}, n${any}) {\n${indent(body, "  ")}\n}`,
    "for (const c of [0, 1, 2]) {",
    "  try {",
    "    console.log(run(c, c + 1));",
    "  } catch (error) {",
    "    console.log(error.name);",
    "  }",
    "}",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${first[0]}--${second[0]}--${canShare ? "shared" : "own"}--${place[0]}--${outer[0]}--${inner[0]}--${value[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
