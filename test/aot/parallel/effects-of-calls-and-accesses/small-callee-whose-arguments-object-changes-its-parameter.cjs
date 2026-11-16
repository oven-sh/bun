// a small sloppy callee returns its parameter, which a store into its arguments object has changed
function A() { this.v = 1; }
function swap(value) { arguments[0] = "swapped"; return value; }
function deed() { var got = swap(new A()); return typeof got + " " + String(got.v) + " " + String(got); }
console.log(deed());
var all = "";
for (var i = 0; i < 4; i++) all += deed() + ";";
console.log(all);
