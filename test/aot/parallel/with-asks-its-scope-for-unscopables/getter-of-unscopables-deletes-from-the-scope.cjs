class Scope { constructor(n) { this.x = n; this.y = 2; } get [Symbol.unscopables]() { delete this.x; return undefined; } }
function read(o) { return o.x; }
const scope = new Scope(1);
console.log(read(scope), Object.keys(scope).join());
with (scope) { console.log(y); }
console.log(read(scope), Object.keys(scope).join());
