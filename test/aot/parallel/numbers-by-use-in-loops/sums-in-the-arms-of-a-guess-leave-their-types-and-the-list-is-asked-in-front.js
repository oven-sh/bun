// STATISTIC: KnownInductionsUsed >= 3
// Bodies pull at one another: two loops over one list by index, one in the other. `dx` may be a big integer as far as anybody knows and is asked; the sums `a.vx + ..` stand inside the arms of that guess and
// are stored at once. The row of the inner loop must still know that they are no texts, or the list is not asked for its kind of storage in front of the loop.
"use strict";
const rows = JSON.parse(process.env.NOTHING_SET_HERE || '[{"x":11.45,"y":79.45,"vx":-0.65,"vy":-0.45,"m":8.15},{"x":34.25,"y":12.5,"vx":0.35,"vy":0.75,"m":3.25},{"x":56.5,"y":44.75,"vx":-0.15,"vy":0.05,"m":5.5},{"x":78.125,"y":91,"vx":0.55,"vy":-0.85,"m":1.75},{"x":3,"y":27.5,"vx":0.25,"vy":0.45,"m":9}]');
const kept = rows.map(r => ({ x: +r.x, y: +r.y, vx: +r.vx, vy: +r.vy, m: +r.m }));
function step(turn) {
  const bodies = kept;
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy + 1, pull = 0.01 / (d2 * Math.sqrt(d2));
        a.vx += dx * b.m * pull; a.vy += dy * b.m * pull;
        b.vx -= dx * a.m * pull; b.vy -= dy * a.m * pull;
      }
    }
    for (const b of bodies) { b.x += b.vx * 0.01; b.y += b.vy * 0.01; }
  }
  let e = 0;
  for (const b of bodies) e += b.m * (b.vx * b.vx + b.vy * b.vy);
  return Math.floor(Math.abs(e) * 1000) % 100000;
}
for (let turn = 0; turn < 4; turn++) console.log(step(turn));
