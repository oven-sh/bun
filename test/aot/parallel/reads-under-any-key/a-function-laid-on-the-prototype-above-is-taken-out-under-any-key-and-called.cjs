function F() { this.a = 1; }
F.prototype.first = function (x) { return 0; };
function hit(x) { return x + 1; }
const K = JSON.parse('["late", "first"]');
const o = new F();
function run(t, k, x) { const f = t[k]; return f(x); }
const out = [hit(1), run(o, K[1], 2)];
function later() { F.prototype.late = hit; }
later();
out.push(run(o, K[0], "s"), hit(2));
console.log(out.join());
