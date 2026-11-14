// Object.is in loops of numbers that lie in registers, of numbers or undefined, and of both beside values of other kinds.
const bits = (high, low = 0) => { const v = new DataView(new ArrayBuffer(8)); v.setUint32(0, high); v.setUint32(4, low); return v.getFloat64(0); };
const numbers = [0, -0, 1, -1, 0.5, NaN, 0 / 0, -(0 / 0), bits(0x7ff80000, 1), bits(0xfff80000), bits(0x7ff00000, 1), Infinity, -Infinity, 2 ** 31, 2 ** 53, -(2 ** 31), 5e-324, -5e-324];
const maybe = [0, -0, undefined, NaN, 1, undefined, 0.5, 0 / 0, null];
const holes = [1.5, , NaN, -0, , 0];
const mixed = [0, "0", NaN, "NaN", undefined, null, true, -0, 1n, {}, [NaN], Symbol.iterator];
const floats = Float64Array.from(numbers), ints = Int32Array.from([0, -1, 5]);
const lines = [];
function pairs(list, turns) { let shown = ""; for (let k = 0; k < turns; k++) for (let i = 0; i < list.length; i++) shown += Object.is(list[k], list[i]) ? 1 : 0; return shown; }
for (const list of [numbers, maybe, holes, mixed]) lines.push(pairs(list, list.length + 1));
function written(list) { let n = 0; for (let i = 0; i < list.length; i++) { n *= 3; n += Object.is(list[i], NaN) ? 1 : Object.is(list[i], -0) ? 2 : Object.is(0, list[i]) ? 4 : Object.is(list[i], 1) ? 8 : Object.is(undefined, list[i]) ? 16 : 0; } return n; }
for (const list of [numbers, maybe, holes, mixed]) lines.push(written(list));
function ofFloats(a, b) { let shown = ""; for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) shown += Object.is(a[i], b[j]) ? 1 : 0; return shown; }
lines.push(ofFloats(floats, floats), ofFloats(floats, ints), ofFloats(ints, floats), ofFloats(ints, ints), ofFloats(floats, numbers), ofFloats(maybe, floats));
function computed(turns) { let n = 0; for (let k = 0; k < turns; k++) { const x = k * 0.1 - 0.5, y = x * 0, z = x / 0, w = z - z; n = n * 2 + (Object.is(y, -0) ? 1 : 0); n += Object.is(w, NaN) ? 1 : 0; n += Object.is(z, -Infinity) ? 2 : 0; n += Object.is(w, z * 0) ? 4 : 0; n += Object.is(Math.sqrt(x), NaN) ? 8 : 0; n += Object.is(-w, w) ? 16 : 0; n %= 1000003; } return n; }
lines.push(computed(12));
function outside(list, turns) { let n = 0; for (let k = 0; k < turns; k++) n = n * 2 + (Object.is(list[k], undefined) ? 1 : 0) + (Object.is(list[k], list[k + 1]) ? 4 : 0); return n; }
lines.push(outside([1.5, 2.5], 6), outside([1, 2], 6), outside(new Float64Array(2), 5));
const short = new Float64Array([NaN, -0, 1.5]);
function pastTheEnd(turns) { let shown = ""; for (let i = 0; i < turns; i++) for (let j = 0; j < turns; j++) shown += Object.is(short[i], short[j]) ? 1 : 0; return shown; }
lines.push(pastTheEnd(5));
function pastTheEndOrWritten(turns) { let n = 0; for (let i = 0; i < turns; i++) { n *= 3; n += Object.is(short[i], NaN) ? 1 : Object.is(short[i], -0) ? 2 : 0; n += Object.is(short[i], i / 2) ? 1 : 0; n += Object.is(Math.sqrt(-i), short[i]) ? 1 : 0; } return n; }
lines.push(pastTheEndOrWritten(6));
function arms(turns) { let n = 0; for (let k = 0; k < turns; k++) { const x = k % 3 ? k / 2 : undefined; n += Object.is(x, k & 1 ? 0.5 : undefined) ? 1 : 10; } return n; }
lines.push(arms(20));
console.log(lines.map(String).join("\n"));
