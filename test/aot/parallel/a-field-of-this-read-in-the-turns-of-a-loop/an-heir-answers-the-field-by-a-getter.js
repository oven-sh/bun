// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. An heir answers the name by a getter of its own: its calls are counted.
let asked = 0;
class Box { constructor(items) { this.items = items; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) s += this.items[i]; return s; } }
class Heir extends Box { constructor(items) { super(null); this.kept = items; } get items() { asked++; return this.kept; } set items(value) {} }
const name = JSON.parse('"sum"');
for (let turn = 0; turn < 3; turn++) console.log(new Box([0.5, 1.5])[name](), new Heir([2.5, 3.5, 4.5])[name](), asked);
