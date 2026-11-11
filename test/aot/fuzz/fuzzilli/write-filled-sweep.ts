// A list that a loop fills from its end: how the list is born, times where the counter begins, times what is stored, times what is done to the list in one turn, times how the bound is known, times where and how that is done.
//
//   bun write-filled-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<born>--<begins>--<stored>--<what is done>--<bound>--<where>.cjs
//   bun write-filled-sweep.ts count
//   bun write-filled-sweep.ts named <pattern> <folder> [most]
//
// `const list = [first]; for (let j = 1; j < bound; j++) list[j] = ...` stores at the end of a list that nobody else holds. A compiler may give the list its room at birth and let each store raise the length without asking
// anything, for as long as the position is the length. Here something is done to the list in the sixth turn, in sight or by a function that is reached under a key out of data.
import { mkdirSync, writeFileSync } from "node:fs";

const births: [name: string, made: string][] = [
  ["one-fraction", "[t + 0.5]"],
  ["one-whole-number", "[t]"],
  ["nothing-in-it", "[]"],
  ["two-numbers", "[t, t + 1]"],
  ["made-by-new", "new Array()"],
  ["made-with-a-length", "new Array(3)"],
  ["of-an-heir-of-lists", "new (class extends Array {})()"],
];

const starts: [name: string, first: string][] = [
  ["begins-at-the-end", "list.length"],
  ["begins-one-below-the-end", "Math.max(0, list.length - 1)"],
  ["begins-one-past-the-end", "list.length + 1"],
  ["begins-at-a-written-place", "1"],
];

const stores: [name: string, value: string][] = [
  ["a-fraction", "j * 0.5 + t"],
  ["a-whole-number", "j + t"],
  ["reckoned-from-the-place-before", "list[j - 1] + j * 0.5"],
  ["once-not-a-number", "j === 7 ? NaN : j * 0.5"],
  ["once-minus-zero", "j === 7 ? -0 : j"],
  ["once-a-text", 'j === 7 ? "text" : j'],
  ["once-a-great-number", "j === 7 ? 2 ** 31 : j"],
  ["once-undefined", "j === 7 ? undefined : j * 0.5"],
];

const deeds: [name: string, done: string][] = [
  ["nothing-is-done", ""],
  ["it-is-made-shorter", "list.length = 2;"],
  ["it-is-made-longer", "list.length = 20;"],
  ["it-is-pushed-onto", "list.push(90, 91);"],
  ["an-element-is-deleted", "delete list[1];"],
  ["it-is-frozen", "Object.freeze(list);"],
  ["it-may-take-no-more", "Object.preventExtensions(list);"],
  ["its-length-may-not-be-written", 'Object.defineProperty(list, "length", { writable: false });'],
  [
    "a-setter-is-laid-above-a-place-ahead",
    "Object.setPrototypeOf(list, Object.create(Array.prototype, { 8: { set(value) { seen.push(value); }, get() { return 80; } } }));",
  ],
];

const bounds: [name: string, bound: string][] = [
  ["a-written-bound", "12"],
  ["a-bound-out-of-data", "bound"],
  ["as-long-as-another-list", "other.length"],
];

const places = ["in-sight-in-front", "in-sight-behind", "unseen-in-front", "unseen-behind"] as const;

const all = births.length * starts.length * stores.length * deeds.length * bounds.length * places.length;

function write(at: number) {
  const place = places[at % places.length];
  at = Math.floor(at / places.length);
  const [bounded, bound] = bounds[at % bounds.length];
  at = Math.floor(at / bounds.length);
  const [deed, done] = deeds[at % deeds.length];
  at = Math.floor(at / deeds.length);
  const [stored, value] = stores[at % stores.length];
  at = Math.floor(at / stores.length);
  const [begins, first] = starts[at % starts.length];
  const [born, made] = births[Math.floor(at / starts.length)];
  const inTheTurn = !done
    ? ""
    : place.startsWith("in-sight")
      ? `if (j === 5) { ${done} } `
      : "if (j === 5) unseen(list); ";
  return {
    name: `${born}--${begins}--${stored}--${deed}--${bounded}--${place}.cjs`,
    text: `"use strict";
const seen = [];
const other = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const unseen = { deed(list) { ${done} }, idle() {} }[JSON.parse('"deed"')];
function tell(list) { return list.length + "|" + Array.prototype.map.call(list, each => (Object.is(each, -0) ? "-0" : String(each))).join() + "|" + Object.keys(list).join(""); }
function fill(t, bound) {
  const list = ${made};
  for (let j = ${first}; j < ${bound}; j++) { ${place.endsWith("in-front") ? inTheTurn : ""}list[j] = ${value}; ${place.endsWith("behind") ? inTheTurn : ""}}
  return tell(list);
}
for (let t = 0; t < 3; t++) {
  let said;
  try { said = fill(t, JSON.parse("12") | 0); } catch (error) { said = "threw " + error.name; }
  console.log(said, seen.join());
}
`,
  };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, most] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < most; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
