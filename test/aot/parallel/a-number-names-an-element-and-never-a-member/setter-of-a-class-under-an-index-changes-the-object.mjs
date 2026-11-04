class A { x = 1; set 0(v) { this.x = v; } }
const a = new A;
function put(o, i, v) { o[i] = v; }
const before = typeof a.x;
put(a, [].length, "text");
console.log(before, typeof a.x, Object.keys(a).join());
