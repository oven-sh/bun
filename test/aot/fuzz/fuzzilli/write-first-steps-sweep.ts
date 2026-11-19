// The first steps off a collection: what holds the values, times which of its iterators is asked for, times how the first values are taken off it, times what is done to the holder, times where that stands.
//
//   bun write-first-steps-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<holder>--<asked>--<taken>--<what is done>--<place>.cjs
//   bun write-first-steps-sweep.ts count
//   bun write-first-steps-sweep.ts named <pattern> <folder> [most]
//
// `const [first] = map.keys()` and `map.values().next().value` make an iterator, step it once or twice and let it go. A compiler may read the first values off the holder and make no iterator, for as long as the method
// is the built-in one and nothing comes between the steps.
import { mkdirSync, writeFileSync } from "node:fs";

const holders: [name: string, made: string][] = [
  ["a-map-of-written-pairs", 'new Map([["a", 1], ["bc", 2.5], ["d", "three"]])'],
  [
    "a-map-filled-by-set",
    '(() => { const map = new Map(); for (let k = 0; k < 4; k++) map.set("k" + k, k / 2); return map; })()',
  ],
  ["a-map-with-nothing-in-it", "new Map()"],
  ["a-map-with-undefined-in-it", 'new Map([[undefined, 1], ["p", undefined]])'],
  ["a-set", 'new Set([1.5, 2, "x"])'],
  ["a-set-with-nothing-in-it", "new Set()"],
  ["a-list-with-a-hole", '[1, "p", , 2.5, "x"]'],
  ["a-view", "new Float64Array([1.5, 2.5, 3.5])"],
  [
    "an-heir-of-maps-with-methods-of-its-own",
    'new (class extends Map { keys() { log.push("keys"); return super.keys(); } values() { log.push("values"); return super.values(); } entries() { log.push("entries"); return super.entries(); } [Symbol.iterator]() { log.push("iterator"); return super[Symbol.iterator](); } })([["z", 1], ["y", 2]])',
  ],
  [
    "a-map-that-has-the-methods-itself",
    '(() => { const map = new Map([["a", 1], ["b", 2]]); const own = name => () => { log.push("own " + name); return ["q", 7][Symbol.iterator](); }; map.keys = own("keys"); map.values = own("values"); map.entries = own("entries"); map[Symbol.iterator] = own("iterator"); return map; })()',
  ],
];

const asks: [name: string, asked: string][] = [
  ["its-keys", "h.keys()"],
  ["its-values", "h.values()"],
  ["its-entries", "h.entries()"],
  ["its-iterator", "h[Symbol.iterator]()"],
];

const takes: [name: string, taken: string][] = [
  ["the-first-by-a-pattern", "const [a] = ASKED; tell(a);"],
  ["two-by-a-pattern", "const [a, b] = ASKED; tell(a, b);"],
  ["more-than-it-holds", "const [a, b, c, d, e, f] = ASKED; tell(a, b, c, d, e, f);"],
  ["with-defaults", 'const [a = "first", b = "second"] = ASKED; tell(a, b);'],
  ["the-second-alone", "const [, b] = ASKED; tell(b);"],
  ["the-first-and-the-rest", "const [a, ...rest] = ASKED; tell(a, rest.length);"],
  ["the-value-of-one-step", "tell(ASKED.next().value);"],
  ["whether-one-step-ends-it", "tell(ASKED.next().done);"],
  ["two-steps-off-one-iterator", "const steps = ASKED; tell(steps.next().value, steps.next().value);"],
  [
    "a-deed-between-two-steps",
    "const steps = ASKED; const one = steps.next(); DEED tell(one.value, one.done, steps.next().value);",
  ],
];

const deeds: [name: string, done: string][] = [
  ["nothing-is-done", ""],
  ["the-first-is-taken-out", "drop(h);"],
  ["one-more-is-put-in", "grow(h);"],
  ["it-is-emptied", "empty(h);"],
  ["the-first-is-changed", "change(h);"],
];

const places = ["in-a-loop-off-a-variable", "in-a-loop-off-a-parameter-nobody-knows", "straight"] as const;

const all = holders.length * asks.length * takes.length * deeds.length * places.length;

function write(at: number) {
  const place = places[at % places.length];
  at = Math.floor(at / places.length);
  const [deed, done] = deeds[at % deeds.length];
  at = Math.floor(at / deeds.length);
  const [taken, take] = takes[at % takes.length];
  at = Math.floor(at / takes.length);
  const [asked, ask] = asks[at % asks.length];
  const [holder, made] = holders[Math.floor(at / asks.length)];
  const isBetween = take.includes("DEED");
  const step = take.replace("ASKED", ask).replace("DEED", done);
  const body =
    place === "straight"
      ? `{ ${step} } ${isBetween ? "" : done} { ${step} }`
      : `for (let i = 0; i < turns; i++) { ${isBetween || !done ? "" : `if (i === 1) { ${done} } `}${step} }`;
  return {
    name: `${holder}--${asked}--${taken}--${deed}--${place}.cjs`,
    text: `"use strict";
const log = [];
const turns = JSON.parse("3") | 0;
function shown(each) { return Array.isArray(each) ? "[" + each.map(String).join() + "]" : typeof each + ":" + String(each); }
function tell(...all) { log.push(all.map(shown).join("/")); }
const isKeyed = h => h instanceof Map || h instanceof Set;
const firstOf = h => Map.prototype.keys.call(h instanceof Map ? h : new Map([...Set.prototype.values.call(h)].map(each => [each]))).next().value;
function drop(h) { if (isKeyed(h)) h.delete(firstOf(h)); else if (Array.isArray(h)) h.shift(); else h[0] = -1; }
function grow(h) { if (h instanceof Map) h.set("more", 9); else if (h instanceof Set) h.add("more"); else if (Array.isArray(h)) h.unshift("more"); else h[1] = 9; }
function empty(h) { if (isKeyed(h)) h.clear(); else if (Array.isArray(h)) h.length = 0; else h.fill(0); }
function change(h) { if (h instanceof Map) h.set(firstOf(h), "changed"); else if (h instanceof Set) { const first = firstOf(h); h.delete(first); h.add(first); } else h[0] = 7; }
${place === "in-a-loop-off-a-variable" ? `const h = ${made};\nfunction run() { ${body} }` : `function run(h) { ${body} }`}
const go = ${place === "in-a-loop-off-a-parameter-nobody-knows" ? `{ run, idle() {} }[JSON.parse('"run"')]` : "run"};
try { go(${place === "in-a-loop-off-a-variable" ? "" : made}); } catch (error) { log.push("threw " + error.name); }
try { go(${place === "in-a-loop-off-a-variable" ? "" : made}); } catch (error) { log.push("threw " + error.name); }
console.log(log.join(" | "));
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
