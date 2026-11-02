// What `<<`, `>>` and `>>>` make of an integer within known bounds, by a count within known bounds, lies within bounds of its own.
// What is made of the result goes by them: a shift of one value by one count is that value, a comparison is decided, an index needs no test.
// IR= 0 halfOfALength URShift
// IR= 0 quarterOfEightToEleven URShift|Less|Greater
// IR= 0 fourTimesUpToThree Less|Greater
// IR= 0 eightTimesANegative Less|Greater
// IR= 0 highBitsOfANegative Less|Greater
// IR= 0 negativeReadAsUnsigned Less|Greater
// IR= 0 byFourToSeven Less|Greater
// IR= 0 unsignedByFourToSeven Less|Greater
// IR= 0 oneBitOfFour Less|Greater
// IR= 0 negativeByOneOrTwo Less|Greater
// IR= 0 byThirtyTwoToThirtyFive Less|Greater
// IR= 0 halfOfAnUnsigned Less|Greater
// IR= 2 byThirtyOneToThirtyFour Less|Greater
// IR= 2 pastTheLastBit Less|Greater
let guard = 0;
const table = [];
for (let k = 0; k < 64; k++) table.push("t" + k);

function halfOfALength(a, b, c, d) { if (guard) halfOfALength(a, b, c, d); const list = [a, b, c, d]; return list.length >>> 1; }
function quarterOfEightToEleven(x) { if (guard) quarterOfEightToEleven(x); const q = ((x & 3) + 8) >>> 2; return q < 2 ? "below" : q > 2 ? "above" : table[q]; }
function fourTimesUpToThree(x) { if (guard) fourTimesUpToThree(x); const p = (x & 3) << 2; return p < 0 ? "below" : p > 12 ? "above" : table[p]; }
function eightTimesANegative(x) { if (guard) eightTimesANegative(x); const p = ((x & 3) - 4) << 3; return p < -32 ? "below" : p > -8 ? "above" : table[p + 32]; }
function highBitsOfANegative(x) { if (guard) highBitsOfANegative(x); const h = ((x & 2147483647) - 2147483648) >>> 28; return h < 8 ? "below" : h > 15 ? "above" : table[h]; }
function negativeReadAsUnsigned(x) { if (guard) negativeReadAsUnsigned(x); const u = ((x & 7) - 8) >>> 0; return u < 4294967288 ? "below" : u > 4294967295 ? "above" : table[u - 4294967288]; }

function byFourToSeven(x, c) { if (guard) byFourToSeven(x, c); const r = (x & 255) >> ((c & 3) + 4); return r < 0 ? "below" : r > 15 ? "above" : table[r]; }
function unsignedByFourToSeven(x, c) { if (guard) unsignedByFourToSeven(x, c); const r = ((x & 255) + 256) >>> ((c & 3) + 4); return r < 2 ? "below" : r > 31 ? "above" : table[r]; }
function oneBitOfFour(c) { if (guard) oneBitOfFour(c); const bit = 1 << (c & 3); return bit < 1 ? "below" : bit > 8 ? "above" : table[bit]; }
function negativeByOneOrTwo(x, c) { if (guard) negativeByOneOrTwo(x, c); const r = ((x & 15) - 32) >> ((c & 1) + 1); return r < -16 ? "below" : r > -5 ? "above" : table[r + 16]; }

function byThirtyTwoToThirtyFive(x, c) { if (guard) byThirtyTwoToThirtyFive(x, c); const r = ((x & 7) + 8) >>> ((c & 3) + 32); return r < 1 ? "below" : r > 15 ? "above" : table[r]; }
function byThirtyOneToThirtyFour(x, c) { if (guard) byThirtyOneToThirtyFour(x, c); const r = ((x & 7) + 8) >>> ((c & 3) + 31); return r < 1 ? "none left" : r > 7 ? "all left " + table[r] : table[r]; }
function byMinusOne(x) { if (guard) byMinusOne(x); const p = ((x & 7) + 8) << -1; return p + " " + (p < 0) + " " + (((x & 7) + 8) >> -1) + " " + ((-(x & 7) - 1) >>> -1); }

function pastTheLastBit(x, c) { if (guard) pastTheLastBit(x, c); const p = ((x & 3) + 1) << ((c & 1) + 30); return p < 0 ? "negative " + p : p > 1073741824 ? "large " + p : "small " + p; }
function upToTheLastBit(x) { if (guard) upToTheLastBit(x); const p = (x & 1) << 30; return p + " " + (p + p) + " " + ((p + p) | 0) + " " + (-(x & 1) << 31); }

function halfOfAnUnsigned(x) { if (guard) halfOfAnUnsigned(x); const h = (x >>> 0) >>> 1; return h < 0 ? "below" : h > 2147483647 ? "above" : h + " " + (h | 0); }
function unsignedShiftedAsSigned(x) { if (guard) unsignedShiftedAsSigned(x); const u = x >>> 0; return (u >> 1) + " " + (u << 1) + " " + (u >> 0) + " " + (u << 0); }
function pastTheUnsigned(x) { if (guard) pastTheUnsigned(x); const wide = (x >>> 0) + 4294967290; return (wide >>> 0) + " " + (wide >>> 4) + " " + (wide >> 4) + " " + (wide << 4); }
function belowTheUnsigned(x) { if (guard) belowTheUnsigned(x); const deep = -(x >>> 0) - 1; return (deep >>> 0) + " " + (deep >>> 31) + " " + (deep >> 31) + " " + (deep - 4294967296 >>> 0); }
function ofAnything(x, c) { if (guard) ofAnything(x, c); return (x << (c & 1)) + " " + (x >> (c & 1)) + " " + (x >>> ((c & 1) + 1)) + " " + ((x & 15) << c) + " " + ((x & 15) >> c) + " " + ((x | -16) >>> c); }

const oneOperand = [quarterOfEightToEleven, fourTimesUpToThree, eightTimesANegative, highBitsOfANegative, negativeReadAsUnsigned, oneBitOfFour, byMinusOne, upToTheLastBit, halfOfAnUnsigned, unsignedShiftedAsSigned, pastTheUnsigned, belowTheUnsigned];
const twoOperands = [byFourToSeven, unsignedByFourToSeven, negativeByOneOrTwo, byThirtyTwoToThirtyFive, byThirtyOneToThirtyFour, pastTheLastBit, ofAnything];
const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 16, 31, 32, 33, 255, 256, 65535, 1073741823, 1073741824, 2147483647, 2147483648, 4294967295, 4294967296, 4294967301, 9007199254740991,
  -1, -2, -3, -7, -8, -9, -31, -32, -33, -1073741824, -2147483648, -2147483649, -4294967295, -4294967296, -9007199254740991, 0.5, -0.5, -0, 1e21, NaN, Infinity, -Infinity];
const odd = [undefined, null, true, false, "7", "-9", "x", "", [5], {}, { valueOf() { return -3; } }];

console.log(halfOfALength(1, 2, 3, 4), halfOfALength());
for (const shift of oneOperand) {
  const seen = new Set();
  for (const x of values) seen.add(shift(x));
  for (const x of odd) seen.add(shift(x));
  console.log(shift.name + ": " + [...seen].join(" | "));
}
for (const shift of twoOperands) {
  const seen = new Set();
  for (const x of values) for (const c of values) seen.add(shift(x, c));
  for (const x of odd) for (const c of odd) seen.add(shift(x, c));
  let sum = 0;
  for (const text of seen) for (let k = 0; k < text.length; k++) sum = (sum * 31 + text.charCodeAt(k)) | 0;
  console.log(shift.name + ": " + seen.size + " answers, " + sum + ", " + [...seen].slice(0, 12).join(" | "));
}
let warm = 0;
for (let turn = 0; turn < 3000; turn++) {
  const x = (turn * 2654435761) | 0;
  for (const shift of oneOperand) warm += shift(x).length;
  for (const shift of twoOperands) warm += shift(x, turn).length;
}
console.log(warm);
guard += warm > 1e12 ? 1 : 0;
