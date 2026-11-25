const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function make() { var made = 0; function K(v) { made++; this.v = v; } K.count = function () { return made; }; return K; }
var A = make(), B = make(); function run(n) { var t = 0; for (var i = 0; i < n; i++) t += (new A(i) instanceof B ? 10 : 0) + (new A(i) instanceof A ? 1 : 0); return t; } console.log(run(5), A.count(), B.count());
