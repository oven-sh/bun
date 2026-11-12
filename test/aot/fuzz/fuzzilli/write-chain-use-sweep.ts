// Calls in a row on a list: what the list holds, times the first call, times the second, times what ends the row, times the callbacks, times where the row stands. Callbacks note what they are handed.
//
//   bun write-chain-use-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<first>--<second>--<end>--<callback>--<place>.mjs
//   bun write-chain-use-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const lists: [name: string, text: string][] = [
  ["integers", "[n, 2, 3, n + 4]"],
  ["halves", "[0.5, n, 1.5, -0]"],
  ["texts", '["b", "a" + n, "", "c"]'],
  ["rows", "[{ v: n }, { v: 2, w: 1 }, new Row(3)]"],
  ["instances", "[new Row(n), new Row(1), new Row(n)]"],
  ["holes", "[n, , 3, , 5]"],
  ["nothings", "[undefined, n, null, 0]"],
  ["nested", "[[n, 1], [], [2, [3]]]"],
  ["mixed", '[n, "t", 1.5, null, { v: 1 }]'],
  ["empty", "[]"],
  ["one", "[n]"],
  ["long", "Array.from({ length: 40 }, (_, at) => (at * 7) % 11)"],
  ["parsed", 'JSON.parse("[3,1,2,10]")'],
  ["parsed-rows", 'JSON.parse(\'[{"v":1},{"v":0.5},{"v":3,"w":2}]\')'],
  ["of-the-file", "shared"],
  ["filled", "new Array(4).fill(n)"],
  ["without-elements", "new Array(3)"],
  ["frozen", "Object.freeze([n, 5, 1])"],
  ["heir", "Heir.from([n, 2, 3])"],
  ["bytes", "Uint8Array.of(n, 2, 250, 4)"],
  ["doubles", "Float64Array.of(n, 0.5, 2)"],
  ["keys", "Object.keys({ b: 1, a: n, 2: 1 })"],
  ["entries", "Object.entries({ b: 1, a: n })"],
  ["split", '"c,a,b".split(",")'],
  ["spread-set", "[...new Set([n, 2, n, 3])]"],
  ["booleans", "[true, n > 1, false]"],
  ["wide", "[2 ** 31, n, -(2 ** 33)]"],
];
// `F` is a callback of one value, `G` one that answers yes or no, `C` one that compares.
const steps: [name: string, text: string][] = [
  ["nothing", ""],
  ["map", ".map(F)"],
  ["filter", ".filter(G)"],
  ["slice", ".slice(1)"],
  ["slice-end", ".slice(-2, 3)"],
  ["concat", ".concat([7, 8])"],
  ["concat-value", ".concat(n, [n])"],
  ["flat", ".flat()"],
  ["flat-map", ".flatMap(value => [value, F(value)])"],
  ["sort", ".sort()"],
  ["sort-by", ".sort(C)"],
  ["to-sorted", ".toSorted(C)"],
  ["reverse", ".reverse()"],
  ["to-reversed", ".toReversed()"],
  ["spliced", ".toSpliced(1, 1, n)"],
  ["with", ".with(0, n)"],
  ["fill", ".fill(n, 1)"],
  ["copy-within", ".copyWithin(0, 1)"],
  ["map-index", ".map((value, at) => [at, value])"],
  ["filter-index", ".filter((_, at) => at !== 1)"],
  ["filter-truth", ".filter(Boolean)"],
  ["map-number", ".map(Number)"],
  ["map-text", ".map(String)"],
  ["steps-mapped", ".values().map(F).toArray()"],
  ["steps-filtered", ".values().filter(G).take(3).toArray()"],
  ["copied", ".map(value => value)"],
  ["unique", ".filter((value, at, all) => all.indexOf(value) === at)"],
];
// `R` is the row of calls.
const ends: [name: string, text: string][] = [
  ["shown", "note(R);"],
  ["length", "note(R.length);"],
  ["reduce", 'note(R.reduce((sum, value) => sum + (typeof value === "number" ? value : 1), 0));'],
  ["reduce-without-start", "note(R.reduce((sum, value) => (sum > value ? sum : value)));"],
  ["reduce-right", 'note(R.reduceRight((sum, value) => sum + String(value), ""));'],
  ["join", 'note(R.map(show).join("-"));'],
  ["for-each", "R.forEach((value, at) => note([at, value]));"],
  ["some", "note([R.some(G), R.every(G)]);"],
  ["find", "note([R.find(G), R.findIndex(G), R.findLast(G)]);"],
  ["index-of", "note([R.indexOf(n), R.includes(2), R.lastIndexOf(n)]);"],
  ["at", "note([R.at(-1), R.at(0), R[1]]);"],
  ["for-of", "for (const value of R) {\n  if (value === 3) continue;\n  note(value);\n}"],
  ["for-in", "for (const at in R) notes.push(at);"],
  ["counted", "const row = R;\nfor (let i = 0; i < row.length; i++) note(row[i]);"],
  ["spread", "note([0, ...R]);"],
  ["arguments", "note(Math.max(...R.map(Number)));"],
  ["pattern", "const [a, , b = 9, ...others] = R;\nnote([a, b, others]);"],
  ["pushed", "const row = R;\nrow.push?.(n);\nnote(row);"],
  ["stored", "const row = R;\nrow[0] = n;\nnote([row, list.length]);"],
  ["set", "note([...new Set(R)]);"],
  ["map-of", "note([...new Map(R.map((value, at) => [at, value]))]);"],
  ["object", 'note(Object.fromEntries(R.map((value, at) => ["k" + at, value])));'],
  ["text", "note(String(R.map(show)));"],
  ["shift", "const row = R;\nnote([row.shift?.(), row.pop?.(), row.length]);"],
  ["entries", "for (const [at, value] of R.entries()) note([at, value]);"],
  ["grouped", "note(Object.groupBy(R, value => typeof value));"],
];
const callbacks: [name: string, f: string, g: string, c: string][] = [
  ["plain", "value => value", "value => value > 1", "(a, b) => (a > b ? 1 : a < b ? -1 : 0)"],
  ["fields", "value => value?.v", "value => value?.v !== 1", "(a, b) => (a?.v ?? 0) - (b?.v ?? 0)"],
  ["makes-rows", "value => ({ v: value })", "value => !!value", "(a, b) => String(a).length - String(b).length"],
  ["numbers", "value => value * 2 + 1", "value => (value & 1) === 1", "(a, b) => b - a"],
  [
    "texts",
    'value => value + "!"',
    "value => String(value).length < 3",
    "(a, b) => String(a).localeCompare(String(b))",
  ],
  ["notes", 'value => (notes.push("f"), value)', 'value => (notes.push("g"), true)', '(a, b) => (notes.push("c"), 0)'],
  [
    "throws",
    'value => {\n  if (value === 3) throw new RangeError("f");\n  return value;\n}',
    'value => {\n  if (value === 2) throw new SyntaxError("g");\n  return true;\n}',
    '(a, b) => {\n  throw new EvalError("c");\n}',
  ],
  ["captured", "value => [value, count++]", "value => count++ !== 1", "(a, b) => (count & 1 ? -1 : 1)"],
  ["named", "named", "isWanted", "compare"],
  ["methods", "helper.f", "helper.g.bind(helper)", "(a, b) => helper.c(a, b)"],
  [
    "changes-the-list",
    "value => {\n  if (list.length < 6 && count++ < 2 && !Object.isFrozen(list)) list.push?.(9);\n  return value;\n}",
    "value => {\n  if (count++ === 1 && !Object.isFrozen(list)) list.pop?.();\n  return true;\n}",
    "(a, b) => (a < b ? -1 : 1)",
  ],
  ["kinds", 'value => (value === 2 ? "two" : value === 3 ? null : value)', 'value => value ?? ""', "() => 0"],
];
const places: [name: string, text: string][] = [
  ["loop", "for (let n = 0; n < 4; n++) {\nBODY\n}"],
  ["once", 'const n = JSON.parse("3");\nBODY'],
  ["function", "const turn = n => {\nBODY\n};\nfor (let n = 1; n < 4; n++) turn(n);"],
  [
    "tried",
    'for (let n = 1; n < 4; n++) {\n  try {\nBODY\n  } catch (error) {\n    notes.push("t" + told(error));\n  }\n}',
  ],
  ["written", "{\n  const n = 2;\nBODY\n}\n{\n  const n = 5;\nBODY\n}"],
];
const total = lists.length * steps.length * steps.length * ends.length * callbacks.length * places.length;

function write(cell: number): { name: string; text: string } {
  let rest = Number((BigInt(cell) * 829348951n) % BigInt(total));
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const place = pick(places);
  const end = pick(ends);
  const callback = pick(callbacks);
  const list = pick(lists);
  const first = pick(steps);
  const second = pick(steps);
  const indent = (text: string, by: string) => text.split("\n").filter(line => line).map(line => by + line).join("\n"); // prettier-ignore
  const given = (text: string) => text.replaceAll(/\bF\b/g, () => wrap(callback[1])).replaceAll(/\bG\b/g, () => callback[2]).replaceAll(/\bC\b/g, () => callback[3]); // prettier-ignore
  const wrap = (text: string) => (text.includes("=>") ? `(${text})` : text);
  const row = given(`list${first[1]}${second[1]}`);
  const body = `const list = ${list[1]};\n${given(end[1]).replaceAll(/\bR\b/g, () => row)}`;
  const lines = [
    "const notes = [];",
    "let count = 0;",
    'const told = error => "!" + error.name;',
    'const show = value => (Array.isArray(value) ? "[" + Array.from(value, show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : typeof value === "function" ? "function" : String(value));',
    "const note = value => void notes.push(show(value));",
    "class Row {\n  constructor(v) {\n    this.v = v;\n  }\n}",
    "class Heir extends Array {}",
    "const shared = [4, 1, 3];",
    "function named(value, at) {\n  return at === 1 ? value : at;\n}",
    "const isWanted = (value, at) => at !== 0;",
    "const compare = (a, b) => (a === b ? 0 : a < b ? 1 : -1);",
    "const helper = {\n  f: value => value,\n  g(value) {\n    return this === helper && value !== 2;\n  },\n  c: (a, b) => a - b,\n};",
    "try {",
    ...indent(place[1].replaceAll("BODY", () => indent(body, "    ")), "  ").split("\n"),
    "} catch (error) {",
    '  notes.push("left" + told(error));',
    "}",
    'console.log(notes.join(" "), count, shared.join());',
  ]; // prettier-ignore
  return { name: `${list[0]}--${first[0]}--${second[0]}--${end[0]}--${callback[0]}--${place[0]}.mjs`, text: lines.join("\n") + "\n" }; // prettier-ignore
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
