// In the middle of the loop Object.assign, Reflect.set and Reflect.defineProperty put other classes under constructor on the prototypes.
class Tree { k = 1; again(): any { return new (this as any).constructor(); } }
class Ash extends Tree { k = 2; }
class Birch extends Tree { k = 30; }
class Cedar extends Tree { k = 400; }
const ash = new Ash(), birch = new Birch();
let sum = 0;
for (let i = 0; i < 400; i++) {
  if (i === 100) Object.assign(Ash.prototype, { constructor: Cedar });
  if (i === 200) Reflect.set(Birch.prototype, "constructor", Cedar);
  if (i === 300) Reflect.defineProperty(Ash.prototype, "constructor", { value: Birch, configurable: true });
  sum += (i & 1 ? ash : birch).again().k;
}
console.log(sum);
