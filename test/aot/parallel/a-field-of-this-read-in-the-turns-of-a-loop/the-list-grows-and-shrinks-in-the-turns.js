// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. The turns push onto the list, cut it and store into it.
class Box { constructor(items) { this.items = items; } sum(limit) { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]; if (this.items.length < limit) this.items.push(i + 0.25); if (i === 4) this.items.length = 6; this.items[i] = s; } return s; } }
const name = JSON.parse('"sum"');
for (const limit of [0, 4, 9]) { const box = new Box([0.5, 1.5, 2.5]); console.log(box[name](limit), box.items.join()); }
