const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
function G(y) { this.y = y; }
function is(v) { return v instanceof F ? 1 : 0; }
function isG(v) { return v instanceof G ? 1 : 0; }
function all(list) { let t = ""; for (let i = 0; i < list.length; i++) t += is(list[i]) + "" + isG(list[i]); return t; }
function make2() { return function K(x) { this.x = x; }; } const A = make2(), B = make2(); console.log(new A(1) instanceof A ? 1 : 0, new A(1) instanceof B ? 1 : 0, new B(1) instanceof A ? 1 : 0);
