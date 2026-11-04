const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
function G(y) { this.y = y; }
function is(v) { return v instanceof F ? 1 : 0; }
function isG(v) { return v instanceof G ? 1 : 0; }
function all(list) { let t = ""; for (let i = 0; i < list.length; i++) t += is(list[i]) + "" + isG(list[i]); return t; }
console.log(is(F), F instanceof Function ? 1 : 0, F instanceof Object ? 1 : 0, new F(1) instanceof Object ? 1 : 0);
