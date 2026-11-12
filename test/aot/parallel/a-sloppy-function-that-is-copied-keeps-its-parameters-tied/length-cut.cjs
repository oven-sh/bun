function g() { return arguments.length; }
function f(a) { arguments.length = 0; return g.apply(null, arguments); }
function drive(n) { var out = []; for (var i = 2; i < n; i++) out.push(f(i)); return out.join(); }
console.log("SAID length-cut " + drive(5));
