"use strict";
// The first record finds the name above itself, the second nowhere, the rest in themselves.
const size = Number(process.env.SIZE ?? 300);
const rows = JSON.parse("[" + Array.from({ length: size }, (_, i) => '{"price":' + i + ',"count":2}').join(",") + "]");
rows[0] = Object.create({ price: 11, count: 3 });
rows[1] = { count: 4 };
function total(rows) { let sum = 0, odd = 0; for (const row of rows) { const product = row.price * row.count; if (product === product) sum += product; else odd++; } return sum + " " + odd; }
console.log(total(rows));
