"use strict";
// STATISTIC: ArrayOrUint8ArrayLoopsVersioned >= 2
// What is neither a list, a Buffer nor a Uint8Array but a view of another kind of numbers takes one copy for all kinds, and each access switches over the kind of the cell. Such a turn is not written out eight times: eight switches an access for the counter's three instructions.
const key = JSON.parse('"go"');
const read = { go(d) { let h = 7; for (let i = 0; i <= d.length; i++) h = (h * 31 + d[i]) | 0; return h; } };
const stored = { go(d) { for (let i = 0; i < d.length; i++) d[i] = d[i] * 3 + 0.5; return Array.prototype.join.call(d); } };
const given = () => [new Int8Array([-128, 127, 5]), new Uint8ClampedArray([0, 100, 255]), new Int16Array([-32768, 32767]), new Uint16Array([65535, 1]), new Int32Array([-2147483648, 2147483647]), new Uint32Array([4294967295, 7]), new Float32Array([0.1, -0, NaN, 3e38]), new Float64Array([0.1, -0, NaN, 1e308]), new Float16Array([0.5, 65504]), new BigInt64Array([1n]), new Uint8Array([1, 255]), Buffer.from([2, 254]), [1.5, , 3], new Int16Array(0), new Float64Array(new ArrayBuffer(16, { maxByteLength: 32 })), new DataView(new ArrayBuffer(2))];
for (const d of given()) for (let turn = 0; turn < 3; turn++) { let said; try { said = read[key](d) + " " + stored[key](d); } catch (e) { said = e.name; } console.log(said); }
