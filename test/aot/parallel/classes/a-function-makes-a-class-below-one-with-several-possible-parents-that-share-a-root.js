// Both possible parents extend one class with a field.
class Root { r = 7; root() { return this.r; } }
class P extends Root { k() { return 1; } }
class Q extends Root { k() { return 2; } }
class B extends (Date.now() > 0 ? P : Q) {}
const derive = (c) => class extends c {};
const o = new (derive(B))();
console.log(o.k(), o.root(), JSON.stringify(o));
