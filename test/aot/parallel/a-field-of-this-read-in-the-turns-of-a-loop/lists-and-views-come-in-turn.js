// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. Lists and views lie in the same box one after another.
class Box { constructor(items) { this.items = items; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) s += this.items[i]; return s; } }
const name = JSON.parse('"sum"');
const box = new Box([0.5]);
for (let turn = 0; turn < 2; turn++) for (const next of [new Uint8Array(5).fill(3), [1.5, 2.5], Buffer.from([9, 8]), new Int16Array([-4, 4, 7]), "xy", [], new Uint8ClampedArray([300, 2]), ["a", 1], new Float32Array([0.5])]) { box.items = next; console.log(box[name]()); }
