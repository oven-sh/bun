"use strict";
// Records with more names than their cells hold keep the later ones in their storage; two shapes of them in turn.
const size = Number(process.env.SIZE ?? 300);
const many = Array.from({ length: 12 }, (_, k) => '"n' + k + '":' + k).join(",");
const rows = JSON.parse("[" + Array.from({ length: size }, (_, i) => "{" + (i % 2 ? '"kind":1,' : "") + many + ',"price":' + i + ',"count":2}').join(",") + "]");
function total(rows) { let sum = 0; for (const row of rows) sum += row.price * row.count; return sum; }
let all = 0;
for (let turn = 0; turn < 200; turn++) all = (all + total(rows)) % 1000003;
console.log(all);
