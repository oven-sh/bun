// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. One kind of list after another lies in the same box.
class Box { constructor(items) { this.items = items; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) s += this.items[i]; return s; } }
const name = JSON.parse('"sum"');
const box = new Box([0.5]);
for (let turn = 0; turn < 2; turn++) for (const next of [[1.5, 2.5], [1, 2, 3], ["x", 1], [], [1, , 2], [2 ** 31, -0, 0.25]]) { box.items = next; console.log(box[name]()); }
