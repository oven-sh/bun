"use strict";
const say = x => Object.is(x, -0) ? "-0" : String(x);
const doubles = new Float64Array([0, -0, 0.5, -0.5, 1.5, -1.5, 2.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 1e21, -1e21, 5e-324, 0.49999999999999994, -0.49999999999999994, 3]); const list = [0, -0, 0.5, -0.5, 1.5, -1.5, 2.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 1e21, -1e21, 5e-324, 0.49999999999999994, -0.49999999999999994, 3]; const ints = new Int32Array([0, 1, -1, 2147483647, -2147483648, 7, -7, 100, -100, 65536, 3]);
function overDoubles(a) { let s = ""; for (let i = 0; i < a.length; i++) { const x = a[i]; s += say(Math.sign(x)) + " "; } return s; }
function folded(a) { let s = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; s = s * 3 + Number(Math.sign(x)) % 1000; } return s; }
console.log(overDoubles(doubles)); console.log(overDoubles(list)); console.log(overDoubles(ints)); console.log(say(folded(doubles)), say(folded(list)), say(folded(ints)), say(folded(new Float64Array(0))), say(folded(new Float64Array(8).fill(-0))), say(folded(new Float64Array(9).fill(2.5))));
// STATISTIC: LoopsWhoseTurnsAreLaidOut >= 1
