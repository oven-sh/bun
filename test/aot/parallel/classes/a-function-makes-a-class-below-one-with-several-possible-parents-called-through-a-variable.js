// The function that makes the class is read out of an object first.
class P { k() { return 1; } }
class Q { k() { return 2; } }
class B extends (Date.now() > 0 ? P : Q) {}
const derive = (c) => class extends c {};
const table = { make: derive };
const how = table.make;
const Made = how(B);
console.log(new Made().k(), new Made() instanceof B, new Made() instanceof P, new Made() instanceof Q);
