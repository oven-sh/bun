"use strict";
const rows = []; for (let k = 0; k < 12; k++) rows.push({ x: 3.5 + k * 7.25, y: 90.5 - k * 6.75, vx: 0.25 * (k % 5) - 0.5, vy: 0.125 * (k % 7) - 0.375, m: 1.5 + (k % 4) });
const motes = rows.map(r => ({ x: +r.x, y: +r.y, vx: +r.vx, vy: +r.vy, m: +r.m }));
const change = new Function("list", 'const o = list[5]; o.vy = { valueOf() { seen.push("vy@" + String(o.vx).slice(0, 9)); return 0.5; } };');
function step() {
  for (let i = 0; i < motes.length; i++) {
    const a = motes[i];
    for (let j = i + 1; j < motes.length; j++) {
      const b = motes[j], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy + 1, pull = 0.01 / (d2 * Math.sqrt(d2));
      a.vx += dx * b.m * pull; a.vy += dy * b.m * pull;
      b.vx -= dx * a.m * pull; b.vy -= dy * a.m * pull;
    }
  }
}
function show() { return motes.map(o => [typeof o.vx, String(o.vx).slice(0, 12), typeof o.vy, String(o.vy).slice(0, 12), typeof o.m, String(o.x).slice(0, 8)].join(":")).join(" "); }
const log = globalThis.seen = [];
for (let t = 0; t < 400; t++) { if (t === 300) change(motes); step(); }
console.log(show()); console.log(log.length, log.slice(0, 12).join(","), log.slice(-6).join(","));
