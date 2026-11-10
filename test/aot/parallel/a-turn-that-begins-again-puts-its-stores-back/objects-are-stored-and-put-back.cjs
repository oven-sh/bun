"use strict";
const rows = []; for (let k = 0; k < 12; k++) rows.push({ x: 3.5 + k * 7.25, y: 90.5 - k * 6.75, vx: 0.25 * (k % 5) - 0.5, vy: 0.125 * (k % 7) - 0.375, m: 1.5 + (k % 4) });
const motes = rows.map((r, k) => ({ x: +r.x, y: +r.y, vx: +r.vx, vy: +r.vy, m: +r.m, tag: { n: k } }));
const log = globalThis.seen = [];
const change = new Function("list", 'list[7].m = "6";');
function step() {
  for (let i = 0; i < motes.length; i++) {
    const a = motes[i];
    for (let j = i + 1; j < motes.length; j++) {
      const b = motes[j];
      const kept = a.tag; a.tag = b.tag; b.tag = kept;
      a.vx += b.m * 0.001 + a.tag.n * 0.0001;
    }
  }
  if (globalThis.gc && log.length === 0) gc();
}
function show() { return motes.map(o => [typeof o.vx, String(o.vx).slice(0, 12), typeof o.vy, String(o.vy).slice(0, 12), typeof o.m, String(o.x).slice(0, 8)].join(":")).join(" "); }
for (let t = 0; t < 400; t++) { if (t === 300) change(motes); step(); }
console.log(show()); console.log(motes.map(o => o.tag.n).join()); console.log(log.length, log.slice(0, 12).join(","), log.slice(-6).join(","));
