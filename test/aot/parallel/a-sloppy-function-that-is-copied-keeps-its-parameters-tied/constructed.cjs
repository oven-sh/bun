function F() { this.same = arguments.callee === F; this.n = arguments.length; }
function f(i) { var o = new F(i, i); return o.same + ":" + o.n; }
function drive(n) { var out = []; for (var i = 2; i < n; i++) out.push(f(i)); return out.join(); }
console.log("SAID constructed " + drive(5));
