function f(a) { var read = () => a; delete arguments[0]; arguments[0] = "loose"; return read() + ":" + arguments[0]; }
function drive(n) { var out = []; for (var i = 2; i < n; i++) out.push(f(i)); return out.join(); }
console.log("SAID deleted-then-stored " + drive(5));
