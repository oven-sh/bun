"use strict";
// STATISTIC: ArrayOrUint8ArrayLoopsVersioned >= 1
// In a file without types `d[i]` and `d.length` say "a list of numbers". What comes may as well be a Uint8Array or a Buffer: the loop asks in front which of the three it is.
var key = JSON.parse('"go"');
var T = { go(d) { var h = 7; for (var i = 0; i <= d.length; i++) h = h * 31 + d[i]; return h; } };
var V = [new Uint8Array([1, 2, 3]), Buffer.from([1, 2, 3]), new Int8Array([-1, 2, 3]), new Uint8ClampedArray([1, 2, 3]), new Float64Array([0.5, -0, NaN]), new BigInt64Array([1n, 2n, 3n]), [1, 2, 3], [1, , 3], [0.5, -0, NaN], ["a", 2, null], "abc", { length: 3, 0: 1, 1: 2, 2: 3 }, new Array(3), Object.freeze([1, 2, 3])];
for (const v of V) for (let turn = 0; turn < 3; turn++) { let s; try { s = T[key](v); } catch (e) { s = e.name; } console.log(String(s), Array.prototype.slice.call(v, 0, 5).map(x => Object.is(x, -0) ? "-0" : String(x)).join()); }
