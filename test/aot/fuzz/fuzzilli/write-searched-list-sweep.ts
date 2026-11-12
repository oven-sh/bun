// Lists and texts that are searched or sifted: the list or text, times the search, times what is sought, times from where, times what happens on the way, times the use, times the place.
//
//   bun write-searched-list-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<search>--<sought>--<from>--<event>--<use>--<place>.mjs, .cjs or .ts
//   bun write-searched-list-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is a number, `given` a list of the caller, `i` a counter (in a turn alone).
const lists: [name: string, text: string][] = [
  ["integers", "[1, 2, 3, 2, 1]"],
  ["doubles", "[0.5, 1.5, 2, 1.5]"],
  ["texts", '["a", "bc", "a", ""]'],
  ["mixed", '[0, "", null, undefined, NaN, 1, "a", false]'],
  ["truths", "[true, false, true]"],
  ["objects", "[kept, {}, kept, null]"],
  ["holes", "[1, , 3, , 2]"],
  ["empty", "[]"],
  ["by-length", "new Array(4)"],
  ["by-length-filled", "new Array(n + 2).fill(1)"],
  ["by-length-written", "written(new Array(4))"],
  ["by-length-of-run", "written(new Array(n))"],
  ["given", "given"],
  ["zeros", "[0, -0, 0, 5]"],
  ["not-numbers", "[NaN, 1, NaN]"],
  ["bigs", "[1n, 2n, 0n]"],
  ["bytes", "new Uint8Array([1, 2, 3, 2])"],
  ["floats", "new Float32Array([0.5, NaN, -0])"],
  ["subclass", "Items.from([1, 0, 2])"],
  ["frozen", "Object.freeze([1, 2, 0])"],
  ["long", "Array.from({ length: 90 }, (_, at) => at % 7)"],
  ["text", '"abcabc"'],
  ["joined-text", '"ab" + n + "cab"'],
  ["many-joined", '["ab", n, "c"].join("-")'],
  ["wide-text", '"a\\u0100b" + n'],
  ["grown-text", "grown(n)"],
  ["sparse", "Object.assign([], { 30: 1 })"],
  ["like", "{ length: 3, 0: 1, 1: 2, 2: 1 }"],
];
// `L` the list, `S` the sought, `F` the arguments behind it.
const searches: [name: string, text: string][] = [
  ["index-of", "L.indexOf(SF)"],
  ["last-index-of", "L.lastIndexOf(SF)"],
  ["includes", "L.includes(SF)"],
  ["index-of-asked", "L.indexOf(SF) >= 0"],
  ["index-of-minus-one", "L.indexOf(SF) === -1"],
  ["not-index-of", "~L.indexOf(SF)"],
  ["by-call", "Array.prototype.indexOf.call(LSF)"],
  ["includes-by-call", "Array.prototype.includes.call(LSF)"],
  ["text-by-call", "String.prototype.indexOf.call(LSF)"],
  ["optional", "L?.indexOf?.(SF)"],
  ["starts-with", "L.startsWith(SF)"],
  ["ends-with", "L.endsWith(SF)"],
  ["split", "L.split(S).length"],
  ["replaced", 'L.replace(S, "-")'],
  ["filter-boolean", "L.filter(Boolean)"],
  ["filter-not-not", "L.filter(item => !!item)"],
  ["filter-itself", "L.filter(item => item)"],
  ["filter-equal", "L.filter(item => item === S)"],
  ["filter-larger", "L.filter((item, at) => item > at)"],
  ["filter-length", "L.filter(Boolean).length"],
  ["filter-mapped", "L.filter(Boolean).map(item => item + 1)"],
  ["find", "L.find(item => item === S)"],
  ["find-index", "L.findIndex(item => item == S)"],
  ["find-last", "L.findLast(item => item !== S)"],
  ["some", "L.some(item => item === S)"],
  ["every-boolean", "L.every(Boolean)"],
  ["some-boolean", "L.some(Boolean)"],
  ["map-boolean", "L.map(Boolean)"],
  ["by-hand", "(() => {\n  for (let k = 0; k < L.length; k++) if (L[k] === S) return k;\n  return -1;\n})()"],
];
const soughts: [name: string, text: string][] = [
  ["integer", "2"],
  ["counter", "i"],
  ["double", "1.5"],
  ["text", '"a"'],
  ["joined", '"a" + "b"'],
  ["of-run", "given[0]"],
  ["not-a-number", "NaN"],
  ["nothing", "undefined"],
  ["null", "null"],
  ["negative-zero", "-0"],
  ["object", "kept"],
  ["big", "1n"],
  ["empty", '""'],
  ["truth", "true"],
  ["last", "L[L.length - 1]"],
];
const froms: [name: string, text: string][] = [
  ["none", ""],
  ["zero", ", 0"],
  ["two", ", 2"],
  ["counter", ", i"],
  ["minus-one", ", -1"],
  ["far", ", 99"],
  ["far-below", ", -99"],
  ["double", ", 1.5"],
  ["not-a-number", ", NaN"],
  ["nothing", ", undefined"],
  ["text", ', "1"'],
  ["length", ", L.length - 1"],
  ["object", ", shortens"],
  ["infinite", ", Infinity"],
  ["of-run", ", n"],
];
const events: [name: string, text: string][] = [
  ["none", ""],
  ["kind", "if (i === 1 && Array.isArray(L)) L[0] = 0.5;"],
  ["text", 'if (i === 1 && Array.isArray(L) && !Object.isFrozen(L)) L[1] = "a";'],
  ["grown", "if (Array.isArray(L) && !Object.isFrozen(L) && L.length < 120) L.push(i);"],
  ["shortened", "if (i === 1 && Array.isArray(L) && !Object.isFrozen(L)) L.length = 1;"],
  ["exchanged", "if (i === 2) L = [2, 'a'];"],
  ["hole", "if (i === 1 && Array.isArray(L) && !Object.isFrozen(L)) delete L[0];"],
  ["longer-text", 'if (typeof L === "string") L += "a" + i;'],
];
const uses: [name: string, text: string][] = [
  ["kept", "last = VALUE;"],
  ["sum", "sum += +(VALUE);"],
  ["shown", "if (out.length < 16) out.push(show(VALUE));"],
  ["asked", "if (VALUE) sum++;"],
  ["index", "last = L[VALUE];"],
];
const places: [name: string, text: string][] = [
  ["loop", "for (let i = 0; i < 4; i++) {\n  STEP\n}"],
  ["long", "for (let i = 0; i < 70; i++) {\n  STEP\n}"],
  ["once", "const i = 1;\n{\n  STEP\n}"],
  ["callback", "[0, 1, 2].forEach(i => {\n  STEP\n});"],
  ["function", "const step = i => {\n  STEP\n};\nfor (let i = 0; i < 4; i++) step(i);"],
  ["while", "let i = 5;\nwhile (i-- > 0) {\n  STEP\n}"],
];
const total = lists.length * searches.length * soughts.length * froms.length * events.length * uses.length * places.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const search = pick(searches);
  const list = pick(lists);
  const sought = pick(soughts);
  const from = pick(froms);
  const event = pick(events);
  const use = pick(uses);
  const place = pick(places);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 5 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const named = (text: string) => text.replaceAll(/\bL\b/g, "list");
  const asked = named(search[1].replace("LSF", () => `L, ${sought[1]}${from[1]}`).replace("SF", () => sought[1] + from[1]).replaceAll(/\bS\b/g, () => sought[1])); // prettier-ignore
  const step = [named(event[1]), named(use[1]).replace("VALUE", () => asked)].filter(Boolean).join("\n");
  const body = within(place[1], "STEP", step);
  const whole = body + list[1];
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Array.isArray(value) ? "[" + Array.from({ length: Math.min(value.length, 30) }, (_, at) => (at in value ? show(value[at]) : "hole")).join() + "]" : typeof value === "bigint" ? value + "n" : typeof value === "object" && value ? "o" : Object.is(value, -0) ? "-0" : JSON.stringify(value) ?? String(value));',
    "const out = [];",
    ...(/\bkept\b/.test(whole) ? ["const kept = { v: 1 };"] : []),
    ...(/\bshortens\b/.test(whole) ? ["const shortens = {\n  valueOf() {\n    out.push('v');\n    return 1;\n  },\n};"] : []), // prettier-ignore
    ...(/\bwritten\(/.test(whole) ? [`const written = list => {\n  for (let k = 0; k < list.length; k++) list[k] = ${["k", "k / 2", "'s' + k", "k & 1 ? k : 'a'"][cell % 11 % 4]};\n  return list;\n};`] : []), // prettier-ignore
    ...(/\bgrown\(/.test(whole) ? ["const grown = n => {\n  let text = '';\n  for (let k = 0; k < n + 5; k++) text += String.fromCharCode(97 + (k % 3));\n  return text;\n};"] : []), // prettier-ignore
    ...(/\bItems\b/.test(whole) ? ["class Items extends Array {}"] : []),
    "function work(n, given) {",
    "  let sum = 0;",
    "  let last;",
    `  let list = ${list[1]};`,
    indent(body, "  "),
    "  out.push(show(sum), show(last), list.length);",
    "}",
    "for (const given of [[2, 1, 0], ['a', 'b'], [0.5, NaN]]) {",
    "  try {",
    "    work(given.length, given);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${search[0]}--${sought[0]}--${from[0]}--${event[0]}--${use[0]}--${place[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
