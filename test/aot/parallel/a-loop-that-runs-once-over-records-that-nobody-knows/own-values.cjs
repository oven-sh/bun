"use strict";
// The ordinary spelling: a text is parsed, one loop goes over its records once.
// COUNT: operation:operationAOTFillSiteAnswers <= 12
const size = Number(process.env.SIZE ?? 3000);
let text = "[";
for (let i = 0; i < size; i++) text += (i ? "," : "") + '{"id":' + i + ',"name":"n' + i + '","price":' + ((i * 7) % 97) + ',"count":' + (i % 7) + "}";
const rows = JSON.parse(text + "]");
function total(rows) { let sum = 0; for (const row of rows) sum += row.price * row.count; return sum; }
console.log(total(rows));
