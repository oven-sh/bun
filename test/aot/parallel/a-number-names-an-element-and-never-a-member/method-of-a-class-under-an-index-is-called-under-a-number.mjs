class A { x = 1; 0() { this.x = "text"; return 7; } }
const a = new A;
function call(o, i) { return o[i](); }
console.log(call(a, [].length), typeof a.x);
