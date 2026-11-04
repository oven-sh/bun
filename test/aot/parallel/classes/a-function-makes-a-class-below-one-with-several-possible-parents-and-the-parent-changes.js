// B gets the other parent after the first object is made.
class P { k() { return 1; } }
class Q { k() { return 2; } }
class B extends (Date.now() > 0 ? P : Q) {}
const derive = (c) => class extends c {};
const Made = derive(B);
console.log(new Made().k());
Object.setPrototypeOf(B, Q);
Object.setPrototypeOf(B.prototype, Q.prototype);
console.log(new Made().k(), new Made() instanceof Q, new Made() instanceof P);
