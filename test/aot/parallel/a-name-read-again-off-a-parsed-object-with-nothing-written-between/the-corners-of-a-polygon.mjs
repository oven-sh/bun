const corners = JSON.parse('[{"x":3,"y":4},{"x":90,"y":8},{"x":70,"y":77},{"x":40,"y":95},{"x":5,"y":60}]');
function count(d, k) { let hits = 0; for (let q = 0; q < 8; q++) { const px = (q * 13 + k) % 100, py = (q * 29 + k * 3) % 100; let inside = false; for (let i = 0, j = d.length - 1; i < d.length; j = i++) { const a = d[i], b = d[j]; if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside; } if (inside) hits++; } return hits; }
const byName = { count }, key = JSON.parse('"count"');
let all = 0; for (let k = 0; k < 3000; k++) all = (all * 31 + byName[key](corners, k)) % 1000003;
console.log(all);
