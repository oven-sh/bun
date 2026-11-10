"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
class Point { constructor(x, y) { this.x = x; this.y = y; } }
function made(turn, i) { const point = new Point(i, turn); point["extra" + (i % 40)] = i; if (i % 3 === 0) point["second" + (i % 7)] = turn; return point; }
let sum = 0;
for (let turn = 0; turn < 8 + more; turn++) { let held = []; for (let i = 0; i < 400; i++) held.push(made(turn, i)); for (const point of held) for (const key of Object.keys(point)) sum = (sum * 31 + key.length + point[key]) % 1000003; held = null; if (turn & 1) Bun.gc(true); else { const churn = []; for (let i = 0; i < 30000; i++) churn.push({ i, turn }); sum = (sum + churn.length) % 1000003; } said.push(String(sum)); }
console.log(said.join("\n"));
