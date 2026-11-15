// A class declared in a function captures the alias.
function outer() {
  const g = globalThis;
  class Reader { constructor() { this.kind = typeof g.Array; } }
  return new Reader().kind;
}
console.log(outer());
