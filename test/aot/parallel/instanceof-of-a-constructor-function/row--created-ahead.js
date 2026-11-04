const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Base(a) { this.a = a; }
function Below(a, b) { Base.call(this, a); this.b = b; }
function Beside(c) { this.c = c; }
function which(v) { return (v instanceof Base ? 1 : 0) + "" + (v instanceof Below ? 1 : 0) + (v instanceof Beside ? 1 : 0); }
const show = () => console.log(attempt(() => which(new Base(1)) + " " + which(new Below(1, 2)) + " " + which(new Beside(3))));
Below.prototype = Object.create(Base.prototype); show();
