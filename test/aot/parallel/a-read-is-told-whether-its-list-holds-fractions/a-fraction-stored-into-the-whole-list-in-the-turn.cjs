const make = (n, d) => { const l = []; for (let i = 0; i < n; i++) l.push(i + d); return l; };
function f(a, w, at) { let s = 0, t = 0, u = 0; for (let i = 0; i < a.length; i++) { s += a[i] * w[i]; t += w[i] * 2; u += a[i] + w[(i * 7) % 40]; if (i === at) w[i + 1 < 40 ? i + 1 : 0] = 0.25; } return s + t + u; }
const out = [];
for (let r = 0; r < 40; r++) for (const at of [-1, 0, 5, 19, 39]) { const a = make(40, r & 1 ? 0 : 0.5), w = make(40, 0); out.push(f(a, w, at)); }
console.log(out.slice(-10).join());
