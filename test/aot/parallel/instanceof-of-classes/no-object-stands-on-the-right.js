// What is no object, and an object that cannot be called, stand on the right of `instanceof` where a class of the program has stood so far: a TypeError each time.
class Leaf { constructor() { this.a = 1; } }
function isOf(x, C) { return x instanceof C; }

function deed(C) {
  try { return String(isOf(new Leaf(), C)); } catch (error) { return error.name + ": " + error.message; }
}
console.log(deed(Leaf));
let count = 0;
for (let i = 0; i < 200; i++) count += isOf(i & 1 ? new Leaf() : {}, Leaf) ? 1 : 0;
console.log(String(count));
console.log(deed(undefined));
console.log(deed(null));
console.log(deed(5));
console.log(deed("Leaf"));
console.log(deed({}));
console.log(deed(Leaf.prototype));
console.log(deed(() => 1));
console.log(deed({ [Symbol.hasInstance]: x => x instanceof Leaf }));
console.log(deed({ [Symbol.hasInstance]: 5 }));
console.log(deed(Leaf));
