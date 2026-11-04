const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
const opaque = (v) => (process.argv.length > 99 ? undefined : v);
function F(x) { this.x = x; }
F.prototype.m = function () { return this.x + 1; };
const first = F.prototype;
const second = { m() { return this.x + 100; } };
function G(x) { this.x = x * 2; }
G.prototype = F.prototype;
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new F(i).m() + new G(i).m() + (new G(i) instanceof F ? 1000 : 0); return t; }
console.log(attempt(() => run(6)));
