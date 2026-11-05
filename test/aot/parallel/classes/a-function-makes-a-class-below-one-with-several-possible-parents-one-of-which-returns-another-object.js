// The topmost constructor returns an object of its own, which takes the fields of the classes below.
class P { constructor() { return Date.now() > 0 ? { other: 1, k() { return 9; } } : this; } k() { return 1; } }
class Q { k() { return 2; } }
class B extends (Date.now() > 0 ? P : Q) { b = 3; }
const derive = (c) => class extends c { d = 4; };
const o = new (derive(B))();
console.log(o.k(), JSON.stringify(o));
