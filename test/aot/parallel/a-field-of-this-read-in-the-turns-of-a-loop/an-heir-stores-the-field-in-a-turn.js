// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. The heir's own method is called in a turn and stores the field.
class Box { constructor(items) { this.items = items; } step() {} sum() { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]; if (i === 1) this.step(); } return s; } }
class Heir extends Box { constructor(items, next) { super(items); this.next = next; } step() { this.items = this.next; } }
const name = JSON.parse('"sum"');
for (let turn = 0; turn < 2; turn++) console.log(new Box([0.5, 1.5, 2.5])[name](), new Heir([0.5, 1.5, 2.5], [10.5, 20.5, 30.5, 40.5])[name](), new Heir([1, 2, 3], ["a", "b", "c"])[name]());
