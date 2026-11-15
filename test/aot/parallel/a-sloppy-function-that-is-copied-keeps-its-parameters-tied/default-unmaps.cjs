function f(a = 0) { var read = () => a; arguments[0] = "changed"; return read(); }
function drive(n) { var out = []; for (var i = 2; i < n; i++) out.push(f(i)); return out.join(); }
console.log("SAID default-unmaps " + drive(5));
