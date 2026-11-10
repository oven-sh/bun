"use strict";
// STATISTIC: LoopsBuiltForListsAndForBytes >= 1
// Where use alone says "a list of numbers", what is neither a list nor bytes ran the slow version before there was a front: the closed copy is the better road already, and a copy of its own would be bytes for nothing. (Where nothing was expected it has one.)
const key = JSON.parse('"go"');
const T = { go(d) { let h = 7; for (let i = 0; i <= d.length; i++) h = (h * 31 + d[i]) | 0; return h; } };
module.exports = T;
for (const v of [[1, 2, 3], [0.5, , 3], ["a", 2], new Uint8Array([1, 2, 3]), Buffer.from([1, 2, 3]), new Int8Array([-1, 2]), new Float64Array([0.5, NaN]), new Uint32Array([4294967295]), "abc", { length: 1, 0: 9 }, []]) for (let turn = 0; turn < 3; turn++) console.log(String(module.exports[key](v)));
