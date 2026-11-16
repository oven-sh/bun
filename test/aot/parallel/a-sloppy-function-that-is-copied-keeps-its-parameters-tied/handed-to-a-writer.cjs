function w(list) { list[0] = "by w"; }
function f(a) { var read = () => a; w(arguments); return read(); }
function drive(n) { var out = []; for (var i = 2; i < n; i++) out.push(f(i)); return out.join(); }
console.log("SAID handed-to-a-writer " + drive(5));
