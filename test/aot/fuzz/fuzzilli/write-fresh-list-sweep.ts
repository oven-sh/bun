// What is still known of a list that was just made: how it is made, times what stands between two reads of it, times how it is read afterward, times where the reads stand.
//
//   bun write-fresh-list-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<made>--<between>--<read>--<place>.cjs
//   bun write-fresh-list-sweep.ts count
//   bun write-fresh-list-sweep.ts named <pattern> <folder> [most]
//
// A compiler that sees a list made knows what lies in it, and may answer a second read by the first for as long as nothing has been done to the list. Each program reads an element twice, does one thing, and reads
// again. What it tells is a number: whether the second read is the first, and whether the last is the first, what was stored, or nothing.
import { mkdirSync, writeFileSync } from "node:fs";

const makes: [name: string, made: string][] = [
  ["three-out-of-a-parameter", "[from[0], from[1], from[2]]"],
  ["four-out-of-a-parameter", "[from[0], from[1], from[2], from[3]]"],
  ["whole-numbers", "[1, 2, 3]"],
  ["fractions", "[1.5, 2.5, 3.5]"],
  ["a-hole-in-it", "[from[0], , from[2]]"],
  ["a-spread", "[...from]"],
  ["a-slice", "from.slice(0, 3)"],
  ["made-by-Array-of", "Array.of(from[0], from[1], from[2])"],
  ["filled-by-pushes", "[]; held.push(from[0]); held.push(from[1]); held.push(from[2])"],
];

const betweens: [name: string, done: string][] = [
  ["nothing", ""],
  ["it-is-only-read", "seen += held.length + (key in held ? 1 : 0);"],
  ["it-is-copied", "seen += held.slice().length + held.map(each => each).length + [...held].length;"],
  ["a-store-under-the-key", "held[key] = x;"],
  ["a-store-under-the-other-key", "held[other] = x;"],
  ["a-store-under-a-written-index", "held[1] = x;"],
  ["a-store-under-the-key-reckoned-again", "held[rawKey & 3] = x;"],
  ["a-store-under-the-key-as-a-text", "held[String(key)] = x;"],
  ["a-store-under-a-written-text", 'held["1"] = x;'],
  ["a-store-past-the-end", "held[key + 4] = x;"],
  ["a-store-on-a-rare-turn", "if (rawKey & 4) held[key] = x;"],
  ["stores-in-a-loop", "for (let i = 0; i < other; i++) held[i] = x;"],
  ["a-store-in-a-catch", "try { throw 0; } catch { held[key] = x; }"],
  ["a-store-in-a-finally", "try { seen++; } finally { held[key] = x; }"],
  ["a-store-by-taking-apart", "[held[key]] = [x];"],
  ["a-store-by-taking-an-object-apart", "({ a: held[key] } = { a: x });"],
  ["a-store-through-a-second-name", "const same = held; same[key] = x;"],
  ["a-store-through-a-list-that-holds-it", "const box = [held]; box[0][key] = x;"],
  ["a-store-through-a-record-that-holds-it", "const box = { held }; box.held[key] = x;"],
  ["a-store-by-a-closure-made-here", "const set = () => { held[key] = x; }; set();"],
  ["a-store-by-a-function-in-sight", "store(held, key, x);"],
  ["a-store-by-a-function-out-of-sight", "ops[steps[1]](held, key, x);"],
  ["a-store-by-Reflect-set", "Reflect.set(held, key, x);"],
  ["a-store-by-Object-assign", "Object.assign(held, { [key]: x });"],
  ["a-store-while-something-becomes-a-text", 'seen += String({ toString() { held[key] = x; return "1"; } }).length;'],
  ["a-store-while-something-becomes-a-number", "seen += +{ valueOf() { held[key] = x; return 1; } };"],
  ["a-store-in-a-callback-of-its-own", "held.forEach((each, at) => { if (at === key) held[at] = x; });"],
  ["a-store-in-for-in", "for (const at in held) held[at] = x;"],
  ["the-element-is-deleted", "delete held[key];"],
  ["another-element-is-deleted", "delete held[other];"],
  ["deleted-by-Reflect", "Reflect.deleteProperty(held, key);"],
  ["popped", "held.pop();"],
  ["pushed", "held.push(x);"],
  ["shifted", "held.shift();"],
  ["unshifted", "held.unshift(x);"],
  ["spliced-out", "held.splice(0, 1);"],
  ["spliced-in", "held.splice(1, 0, x);"],
  ["reversed", "held.reverse();"],
  ["sorted", "held.sort(() => -1);"],
  ["filled", "held.fill(x);"],
  ["copied-within", "held.copyWithin(0, 1);"],
  ["cut-to-one", "held.length = 1;"],
  ["cut-to-nothing", "held.length = 0;"],
  ["cut-and-grown-again", "held.length = 0; held.length = 3;"],
  ["the-element-becomes-a-getter", "Object.defineProperty(held, key, { get() { return x; }, configurable: true });"],
  [
    "the-element-is-defined-anew",
    "Object.defineProperty(held, key, { value: x, writable: true, enumerable: true, configurable: true });",
  ],
  ["frozen-and-stored", "Object.freeze(held); try { held[key] = x; } catch { seen++; }"],
  [
    "deleted-above-a-prototype-that-has-it",
    "Object.setPrototypeOf(held, Object.assign(Object.create(Array.prototype), { 0: x, 1: x, 2: x, 3: x })); delete held[key];",
  ],
];

const reads: [name: string, read: string][] = [
  ["under-the-key", "held[key]"],
  ["under-the-key-reckoned-again", "held[rawKey & 3]"],
  ["by-at", "held.at(key)"],
  ["under-the-key-as-a-text", "held[String(key)]"],
];

const places = ["straight", "in-a-loop-the-list-made-in-the-turn", "in-a-loop-the-list-made-in-front"] as const;

const all = makes.length * betweens.length * reads.length * places.length;

function write(at: number) {
  const place = places[at % places.length];
  at = Math.floor(at / places.length);
  const [read, last] = reads[at % reads.length];
  at = Math.floor(at / reads.length);
  const [between, done] = betweens[at % betweens.length];
  const [make, made] = makes[Math.floor(at / betweens.length)];
  const asked = `const first = held[key], again = held[key]; ${done} const last = ${last};
    sum = (Math.imul(sum, 31) + (again === first ? 1 : 0) + (last === first ? 2 : 0) + (last === x ? 4 : 0) + (last === undefined ? 8 : 0) + held.length * 16 + seen * 256) | 0;`;
  const keys = (turn: string) => `const key = (rawKey + ${turn}) & 3, other = (rawOther + ${turn}) & 3;`;
  const body = {
    straight: `${keys("0")} const held = ${made}; ${asked}`,
    "in-a-loop-the-list-made-in-the-turn": `for (let j = 0; j < turns; j++) { ${keys("j")} const held = ${made}; ${asked} }`,
    "in-a-loop-the-list-made-in-front": `const held = ${made}; for (let j = 0; j < turns; j++) { ${keys("j")} ${asked} }`,
  }[place];
  return {
    name: `${make}--${between}--${read}--${place}.cjs`,
    text: `"use strict";
const values = JSON.parse('[["a",1],["b",2],["c",3],["d",4]]'), turns = JSON.parse("9");
function store(list, at, value) { list[at] = value; }
function thrice(from, rawKey, rawOther) {
  const x = from[3];
  let sum = 7, seen = 0;
  ${body}
  return sum;
}
const ops = { thrice, store, idle() { return 0; } }, steps = JSON.parse('["thrice","store"]');
const printed = [];
for (let turn = 0; turn < 32; turn++) {
  try { printed.push(ops[steps[0]](values, turn, turn >> 2)); } catch (error) { printed.push(error.name); }
}
console.log(printed.join(" "));
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
