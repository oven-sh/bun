// Loops that store counters and whole numbers, some of them beyond int32, into lists of every kind.
// STATISTIC: WholeNumberListsAskedTwice >= 10
function counter(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = i;
  return 0;
}
function twice(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = i * 2;
  return 0;
}
function squares(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = i * i * 3 - 5;
  return 0;
}
function large(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = i * 1000000007;
  return 0;
}
function cubes(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = i * i * i * 100003 - 7;
  return 0;
}
function rounds(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = Math.round(a[i] / 2);
  return 0;
}
function floors(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = Math.floor(a[i] * 3000000000);
  return 0;
}
function negative(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = -i;
  return 0;
}
function back(a, b, c) {
  for (let i = c.length - 1; i >= 0; i--) c[i] = c.length - i;
  return 0;
}
function written(a, b, c) {
  for (let i = 0; i < 9; i++) c[i] = i + n;
  return 0;
}
function other(a, b, c) {
  for (let i = 0; i < a.length; i++) c[i] = i * 7;
  return 0;
}
function stepped(a, b, c) {
  let k = 0; for (let i = 0; i < a.length; i++) if (i & 1) c[k++] = i;
  return 0;
}
function remainder(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = (i * 13 + 5) % 7;
  return 0;
}
function lengths(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = a.length - i;
  return 0;
}
function sums(a, b, c) {
  let s = 0; for (let i = 0; i < c.length; i++) { s += i; c[i] = s; } return s;
  return 0;
}
function both(a, b, c) {
  for (let i = 0; i < c.length; i++) { c[i] = i; b[i] = i * 3; }
  return 0;
}
function andFraction(a, b, c) {
  for (let i = 0; i < c.length; i++) { c[i] = i; if (i === n) c[i] = 0.5; }
  return 0;
}
function andReads(a, b, c) {
  let s = 0; for (let i = 0; i < c.length; i++) { c[i] = i * 2; s += a[i]; } return s;
  return 0;
}
function readsBack(a, b, c) {
  let s = 0; for (let i = 0; i < c.length; i++) { c[i] = i * 2; s += c[i]; } return s;
  return 0;
}
function adds(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] += i;
  return 0;
}
function nested(a, b, c) {
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) c[y * 3 + x] = y * x;
  return 0;
}
function pushes(a, b, c) {
  for (let i = 0; i < c.length && i < 20; i++) { c[i] = i; if (i === n) c.push(i); }
  return 0;
}
function shortens(a, b, c) {
  for (let i = 0; i < c.length; i++) { c[i] = i; if (i === n) c.length = 5; }
  return 0;
}
function calls(a, b, c) {
  for (let i = 0; i < c.length; i++) { c[i] = i; change(c, i); }
  return 0;
}
function guarded(a, b, c) {
  try { for (let i = 0; i < c.length; i++) c[i] = i * 2; } catch (error) { return error.name; }
  return 0;
}
function cut(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = (i * 2654435761) >>> 0;
  return 0;
}
function bits(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = (i * 2654435761) | 0;
  return 0;
}
function parsed(a, b, c) {
  for (let i = 0; i < c.length; i++) c[i] = Number(n) + i;
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
const functions = { counter, twice, squares, large, cubes, rounds, floors, negative, back, written, other, stepped, remainder, lengths, sums, both, andFraction, andReads, readsBack, adds, nested, pushes, shortens, calls, guarded, cut, bits, parsed };
let numberOfCase = 0;
const kept = [];
for (let times = 0; times < 2; times++) {
  for (const kindOfA of Object.keys(kinds)) {
    for (const kindOfC of Object.keys(kinds).concat("same")) {
      for (const name of Object.keys(functions)) {
        if (numberOfCase++ % 13) continue;
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
  functions.counter(young, young, round & 1 ? young : old);
  for (let i = 0; i < 64; i++) old[i] = young[i] === i ? { v: i, text: "n" } : young[i];
  if (typeof Bun !== "undefined") Bun.gc(true);
  let s = 0;
  for (const each of old) s += each.v + each.text.length;
  log.push("kept " + round + " " + s);
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, kept.length, sum);
for (let i = 0; i < log.length; i += 7) console.log(log[i]);
