"use strict";
// Records of five shapes out of one text, read in one loop that is entered again and again: each read finds its value by the record's own shape.
const size = Number(process.env.SIZE ?? 500);
const lead = ["", '"a":1,', '"a":1,"b":2,', '"b":2,', '"c":3,"a":1,"b":2,'];
const rows = JSON.parse("[" + Array.from({ length: size }, (_, i) => "{" + lead[i % 5] + '"price":' + i + ',"count":' + (i % 7) + "}").join(",") + "]");
function total(rows) { let sum = 0; for (const row of rows) sum += row.price * row.count; return sum; }
let all = 0;
for (let turn = 0; turn < 300; turn++) all = (all + total(rows)) % 1000003;
console.log(all);
