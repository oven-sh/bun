// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. A turn stores the field under another name of the same box: the next read sees it.
class Box { constructor(items) { this.items = items; } sum(alias, next) { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]; if (i === 1) alias.items = next; } return s; } }
const name = JSON.parse('"sum"');
for (const next of [[10.5, 20.5, 30.5, 40.5], [1, 2, 3, 4, 5], ["a", "b", "c"]]) { const box = new Box([0.5, 1.5, 2.5]), stranger = new Box([0.5]); console.log(box[name](box, next), box[name](stranger, next), stranger.items === next); }
