// Two functions make two classes, one below the other.
class P { k() { return 1; } }
class Q { k() { return 2; } }
class B extends (Date.now() > 0 ? P : Q) {}
const derive = (c) => class extends c {};
const again = (c) => class extends c {};
console.log(new (again(derive(B)))().k());
