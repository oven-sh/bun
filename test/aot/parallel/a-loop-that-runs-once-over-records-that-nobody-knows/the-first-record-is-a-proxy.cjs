"use strict";
// A proxy's trap is code: the site stays empty and the general read calls the trap.
const size = Number(process.env.SIZE ?? 300);
const rows = JSON.parse("[" + Array.from({ length: size }, (_, i) => '{"price":' + i + ',"count":2}').join(",") + "]");
const said = [];
rows[0] = new Proxy({ price: 7, count: 3 }, { get(target, name, receiver) { said.push(String(name)); return Reflect.get(target, name, receiver); } });
function total(rows) { let sum = 0; for (const row of rows) sum += row.price * row.count; return sum; }
console.log(total(rows), said.join(" | "));
