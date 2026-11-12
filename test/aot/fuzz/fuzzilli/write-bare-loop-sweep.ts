// The least programs that have loops: one thing that changes, one change, and loops around it, with nothing beside: the thing, times the change, times the value, times the outer loop, times the inner loop, times where else the same change stands, times the calls.
//
//   bun write-bare-loop-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<change>--<value>--<outer>--<inner>--<again>--<calls>.mjs, .cjs or .ts
//   bun write-bare-loop-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";
import { changes, values } from "./bare-changes.ts";

const outers: [name: string, text: string][] = [["three", "for (let i = 0; i < 3; i++) {\n  IN\n}"], ["given", "for (let i = 0; i < n; i++) {\n  IN\n}"], ["four", "for (let i = 0; i < 4; i++) {\n  IN\n}"], ["of-length", "for (let i = 0; i < l.length; i++) {\n  IN\n}"], ["while", "let i = 0;\nwhile (i < 3) {\n  IN\n  i++;\n}"], ["of", "for (const i of l) {\n  IN\n}"], ["down", "for (let i = 3; i-- > 0; ) {\n  IN\n}"], ["none", "const i = 1;\n{\n  IN\n}"], ["many", "for (let i = 0; i < 30; i++) {\n  IN\n}"]]; // prettier-ignore
const inners: [name: string, text: string][] = [["two", "for (let q = 0; q < 2; q++) DO"], ["three", "for (let q = 0; q < 3; q++) DO"], ["given", "for (let q = 0; q < n; q++) DO"], ["to-outer", "for (let q = 0; q < i; q++) DO"], ["through-outer", "for (let q = 0; q <= i; q++) DO"], ["of-length", "for (let q = 0; q < l.length; q++) DO"], ["from-outer", "for (let q = i; q < 3; q++) DO"], ["none", "const q = i;\nDO"], ["while", "let q = 0;\nwhile (q < 2) {\n  DO\n  q++;\n}"], ["if", "const q = i;\nif (i !== 1) DO"], ["deeper", "for (let k = 0; k < 2; k++) for (let q = 0; q < 2; q++) DO"], ["twice", "for (let q = 0; q < 2; q++) DO\nfor (let q = 0; q < 2; q++) DO"]]; // prettier-ignore
const again: [name: string, text: string][] = [["nowhere", "LOOP"], ["behind", "LOOP\nSAME"], ["in-front", "SAME\nLOOP"], ["if-odd", "LOOP\nif (i & 1) SAME"]]; // prettier-ignore
const calls: [name: string, text: string][] = [["three", "for (const c of [0, 1, 2]) console.log(run(c, c + 1));"], ["once", "console.log(run(1, 2));"], ["twice", "for (let turn = 0; turn < 2; turn++) console.log(run(turn, 3));"], ["many", "let last = '';\nfor (let turn = 0; turn < 300; turn++) last = run(turn % 3, 2);\nconsole.log(last);"]]; // prettier-ignore
const total = changes.length * values.length * outers.length * inners.length * again.length * calls.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const change = pick(changes);
  const inner = pick(inners);
  const value = pick(values);
  const outer = pick(outers);
  const more = pick(again);
  const call = pick(calls);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const statement = (text: string) => (text.includes("\n") || text.startsWith("if ") ? `{\n${indent(text, "  ")}\n}` : text); // prettier-ignore
  const deed = change[2].replaceAll(/\bV\b/g, value[1]);
  const same = statement(deed.replaceAll(/\bq\b/g, "i"));
  const place = (text: string, hole: string, part: string) =>
    text.replaceAll(
      new RegExp(`^( *)(.*)\\b${hole}$`, "gm"),
      (_, by, front) => by + front + indent(part, by).trimStart(),
    );
  const loop = place(inner[1], "DO", inner[0] === "none" || inner[0] === "while" ? deed : statement(deed));
  const within = more[1].split("\n").map(line => (line === "LOOP" ? `{\n${indent(loop, "  ")}\n}` : place(line, "SAME", same))).join("\n"); // prettier-ignore
  const body = `${/\bl\b/.test(deed + outer[1] + inner[1]) ? "const l = [1, 2, 3];\n" : ""}${change[1]}\n${place(outer[1], "IN", within)}\nreturn ${change[3]};`;
  const any = isTyped ? ": number" : "";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    `function run(c${any}, n${any}) {\n${indent(body, "  ")}\n}`,
    call[1],
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${change[0]}--${value[0]}--${outer[0]}--${inner[0]}--${more[0]}--${call[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
