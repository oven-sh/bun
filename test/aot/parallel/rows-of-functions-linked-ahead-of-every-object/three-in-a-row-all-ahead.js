const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Top(a) { this.a = a; }
function Middle(a, m) { Top.call(this, a); this.m = m; }
function Low(a, m, l) { Middle.call(this, a, m); this.l = l; }
function read(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new Low(i & 7, 2, 3); t += o.low(); } return t; }
const show = () => console.log(attempt(() => read(5)));
Middle.prototype = Object.create(Top.prototype); Low.prototype = Object.create(Middle.prototype); Top.prototype.top = function () { return this.a; }; Middle.prototype.middle = function () { return this.m + this.top(); }; Low.prototype.low = function () { return this.l + this.middle() + this.top(); }; show();
