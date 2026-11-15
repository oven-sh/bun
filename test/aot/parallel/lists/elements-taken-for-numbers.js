// Elements that Math takes, sums of two elements, and lists that some turns alone read, over lists of every kind.
// STATISTIC: ArraysConvertedToDoubleStorage >= 12
function clamps(a, c) {
  for (let i = 0; i < c.length; i++) c[i] = Math.min(Math.max(a[i], 2), 6);
  return 0;
}
function greater(a, c) {
  for (let i = 0; i < c.length; i++) c[i] = Math.max(a[i], c[i]);
  return 0;
}
function greatest(a, c) {
  let m = -1; for (let i = 0; i < a.length; i++) m = Math.max(m, a[i]); return m;
  return 0;
}
function floors(a, c) {
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.floor(a[i]) + Math.ceil(c[i]); return s;
  return 0;
}
function rounds(a, c) {
  for (let i = 0; i < c.length; i++) c[i] = Math.round(a[i] / 2);
  return 0;
}
function absolutes(a, c) {
  for (let i = 0; i < a.length; i++) c[i] = Math.abs(a[i]) + Math.sign(c[i]);
  return 0;
}
function roots(a, c) {
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.sqrt(a[i]) + Math.hypot(a[i], c[i]); return s;
  return 0;
}
function powers(a, c) {
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.pow(a[i], 2) * Math.imul(c[i], 3) + Math.clz32(a[i]); return s;
  return 0;
}
function angles(a, c) {
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.atan2(a[i], c[i]) + Math.sin(a[i]); return s;
  return 0;
}
function added(a, c) {
  for (let i = 0; i < a.length; i++) c[i] = a[i] + c[i];
  return 0;
}
function addedNext(a, c) {
  for (let i = c.length - 1; i > 0; i--) c[i] += c[i - 1];
  return 0;
}
function sumsOfBoth(a, c) {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] + c[i]; return s;
  return 0;
}
function joins(a, c) {
  let s = ""; for (let i = 0; i < a.length; i++) s += a[i] + c[i]; return s;
  return 0;
}
function eitherOne(a, c) {
  let s = 0; for (let i = 0; i < a.length; i++) s += (i & 1 ? a[i] : c[i]) * 2; return s;
  return 0;
}
function storesEither(a, c) {
  for (let i = 0; i < a.length; i++) c[i] = i & 1 ? a[i] : c[i];
  return 0;
}
function someTurns(a, c) {
  let s = 0; for (let i = 0; i < 8; i++) if (i & 1) s += a[i] * 2; return s;
  return 0;
}
function neverRead(a, c) {
  let s = 0; for (let i = 0; i < c.length; i++) { s += c[i] * 1; if (i > 50) s += a[i]; } return s;
  return 0;
}
function ofValues(a, c) {
  let k = 0; for (const x of a) c[k++] = x; return k;
  return 0;
}
function ofSums(a, c) {
  let k = 0; for (const x of a) { c[k] = x + c[k]; k++; } return k;
  return 0;
}
function calls(a, c) {
  let s = 0; for (let i = 0; i < a.length; i++) { s += Math.max(a[i], 3); change(a, i); } return s;
  return 0;
}
let seen = 0, changes = 0;
class Own extends Array {}
const n = JSON.parse("3"), log = [];
function change(list, i) {
  changes++;
  if (changes % 11 === 0) list.length = 2;
  if (changes % 7 === 0) list[i] = "t";
}
function show(list) {
  if (list === null || typeof list !== "object") return String(list);
  const all = [];
  for (let i = 0; i < Math.min(list.length >>> 0, 14); i++) all.push(i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" ? "{}" : typeof list[i] === "bigint" ? list[i] + "n" : typeof list[i] === "string" ? "'" + list[i] : String(list[i])) : "hole");
  return list.length + ":" + all.join();
}
const kinds = {
  "doubles": () => [0.5, -1.5, 2.5, -3.5, 4.5, 5.5, 6.5, 7.5],
  "ints": () => [1, -2, 3, 4, -5, 6, 7, 8],
  "made doubles": () => Array.from({ length: 8 }, (_, i) => i / 4 - n),
  "made ints": () => Array.from({ length: 8 }, (_, i) => i - n),
  "greatest": () => [2147483647, 2147483646, -2147483648, 4294967295, 9007199254740991, 1, 2, 3],
  "not a number": () => [NaN, -0, Infinity, -Infinity, 0, 1, 2, 3],
  "holes": () => [0.5, , 2.5, , 4.5, 5.5, , 7.5],
  "holes of ints": () => [1, , 3, 4, , 6, 7, 8],
  "room": () => new Array(8),
  "texts": () => ["1", "2", "x", "", "5", "6", "7", "8"],
  "words": () => ["a", "b", "c", "d", "e", "f", "g", "h"],
  "late text": () => [1, 2, 3, 4, 5, "6", 7, 8],
  "late text of doubles": () => [1.5, 2, 3, 4, 5, "6", 7, 8],
  "bigints": () => [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n],
  "late bigint": () => [1, 2, 3, 4, 5n, 6, 7, 8],
  "objects": () => [1, { valueOf() { seen++; return 2; } }, 3, 4, 5, 6, 7, 8],
  "throws": () => [1, 2, 3, { valueOf() { throw new RangeError("no"); } }, 5, 6, 7, 8],
  "symbols": () => [1, 2, Symbol.iterator, 4, 5, 6, 7, 8],
  "nothing": () => [1, null, undefined, true, false, 6, 7, 8],
  "lists": () => [[1], [2, 3], [], ["4"], 5, 6, 7, 8],
  "short": () => [1, 2.5, 3],
  "none": () => [],
  "far": () => (() => { const list = [1.5, 2.5]; list[n + 90] = 3; return list; })(),
  "frozen": () => Object.freeze([1.5, 2, 3, 4, 5, 6, 7, 8]),
  "accessor": () => (() => { const list = [1.5, 2, 3, 4, 5, 6, 7, 8]; Object.defineProperty(list, 5, { get() { seen++; return 0.25; }, set(value) { seen += 10; }, configurable: true }); return list; })(),
  "own prototype": () => (() => { const list = [1.5, , 3.5, 4]; Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { value: 9.5, writable: true }, 6: { get() { seen++; return 7; }, set(value) { seen += 100; } } })); return list; })(),
  "heir": () => Own.from([1.5, 2.5, 3.5, 4.5]),
  "view": () => new Float64Array([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]),
  "bytes": () => new Uint8Array([255, 2, 3, 4, 5, 6, 7, 254]),
  "text": () => "01234567",
  "undefined": () => undefined,
  "null": () => null,
  "like": () => ({ length: 8, 0: 1.5, 1: 2, 3: 4 }),
  "proxy": () => new Proxy([1.5, 2, 3, 4, 5, 6, 7, 8], { get(target, key, receiver) { seen++; return Reflect.get(target, key, receiver); } }),
};
const functions = { clamps, greater, greatest, floors, rounds, absolutes, roots, powers, angles, added, addedNext, sumsOfBoth, joins, eitherOne, storesEither, someTurns, neverRead, ofValues, ofSums, calls };
let numberOfCase = 0;
for (let times = 0; times < 2; times++) {
  for (const kindOfA of Object.keys(kinds)) {
    for (const kindOfC of Object.keys(kinds).concat("same")) {
      for (const name of Object.keys(functions)) {
        if (numberOfCase++ % 13) continue;
        const a = kinds[kindOfA](), c = kindOfC === "same" ? a : kinds[kindOfC]();
        seen = changes = 0;
        let answer;
        try {
          const made = functions[name](a, c);
          answer = typeof made + " " + (Object.is(made, -0) ? "-0" : String(made));
        } catch (error) {
          answer = error.name;
        }
        log.push(name + " " + kindOfA + " " + kindOfC + ": " + answer + " " + show(a) + " " + show(c) + " " + seen);
      }
    }
  }
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 7) console.log(log[i]);
