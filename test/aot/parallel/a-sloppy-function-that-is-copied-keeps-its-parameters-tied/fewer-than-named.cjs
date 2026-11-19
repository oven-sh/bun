function f(a, b) { var read = () => b; arguments[1] = "loose"; return String(read()) + ":" + arguments.length; }
function drive(n) { var out = []; for (var i = 2; i < n; i++) out.push(f(i)); return out.join(); }
console.log("SAID fewer-than-named " + drive(5));
