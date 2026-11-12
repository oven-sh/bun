// What a loop looks up under a key that stays: what holds it, times what lies under the key, times what is reckoned with it, times what happens in a turn, times how the key is known, times how the function is reached.
//
//   bun write-lookup-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<holder>--<found>--<reckoned>--<what happens>--<key>--<reached>.cjs
//   bun write-lookup-sweep.ts count
//   bun write-lookup-sweep.ts named <pattern> <folder> [most]
//
// `sum += table.get(key) + 1` asks the same question in every turn, and a compiler may ask it once, in front of the loop, and ask the answer for a number there. That holds for as long as nothing in a turn lays
// something else under the key. Each program tells the sum, how often a value was asked for, and what the holder holds in the end.
import { mkdirSync, writeFileSync } from "node:fs";

const holders: [name: string, made: string][] = [
  ["a-map-of-parsed-entries", "new Map(Object.entries(parsed))"],
  [
    "a-map-filled-by-set",
    "(() => { const made = new Map(); for (const name in parsed) made.set(name, parsed[name]); return made; })()",
  ],
  ["an-heir-of-map", "new (class Heir extends Map {})(Object.entries(parsed))"],
  [
    "an-heir-of-map-with-its-own-get",
    "new (class Heir extends Map { get(name) { gets++; return super.get(name); } })(Object.entries(parsed))",
  ],
  [
    "a-map-with-a-get-of-its-own",
    "Object.assign(new Map(Object.entries(parsed)), { get(name) { gets++; return Map.prototype.get.call(this, name); } })",
  ],
  [
    "a-record-that-answers-like-a-map",
    "{ held: { ...parsed }, get(name) { gets++; return this.held[name]; }, set(name, value) { this.held[name] = value; return this; }, delete(name) { return delete this.held[name]; }, clear() { this.held = {}; }, entries() { return Object.entries(this.held); } }",
  ],
];

const founds: [name: string, laid: string][] = [
  ["a-whole-number", "1"],
  ["a-fraction", "2.5"],
  ["not-a-number", "NaN"],
  ["minus-zero", "-0"],
  ["a-text-of-digits", '"3"'],
  ["a-text", '"x"'],
  ["true", "true"],
  ["null", "null"],
  ["nothing", "undefined"],
  ["a-big-integer", "3n"],
  ["a-list-of-one", "[3]"],
  ["an-object-asked-for-its-value", "{ valueOf() { asked++; return 3; } }"],
];

const reckonings: [name: string, reckoned: string][] = [
  ["plus-a-number", "LOOKUP + 1"],
  ["times-a-number", "LOOKUP * 2"],
  ["a-number-less-it", "10 - LOOKUP"],
  ["or-zero", "LOOKUP | 0"],
  ["greater-than-a-number", "(LOOKUP > 0 ? 1 : 0)"],
  ["plus-another-lookup", 'LOOKUP + table.get("b")'],
  ["looked-up-twice", "LOOKUP + LOOKUP"],
];

const happenings: [name: string, done: string][] = [
  ["nothing-happens", ""],
  ["a-number-is-laid-under-the-key", "table.set(key, 40);"],
  ["a-text-is-laid-under-the-key", 'table.set(key, "t");'],
  ["a-fraction-is-laid-under-the-key", "table.set(key, 0.25);"],
  ["the-key-is-deleted", "table.delete(key);"],
  ["the-holder-is-cleared", "table.clear();"],
  ["another-key-is-laid", 'table.set("z", 9);'],
  ["a-function-out-of-sight-lays-under-the-key", "ops[steps[1]](table, key, 40);"],
  ["a-getter-read-in-the-turn-lays-under-the-key", "sum += trip.wire;"],
];

const keys: [name: string, handed: string][] = [
  ["a-written-key", '"a"'],
  ["a-key-out-of-data", "under"],
  ["a-key-put-together", '["", "a"].join("")'],
];

const reaches = ["under-a-key-out-of-data", "in-sight"] as const;

const all = holders.length * founds.length * reckonings.length * happenings.length * keys.length * reaches.length;

function write(at: number) {
  const take = <T>(from: readonly T[]) => {
    const taken = from[at % from.length];
    at = Math.floor(at / from.length);
    return taken;
  };
  const reached = take(reaches);
  const [key, handed] = take(keys);
  const [happening, done] = take(happenings);
  const [reckoning, reckoned] = take(reckonings);
  const [found, laid] = take(founds);
  const [holder, made] = take(holders);
  const isWritten = key === "a-written-key";
  const lookup = isWritten ? 'table.get("a")' : "table.get(key)";
  return {
    name: `${holder}--${found}--${reckoning}--${happening}--${key}--${reached}.cjs`,
    text: `"use strict";
let asked = 0, gets = 0, target = null;
const under = JSON.parse('"a"'), turns = JSON.parse("9") | 0;
const trip = { get wire() { if (target !== null) target.set(under, 40); return 0; } };
function make() { const parsed = JSON.parse('{"a":0,"b":2}'); parsed.a = ${laid}; return ${made}; }
function lay(table, key, value) { table.set(key, value); }
function walk(table, key, turns) { let sum = 0; for (let i = 0; i < turns; i++) { sum += ${reckoned.replaceAll("LOOKUP", lookup)}; if (i === 1) { ${done} } } return sum; }
const ops = { walk, lay, idle() { return 0; } }, steps = JSON.parse('["walk","lay"]');
const go = ${reached === "in-sight" ? "walk" : "ops[steps[0]]"};
function tell(value) { return typeof value === "bigint" ? value + "n" : typeof value + ":" + (Object.is(value, -0) ? "-0" : String(value)); }
for (let round = 0; round < 2; round++) {
  const table = make();
  target = table;
  let said;
  try { said = tell(go(table, ${handed}, turns)); } catch (error) { said = "threw " + error.name; }
  console.log(said, "| asked", asked, "| gets", gets, "| left", [...table.entries()].map(([name, value]) => name + "=" + tell(value)).join());
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
