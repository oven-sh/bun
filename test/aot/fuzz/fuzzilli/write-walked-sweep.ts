// What a loop walks where nobody declares it: how the loop uses its holder, times what it is handed first, times what it is handed next, times what happens to the holder in a turn, times how the function is reached.
//
//   bun write-walked-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<loop>--first-<kind>--then-<kind>--<what happens>--<reached>.cjs
//   bun write-walked-sweep.ts count
//   bun write-walked-sweep.ts named <pattern> <folder> [most]
//
// A function of untyped code that is reached under a key out of data has parameters of which nothing is known but their use. A compiler guesses from the use: what gives a loop its bound is a list, what is read under
// the counter holds numbers, what `for...of` walks is a list or a text. Each guess has a side on which it fails. Here the same function is handed one kind of thing, then another, then the first again.
import { mkdirSync, writeFileSync } from "node:fs";

const loops: [name: string, body: string][] = [
  ["read-under-the-counter", "for (let i = 0; i < h.length; i++) sum += h[i];"],
  ["read-under-the-counter-the-length-kept", "const n = h.length; for (let i = 0; i < n; i++) sum += h[i];"],
  ["only-measured", "for (let i = 0; i < h.length; i++) sum += beside[i & 3];"],
  ["stored-under-the-counter", "for (let i = 0; i < h.length; i++) { h[i] = h[i] + 1; sum += h[i]; }"],
  ["read-downward", "for (let i = h.length - 1; i >= 0; i--) sum += h[i];"],
  ["read-by-a-while", "let i = 0; while (i < h.length) { sum += h[i]; i++; }"],
  ["read-with-the-one-behind", "for (let i = 0; i + 1 < h.length; i++) sum += h[i] * h[i + 1];"],
  ["walked-by-for-of", "for (const each of h) sum += each;"],
  ["walked-by-for-of-and-left-early", "for (const each of h) { sum += each; if (++seen === 2) break; }"],
  [
    "walked-by-for-of-and-held-against-a-text",
    'for (const each of h) { if (each === "5") seen++; else sum += 1; } sum += seen * 100;',
  ],
  [
    "walked-by-for-of-and-gathered-into-a-text",
    'let text = ""; for (const each of h) { if (each === ",") seen++; else text += "<" + each + ">"; } sum += text.length;',
  ],
  ["walked-by-for-in", "for (const key in h) sum += h[key];"],
  ["a-column-read-through-rows", "for (let k = 0; k < rows.length; k++) sum += rows[k][1];"],
  [
    "a-column-stored-through-rows",
    "for (let k = 0; k < rows.length; k++) { rows[k][1] = rows[k][0] + 1; sum += rows[k][1]; }",
  ],
  [
    "rows-walked-whole",
    "for (let k = 0; k < rows.length; k++) for (let j = 0; j < rows[k].length; j++) sum += rows[k][j];",
  ],
  ["a-row-under-a-key-read", "for (let j = 0; j < shelf[name].length; j++) sum += shelf[name][j];"],
  [
    "a-row-under-a-key-stored",
    "for (let j = 0; j < shelf[name].length; j++) { sum += shelf[name][j]; shelf[name][j] = 0; }",
  ],
  [
    "a-row-under-a-key-beside-another",
    "for (let j = 0; j < shelf[name].length; j++) sum += shelf[name][j] * shelf.other[0];",
  ],
  ["a-list-in-a-variable-of-the-file-read", "for (let j = 0; j < kept.length; j++) sum += kept[j];"],
  ["a-list-in-a-variable-of-the-file-stored", "for (let j = 0; j < kept.length; j++) { sum += kept[j]; kept[j] = 0; }"],
  ["a-list-in-a-captured-variable-read", "for (let j = 0; j < caught.length; j++) sum += caught[j];"],
  ["a-column-out-of-data-read-through-rows", "at = at | 0; for (let k = 0; k < rows.length; k++) sum += rows[k][at];"],
  [
    "a-column-out-of-data-reckoned-and-stored",
    "at = at | 0; for (let k = 0; k < rows.length; k++) { rows[k][at] = 0.5 * rows[k][at] - 0.25; sum += rows[k][at]; }",
  ],
  [
    "rows-reckoned-and-stored-column-by-column",
    "for (let j = 2; j >= 0; j--) for (let k = 0; k < rows.length; k++) { rows[k][j] = 0.5 * rows[k][j] - 0.25; sum += rows[k][j]; }",
  ],
  [
    "beside-a-list-out-of-data-that-a-callee-reads",
    "for (let j = 0; j < h.length; j++) sum += h[j] + pick(base, j % 6);",
  ],
  ["beside-a-list-out-of-data-read-in-the-turn", "for (let j = 0; j < h.length; j++) sum += h[j] + base[j % 6];"],
  [
    "a-list-out-of-data-walked-beside-what-a-callee-reads",
    "for (let j = 0; j < base.length; j++) sum += base[j] + pick(h, j % 6);",
  ],
  [
    "a-list-out-of-data-walked-beside-what-the-turn-reads",
    "for (let j = 0; j < base.length; j++) sum += base[j] + h[j % 6];",
  ],
  [
    "two-neighbors-in-the-row-that-a-turn-finds-are-stored",
    "for (let j = 8; j >= 0; j -= 2) for (let k = 0; k < rows.length; k++) { const held = rows[k][j + 1]; rows[k][j + 1] = 0.5 * rows[k][j] + 0.25 * held; rows[k][j] = 0.25 * rows[k][j] - 0.5 * held; sum += rows[k][j]; }",
  ],
  [
    "two-neighbors-in-the-row-that-a-turn-finds-are-stored-around-a-read",
    "for (let j = 8; j >= 0; j -= 2) for (let k = 0; k < rows.length; k++) { const held = rows[k][j + 1]; rows[k][j + 1] = 0.5 * rows[k][j] + 0.25 * held; sum += rows[k][j + 1]; rows[k][j] = 0.25 * rows[k][j] - 0.5 * held; }",
  ],
  [
    "a-row-under-a-key-raised-by-what-is-read-of-it",
    "for (let j = 0; j < shelf[name].length; j++) { sum += shelf[name][j]; shelf[name][j] = shelf[name][j] + 2; }",
  ],
];

const kinds: [name: string, made: string][] = [
  ["whole-numbers", "[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]"],
  ["fractions", "[1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]"],
  ["texts", '["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]'],
  ["numbers-and-a-text", '[1, 2, 3, 4, 5, 6, "7", 8, 9, 10]'],
  ["a-hole", "[1, 2, , 4, 5, 6, 7, 8, 9, 10]"],
  [
    "a-hole-over-an-inherited-element",
    "Object.setPrototypeOf([1, 2, , 4, 5, 6, 7, 8, 9, 10], Object.assign(Object.create(Array.prototype), { 2: 30 }))",
  ],
  ["nothing-in-it", "[]"],
  ["undefined-and-null-in-it", "[1, undefined, 3, null, 5, 6, 7, 8, 9, 10]"],
  ["Int32Array", "new Int32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])"],
  ["Float64Array", "new Float64Array([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5])"],
  ["Uint8Array", "new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 255])"],
  ["Uint8ClampedArray", "new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 255])"],
  ["Uint32Array", "new Uint32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 4294967295])"],
  [
    "a-view-into-the-middle-of-a-buffer",
    "new Int16Array(new Int16Array([9, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9]).buffer, 4, 8)",
  ],
  ["a-view-that-follows-a-buffer-that-may-grow", "new Uint8Array(new ArrayBuffer(10, { maxByteLength: 16 })).fill(3)"],
  ["a-text", '"0123456789"'],
  ["a-text-put-together", '["01234", "56789"].join("")'],
  ["a-text-of-wide-letters", '"\\u4e2d\\ud83d\\ude00x\\ud83dy"'],
  ["an-arguments-object", "(function () { return arguments; })(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)"],
  ["a-record-with-a-length", "{ length: 10, 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10 }"],
  ["an-heir-of-Array", "class Heir extends Array {}.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])"],
  [
    "an-heir-of-Array-with-its-own-iterator",
    "Object.assign(class Heir extends Array { *[Symbol.iterator]() { yield 100; yield 200; yield 300; } }.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))",
  ],
  ["a-proxy-over-a-list", "new Proxy([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {})"],
  ["a-frozen-list", "Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])"],
  [
    "a-list-with-a-getter-under-an-index",
    "Object.defineProperty([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, { get() { return 50; }, set() {}, enumerable: true, configurable: true })",
  ],
  ["a-list-with-a-name-beside-its-elements", "Object.assign([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { extra: 1000 })"],
  ["a-set", "new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])"],
  ["null", "null"],
];
const firsts = [0, 1, 9, 15];

const happenings: [name: string, done: string][] = [
  ["nothing-happens", ""],
  ["it-shrinks-in-a-turn", "try { target.length = 3; } catch {}"],
  ["it-grows-in-a-turn", "try { target.push(11, 12); } catch {}"],
  ["an-element-ahead-becomes-a-text", 'try { target[target.length - 1] = "z"; } catch {}'],
  ["an-element-ahead-becomes-a-fraction", "try { target[target.length - 1] = 0.25; } catch {}"],
  ["an-element-ahead-is-deleted", "try { delete target[target.length - 1]; } catch {}"],
  ["its-buffer-is-handed-away", "try { target.buffer.transfer(); } catch {}"],
  ["what-holds-it-is-given-another", "try { GIVEN } catch {}"],
  ["what-holds-it-lets-go-of-it", "try { LET_GO } catch {}"],
  ["a-getter-hands-it-out-and-soon-another", ""],
];

const reaches = ["under-a-key-out-of-data", "in-sight"] as const;

const all = loops.length * firsts.length * kinds.length * happenings.length * reaches.length;

function write(at: number) {
  const reached = reaches[at % reaches.length];
  at = Math.floor(at / reaches.length);
  const [happening, done] = happenings[at % happenings.length];
  at = Math.floor(at / happenings.length);
  const [next, madeNext] = kinds[at % kinds.length];
  at = Math.floor(at / kinds.length);
  const [first, madeFirst] = kinds[firsts[at % firsts.length]];
  const [loop, body] = loops[Math.floor(at / firsts.length)];
  const overRows = body.includes("rows"),
    underAKey = body.includes("shelf"),
    inAVariable = body.includes("kept"),
    isCaught = body.includes("caught"),
    takesAColumn = body.startsWith("at = "),
    hasABase = body.includes("base"),
    walksTheBase = body.includes("base.length");
  const given = isCaught ? "made.give([7, 7, 7]);" : inAVariable ? "kept = [7, 7, 7];" : underAKey ? "holder.row = [7, 7, 7];" : overRows ? "holder[1] = [7, 7, 7];" : "Object.setPrototypeOf(target, Object.create(Object.getPrototypeOf(target)));"; // prettier-ignore
  const letGo = isCaught
    ? "made.give(undefined);"
    : inAVariable
      ? "kept = undefined;"
      : underAKey
        ? "delete holder.row;"
        : overRows
          ? "holder.length = 1;"
          : "Object.preventExtensions(target);";
  // The getter is laid in front of the walk and nothing stands in the loop: over what holds the list, where it hands out another from the third asking on, or over an element where nothing holds the
  // list, from the second on: what is printed behind the walk then shows how often the walk has asked.
  const handsOut = (where: string, key: string, askings: number, later: string) => `{ const held = ${where}[${key}]; let asked = 0; Object.defineProperty(${where}, ${key}, { get() { return ++asked <= ${askings} ? held : ${later}; }, set(value) {}, enumerable: true, configurable: true }); }`; // prettier-ignore
  const laid = !happening.startsWith("a-getter-hands-it-out") ? "" : ` try ${underAKey ? handsOut("handed", '"row"', 2, "[7, 7, 7]") : overRows ? handsOut("handed", "1", 2, "[7, 7, 7]") : handsOut("target", "1", 1, "70")} catch {}`; // prettier-ignore
  // What else happens, happens once, in the second turn, through a getter that the turn reads: no call stands in the loop.
  const turn = done ? body.replace(/sum \+= /, "sum += trip.wire + ") : body;
  const handed = (made: string) =>
    underAKey ? `{ row: ${made}, other: [2] }` : overRows ? `[${made}, ${made}, ${made}]` : made;
  return {
    name: `${loop}--first-${first}--then-${next}--${happening}--${reached}.cjs`,
    text: `"use strict";
const beside = [1, 2, 3, 4];
let target = null, holder = null, ${inAVariable ? "kept = null, " : ""}turns = 0;
const under = JSON.parse('${takesAColumn ? "1" : '"row"'}');${hasABase ? '\nconst base = JSON.parse("[1.5, 2.5, 3, 4.5, 5.5, 6]");\nfunction pick(held, k) { return held[k]; }' : ""}
const trip = { get wire() { if (++turns === 2 && target !== null) { ${done.replace("GIVEN", given).replace("LET_GO", letGo)} } return 0; } };
${
  isCaught
    ? `const made = (() => { let caught = null; return { walk() { let sum = 0, seen = 0; ${turn} return sum; }, give(next) { caught = next; } }; })();\nconst walk = made.walk;`
    : `function walk(${underAKey ? "shelf, name" : takesAColumn ? "rows, at" : overRows ? "rows" : "h"}) { let sum = 0, seen = 0; ${turn} return sum; }`
}
const go = ${reached === "in-sight" ? "walk" : `{ walk, idle() { return 0; } }[JSON.parse('"walk"')]`};
function tell(value) { return typeof value + ":" + (Object.is(value, -0) ? "-0" : String(value)); }
function ask(handed) {
  holder = handed; target = ${underAKey ? "handed.row" : overRows ? "handed === null ? null : handed[1]" : hasABase && !walksTheBase ? "base" : "handed"}; turns = 0;${isCaught ? " made.give(handed);" : inAVariable ? " kept = handed;" : ""}${laid}
  let said;
  try { said = tell(go(handed, under)); } catch (error) { said = "threw " + error.name; }
  let left;
  try { left = ${underAKey ? 'Object.keys(handed).join() + "/" + Array.from(target).join()' : overRows ? 'handed.map(row => Array.from(row).join()).join("/")' : hasABase ? 'Array.from(handed).join() + "/" + base.join()' : "Array.from(handed).join()"}; } catch (error) { left = "threw " + error.name; }
  return said + " | " + left;
}
console.log(ask(${handed(madeFirst)}));
console.log(ask(${handed(madeFirst)}));
console.log(ask(${next === "null" && overRows ? "null" : handed(madeNext)}));
console.log(ask(${handed(madeFirst)}));
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
