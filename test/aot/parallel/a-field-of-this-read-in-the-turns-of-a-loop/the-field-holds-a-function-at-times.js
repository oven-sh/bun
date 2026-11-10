// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. The field holds a function at times, written where the object is made: it has a length and no elements.
class Box { constructor(items) { this.items = items; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) s += this.items[i]; return s; } }
const name = JSON.parse('"sum"');
const boxes = [new Box([0.5, 1.5]), new Box(() => 1), new Box(function (a, b) { return a + b; }), new Box([2.5])];
for (let turn = 0; turn < 3; turn++) console.log(boxes.map(box => String(box[name]())).join(" | "));
