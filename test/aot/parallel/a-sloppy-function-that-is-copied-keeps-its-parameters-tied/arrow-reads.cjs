function f(a) { var read = () => a; arguments[0] = "changed"; return read(); }
function drive(n) { var out = []; for (var i = 2; i < n; i++) out.push(f(i)); return out.join(); }
console.log("SAID arrow-reads " + drive(5));
