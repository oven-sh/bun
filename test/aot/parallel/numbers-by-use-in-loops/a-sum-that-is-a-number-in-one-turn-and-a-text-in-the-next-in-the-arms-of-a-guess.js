// The same loops; one field is a number in most bodies and a text in one: the sum stored into it joins texts there.
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
  return String(e).slice(0, 12) + bodies.map(b => String(b.vx).slice(0, 8)).join();
}
console.log(step(0)); kept[2].vx = "t"; console.log(step(1)); kept[0].x = 3n; try { step(2); console.log("no throw"); } catch (error) { console.log(error.constructor.name); }
