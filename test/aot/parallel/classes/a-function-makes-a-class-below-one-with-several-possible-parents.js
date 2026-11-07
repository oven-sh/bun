// B extends one of two classes, and a function that gets only B makes a class below it: an object of that class goes through the constructors of all three.
class P { k() { return 1; } }
class Q { k() { return 2; } }
class B extends (Date.now() > 0 ? P : Q) {}
const derive = (c) => class extends c {};
console.log(new (derive(B))().k());
