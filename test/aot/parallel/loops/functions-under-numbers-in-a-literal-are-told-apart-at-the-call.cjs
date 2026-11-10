// STATISTIC: CallsToldApartByCallee >= 1
"use strict";
const z = JSON.parse("0"); let last = 0;
const ways = { 0: (x) => x + 1, 1: (x) => x * 2 };
function f(t) { for (let i = 0; i < 100; i++) { last = ways[(i + z + t) & 1](i); } return last; }
const go = { f }[JSON.parse("\"f\"")];
console.log([go(0), go(1), go(+(process.argv[2] ?? 2))].join(" | "));
