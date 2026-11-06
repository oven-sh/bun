// `new Array(n)` and `Array(n)` where the text does not say what n is: every length round the edges of what is made at once, and what the arrays are afterwards.
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
// Env: JSC_aotCountsPath=/dev/null
const countsSoFar = () => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for, but for the operations named, and but for the calls that found an allocator without a cell at hand and filled it again: a line "<calls>\trefilled:<name>".
// How often that is goes by the size of the cells, which is not the same on every machine.
function callsIn(counts, ...besides) {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && !besides.includes(name)) sum += Number(calls);
    const [refills, refilled] = line.split("\trefilled:");
    if (refilled !== undefined && !besides.includes(refilled)) sum -= Number(refills);
  }
  return sum;
}
const attempt = (f) => { try { return f(); } catch (error) { return error.constructor.name + ": " + error.message; } };
function constructed(n) { return new Array(n); }
function called(n) { return Array(n); }
function describe(array) {
  if (!Array.isArray(array)) return String(array);
  if (array.length > 200000) return array.length + "/long";
  let holes = 0;
  for (let i = 0; i < array.length; i++) holes += !(i in array);
  return array.length + "/" + holes + "/" + Object.keys(array).length;
}
const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 125, 126, 127, 128, 129, 130, 255, 256, 1000, 10000, 100000];
console.log(lengths.map((n) => describe(constructed(n))).join(" "));
console.log(lengths.map((n) => describe(called(n))).join(" "));

// What is no length.
const others = [-1, -0, 0.5, 1.5, NaN, Infinity, 4294967295, 4294967296, 2147483647, 2147483648, -2147483648, "3", "", null, undefined, true, false, 3n, {}, [], [5], Symbol.iterator, { valueOf() { return 2; } }];
console.log(others.map((n) => attempt(() => describe(constructed(n)) + ":" + String(typeof n === "symbol" ? "symbol" : JSON.stringify(constructed(n).slice(0, 2), (k, v) => typeof v === "bigint" ? "big" : v)))).join(" | "));
console.log(others.map((n) => attempt(() => describe(called(n)))).join(" | "));

// Filled from the front, from the back, in the middle; grown and shrunk.
for (const n of [1, 5, 6, 126, 127, 128]) {
  const front = constructed(n), back = called(n), middle = constructed(n);
  for (let i = 0; i < n; i++) front[i] = i;
  for (let i = n; i--;) back[i] = "s" + i;
  middle[n >> 1] = { n };
  const grown = constructed(n);
  grown.push("pushed");
  grown[n + 3] = 1.5;
  const shrunk = called(n);
  shrunk.fill(7);
  shrunk.length = n >> 1;
  console.log(n, describe(front), front[n - 1], describe(back), back[0], describe(middle), JSON.stringify(middle[n >> 1]), describe(grown), grown[n], grown.indexOf(1.5), describe(shrunk), shrunk.join("").length, front.reduce((a, b) => a + b, 0), constructed(n).join("-").length, constructed(n).map(() => 1).length, called(n).concat([1]).length);
}

// Kept across collections, many at a time, of every kind of value.
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const before = countsSoFar();
const kept = [];
let sum = 0, turn = 0;
function step() {
  const n = turn++ % 140;
  const a = constructed(n), b = called(n);
  if (n) { a[0] = turn; a[n - 1] = "last"; b[n - 1] = { turn }; b[0] = 0.5; }
  sum += a.length + b.length;
  if (turn % 97 === 0) kept.push(a, b);
  if (turn % 700 === 0) collect();
}
function ten() { step(); step(); step(); step(); step(); step(); step(); step(); step(); step(); }
function hundred() { ten(); ten(); ten(); ten(); ten(); ten(); ten(); ten(); ten(); ten(); }
function thousand() { hundred(); hundred(); hundred(); hundred(); hundred(); hundred(); hundred(); hundred(); hundred(); hundred(); }
thousand(); thousand(); thousand();
collect();
const asked = callsIn(countsSoFar()) - callsIn(before);
console.log(sum, kept.length, kept.map(describe).slice(0, 12).join(" "), JSON.stringify(kept[3][kept[3].length - 1]), asked <= 1200 ? "and stores into the short ones did not ask the run time" : "and the run time was asked " + asked + " times");
