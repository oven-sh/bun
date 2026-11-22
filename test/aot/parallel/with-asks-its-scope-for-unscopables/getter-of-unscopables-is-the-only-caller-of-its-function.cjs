let hits = 0;
function count() { hits++; return undefined; }
const scope = { y: 2 };
Object.defineProperty(scope, Symbol.unscopables, { get: count });
with (scope) { console.log(y); }
console.log(hits);
