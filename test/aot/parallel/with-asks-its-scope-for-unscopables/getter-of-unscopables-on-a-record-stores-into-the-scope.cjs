function make(n) { return { x: n, y: 2, get [Symbol.unscopables]() { this.x = "text"; return undefined; } }; }
function read(o) { return o.x + 1; }
const scope = make(1);
console.log(read(scope), read(make(5)));
with (scope) { console.log(y); }
console.log(read(scope), read(make(5)));
