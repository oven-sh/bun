// Callbacks over lists with holes: the list, times the method, times the callback, times what the callback does to the list, times what stands behind the holes.
//
//   bun write-hole-callback-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<method>--<callback>--<change>--<behind>.ts or .mjs
//   bun write-hole-callback-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number from 2.
const lists: [name: string, text: string][] = [
  ["hole-in-the-middle", "[1, , 3, 4]"],
  ["hole-first", "[, 2, 3]"],
  ["hole-last", "[1, 2, , ]"],
  ["holes-alone", "[, , , ]"],
  ["bare", "new Array(n + 1)"],
  ["doubles", "[0.5, , -0, NaN]"],
  ["texts", '["a", , "c"]'],
  ["objects", "[{ v: 1 }, , { v: n }]"],
  ["nothing-and-hole", "[undefined, , null, 1]"],
  ["lists", "[[1], , [n, 2]]"],
  ["deleted", "without([1, 2, 3, 4], 1)"],
  ["deleted-doubles", "without([0.5, 1.5, 2.5], 0)"],
  ["longer", "longer([1, 2], 4)"],
  ["beyond", "beyond([1, 2], 5)"],
  ["assigned", "filled(n)"],
  ["full", "[1, 2, 3, 4]"],
  ["empty", "[]"],
  ["far", "far(n)"],
  ["copied", "[1, , 3].slice()"],
  ["concatenated", "[1, , 2].concat([, 4])"],
  ["spread", "[...[1, , 3]]"],
  ["frozen", "Object.freeze([1, , 3])"],
];
// `F` is the callback.
const methods: [name: string, text: string][] = [
  ["for-each", "list.forEach(F);"],
  ["map", "answer = list.map(F);"],
  ["map-length", "answer = list.map(F).length;"],
  ["filter", "answer = list.filter(F);"],
  ["reduce", 'answer = list.reduce((left, item, at) => show(left) + show((F)(item, at, list)), "");'],
  ["reduce-first", "answer = list.reduce((left, item, at) => ((F)(item, at, list) ? item : left));"],
  ["reduce-right", 'answer = list.reduceRight((left, item, at) => show(left) + show((F)(item, at, list)), "");'],
  ["some", "answer = list.some(F);"],
  ["every", "answer = list.every(F);"],
  ["find", "answer = list.find(F);"],
  ["find-index", "answer = list.findIndex(F);"],
  ["find-last", "answer = list.findLast(F);"],
  ["flat-map", "answer = list.flatMap(F);"],
  ["from", "answer = Array.from(list, F);"],
  ["sort", "answer = list.slice().sort((a, b) => Number((F)(a, 0, list)) - Number((F)(b, 1, list)));"],
  ["map-filter", "answer = list.map(F).filter(value => value !== undefined);"],
  ["filter-map", "answer = list.filter((item, at) => at !== 1).map(F);"],
  ["map-reduce", 'answer = list.map(F).reduce((left, item) => left + show(item), "");'],
  ["keys-map", "answer = [...list.keys()].map(at => (F)(list[at], at, list));"],
  ["entries", "answer = [];\nfor (const [at, item] of list.entries()) answer.push((F)(item, at, list));"],
  ["in-loop", "answer = [];\nfor (const at in list) answer.push((F)(list[at], Number(at), list));"],
  ["of-loop", "answer = [];\nfor (const item of list) answer.push((F)(item, answer.length, list));"],
  [
    "counted-loop",
    "answer = [];\nfor (let at = 0; at < list.length && at < 9; at++) answer.push((F)(list[at], at, list));",
  ],
  ["call", "answer = Array.prototype.map.call(list, F);"],
];
// `CHANGE` stands at its start.
const callbacks: [name: string, text: string][] = [
  ["item", "(item, at) => {\n  CHANGE\n  return item;\n}"],
  ["plus", "(item, at) => {\n  CHANGE\n  return item + 1;\n}"],
  ["truth", "(item, at) => {\n  CHANGE\n  return item !== undefined;\n}"],
  ["index", "(item, at) => {\n  CHANGE\n  return at;\n}"],
  ["sum", "(item, at) => {\n  CHANGE\n  sum += item;\n  return sum;\n}"],
  ["text", "(item, at) => {\n  CHANGE\n  text += show(item);\n  return text.length;\n}"],
  ["third", "(item, at, all) => {\n  CHANGE\n  return all.length;\n}"],
  ["counts", "(item, at) => {\n  CHANGE\n  calls++;\n  return calls;\n}"],
  ["compared", "(item, at) => {\n  CHANGE\n  return item > 1;\n}"],
  ["list", "(item, at) => {\n  CHANGE\n  return [item, at];\n}"],
  ["throws", '(item, at) => {\n  CHANGE\n  if (item === 3) throw new RangeError("c");\n  return item;\n}'],
  ["field", "(item, at) => {\n  CHANGE\n  return item?.v;\n}"],
  ["product", "(item, at) => {\n  CHANGE\n  return Math.imul(item, 3) | at;\n}"],
];
const changes: [name: string, text: string][] = [
  ["none", ""],
  ["fills", "if (at === 0) list[1] = 8;"],
  ["fills-double", "if (at === 0) list[1] = 0.25;"],
  ["fills-text", 'if (at === 0) list[1] = "w";'],
  ["deletes", "if (at === 0) delete list[2];"],
  ["pushes", "if (list.length < 6) list.push(7);"],
  ["shortens", "if (at === 1) list.length = 2;"],
  ["empties", "list.length = 0;"],
  ["lengthens", "if (at === 0) list.length += 2;"],
  ["shifts", "if (at === 0) list.shift();"],
];
// What stands under an index of the prototype of the list.
const behinds: [name: string, text: string][] = [
  ["nothing", ""],
  ["nothing-again", ""],
  [
    "element",
    "if (Object.isExtensible(list))\n  Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { value: 77, writable: true } }));",
  ],
];
const total = lists.length * methods.length * callbacks.length * changes.length * behinds.length * lists.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const list = pick(lists);
  const method = pick(methods);
  const callback = pick(callbacks);
  const change = pick(changes);
  const behind = pick(behinds);
  const other = pick(lists);
  const isTyped = cell % 2 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const type = (text: string) => (isTyped ? text : "");
  // The typed callbacks name the types of their parameters.
  const called = callback[1]
    .replace("CHANGE", () => change[1])
    .replace("(item, at, all)", () => `(item${type(": any")}, at${type(": number")}, all${type(": any[]")})${type(": any")}`)
    .replace("(item, at)", () => `(item${type(": any")}, at${type(": number")})${type(": any")}`)
    .split("\n").filter(line => line.trim()).join("\n"); // prettier-ignore
  const text = method[1]
    .replaceAll(/\(F\)\(/g, () => "callback(")
    .replaceAll(/\bF\b/g, () => "callback")
    .replace("(left, item, at)", () => `(left${type(": any")}, item${type(": any")}, at${type(": number")})`)
    .replace("(left, item)", () => `(left${type(": any")}, item${type(": any")})`)
    .replace("(a, b)", () => `(a${type(": any")}, b${type(": any")})`)
    .replace("(item, at) =>", () => `(item${type(": any")}, at${type(": number")}) =>`)
    .replace("value =>", () => `(value${type(": any")}) =>`)
    .replace("callback(item, at, list)", "callback(item, at, list)");
  const isInline = cell % 5 !== 0 && !method[1].includes("(F)(");
  const lines = [
    `const show = (value${type(": any")})${type(": string")} => (Array.isArray(value) ? "[" + Array.from({ length: value.length }, (_, at) => (at in value ? show(value[at]) : "hole")).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : String(value));`,
    `const without = (list${type(": any[]")}, at${type(": number")}) => {\n  delete list[at];\n  return list;\n};`,
    `const longer = (list${type(": any[]")}, length${type(": number")}) => {\n  list.length = length;\n  return list;\n};`,
    `const beyond = (list${type(": any[]")}, at${type(": number")}) => {\n  list[at] = 9;\n  return list;\n};`,
    `const filled = (n${type(": number")}) => {\n  const list${type(": any[]")} = [];\n  for (let at = 0; at < n * 2; at += 2) list[at] = at;\n  return list;\n};`,
    `const far = (n${type(": number")}) => {\n  const list${type(": any[]")} = [1];\n  list[300] = n;\n  return list;\n};`,
    `const notes${type(": string[]")} = [];`,
    "let calls = 0;",
    `function work(list${type(": any[]")}, n${type(": number")})${type(": any")} {`,
    `  let answer${type(": any")};`,
    `  let sum${type(": any")} = 0;`,
    '  let text = "";',
    ...(behind[1] ? [indent(behind[1], "  ")] : []),
    ...(isInline ? [indent(text.replaceAll(/\bcallback\b/g, () => called), "  ")] : [`  const callback${type(": any")} = ${indent(called, "  ").trimStart()};`, indent(text, "  ")]),
    "  return [answer, sum, text, list.length];",
    "}",
    "for (const n of [2, 3]) {",
    `  for (const list of [${list[1]}, ${other[1]}]${type(" as any[][]")}) {`,
    "    try {",
    "      notes.push(show(work(list, n)).slice(0, 200));",
    "    } catch (error) {",
    `      notes.push((error${type(" as any")}).name);`,
    "    }",
    "  }",
    "}",
    'console.log(notes.join(" "), calls);',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${list[0]}--${method[0]}--${callback[0]}--${change[0]}--${behind[0]}${isTyped ? ".ts" : ".mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
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
