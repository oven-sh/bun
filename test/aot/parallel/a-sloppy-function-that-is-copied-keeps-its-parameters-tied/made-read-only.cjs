function f(a) { var write = (v) => { a = v; }; Object.defineProperty(arguments, "0", { writable: false }); write("late"); return arguments[0]; }
function drive(n) { var out = []; for (var i = 2; i < n; i++) out.push(f(i)); return out.join(); }
console.log("SAID made-read-only " + drive(5));
