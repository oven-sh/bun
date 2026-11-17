// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. A call in a turn shrinks, grows or transfers what lies under the view.
class Box { constructor(items) { this.items = items; } sum(deed) { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]; if (i === 1) deed(this); } return s; } }
const name = JSON.parse('"sum"'), key = JSON.parse('"items"');
const data = new Uint8Array(new ArrayBuffer(6, { maxByteLength: 16 })); data.fill(7);
const box = new Box(data);
console.log(box[name](b => b[key].buffer.resize(3)), box[name](b => b[key].buffer.resize(9)), box[name](() => {}));
const other = new Box(new Uint8Array(8).fill(2)); console.log(other[name](b => b[key].buffer.transfer()), other[name](() => {}));
