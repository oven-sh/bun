class Scope { constructor(n) { this.x = n; this.y = 2; } get [Symbol.unscopables]() { this.x = "text"; return undefined; } }
function read(o) { return o.x + 1; }
const scope = new Scope(1);
console.log(read(scope), read(new Scope(5)));
with (scope) { console.log(y); }
console.log(read(scope), read(new Scope(5)));
