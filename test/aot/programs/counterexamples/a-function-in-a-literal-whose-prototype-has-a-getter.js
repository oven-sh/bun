// A getter that a literal inherits through `__proto__` sees the function of that literal, a new one each time.
const seen = [], base = { get ready() { seen.push(this.f); } };
function read() { ({ __proto__: base, f: () => 1 }).ready; }
read(); read();
console.log(seen.length, typeof seen[0], seen[0] === seen[1]);
