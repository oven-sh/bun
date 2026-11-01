// As with two possible parents, with three.
class P { k() { return 1; } }
class Q { k() { return 2; } }
class R { k() { return 3; } }
const n = Date.now() > 0 ? 0 : Date.now() > 1 ? 1 : 2;
class B extends (n === 0 ? P : n === 1 ? Q : R) {}
const derive = (c) => class extends c {};
console.log(new (derive(B))().k());
