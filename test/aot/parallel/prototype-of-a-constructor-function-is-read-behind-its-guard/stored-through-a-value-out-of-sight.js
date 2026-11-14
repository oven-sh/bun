const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
const opaque = (v) => (process.argv.length > 99 ? undefined : v);
function F(x) { this.x = x; }
F.prototype.m = function () { return this.x + 1; };
const first = F.prototype;
const second = { m() { return this.x + 100; } };
function deed() { opaque(F).prototype = second; }
function run(n, deedAt) { let t = 0; for (let i = 0; i < n; i++) { if (i === deedAt) deed(); const o = new F(i & 7); t += o.m() + (Object.getPrototypeOf(o) === first ? 1000 : 0) + (Object.getPrototypeOf(o) === second ? 100000 : 0); } return t; }
console.log(attempt(() => run(6, -1))); console.log(attempt(() => run(6, 3))); console.log(attempt(() => run(6, -1)));
