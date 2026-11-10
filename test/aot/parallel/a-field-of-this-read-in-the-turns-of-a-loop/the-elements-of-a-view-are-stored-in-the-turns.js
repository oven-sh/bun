// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. The turns store into the view that the field gives.
class Box { constructor(items) { this.items = items; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) { this.items[i] = this.items[i] + 1; s += this.items[i]; } return s; } }
const name = JSON.parse('"sum"');
const box = new Box(new Uint8Array(6).fill(254));
console.log(box[name](), box[name](), box[name]()); box.items = [1.5, 2]; console.log(box[name](), box[name]()); box.items = Buffer.from([255, 0]); console.log(box[name]());
