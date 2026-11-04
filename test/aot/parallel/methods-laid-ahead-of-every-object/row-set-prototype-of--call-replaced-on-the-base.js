const opaque = (v) => (process.argv.length > 99 ? undefined : v);
function Base(a) { this.a = a; }
function Below(a, b) { Base.call(this, a); this.b = b; }
const first = function () { return this.a; };
const other = function () { return this.a + 100; };
function read(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new Below(i & 7, 2); t += o.second() + o.a; } return t; }
const show = (when) => { let r; try { r = String(read(5)); } catch (e) { r = "threw " + e.name; } console.log(when, r); };
Base.prototype.first = first; Object.setPrototypeOf(Below.prototype, Base.prototype); Below.prototype.second = function () { return this.b + this.first(); }; show("a"); Base.call = function (self, a) { self.a = a * 2; }; show("b");
