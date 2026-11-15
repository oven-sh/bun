// The least programs with holes in lists: how the hole comes about, times the elements, times how it is read, times the place, times where, times how often the function is called.
//
//   bun write-hole-read-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<hole>--<elements>--<read>--<place>--<where>--<calls>.mjs, .cjs or .ts
//   bun write-hole-read-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// E, F and G are elements; `more` and `rest` are lists of them.
const holes: [name: string, text: string][] = [
  ["middle", "[E, , F]"],
  ["front", "[, E, F]"],
  ["end", "[E, F, ,]"],
  ["alone", "[,]"],
  ["two", "[E, , , F]"],
  ["behind-spread", "[...more, , E]"],
  ["behind-two-spreads", "[...more, ...rest, , E]"],
  ["between-spreads", "[...more, , ...rest]"],
  ["in-front-of-spread", "[, ...more]"],
  ["behind-spread-at-end", "[...more, ,]"],
  ["element-spread-hole", "[E, ...more, , F]"],
  ["spread-of-holes", "[...[E, , F]]"],
  ["spread-and-holes", "[...more, , ...[F, , G]]"],
  ["spread-of-text", "[...'ab', , E]"],
  ["spread-of-set", "[...new Set(more), , E]"],
  ["spread-of-none", "[...[], , E]"],
  ["made", "new Array(4)"],
  ["made-filled", "filled(new Array(4))"],
  ["length-set", "longer([E, F])"],
  ["deleted", "without([E, F, G])"],
  ["stored-past", "past([E])"],
  ["concat", "[E, , F].concat(more)"],
  ["concat-holes", "more.concat([, E])"],
  ["slice", "[E, , F, G].slice(0, 3)"],
  ["splice", "spliced([E, , F, G])"],
  ["copy-within", "[E, , F, G].copyWithin(0, 1)"],
  ["fill", "[E, , F, G].fill(F, 0, 1)"],
  ["from-holes", "Array.from([E, , F])"],
  ["from-length", "Array.from({ length: 3, 0: E, 2: F })"],
  ["mapped", "[E, , F].map(x => x)"],
  ["filtered", "[E, , F].filter(() => true)"],
  ["reversed", "[E, , F].reverse()"],
  ["sorted", "[F, , E].sort()"],
  ["flat", "[[E, , F], more].flat()"],
  ["rest-of-pattern", "restOf([E, , F, G])"],
  ["rest-parameter", "restOf2(E, undefined, F)"],
  ["none", "[E, F, G]"],
];
const elements: [name: string, e: string, f: string, g: string][] = [
  ["integers", "1", "2", "3"],
  ["doubles", "0.5", "1.5", "2.5"],
  ["texts", "'a'", "'b'", "'c'"],
  ["objects", "{ v: 1 }", "{ v: 2 }", "{ v: 3 }"],
  ["kinds", "1", "'b'", "0.5"],
  ["undefined", "undefined", "1", "undefined"],
  ["functions", "() => 1", "() => 2", "() => 3"],
  ["truths", "true", "false", "true"],
  ["bigs", "1n", "2n", "3n"],
  ["lists", "[1]", "[2, 3]", "[]"],
  ["null", "null", "'b'", "null"],
  ["handed", "handed", "2", "handed"],
];
// P is the place.
const reads: [name: string, text: string][] = [
  ["index", "say(list[P]);"],
  ["typeof", "say(typeof list[P]);"],
  ["typeof-kept", "const x = list[P];\nsay(typeof x);"],
  ["same", "say(list[P] === undefined);"],
  ["equal", "say(list[P] == null);"],
  ["sum", "say(list[P] + '');"],
  ["number", "say(+(list[P] ?? 0) === 0);"],
  ["optional", "say(list[P]?.v);"],
  ["nullish", "say(list[P] ?? 'none');"],
  ["truth", "if (list[P]) say('t');\nelse say('f');"],
  ["has", "say(P in list);"],
  ["own", "say(Object.hasOwn(list, P));"],
  ["of", "for (const x of list) say(x);"],
  ["of-typeof", "for (const x of list) say(typeof x);"],
  ["in", "for (const k in list) say(k);"],
  ["index-loop", "for (let k = 0; k < list.length; k++) say(typeof list[k]);"],
  ["index-loop-values", "for (let k = 0; k < list.length; k++) say(list[k]);"],
  ["entries", "for (const [k, x] of list.entries()) say(k + typeof x);"],
  ["pattern", "const [a, b, c] = list;\nsay(typeof a + typeof b + typeof c);"],
  ["pattern-default", "const [a = 'x', b = 'y', c = 'z'] = list;\nsay(a, b, c);"],
  ["pattern-rest", "const [a, ...r] = list;\nsay(r.length, typeof r[0], typeof r[1]);"],
  ["spread", "const r = [...list];\nsay(P in r, typeof r[P]);"],
  ["spread-hole", "const r = [...list, , 'z'];\nsay(typeof r[list.length], P in r);"],
  ["for-each", "list.forEach((x, k) => say(k, x));"],
  ["map", "const r = list.map(x => typeof x);\nsay(r.length, P in r, r[P]);"],
  ["find", "say(list.find(x => x === undefined), list.findIndex(x => x === undefined));"],
  ["includes", "say(list.includes(undefined));"],
  ["index-of", "say(list.indexOf(undefined));"],
  ["at", "say(list.at(P), list.at(-1));"],
  ["json", "say(JSON.stringify(list, (k, v) => (typeof v === 'bigint' ? 'n' : v)));"],
  ["join", "say(list.length);\nsay(list.map(String).join('-'));"],
  ["argument", "say(kind(list[P]));"],
  ["returned", "say(typeof get(list, P));"],
  ["captured", "const x = list[P];\nsay([0].map(() => typeof x)[0]);"],
  ["captured-list", "say([0].map(() => typeof list[P])[0]);"],
  ["reduce", "say(list.reduce((s, x) => s + typeof x, ''));"],
  ["some", "say(list.some(x => x === undefined), list.every(x => x !== undefined));"],
  ["keys", "say(Object.keys(list).join());"],
  ["values", "say([...list.values()].map(x => typeof x).join());"],
  ["stored-then-read", "list[P] = list[P];\nsay(P in list, typeof list[P]);"],
  [
    "other-typeof",
    "switch (typeof list[P]) {\n  case 'undefined':\n    say('u');\n    break;\n  case 'number':\n    say('n');\n    break;\n  default:\n    say('o');\n}",
  ],
  ["popped", "say(typeof list.pop(), list.length);"],
  ["shifted", "say(typeof list.shift(), list.length);"],
  ["applied", "say(kinds(...list));"],
  ["apply", "say(kinds.apply(null, list));"],
  ["copied", "const r = list.slice();\nsay(P in r, typeof r[P]);"],
  ["assigned", "const r = Object.assign([], list);\nsay(P in r, r.length);"],
  ["length", "say(list.length);"],
];
const places: string[] = ["0", "1", "2", "3", "k2", "list.length - 1", "5"];
const wheres: [name: string, text: string][] = [
  ["once", "MAKE\nREAD"],
  ["loop", "for (let i = 0; i < n; i++) {\n  MAKE\n  READ\n}"],
  ["made-in-front", "MAKE\nfor (let i = 0; i < n; i++) {\n  READ\n}"],
  ["three", "for (let i = 0; i < 3; i++) {\n  MAKE\n  READ\n}"],
  ["kept", "MAKE\nkept.push(list);\nREAD"],
  ["changed", "MAKE\nif (n > 2) list[1] = 'late';\nREAD"],
  ["try", "try {\n  MAKE\n  READ\n} finally {\n  turns++;\n}"],
  ["callee", "const list = make(more, rest, handed);\nREAD"],
];
const calls: [name: string, text: string][] = [
  ["once", "go([E, F], [G], 3, 1, E);"],
  ["twice", "go([E, F], [G], 3, 1, E);\ngo([G], [E], 1, 2, F);"],
  ["loop", "for (let k = 0; k < 3; k++) go([E, F], [G], k + 1, k, E);"],
];
const total = holes.length * elements.length * reads.length * places.length * wheres.length * calls.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 2_237_761;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const hole = pick(holes);
  const read = pick(reads);
  const element = pick(elements);
  const where = pick(wheres);
  const place = pick(places);
  const call = pick(calls);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const of = (text: string) => text.replaceAll(/\bE\b/g, () => element[1]).replaceAll(/\bF\b/g, () => element[2]).replaceAll(/\bG\b/g, () => element[3]); // prettier-ignore
  const made = of(hole[1]);
  const body = within(within(where[1], "MAKE", `const list = ${made};`), "READ", read[1].replaceAll(/\bP\b/g, place));
  const callee = /\bmake\(/.test(body) ? `function make(more, rest, handed) {\n  return ${made};\n}` : "";
  const run = of(call[1]);
  const has = (word: RegExp) => word.test(body + callee + run);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const said = [];",
    'const tell = v => (typeof v === "function" ? "function" : Array.isArray(v) ? "list" + v.length : typeof v === "object" && v ? "o" + v.v : typeof v === "bigint" ? v + "n" : String(v));',
    'const say = (...all) => void said.push(all.map(tell).join(":"));',
    ...(has(/\bkept\b/) ? ["const kept = [];"] : []),
    ...(has(/\bturns\b/) ? ["let turns = 0;"] : []),
    ...(has(/\bfilled\(/)
      ? [of("function filled(l) {\n  l[0] = E;\n  l[2] = F;\n  return l;\n}").replaceAll(/\bhanded\b/g, "4")]
      : []),
    ...(has(/\blonger\(/) ? ["function longer(l) {\n  l.length = 4;\n  return l;\n}"] : []),
    ...(has(/\bwithout\(/) ? ["function without(l) {\n  delete l[1];\n  return l;\n}"] : []),
    ...(has(/\bpast\(/) ? [of("function past(l) {\n  l[3] = F;\n  return l;\n}").replaceAll(/\bhanded\b/g, "4")] : []),
    ...(has(/\bspliced\(/) ? ["function spliced(l) {\n  l.splice(0, 1);\n  return l;\n}"] : []),
    ...(has(/\brestOf\(/) ? ["function restOf([first, ...others]) {\n  return others;\n}"] : []),
    ...(has(/\brestOf2\(/) ? ["function restOf2(first, ...others) {\n  return others;\n}"] : []),
    ...(has(/\bkind\(/) ? ["function kind(x) {\n  return typeof x;\n}"] : []),
    ...(has(/\bkinds\b/) ? ["function kinds(...all) {\n  return all.map(x => typeof x).join();\n}"] : []),
    ...(has(/\bget\(/) ? ["function get(l, p) {\n  return l[p];\n}"] : []),
    ...(/\bhanded\b/.test(run) ? ["const handed = 8;"] : []),
    ...(callee ? [callee] : []),
    `function go(more, rest, n, k2, handed) {\n${indent(body, "  ")}\n}`,
    "try {",
    indent(run, "  "),
    "} catch (error) {",
    "  say(error.name);",
    "}",
    'console.log(said.join(" ").slice(0, 1200));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${hole[0]}--${element[0]}--${read[0]}--${place.replaceAll(/[^a-z0-9]/g, "")}--${where[0]}--${call[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
