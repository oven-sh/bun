function A() { this.x = 1; }
Object.defineProperty(A.prototype, 0, { value: 5, writable: false });
const a = new A;
function put(o, i, v) { try { o[i] = v; return "stored"; } catch (e) { return e.constructor.name; } }
console.log(put(a, [].length, "text"), a[0], Object.keys(a).join());
