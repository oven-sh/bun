"use strict";
const shelf = JSON.parse('{"rows":[{"w":"ab"},{"w":"cde"},{"w":"f"},{"w":"ghij"},{"w":"kl"},{"w":"m"},{"w":"nopq"},{"w":"rs"}]}'), seen = new WeakMap();
function note(o) { let m = seen.get(o); if (!m) seen.set(o, m = { hits: 0, size: o.w.length }); m.hits = m.hits + 1 & 1023; return m; }
function tally(shelf, t) { let s = 0; const rows = shelf.rows; for (let i = 0; i < 40; i++) { const m = note(rows[(i + t) % 8]); s += m.size; } return s; }
const kit = { tally, other(shelf, t) { return t; } }, name = JSON.parse('"tally"');
const n = 5; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + kit[name](shelf, t)) % 1000003; console.log(sum);
