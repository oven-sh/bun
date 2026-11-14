// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. The class has an heir with a field of its own: `this` is of two layouts that hold the field in one slot.
class Box { constructor(items) { this.items = items; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) s += this.items[i]; return s; } }
class Heir extends Box { constructor(items) { super(items); this.more = 1; } }
const name = JSON.parse('"sum"');
for (let turn = 0; turn < 2; turn++) for (const items of [[0.5, 1.5, 2.5], [1, 2, 3], ["a", 1], [], [1.5, , 2.5]]) console.log(new Box(items)[name](), new Heir(items)[name]());
