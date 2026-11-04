const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Base(a) { this.a = a; }
function Below(a, b) { this.a = a; this.b = b; }
const first = function () { return this.a; };
const other = function () { return this.a + 100; };
const second = function () { return this.b + this.first(); };
function read(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new Below(i & 7, 2); t += o.second() + o.a; } return t; }
const show = () => console.log(attempt(() => read(5)));
Base.prototype.first = first; Below.prototype = Object.create(Base.prototype); Below.prototype.second = second; show(); console.log(new Base(3).a);
