"use strict";
// Numbers, texts and functions find names above themselves; null throws, and says where.
const size = Number(process.env.SIZE ?? 100);
const records = JSON.parse("[" + Array.from({ length: size }, (_, i) => '{"price":' + i + ',"count":2}').join(",") + "]");
function total(rows) { let sum = 0, odd = 0; for (const row of rows) { const product = row.price * row.count; if (product === product) sum += product; else odd++; } return sum + " " + odd; }
function tried(rows) { try { return total(rows); } catch (error) { return error.constructor.name; } }
console.log(tried([5, ...records]), tried(["text", ...records]), tried([function price() {}, ...records]), tried([true, ...records]), tried([null, ...records]), tried([undefined, ...records]), tried([[1, 2], ...records]));
