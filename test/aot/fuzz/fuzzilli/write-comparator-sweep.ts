// Lists that are sorted by a comparator: the list, times what it compares by, times what else the comparator does, times how it is called, times what happens on the way, times the place.
//
//   bun write-comparator-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<key>--<answer>--<effect>--<call>--<place>.mjs, .cjs or .ts
//   bun write-comparator-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number.
const lists: [name: string, text: string][] = [
  ["integers", "[3, 1, 2, 5, 4, 9, 8]"],
  ["doubles", "[0.5, -1.5, 2.25, 0, -0]"],
  ["texts", '["b", "a", "Z", "", "aa"]'],
  ["objects", "[{ v: 3 }, { v: 1 }, { v: 2 }, { v: 1 }]"],
  ["instances", "[new Item(3), new Item(1), new Wide(2), new Item(0.5)]"],
  ["pairs", "[[2, 'b'], [1, 'a'], [2, 'a'], [0, 'c']]"],
  ["mixed", "[3, 'a', null, undefined, 1, NaN]"],
  ["holes", "[3, , 1, , 2]"],
  ["long", "Array.from({ length: 60 }, (_, at) => (at * 7) % 13)"],
  ["long-objects", "Array.from({ length: 40 }, (_, at) => ({ v: (at * 5) % 11, at }))"],
  ["sorted", "[1, 2, 3, 4]"],
  ["one", "[1]"],
  ["empty", "[]"],
  ["bytes", "new Uint8Array([5, 1, 4])"],
  ["floats", "new Float64Array([0.5, NaN, -1, -0, 0])"],
  ["bigs", "[3n, 1n, 2n]"],
  ["frozen", "Object.freeze([2, 1])"],
  ["subclass", "Items.from([3, 1, 2])"],
];
// What an element is compared by; `x` is the element.
const keys: [name: string, text: string][] = [
  ["itself", "x"],
  ["field", "x.v"],
  ["optional", "x?.v"],
  ["method", "x.size()"],
  ["first", "x[0]"],
  ["second", "x[1]"],
  ["helper", "key(x)"],
  ["deep-helper", "outer(x)"],
  ["negated", "(-x)"],
  ["length", "String(x).length"],
  ["table", "(ranks[x] ?? 9)"],
  ["map", "(byName.get(x) ?? 0)"],
  ["captured", "(x * scale)"],
  ["remainder", "(x % 3)"],
  ["or", "(x || 0)"],
  ["number", "Number(x)"],
  ["counted", "counted(x)"],
  ["memo", "(memo[x] ??= key(x))"],
];
// `a` and `b` are the two keys.
const answers: [name: string, text: string][] = [
  ["difference", "return KA - KB;"],
  ["reversed", "return KB - KA;"],
  ["three-ways", "return KA < KB ? -1 : KA > KB ? 1 : 0;"],
  ["truth", "return KA > KB;"],
  ["only-less", "return KA < KB ? -1 : 1;"],
  ["or-second", "return KA - KB || String(a).length - String(b).length;"],
  ["texts", "return String(KA).localeCompare(String(KB));"],
  ["if", "const one = KA;\nconst two = KB;\nif (one === two) return 0;\nif (one < two) return -1;\nreturn 1;"],
  ["swapped", "[a, b] = [b, a];\nreturn KA - KB;"],
  ["nothing", "KA;\nreturn undefined;"],
  ["zero", "return 0;"],
  ["not-a-number", "return KA - 'x';"],
  ["big", "return KA < KB ? -1n : 1;"],
];
const effects: [name: string, text: string][] = [
  ["none", ""],
  ["counts", "turns++;"],
  ["throws", "if (++turns === 4) throw new RangeError('c');"],
  ["scale", "scale = -scale;"],
  ["grows", "if (++turns === 2 && Array.isArray(list) && !Object.isFrozen(list)) list.push(7);"],
  ["shortens", "if (++turns === 2 && Array.isArray(list) && !Object.isFrozen(list)) list.length = 1;"],
  ["writes-field", "if (a && typeof a === 'object' && !Object.isFrozen(a)) a.seen = ++turns;"],
  ["writes-key", "if (++turns === 3 && b && typeof b === 'object' && 'v' in b) b.v = 0;"],
  ["tells", "if (told.length < 12) told.push(show(a) + show(b));"],
  ["replaces-key", "if (++turns === 2) key = x => -x;"],
];
const calls: [name: string, text: string][] = [
  ["sort", "list.sort(COMPARE)"],
  ["to-sorted", "list.toSorted(COMPARE)"],
  ["copy", "[...list].sort(COMPARE)"],
  ["slice", "list.slice().sort(COMPARE)"],
  ["filtered", "Array.prototype.filter.call(list, x => x !== 1).sort(COMPARE)"],
  ["named", "list.sort(compare)"],
  ["by-call", "Array.prototype.sort.call(list, compare)"],
  ["first", "[...list].sort(COMPARE)[0]"],
  ["by-hand", "insertion([...list], compare)"],
  ["reduced", "[...list].reduce((one, two) => (compare(one, two) > 0 ? two : one), list[0])"],
  ["twice", "[...list].sort(compare).sort(compare)"],
  ["bound", "list.sort(compare.bind(null))"],
];
// `SORT` is the statement.
const places: [name: string, text: string][] = [
  ["once", "SORT"],
  ["loop", "for (let i = 0; i < 3; i++) {\n  SORT\n}"],
  ["function", "const go = () => {\n  SORT\n};\ngo();\ngo();"],
  ["tried", "for (let i = 0; i < 2; i++) {\n  try {\n    SORT\n  } catch (error) {\n    out.push(error.name);\n  }\n}"],
  ["callback", "[0, 1].forEach(() => {\n  SORT\n});"],
];
const total = lists.length * keys.length * answers.length * effects.length * calls.length * places.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const key = pick(keys);
  const list = pick(lists);
  const answer = pick(answers);
  const call = pick(calls);
  const effect = pick(effects);
  const place = pick(places);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const body = [effect[1], answer[1].replaceAll("KA", key[1].replaceAll(/\bx\b/g, "a")).replaceAll("KB", key[1].replaceAll(/\bx\b/g, "b"))].filter(Boolean).join("\n"); // prettier-ignore
  const written = `(a, b) => {\n${indent(body, "  ")}\n}`;
  const isNamed = !/COMPARE/.test(call[1]);
  const sort = `result = ${call[1].replace("COMPARE", () => written)};\nout.push(show(result), show(list));`;
  const whole = body + sort + list[1];
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 24) }, (_, at) => (at in value ? show(value[at]) : "hole")) + "]" : ArrayBuffer.isView(value) ? "<" + Array.from(value).map(show) + ">" : typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? "(" + Object.entries(value).map(([name, held]) => name + ":" + show(held)) + ")" : Object.is(value, -0) ? "-0" : String(value));',
    "const out = [];",
    ...(/\bItem\b|\bWide\b/.test(whole) ? ["class Item {\n  constructor(v) {\n    this.v = v;\n  }\n  size() {\n    return this.v;\n  }\n}\nclass Wide extends Item {\n  size() {\n    return super.size() * 2;\n  }\n}"] : []), // prettier-ignore
    ...(/\bItems\b/.test(whole) ? ["class Items extends Array {}"] : []),
    ...(/\bkey\b|\bouter\(/.test(whole) ? ["let key = x => (typeof x === 'object' && x ? x.v : x);"] : []),
    ...(/\bouter\(/.test(whole) ? ["const outer = x => key(x) * 2;"] : []),
    ...(/\bcounted\(/.test(whole) ? ["let asked = 0;\nconst counted = x => {\n  asked++;\n  return +x || 0;\n};"] : []),
    ...(/\branks\b/.test(whole) ? ["const ranks = { 1: 3, 2: 1, a: 2, b: 0 };"] : []),
    ...(/\bbyName\b/.test(whole) ? ["const byName = new Map([[1, 5], [2, 1], ['a', 3]]);"] : []),
    ...(/\binsertion\(/.test(whole) ? ["function insertion(items, by) {\n  for (let i = 1; i < items.length; i++) {\n    const item = items[i];\n    let j = i;\n    while (j > 0 && by(items[j - 1], item) > 0) {\n      items[j] = items[j - 1];\n      j--;\n    }\n    items[j] = item;\n  }\n  return items;\n}"] : []), // prettier-ignore
    "function work() {",
    `  const list = ${list[1]};`,
    "  let result;",
    ...(/\bturns\b/.test(whole) ? ["  let turns = 0;"] : []),
    ...(/\bscale\b/.test(whole) ? ["  let scale = 2;"] : []),
    ...(/\btold\b/.test(whole) ? ["  const told = [];"] : []),
    ...(/\bmemo\b/.test(whole) ? ["  const memo = {};"] : []),
    ...(isNamed ? [indent(`const compare = ${written};`, "  ")] : []),
    indent(within(place[1], "SORT", sort), "  "),
    `  out.push(${/\bturns\b/.test(whole) ? "turns > 0, " : ""}${/\btold\b/.test(whole) ? "told.length > 0, " : ""}"end");`,
    "}",
    "for (let round = 0; round < 2; round++) {",
    "  try {",
    "    work();",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1500));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${key[0]}--${answer[0]}--${effect[0]}--${call[0]}--${place[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
