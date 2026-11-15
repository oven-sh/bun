// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. A frozen list, a sealed list and a frozen box come.
class Box { constructor(items) { this.items = items; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) s += this.items[i]; return s; } }
const name = JSON.parse('"sum"');
for (let turn = 0; turn < 2; turn++) console.log(new Box(Object.freeze([0.5, 1.5]))[name](), new Box(Object.seal([2.5, 3.5]))[name](), Object.freeze(new Box([4.5, 5.5]))[name]());
