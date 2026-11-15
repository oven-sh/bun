let seed = 7;
function draw(below) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >> 8) % below; }
const parts = []; for (let i = 0; i < 16; i++) parts.push(JSON.stringify({ x: draw(100), y: draw(100) }));
const corners = JSON.parse("[" + parts.join(",") + "]");
function count(d, k) { let hits = 0; for (let q = 0; q < 8; q++) { const px = (q * 13 + k) % 100, py = (q * 29 + k * 3) % 100; let inside = false; for (let i = 0, j = d.length - 1; i < d.length; j = i++) { const a = d[i], b = d[j]; if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside; } if (inside) hits++; } return hits; }
const byName = { count }, key = JSON.parse('"count"');
let all = 0; for (let k = 0; k < 3000; k++) all = (all * 31 + byName[key](corners, k)) % 1000003;
console.log(all);
