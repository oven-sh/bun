// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. A turn deletes the field: the next read finds nothing and throws.
class Box { constructor(items) { this.items = items; this.goes = false; } sum() { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]; if (i === 1 && this.goes) delete this.items; } return s; } }
const name = JSON.parse('"sum"');
const box = new Box([0.5, 1.5, 2.5]);
console.log(box[name]()); box.goes = true;
try { console.log(box[name]()); } catch (error) { console.log(error instanceof TypeError, "items" in box); }
try { console.log(box[name]()); } catch (error) { console.log(error instanceof TypeError); }
box.goes = false; box.items = [4.5, 4.5]; console.log(box[name]());
