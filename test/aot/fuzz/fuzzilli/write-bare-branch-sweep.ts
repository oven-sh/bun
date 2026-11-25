// The least programs that have branches: one thing that changes, one change, and branches and loops around it, with nothing beside: the thing, times the change, times the value, times the branch, times what is done on the other way, times the loop, times the calls.
//
//   bun write-bare-branch-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<change>--<value>--<branch>--<other way>--<loop>--<calls>.mjs, .cjs or .ts
//   bun write-bare-branch-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";
import { changes, values } from "./bare-changes.ts";

// DO is the change and ELSE the other way; `i` counts, c and n are given.
const branches: [name: string, text: string][] = [
  ["if", "if (i & 1) {\n  DO\n}\nELSE"],
  ["if-else", "if (i === c) {\n  DO\n} else {\n  ELSE\n}"],
  ["not", "if (!(i > c)) {\n  DO\n}\nELSE"],
  ["two-ifs", "if (i > 0) {\n  if (i < 3) {\n    DO\n  } else {\n    ELSE\n  }\n}"],
  ["and", "if (i > 0 && c > 0) {\n  DO\n}\nELSE"],
  ["or", "if (i === 0 || c === 2) {\n  DO\n}\nELSE"],
  ["switch", "switch (i) {\n  case 0:\n    DO\n    break;\n  case 2:\n    ELSE\n    break;\n  default:\n    DO\n}"],
  ["falls-through", "switch (c) {\n  case 0:\n    DO\n  case 1:\n    ELSE\n}"],
  ["switch-of-text", "switch ('abc'[i]) {\n  case 'a':\n    DO\n    break;\n  case 'c':\n    ELSE\n}"],
  ["continues", "if (i === 1) continue;\nDO\nELSE"],
  ["breaks", "DO\nif (i === 2) break;\nELSE"],
  ["returns", "DO\nif (i === 3) return 'early';\nELSE"],
  ["caught", "try {\n  DO\n  if (i === 1) throw i;\n  ELSE\n} catch {\n  DO\n}"],
  ["caught-by-call", "try {\n  if (i === 1) null.x;\n  DO\n} catch {\n  ELSE\n}"],
  ["finally", "try {\n  DO\n} finally {\n  ELSE\n}"],
  ["finally-continues", "try {\n  if (i === 1) continue;\n  DO\n} finally {\n  ELSE\n}"],
  ["labeled", "one: {\n  if (i & 1) break one;\n  DO\n}\nELSE"],
  ["unsigned", "if (i >>> 0 < n) {\n  DO\n}\nELSE"],
  ["truth", "if (c) {\n  DO\n} else {\n  ELSE\n}"],
  ["type", "if (typeof n === 'number') {\n  DO\n} else {\n  ELSE\n}"],
  ["equal-to-nothing", "if (n == null) {\n  ELSE\n} else {\n  DO\n}"],
  ["both-ways", "if (i & 1) {\n  DO\n} else {\n  DO\n}\nELSE"],
  ["behind-a-loop", "for (let q = 0; q < 2; q++) if (q === i) break;\nDO\nELSE"],
  ["in-do", "do {\n  DO\n} while (false);\nELSE"],
];
const otherWays: [name: string, text: string][] = [["nothing", ";"], ["same", "DO"], ["step", "steps++;"], ["reset", "steps = 0;"]]; // prettier-ignore
const loops: [name: string, text: string][] = [["three", "for (let i = 0; i < 3; i++) {\n  IN\n}"], ["given", "for (let i = 0; i <= n; i++) {\n  IN\n}"], ["while", "let i = -1;\nwhile (i++ < 3) {\n  IN\n}"], ["of", "for (const i of [0, 1, 2, 3]) {\n  IN\n}"], ["down", "for (let i = 4; i-- > 0; ) {\n  IN\n}"], ["once", "for (let i = c; i < c + 1; i++) {\n  IN\n}"], ["many", "for (let i = 0; i < 25; i++) {\n  IN\n}"], ["nested", "for (let k = 0; k < 2; k++) {\n  for (let i = 0; i < 4; i++) {\n    IN\n  }\n}"], ["do", "let i = 0;\ndo {\n  IN\n} while (++i < 4);"]]; // prettier-ignore
const calls: [name: string, text: string][] = [["three", "for (const c of [0, 1, 2]) console.log(run(c, c + 1));"], ["once", "console.log(run(1, 2));"], ["twice", "for (let turn = 0; turn < 2; turn++) console.log(run(turn, 3));"], ["many", "let last = '';\nfor (let turn = 0; turn < 300; turn++) last = run(turn % 3, 2);\nconsole.log(last);"]]; // prettier-ignore
const total = changes.length * values.length * branches.length * otherWays.length * loops.length * calls.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const change = pick(changes);
  const branch = pick(branches);
  const value = pick(values);
  const loop = pick(loops);
  const other = pick(otherWays);
  const call = pick(calls);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const isDo = (loop[0] === "do" || loop[0] === "while") && /continue/.test(branch[1]);
  const deed = change[2].replaceAll(/\bV\b/g, value[1]).replaceAll(/\bq\b/g, "(i & 3)");
  const inside = within(within(branch[1], "ELSE", other[1]), "DO", deed);
  const around = loop[0] === "do" && isDo ? loops[0][1] : loop[1];
  const body = `${/\bl\b/.test(deed) ? "const l = [1, 2, 3];\n" : ""}${/steps/.test(inside) ? "let steps = 0;\n" : ""}${change[1]}\n${within(around, "IN", inside)}\nreturn ${change[3]}${/steps/.test(inside) ? " + ':' + steps" : ""};`;
  const any = isTyped ? ": number" : "";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    `function run(c${any}, n${any}) {\n${indent(body, "  ")}\n}`,
    call[1],
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${change[0]}--${value[0]}--${branch[0]}--${other[0]}--${loop[0]}--${call[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
