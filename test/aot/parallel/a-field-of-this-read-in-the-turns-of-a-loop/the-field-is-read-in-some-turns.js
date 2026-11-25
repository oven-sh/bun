// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. Only some turns read the field, and a loop of no turns reads nothing.
class Box { constructor(items) { this.items = items; } sum(n) { let s = 0; for (let i = 0; i < n; i++) if (i & 1) s += this.items[i]; return s; } }
const name = JSON.parse('"sum"');
const box = new Box([0.5, 1.5, 2.5, 3.5, 4.5, 5.5]);
console.log(box[name](6), box[name](0), box[name](9)); delete box.items; console.log(box[name](0), box[name](1));
try { console.log(box[name](2)); } catch (error) { console.log(error instanceof TypeError); }
