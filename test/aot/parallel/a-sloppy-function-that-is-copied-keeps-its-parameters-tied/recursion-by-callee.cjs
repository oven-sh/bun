function f() { return arguments[0] <= 1 ? 1 : arguments[0] * arguments.callee(arguments[0] - 1); }
function drive(n) { var out = []; for (var i = 2; i < n; i++) out.push(f(i)); return out.join(); }
console.log("SAID recursion-by-callee " + drive(5));
