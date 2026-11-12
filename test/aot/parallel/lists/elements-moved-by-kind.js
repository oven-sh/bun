// Loops that move elements: copies, swaps, reversals, shifts, shuffles, fills, between lists of every kind, also one list for both.
// STATISTIC: ElementCopyLoopsHoisted >= 7
// STATISTIC: ValuesStoredByAnyKind >= 7
function copy(a, b, c) {
  for (let i = 0; i < a.length; i++) c[i] = a[i];
  return 0;
}
function copyInto(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = a[i];
  return 0;
}
function copyWritten(a, b, c) {
  for (let i = 0; i < 9; i++) c[i] = a[i];
  return 0;
}
function copyNext(a, b, c) {
  for (let i = 0; i < a.length - 1; i++) c[i] = a[i + 1];
  return 0;
}
function copyBack(a, b, c) {
  for (let i = a.length - 1; i >= 0; i--) c[i] = a[i];
  return 0;
}
function shift(a, b, c) {
  for (let i = c.length - 1; i > 0; i--) c[i] = c[i - 1];
  return 0;
}
function reverse(a, b, c) {
  for (let i = 0, j = c.length - 1; i < j; i++, j--) { const t = c[i]; c[i] = c[j]; c[j] = t; }
  return 0;
}
function neighbors(a, b, c) {
  for (let i = 0; i < c.length - 1; i += 2) { const t = c[i]; c[i] = c[i + 1]; c[i + 1] = t; }
  return 0;
}
function shuffle(a, b, c) {
  let x = 7; for (let i = c.length - 1; i > 0; i--) { x = (x * 13 + 5) & 255; const j = x % (i + 1); const t = c[i]; c[i] = c[j]; c[j] = t; }
  return 0;
}
function fill(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = a[2];
  return 0;
}
function some(a, b, c) {
  let k = 0; for (let i = 0; i < a.length; i++) if (i & 1) c[k++] = a[i];
  return 0;
}
function both(a, b, c) {
  for (let i = 0; i < a.length; i++) { c[i] = a[i]; b[i] = a[i]; }
  return 0;
}
function rotate(a, b, c) {
  for (let i = 0; i < a.length; i++) { const t = a[i]; a[i] = c[i]; c[i] = b[i]; b[i] = t; }
  return 0;
}
function andSums(a, b, c) {
  let s = 0; for (let i = 0; i < a.length; i++) { c[i] = a[i]; s += b[i] * 2; } return s;
  return 0;
}
function andReads(a, b, c) {
  let s = 0; for (let i = 0; i < a.length; i++) { c[i] = a[i]; if (a[i] === b[i]) s++; } return s;
  return 0;
}
function pushes(a, b, c) {
  for (let i = 0; i < a.length && i < 20; i++) { c[i] = a[i]; if (i === n) c.push(i); }
  return 0;
}
function shortens(a, b, c) {
  for (let i = 0; i < a.length; i++) { c[i] = a[i]; if (i === n) a.length = 5; }
  return 0;
}
function nested(a, b, c) {
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) c[x * 3 + y] = a[y * 3 + x];
  return 0;
}
function calls(a, b, c) {
  for (let i = 0; i < a.length; i++) { c[i] = a[i]; change(c, i); }
  return 0;
}
function of(a, b, c) {
  let k = 0; for (const x of a) c[k++] = x;
  return 0;
}
function guarded(a, b, c) {
  try { for (let i = 0; i < a.length; i++) c[i] = a[i]; } catch (error) { return error.name; }
  return 0;
}
let seen = 0, changes = 0;
class Own extends Array {}
const n = JSON.parse("3"), log = [];
function change(list, i) {
  changes++;
  if (changes % 11 === 0) list.length = 2;
  if (changes % 7 === 0) list[i] = "t";
  if (changes % 13 === 0) list[i] = 0.25;
}
const word = value => (Object.is(value, -0) ? "-0" : value === null || typeof value !== "object" ? typeof value === "bigint" ? value + "n" : typeof value === "string" ? "'" + value : String(value) : "{" + value.v + "}");
function show(list) {
  if (list === null || typeof list !== "object") return String(list);
  const all = [];
  for (let i = 0; i < Math.min(list.length >>> 0, 14); i++) all.push(i in list ? word(list[i]) : "hole");
  return list.length + ":" + all.join();
}
function behind(list) {
  if (!Array.isArray(list) || Object.isFrozen(list)) return "";
  let said = "";
  try {
    said += list.indexOf(4) + " " + list.includes(6.5) + " " + list.lastIndexOf(9) + " ";
    let s = 0;
    for (let i = 0; i < Math.min(list.length, 9); i++) if (typeof list[i] === "number") s += list[i] | 0;
    list[0] = 0.75;
    list[list.length > 1 ? 1 : 0] = "x";
    said += s + " " + show(list);
  } catch (error) {
    said += error.name;
  }
  return said;
}
const kinds = {
  "doubles": () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5],
  "ints": () => [1, 2, 3, 4, 5, 6, 7, 8, 9],
  "made doubles": () => Array.from({ length: 9 }, (_, i) => i / 4 + n),
  "made ints": () => Array.from({ length: 9 }, (_, i) => i + n),
  "objects": () => Array.from({ length: 9 }, (_, i) => ({ v: i })),
  "texts": () => ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
  "mixed": () => [1, "2", null, 4.5, undefined, true, { v: 7 }, 8, 9],
  "late object": () => [1, 2, 3, 4, 5, { v: 6 }, 7, 8, 9],
  "late double": () => [1, 2, 3, 4, 5, 6, 7.5, 8, 9],
  "whole doubles": () => (() => { const list = [0.5, 1, 2, 3, 4, 5, 6, 7, 8]; list[0] = 9; return list; })(),
  "whole among values": () => (() => { const list = [{}, 1, 2, 3, 4, 5, 6, 7, 8]; list[0] = 4.5 * 2; for (let i = 1; i < 9; i++) list[i] = list[i] * 0.5 * 2; return list; })(),
  "not a number": () => [NaN, -0, Infinity, 0, 1, 2, 3, 4, 5],
  "far numbers": () => [2147483647, 2147483648, -2147483648, -2147483649, 1, 2, 3, 4, 5],
  "holes of doubles": () => [0.5, , 2.5, , 4.5, 5.5, 6.5, 7.5, 8.5],
  "holes of ints": () => [1, , 3, 4, , 6, 7, 8, 9],
  "holes of objects": () => [{ v: 1 }, , { v: 3 }, , { v: 5 }, 6, 7, 8, 9],
  "room": () => new Array(9),
  "filled": () => new Array(9).fill(0),
  "short doubles": () => [0.5, 1.5],
  "short ints": () => [1, 2, 3],
  "short objects": () => [{ v: 1 }, { v: 2 }],
  "none": () => [],
  "bigints": () => [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n],
  "symbols": () => [Symbol.iterator, 2, 3, 4, 5, 6, 7, 8, 9],
  "far": () => (() => { const list = [1.5, 2.5]; list[n + 90] = 3; return list; })(),
  "frozen": () => Object.freeze([1.5, 2, 3, 4, 5, 6, 7, 8, 9]),
  "sealed": () => Object.seal([1, 2, 3, 4, 5, 6, 7, 8, 9]),
  "sealed objects": () => Object.seal([{ v: 1 }, 2, 3, 4, 5, 6, 7, 8, 9]),
  "fixed length": () => (() => { const list = [1.5, 2.5, 3.5]; Object.defineProperty(list, "length", { writable: false }); return list; })(),
  "accessor": () => (() => { const list = [1, 2, 3, 4, 5, 6, 7, 8, 9]; Object.defineProperty(list, 5, { get() { seen++; return 0.25; }, set(value) { seen += 10; }, configurable: true }); return list; })(),
  "own prototype": () => (() => { const list = [1.5, , 3.5, 4]; Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { value: 9.5, writable: true }, 6: { get() { seen++; return 7; }, set(value) { seen += 100; } } })); return list; })(),
  "heir": () => Own.from([1, 2.5, "3", 4]),
  "view": () => new Float64Array([0.5, 1, 2, 3, 4, 5, 6, 7, 8]),
  "bytes": () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
  "text": () => "012345678",
  "like": () => ({ length: 9, 0: 1, 1: "2", 3: 4.5 }),
  "nothing": () => undefined,
  "proxy": () => new Proxy([1, 2.5, "3", 4, 5, 6, 7, 8, 9], { get(target, key, receiver) { seen++; return Reflect.get(target, key, receiver); } }),
};
const functions = { copy, copyInto, copyWritten, copyNext, copyBack, shift, reverse, neighbors, shuffle, fill, some, both, rotate, andSums, andReads, pushes, shortens, nested, calls, of, guarded };
let numberOfCase = 0;
const kept = [];
for (let times = 0; times < 2; times++) {
  for (const kindOfA of Object.keys(kinds)) {
    for (const kindOfC of Object.keys(kinds).concat("same")) {
      for (const name of Object.keys(functions)) {
        if (numberOfCase++ % 11) continue;
        const a = kinds[kindOfA](), c = kindOfC === "same" ? a : kinds[kindOfC](), b = kinds[kindOfC === "same" ? "objects" : kindOfA]();
        seen = changes = 0;
        let answer;
        try {
          answer = String(functions[name](a, b, c));
        } catch (error) {
          answer = error.name;
        }
        log.push(name + " " + kindOfA + " " + kindOfC + ": " + answer + " " + show(a) + " " + show(c) + " " + seen + " | " + behind(c));
        if (log.length % 37 === 0) kept.push(c);
      }
    }
  }
}
const old = [];
for (let i = 0; i < 64; i++) old.push({ v: -i });
if (typeof Bun !== "undefined") Bun.gc(true);
for (let round = 0; round < 20; round++) {
  const young = [];
  for (let i = 0; i < 64; i++) young.push({ v: round * 100 + i, text: "t" + i + round });
  functions.copy(young, young, old);
  functions.reverse(old, old, old);
  if (typeof Bun !== "undefined") Bun.gc(true);
  let s = 0;
  for (const each of old) s += each.v + each.text.length;
  log.push("kept " + round + " " + s);
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, kept.length, sum);
for (let i = 0; i < log.length; i += 7) console.log(log[i]);
