// Loops that wait while something else changes what they walk: where the loop waits, times what changes meanwhile, times when, times the loop, times what it does, times how many of the loops run at once, times what the list holds.
//
//   bun write-await-loop-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<wait>--<change>--<loop>--<use>--<runs>.ts or .mjs
//   bun write-await-loop-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `i` is the counter. `USE` is what the loop does.
const waits: [name: string, text: string][] = [
  ["in-front", "await null;\nUSE"],
  ["behind", "USE\nawait null;"],
  ["sometimes", "if (i === 1) await null;\nUSE"],
  ["twice", "await null;\nUSE\nawait null;"],
  ["call", "await tick();\nUSE"],
  ["value", "const given = await i;\nUSE\nsum += given;"],
  ["between", "const before = list.length;\nawait null;\nUSE\nsum += before;"],
  ["element-between", "const first = list[i];\nawait null;\nUSE\nnote(first);"],
  ["tried", "try {\nawait (i === 2 ? Promise.reject(i) : i);\nUSE\n} catch (error) {\nnote(error);\nUSE\n}"],
  ["finally", "try {\nUSE\n} finally {\nawait null;\n}"],
  ["inner-loop", "for (let j = 0; j < 2; j++) {\nawait null;\nUSE\n}"],
  ["for-await", "for await (const step of [1, 2]) {\nUSE\nsum += step;\n}"],
  ["leaves", "await null;\nUSE\nif (i === 3) break;"],
  ["continues", "if (i === 0) continue;\nawait null;\nUSE"],
  ["never", "if (i > 100) await null;\nUSE"],
];
// Runs while the loop waits.
const changes: [name: string, text: string][] = [
  ["nothing", ""],
  ["pop", "list.pop();"],
  ["push", "if (list.length < 9) list.push(7);"],
  ["cut", "list.length = 1;"],
  ["emptied", "list.length = 0;"],
  ["text-in", 'list[0] = "s";'],
  ["text-behind", 'list[3] = "t";'],
  ["fraction-in", "list[1] = 0.25;"],
  ["hole", "delete list[2];"],
  ["frozen", "Object.freeze(list);"],
  ["reversed", "list.reverse();"],
  ["replaced", "list = [9, 8];"],
  ["replaced-by-texts", 'list = ["x", "y", "z"];'],
  ["view-shrinks", "resize(2);"],
  ["view-grows", "resize(24);"],
  ["view-gone", "detach();"],
  ["field-text", 'row.x = "f";'],
  ["field-gone", "delete row.x;"],
  ["field-getter", 'Object.defineProperty(row, "x", { get: () => 40, configurable: true });'],
  ["row-prototype", "Object.setPrototypeOf(row, { x: 60, y: 61 });"],
  ["row-replaced", "row = { y: 1, x: 0.5 };"],
  ["bound", "bound = 2;"],
  ["bound-wide", "bound = 9;"],
  ["counter", "count += 50;"],
  ["text", 'text += "é\\u0100";'],
  ["text-cut", 'text = "";'],
  ["map", "map.clear();"],
  ["method", "ask = value => value * 100;"],
  ["element-store", "for (let at = 0; at < list.length; at++) list[at] = at;"],
];
const moments = ["1", "2", "3", "5", "8"] as const;
const loops: [name: string, text: string][] = [
  ["length", "for (let i = 0; i < list.length; i++) {\nBODY\n}"],
  ["bound", "for (let i = 0; i < bound; i++) {\nBODY\n}"],
  ["old-length", "const end = list.length;\nfor (let i = 0; i < end; i++) {\nBODY\n}"],
  ["written", "for (let i = 0; i < 5; i++) {\nBODY\n}"],
  ["down", "for (let i = list.length - 1; i >= 0; i--) {\nBODY\n}"],
  ["while", "let i = -1;\nwhile (++i < list.length) {\nBODY\n}"],
  ["for-of", "let i = -1;\nfor (const item of list) {\ni++;\nnote(item);\nBODY\n}"],
  ["entries", "for (const [i, item] of list.entries()) {\nnote(item);\nBODY\n}"],
  ["for-in", "for (const name in list) {\nconst i = Number(name);\nBODY\n}"],
  ["view-length", "for (let i = 0; i < view.length; i++) {\nBODY\n}"],
  ["nest", "for (let r = 0; r < 2; r++) {\nfor (let i = 0; i < list.length; i++) {\nBODY\n}\n}"],
  ["local-list", "const own = list;\nfor (let i = 0; i < own.length; i++) {\nnote(own[i]);\nBODY\n}"],
];
const uses: [name: string, text: string][] = [
  ["sum", "sum += list[i];"],
  ["read", "note(list[i]);"],
  ["store", "list[i] = i;"],
  ["add", "list[i] += 1;"],
  ["next", "note(list[i + 1]);"],
  ["view", "sum += view[i] ?? 1000;"],
  ["view-store", "view[i] = i + 1;"],
  ["field", "sum += row.x;"],
  ["field-store", "row.x = i;\nnote(row.x);"],
  ["two-fields", "note(row.x + row.y);"],
  ["character", "sum += text.charCodeAt(i) | 0;"],
  ["letter", "note(text[i]);"],
  ["count", "count++;\nnote(count);"],
  ["map", "map.set(i, (map.get(i) ?? 0) + 1);\nnote(map.size);"],
  ["call", "note(ask(i));"],
  ["pushed", "if (out.length < 30) out.push(list[i]);"],
  ["captured", "later.push(() => list[i]);"],
  ["pattern", "const [a, b] = list;\nnote([a, b]);"],
  ["compared", "if (list[i] > 2) sum += 10;"],
  ["index", "note(list[count % 4]);"],
  ["several", "sum += list[i] * 2 + (view[i] ?? 0) + row.y;"],
];
const runs: [name: string, text: string][] = [
  ["one", "await run();"],
  ["two", "await Promise.all([run(), run()]);"],
  ["three-in-turn", "await run();\nawait run();\nawait run();"],
  ["arrow-of-method", "await holder.run();"],
];
const lists = ["[1, 2, 3, 4]", "[0.5, 1.5, 2.5, 3]", '["a", "b", "c"]', "[1, , 3, 4]", "[{ v: 1 }, { v: 2 }, { v: 3 }]", "Array.from({ length: 5 }, (_, at) => at)"] as const; // prettier-ignore
const total = waits.length * changes.length * moments.length * loops.length * uses.length * runs.length * lists.length;

function write(cell: number): { name: string; text: string } {
  let rest = Number((BigInt(cell) * 829348951n) % BigInt(total));
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const wait = pick(waits);
  const change = pick(changes);
  const use = pick(uses);
  const loop = pick(loops);
  const moment = pick(moments);
  const run = pick(runs);
  const list = pick(lists);
  const isTyped = cell % 3 === 0;
  const t = (type: string) => (isTyped ? type : "");
  const body = ["if (--fuel < 0) break;", wait[1].replaceAll("USE", () => use[1])].join("\n"); // prettier-ignore
  const inside = [
    "  let sum = 0" + t(" as any") + ";",
    ...loop[1].replace("BODY", () => body).split("\n").map(line => "  " + line),
    "  note(sum);",
  ]; // prettier-ignore
  const lines = [
    `const notes${t(": string[]")} = [];`,
    `const show = (value${t(": any")})${t(": string")} => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + Array.from(value, show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : String(value));`,
    `const note = (value${t(": any")}) => void (notes.length < 80 && notes.push(show(value)));`,
    "const tick = async () => {\n  await null;\n};",
    `let list${t(": any")} = ${list};`,
    `const buffer${t(": any")} = new ${isTyped ? "(ArrayBuffer as any)" : "ArrayBuffer"}(16, { maxByteLength: 32 });`,
    `const view = new Int16Array(buffer);`,
    `const resize = (size${t(": number")}) => {\n  if (!buffer.detached) buffer.resize(size);\n};`,
    `const detach = () => {\n  if (!buffer.detached) buffer.transfer();\n};`,
    `let row${t(": any")} = { x: 1.5, y: 2 };`,
    "let bound = 4;",
    "let count = 0;",
    'let text = "abcdef";',
    `const map = new Map${t("<number, number>")}([[1, 5]]);`,
    `let ask = (value${t(": number")}) => value + 1;`,
    `const out${t(": any[]")} = [];`,
    `const later${t(": (() => any)[]")} = [];`,
    "let fuel = 60;",
    "async function run() {",
    ...inside,
    "}",
    "const holder = {\n  run: async () => {\n" + inside.map(line => "  " + line).join("\n") + "\n  },\n};",
    `async function change() {\n  for (let turn = 0; turn < ${moment}; turn++) await null;\n  ${change[1] || "note(0);"}\n}`,
    "const changing = change();",
    "try {",
    ...run[1].split("\n").map(line => "  " + line),
    `} catch (error${t(": any")}) {`,
    '  notes.push("!" + error.name);',
    "}",
    "await changing;",
    'console.log(notes.join(" "), show(list), buffer.detached ? "gone" : view.join(), show(row), show(out), later.map(one => show(one())).slice(0, 9).join(), [...map].join(";"));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${wait[0]}--${change[0]}--${loop[0]}--${use[0]}--${run[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" }; // prettier-ignore
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
