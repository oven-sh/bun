"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
class Row { constructor() { this.a = 1; this.b = 2; this.c = 3; this.d = 4; } }
let lines = 0;
for (let turn = 0; turn < 6 + more; turn++) { let held = []; for (let i = 0; i < 120; i++) { const row = new Row(); const name = "abcd"[i % 4]; delete row[name]; row[name] = i; if (i % 3 === 0) { const other = "abcd"[(i + 1) % 4]; delete row[other]; row[other] = turn; } if (i % 5 === 0) row["x" + (i % 11)] = i; held.push(row); } Bun.gc(turn % 2 === 0); for (let i = 0; i < held.length; i += 17) { const row = held[i]; delete row.a; row.a = turn; said.push(Object.keys(row).join("") + ":" + JSON.stringify(row)); lines++; } held = null; Bun.gc(true); }
said.push(String(lines));
console.log(said.join("\n"));
