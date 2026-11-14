// Elements read and written by methods: what the list holds, times the method, times the index, times what happens to the list before, times how the answer is used.
//
//   bun write-element-method-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<method>--<index>--<change>--<use>.ts or .mjs
//   bun write-element-method-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number from 2.
const lists: [name: string, text: string][] = [
  ["integers", "[1, 2, 3, 4]"],
  ["doubles", "[0.5, 1.5, -0, NaN]"],
  ["mixed-numbers", "[1, 0.5, n, 4]"],
  ["texts", '["a", "b", "cd"]'],
  ["truths", "[true, false, true]"],
  ["objects", "[{ v: 1 }, { v: n }]"],
  ["mixed", '[1, "b", null, undefined]'],
  ["holes", "[1, , 3, 4]"],
  ["empty", "[]"],
  ["one", "[n]"],
  ["filled", "new Array(n).fill(0)"],
  ["made", "Array.from({ length: n + 1 }, (_, i) => i * 2)"],
  ["bare", "new Array(n)"],
  ["bytes", "new Uint8Array([1, 255, 3])"],
  ["typed-doubles", "new Float64Array([0.5, -0, 2])"],
  ["large-integers", "[2 ** 31, 2 ** 32, 1]"],
  ["frozen", "Object.freeze([1, 2, 3])"],
  ["lists", "[[1], [n, 2]]"],
  ["subclass", "Items.from([1, 2, 3])"],
  ["split", '"a,b,c".split(",")'],
];
// `list` is the list, `K` the index.
const methods: [name: string, text: string][] = [
  ["at", "list.at(K)"],
  ["index", "list[K]"],
  ["at-or", "list.at(K) ?? -1"],
  ["at-twice", "[list.at(K), list.at(-1)]"],
  ["with", "list.with(K, list[0])"],
  ["slice-first", "list.slice(K)[0]"],
  ["slice-length", "list.slice(K).length"],
  ["slice-two", "list.slice(0, K).length"],
  ["index-of", "list.indexOf(list[0], K)"],
  ["last-index-of", "list.lastIndexOf(list[0], K)"],
  ["includes", "list.includes(list[1], K)"],
  ["fill", "list.slice().fill(list[0], K).length"],
  ["copied", "list.slice().copyWithin(0, K)[0]"],
  ["spliced", "Array.from(list).splice(K, 1)[0]"],
  ["to-spliced", "Array.from(list).toSpliced(K, 1).length"],
  ["found", "list.find((item, at) => at === K)"],
  ["found-last", "list.findLast((item, at) => at !== K)"],
  ["found-index", "list.findIndex((item, at) => at >= K)"],
  ["some", "list.some((item, at) => at > K)"],
  ["filtered", "list.filter((item, at) => at !== K).length"],
  ["reversed", "list.toReversed()[K]"],
  ["sorted", "list.toSorted()[K]"],
  ["joined", "list.slice(K).join()"],
  ["concatenated", "[].concat(Array.from(list), [9])[K]"],
  ["popped", "Array.from(list).slice(0, K).pop()"],
  ["shifted", "Array.from(list).slice(K).shift()"],
  ["has", "K in list"],
  ["has-own", "Object.hasOwn(list, K)"],
  ["entries", "[...list.entries()][K]?.[1]"],
  ["stored", "((copy, at) => {\n  copy[at] = 7;\n  return copy.length;\n})(Array.from(list), K)"],
  ["stored-read", "((copy, at) => {\n  copy[at] = 0.25;\n  return copy.at(at);\n})(Array.from(list), K)"],
  ["reduced", "list.reduce((sum, item, at) => (at === K ? sum + 1 : sum), 0)"],
];
const indexes: [name: string, text: string][] = [
  ["counter", "k"],
  ["negative", "-k"],
  ["from-behind", "-1 - k"],
  ["last", "list.length - 1"],
  ["length", "list.length"],
  ["before", "k - 1"],
  ["behind", "k + 1"],
  ["integer", "(k * 1.5) | 0"],
  ["unsigned", "(k - 1) >>> 0"],
  ["half", "k * 0.5"],
  ["zero", "0"],
  ["negative-zero", "-0"],
  ["not-a-number", "NaN"],
  ["nothing", "undefined"],
  ["large", "k + 2 ** 32"],
  ["old-length", "old"],
  ["old-last", "old - 1"],
  ["smaller", "Math.min(k, list.length - 1)"],
  ["masked", "k & 1"],
];
const changes: [name: string, text: string][] = [
  ["none", ""],
  ["push", "list.push(5);"],
  ["push-text", 'list.push("p");'],
  ["push-double", "list.push(0.5);"],
  ["pop", "list.pop();"],
  ["shift", "list.shift();"],
  ["unshift", "list.unshift(8);"],
  ["shorter", "list.length = 1;"],
  ["longer", "list.length += 2;"],
  ["beyond", "list[list.length + 1] = 6;"],
  ["appended", "list[list.length] = true;"],
  ["hole", "delete list[0];"],
  ["frozen", "Object.freeze(list);"],
  ["sealed", "Object.seal(list);"],
  ["sorted", "list.sort();"],
  ["spliced", "list.splice(1, 1, 4, 5);"],
];
// `ASK` is the call of a method, `note` keeps an answer.
const uses: [name: string, text: string][] = [
  ["returned", "const k = n - 1;\nreturn ASK;"],
  ["sum", "let sum = 0;\nfor (let k = 0; k < n; k++) sum += ASK;\nreturn sum;"],
  ["text", 'let text = "";\nfor (let k = 0; k < n + 2; k++) text += show(ASK) + ";";\nreturn text;'],
  ["down", "const out = [];\nfor (let k = n; k >= 0; k--) out.push(ASK);\nreturn out;"],
  [
    "length-loop",
    "const out = [];\nfor (let k = 0; k < Math.min(list.length, 8); k++) out[out.length] = ASK;\nreturn out;",
  ],
  ["old-loop", "const out = [];\nfor (let k = 0; k < old; k++) out.push(ASK);\nreturn out;"],
  ["condition", "let turns = 0;\nfor (let k = 0; k < n; k++) if (ASK) turns++;\nreturn turns;"],
  ["compared", "let turns = 0;\nfor (let k = 0; k < n; k++) if (ASK > 1) turns++;\nreturn turns;"],
  ["product", "let product = 1;\nfor (let k = 0; k < n; k++) product = Math.imul(product, ASK) | 1;\nreturn product;"],
  ["in-a-callback", "return [0, 1, 2].map(k => ASK);"],
  [
    "doubled",
    "const double = value => value * 2;\nlet sum = 0;\nfor (let k = 0; k < n; k++) sum += double(ASK);\nreturn sum;",
  ],
  ["kept", "const row = { v: undefined };\nfor (let k = 0; k < n; k++) row.v = ASK;\nreturn row.v;"],
  [
    "tried",
    "const out = [];\nfor (let k = 0; k < n; k++) {\n  try {\n    out.push(ASK);\n  } catch (error) {\n    out.push(error.name);\n  }\n}\nreturn out;",
  ],
];
const total = lists.length * methods.length * indexes.length * changes.length * uses.length * lists.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const list = pick(lists);
  const method = pick(methods);
  const index = pick(indexes);
  const change = pick(changes);
  const use = pick(uses);
  const other = pick(lists);
  // Every third program writes the types that it takes the lists for.
  const isTyped = cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const ask = method[1].replaceAll(/\bK\b/g, () =>
    /^[a-z.]+$/.test(index[1]) && index[1] !== "undefined"
      ? index[1]
      : `(${index[1]}${isTyped && !/[a-z]/.test(index[1].replace(/undefined|NaN/, "")) ? " as any" : ""})`,
  );
  const type = (text: string) => (isTyped ? text : "");
  const lines = [
    `class Items extends Array${type("<any>")} {}`,
    `const show = (value${type(": any")})${type(": string")} => (Array.isArray(value) ? "[" + Array.from(value, show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : String(value));`,
    `const notes${type(": string[]")} = [];`,
    `function ask(list${type(": any[]")}, n${type(": number")})${type(": any")} {`,
    "  const old = list.length;",
    ...(change[1] ? [`  if (Array.isArray(list)) ${change[1]}`] : []),
    indent(isTyped ? use[1].replace("const out = []", "const out: any[] = []").replace("let sum = 0", "let sum: any = 0").replace("value => value * 2", "(value: any): any => value * 2").replace("{ v: undefined }", "{ v: undefined as any }").replace("(error)", "(error: any)") : use[1], "  ").replace("ASK", () => (isTyped ? `(${ask} as any)` : ask)), // prettier-ignore
    "}",
    "for (const n of [2, 4, 3]) {",
    "  try {",
    `    notes.push(show(ask(${list[1]}${type(" as any")}, n)));`,
    "  } catch (error) {",
    `    notes.push((error${type(" as any")}).name);`,
    "  }",
    "  try {",
    `    notes.push(show(ask(${other[1]}${type(" as any")}, n)));`,
    "  } catch (error) {",
    `    notes.push((error${type(" as any")}).name);`,
    "  }",
    "}",
    'console.log(notes.join(" "));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${list[0]}--${method[0]}--${index[0]}--${change[0]}--${use[0]}${isTyped ? ".ts" : ".mjs"}`,
    text: lines.join("\n") + "\n",
  };
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
