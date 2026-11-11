function f(a) { var write = (v) => { a = v; }; write("written"); return arguments[0]; }
function drive(n) { var out = []; for (var i = 2; i < n; i++) out.push(f(i)); return out.join(); }
console.log("SAID arrow-writes " + drive(5));
