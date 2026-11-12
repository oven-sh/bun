// A read of what may be nothing, and who catches what it throws: where the receiver comes from, times how it is read, times the handler, times the loop. Every program is asked with and without a nothing at the first, a middle and the last place.
//
//   bun write-throwing-read-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<receiver>--<read>--<handler>--<loop>.ts or .mjs
//   bun write-throwing-read-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// How the receiver is written; `rows` is the list, `k` the counter, `row` the element.
const receivers: [name: string, before: string, text: string][] = [
  ["element", "", "rows[k]!"],
  ["constant", "const row = rows[k];", "row!"],
  ["variable", "let row = rows[0];\nrow = rows[k];", "row!"],
  ["field", "holder.row = rows[k];", "holder.row!"],
  ["two-fields", "holder.inner.row = rows[k];", "holder.inner.row!"],
  ["parameter", "", "pass(rows[k])!"],
  ["destructured", "const { row } = { row: rows[k] };", "row!"],
  ["pattern", "const [row] = [rows[k]];", "row!"],
  ["captured", "const row = rows[k];\nconst ask = () => row;", "ask()!"],
  ["map", "const row = new Map([[1, rows[k]]]).get(1);", "row!"],
  ["chosen", "const row = k & 1 ? rows[k] : rows[k];", "row!"],
  ["of-the-file", "shared = rows[k];", "shared!"],
  ["find", "const row = [rows[k]].find(() => true);", "row!"],
  ["beyond", "", "rows[k + 1]!"],
  ["by-name", 'byName["n" + k] = rows[k];\nconst row = byName["n" + k];', "row!"],
];
// `R` is the receiver.
const reads: [name: string, text: string][] = [
  ["field", "sum += R.size;"],
  ["inner-field", "sum += R.inner.z;"],
  ["two-fields", "sum += R.size + R.other;"],
  ["length", "sum += R.list.length;"],
  ["element", "sum += R.list[1]!;"],
  ["method", "sum += R.ask(k);"],
  ["store", "R.size = k;\nsum += 1;"],
  ["add", "R.size += 2;\nsum += R.size;"],
  ["destructuring", "const { size, other } = R;\nsum += size + other;"],
  ["spread", "sum += Object.keys({ ...R.inner }).length;"],
  ["text", "sum += R.name.length;"],
  ["character", "sum += R.name.charCodeAt(0) | 0;"],
  ["comparison", "if (R.size > 1) sum += 5;"],
  ["argument", "sum += Math.max(R.size, 2);"],
  ["twice", "sum += R.size;\nsum += R.size;"],
  ["template", "sum += `${R.size}`.length;"],
  ["delete", "delete R.gone;\nsum += 1;"],
  ["in", 'if ("size" in R) sum += 3;'],
];
// `LOOP` is the loop, `STEP` what a turn does; what is caught is told by its name.
const handlers: [name: string, around: string, inside: string][] = [
  ["around", 'try {\nLOOP\n} catch (error) {\n  return told(error) + sum + ":" + turns;\n}', "STEP"],
  ["inside", "LOOP", "try {\nSTEP\n} catch {\n  sum += 100;\n}"],
  ["inside-told", "LOOP", "try {\nSTEP\n} catch (error) {\n  notes.push(told(error));\n}"],
  ["finally", 'try {\nLOOP\n} finally {\n  notes.push("behind" + sum);\n}', "STEP"],
  ["finally-inside", "LOOP", "try {\nSTEP\n} finally {\n  sum += 10;\n}"],
  [
    "both",
    "try {\nLOOP\n} catch (error) {\n  notes.push(told(error));\n}",
    "try {\nSTEP\n} finally {\n  sum += 1000;\n}",
  ],
  [
    "thrown-on",
    'try {\nLOOP\n} catch (error) {\n  notes.push("outer" + sum);\n}',
    'try {\nSTEP\n} catch (error) {\n  notes.push("inner" + sum);\n  if (k & 1) throw error;\n}',
  ],
  ["goes-on", "LOOP", "try {\nSTEP\n} catch {\n  sum -= 1;\n  continue;\n}\nsum += 7;"],
  ["leaves", "LOOP", "try {\nSTEP\n} catch {\n  break;\n}"],
  [
    "in-a-call",
    "try {\n  const step = (k: number) => {\nSTEP\n  };\nLOOP\n} catch (error) {\n  return told(error) + sum;\n}",
    "step(k);",
  ],
  ["caller", "LOOP", "STEP"],
  [
    "callback",
    'try {\n  rows.forEach((_, k) => {\n    turns++;\nSTEP\n  });\n} catch (error) {\n  return told(error) + sum + ":" + turns;\n}',
    "",
  ],
];
const loops: [name: string, text: string][] = [
  ["up", "for (let k = 0; k < rows.length; k++) {\nTURN\n}"],
  ["counter-outside", "let k = 0;\nfor (; k < rows.length; k++) {\nTURN\n}"],
  ["down", "for (let k = rows.length; --k >= 0; ) {\nTURN\n}"],
  ["entries", "for (const [k] of rows.entries()) {\nTURN\n}"],
  ["inner", "for (let i = 0; i < 2; i++) {\n  for (let k = 0; k < rows.length; k++) {\nTURN\n  }\n}"],
  ["once", "for (let k = 1; k < 2; k++) {\nTURN\n}"],
];
const total = receivers.length * reads.length * handlers.length * loops.length * 2;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const receiver = pick(receivers);
  const read = pick(reads);
  const handler = pick(handlers);
  const loop = pick(loops);
  const isTyped = rest % 2 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const step = (receiver[1] ? receiver[1] + "\n" : "") + read[1].replaceAll(/\bR\b/g, () => receiver[2]);
  const turn = ["turns++;", ...handler[2].replace("STEP", () => indent(step, "  ")).split("\n")].join("\n");
  const body = handler[1].replace("STEP", () => indent(step, "    ")).replace("LOOP", () => indent(loop[1].replace("TURN", () => indent(turn, "  ")), "")); // prettier-ignore
  const strip = (text: string) =>
    isTyped
      ? text
      : text
          .replaceAll(/([\w\])])!(?=[.;,\s)[}])/g, "$1")
          .replaceAll(/\((k|error|k: number|_, k): (number|any)\)/g, "($1)")
          .replaceAll("(k: number)", "(k)"); // prettier-ignore
  const type = (text: string) => (isTyped ? text : "");
  // The rows are literals, or instances of a class where a method is called and in every third program.
  const isClass = read[0] === "method" || cell % 3 === 0;
  const row = (size: number) => (isClass ? `new Item(${size})` : `{ size: ${size}, other: 2, inner: { z: ${size}.5 }, list: [${size}, 4], name: "n${size}" }`); // prettier-ignore
  const nothing = Math.floor(cell / 11) % 3 === 0 ? "undefined" : "null";
  const lists = [[row(1), row(2), row(3)], [row(1), nothing, row(3)], [nothing, row(2)], [row(1), nothing], [nothing], [], [row(4), row(5), row(6), nothing, row(7)]]; // prettier-ignore
  const isByRound = Math.floor(cell / 7) % 2;
  const lines = [
    ...(isTyped ? ["interface Row {", "  size: number;", "  other: number;", "  inner: { z: number };", "  list: number[];", "  name: string;", "  gone?: number;", ...(read[0] === "method" ? ["  ask(k: number): number;"] : []), "}"] : []), // prettier-ignore
    ...(isClass ? [`class Item {`, ...(isTyped ? ["  size: number;"] : []), "  other = 2;", `  inner${type(": { z: number }")};`, `  list${type(": number[]")};`, `  name${type(": string")};`, `  constructor(size${type(": number")}) {`, "    this.size = size;", "    this.inner = { z: size + 0.5 };", "    this.list = [size, 4];", '    this.name = "n" + size;', "  }", `  ask(k${type(": number")})${type(": number")} {`, "    return k + this.size;", "  }", "}"] : []), // prettier-ignore
    ...(isTyped ? ["type Maybe = Row | null | undefined;"] : []),
    `const byName${type(": Record<string, Maybe>")} = { n0: null };`,
    `const holder${type(": { row: Maybe; inner: { row: Maybe } }")} = { row: null, inner: { row: null } };`,
    `let shared${type(": Maybe")} = null;`,
    `const pass = (row${type(": Maybe")})${type(": Maybe")} => row;`,
    `const told = (error${type(": unknown")}) => "!" + ${isTyped ? "(error as Error)" : "error"}.name;`,
    `const notes${type(": string[]")} = [];`,
    `function total(rows${type(": Maybe[]")})${type(": string")} {`,
    "  let sum = 0;",
    "  let turns = 0;",
    ...strip(body).split("\n").map(line => "  " + line), // prettier-ignore
    '  return "sum " + sum + ":" + turns;',
    "}",
    ...(isByRound ? ["for (let round = 0; round < 2; round++) {"] : []),
    ...lists.flatMap(list => ["try {", `  console.log(total([${list.join(", ")}]), notes.splice(0).join("+"));`, "} catch (error) {", '  console.log("left", told(error), notes.splice(0).join("+"));', "}"]), // prettier-ignore
    ...(isByRound ? ["}"] : []),
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${receiver[0]}--${read[0]}--${handler[0]}--${loop[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(5, "0");
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
