"use strict";
const log = [];
class Line { constructor(n) { this.n = n; } }
const rows = JSON.parse('[' + Array.from({ length: 12 }, (_, i) => `{"price":${i + 1},"qty":${i % 4}}`).join() + ']');
const more = JSON.parse('[{"qty":8,"price":7},{"price":9,"qty":1}]');
rows.splice(10, 0, Object.assign(new Line(1), more[0])); rows.push(Object.assign(new Line(2), more[1]));
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
console.log("SAID", log.join(" | "));
