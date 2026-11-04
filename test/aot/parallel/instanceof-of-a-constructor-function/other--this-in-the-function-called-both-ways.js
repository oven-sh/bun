const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
function G(y) { this.y = y; }
function is(v) { return v instanceof F ? 1 : 0; }
function isG(v) { return v instanceof G ? 1 : 0; }
function all(list) { let t = ""; for (let i = 0; i < list.length; i++) t += is(list[i]) + "" + isG(list[i]); return t; }
function P(a) { if (!(this instanceof P)) return new P(a); this.a = a; } function run(n) { let t = 0; for (let i = 0; i < n; i++) t += (i & 1 ? P(i) : new P(i)).a; return t; } console.log(run(6), P.call({ }, 1).a, P.call(new P(5), 7), P.call(Object.create(P.prototype), 3));
