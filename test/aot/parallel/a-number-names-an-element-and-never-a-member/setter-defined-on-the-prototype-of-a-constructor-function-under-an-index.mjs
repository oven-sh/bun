function A() { this.x = 1; }
Object.defineProperty(A.prototype, 0, { set(v) { this.x = v; } });
const a = new A;
function put(o, i, v) { o[i] = v; }
put(a, [].length, "text");
console.log(typeof a.x, Object.keys(a).join());
