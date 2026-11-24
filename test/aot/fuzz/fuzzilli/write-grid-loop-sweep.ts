// Lists of lists in loops: how the rows are made, times what is done to an element, times how the two indexes go, times the loop, times how the rows are shared, times what is read in the end.
//
//   bun write-grid-loop-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<rows>--<step>--<indexes>--<loop>--<sharing>--<read>.ts or .mjs
//   bun write-grid-loop-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// Four rows of four: `grid`.
const rows: [name: string, text: string][] = [
  ["literal", "[[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]]"],
  ["pushed", "pushed(4, (x, y) => y * 4 + x)"],
  ["filled", "Array.from({ length: 4 }, () => new Array(4).fill(0))"],
  ["doubles", "pushed(4, (x, y) => y + x * 0.5)"],
  ["one-double", "pushed(4, (x, y) => (x === 3 && y === 2 ? 0.5 : x))"],
  ["rows-of-kinds", "[[1, 2, 3, 4], [0.5, 1, 2, 3], [4, 3, 2, 1], [9, 8, 7, 6]]"],
  ["texts", 'pushed(4, (x, y) => "t" + x + y)'],
  ["parsed", 'JSON.parse("[[0,1,2,3],[4,5,6,7],[8,9,10,11],[12,13,14,15]]")'],
  ["holes", "[[0, , 2, 3], [4, 5, 6, 7], [8, 9, , 11], [12, 13, 14, 15]]"],
  ["typed", "[0, 1, 2, 3].map(y => new Int32Array([y, y + 1, y + 2, y + 3]))"],
  ["typed-doubles", "[0, 1, 2, 3].map(y => new Float64Array([y, y * 0.5, y + 2, 3]))"],
  ["mapped", "[0, 1, 2, 3].map(y => [0, 1, 2, 3].map(x => x * y))"],
  ["ragged", "[[0, 1, 2, 3], [4, 5], [8], [12, 13, 14, 15]]"],
  ["booleans", "pushed(4, (x, y) => (x + y) % 2 === 0)"],
  ["objects", "pushed(4, (x, y) => ({ v: x + y }))"],
  ["large", "pushed(4, (x, y) => 2147483646 + x + y)"],
  ["by-length", "Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => x - y))"],
];
// `E` is grid[y][x], `i` counts.
const steps: [name: string, text: string][] = [
  ["add", "E += i;"],
  ["increment", "E++;"],
  ["assign", "E = i;"],
  ["assign-double", "E = i * 0.5;"],
  ["by-test", "if (E > 7) E = E - 5;\nelse E = E + 3;"],
  ["largest", "E = Math.max(E, i);"],
  ["int32", "E = (E * 31 + i) | 0;"],
  ["neighbor", "E += grid[y][0];"],
  ["above", "if (y > 0) E = grid[y - 1][x] + 1;"],
  ["swapped", "[E, grid[0][0]] = [grid[0][0], E];"],
  ["row-kept", "const row = grid[y];\nrow[x] += i;"],
  ["row-kept-twice", "const row = grid[y];\nrow[x] = row[x] + 1;\nrow[0] += 1;"],
  ["flag", "E = !E;"],
  ["text", 'E = "w" + i;'],
  ["old", "const old = E;\nE = i;\nsum += Number(old) || 0;"],
  ["row-pushed", "grid[y].push?.(i);"],
  ["row-replaced", "if (i === 3) grid[y] = grid[y].slice();\nE += 1;"],
  ["sum", "sum += Number(E) || 0;"],
  ["sum-of-four", "sum += (Number(E) || 0) + (Number(grid[y][(x + 1) & 3]) || 0);"],
  ["or", "E ||= 4;"],
  ["product", "E *= 2;"],
  ["minus-zero", "E = -E;"],
];
const indexes: [name: string, text: string][] = [
  ["remainders", "const x = (i * 5) % 4, y = (i * 3) % 4;"],
  ["masks", "const x = i & 3, y = (i * 3) & 3;"],
  ["division", "const x = i % 4, y = (i / 4) | 0 & 3;"],
  ["shift", "const x = i & 3, y = (i >> 2) & 3;"],
  ["constant-row", "const x = i & 3, y = 1;"],
  ["constant-column", "const x = 2, y = i & 3;"],
  ["diagonal", "const x = i & 3, y = x;"],
  ["from-lists", "const x = columns[i & 3], y = lines[i & 3];"],
  ["floor", "const x = Math.floor(i / 2) & 3, y = i & 3;"],
  ["beyond", "const x = i % 5, y = i & 3;"],
  ["backwards", "const x = 3 - (i & 3), y = 3 - ((i >> 1) & 3);"],
];
const loops: [name: string, text: string][] = [
  ["counted", "for (let i = 0; i < n; i++) {\n  INDEX\n  STEP\n}"],
  ["nested", "for (let y = 0; y < 4; y++)\n  for (let x = 0; x < 4; x++) {\n    const i = y + x;\n    STEP\n  }"],
  [
    "nested-by-length",
    "for (let y = 0; y < grid.length; y++)\n  for (let x = 0; x < grid[y].length && x < 6; x++) {\n    const i = y * 2 + x;\n    STEP\n  }",
  ],
  ["while", "let i = 0;\nwhile (i < n) {\n  INDEX\n  STEP\n  i++;\n}"],
  ["callback", "[0, 1, 2, 3, 4].forEach(i => {\n  INDEX\n  STEP\n});"],
  ["function", "const step = i => {\n  INDEX\n  STEP\n};\nfor (let i = 0; i < n; i++) step(i);"],
  ["twice", "for (let round = 0; round < 2; round++)\n  for (let i = 0; i < n; i++) {\n    INDEX\n    STEP\n  }"],
  [
    "tried",
    "for (let i = 0; i < n; i++) {\n  try {\n    INDEX\n    STEP\n  } catch (error) {\n    sum += 1000;\n  }\n}",
  ],
  [
    "inner-break",
    "for (let y = 0; y < 4; y++)\n  for (let x = 0; x < 4; x++) {\n    const i = x;\n    if (x > y) break;\n    STEP\n  }",
  ],
];
const sharings: [name: string, text: string][] = [
  ["own", ""],
  ["shared-rows", "grid[1] = grid[2];\ngrid[0] = grid[3];"],
  ["one-missing", "if (n === 9) grid.length = 3;"],
  ["other-kind", "if (n === 9) grid[1] = [0.5, 0.5, 0.5, 0.5];"],
  ["frozen-row", "if (n === 9) Object.freeze(grid[1]);"],
];
const reads: [name: string, text: string][] = [
  ["whole", ""],
  ["sum-of-all", "for (const row of grid) for (const cell of row) sum += Number(cell) || 0;"],
  [
    "by-index",
    "for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) sum += Number(grid[y][x]) || 0;",
  ],
];
const total = rows.length * steps.length * indexes.length * loops.length * sharings.length * reads.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const made = pick(rows);
  const step = pick(steps);
  const index = pick(indexes);
  const loop = pick(loops);
  const sharing = pick(sharings);
  const read = pick(reads);
  const isTyped = cell % 3 === 2;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const type = (text: string) => (isTyped ? text : "");
  const stepped = step[1].replaceAll(/\bE\b/g, "grid[y][x]");
  const body = loop[1].replace("INDEX", () => index[1]).replace("STEP", () => `{\n${indent(stepped, "  ")}\n}`);
  // Half of the typed programs name the rows for what they mostly are.
  const of = cell % 2 ? "any" : "any[][]";
  const typed = isTyped
    ? body.replaceAll("i => {", "(i: number) => {").replaceAll("catch (error)", "catch (error: any)")
    : body;
  const lines = [
    `const show = (value${type(": any")})${type(": string")} => (typeof value === "object" && value ? "{" + value.v + "}" : Object.is(value, -0) ? "-0" : String(value));`,
    ...(/pushed\(/.test(made[1]) ? [`const pushed = (n${type(": number")}, value${type(": any")})${type(": any")} => {\n  const grid${type(": any[]")} = [];\n  for (let y = 0; y < n; y++) {\n    const row${type(": any[]")} = [];\n    for (let x = 0; x < n; x++) row.push(value(x, y));\n    grid.push(row);\n  }\n  return grid;\n};`] : []),
    ...(/columns/.test(body) ? ["const columns = [2, 0, 3, 1];", "const lines = [1, 3, 0, 2];"] : []),
    `const notes${type(": string[]")} = [];`,
    `function work(grid${type(": " + of)}, n${type(": number")}) {`,
    `  let sum${type(": any")} = 0;`,
    ...(sharing[1] ? [indent(sharing[1], "  ")] : []),
    indent(typed, "  "),
    ...(read[1] ? [indent(read[1], "  ")] : []),
    `  notes.push(Array.from(grid, (row${type(": any")}) => Array.from(row, show).join()).join("/") + ":" + show(sum));`,
    "}",
    "for (const n of [9, 4, 16]) {",
    "  try {",
    `    work(${isTyped ? made[1].replaceAll("(x, y) =>", "(x: number, y: number) =>").replaceAll("(_, y)", "(_: any, y: number)").replaceAll("(_, x)", "(_: any, x: number)") : made[1]}${type(" as any")}, n);`,
    "  } catch (error) {",
    `    notes.push((error${type(" as any")}).name);`,
    "  }",
    "}",
    'console.log(notes.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${made[0]}--${step[0]}--${index[0]}--${loop[0]}--${sharing[0]}--${read[0]}.${isTyped ? "ts" : "mjs"}`,
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
