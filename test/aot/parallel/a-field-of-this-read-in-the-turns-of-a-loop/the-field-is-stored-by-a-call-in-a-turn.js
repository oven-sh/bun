// `this.items[i]` in a method: `this` is proven. In front of the loop the slot is asked whether it is filled and read once; what it gives is told apart: a list of numbers, a list, a buffer, bytes, another view. A call in a turn stores the field: the next read sees it.
class Box { constructor(items) { this.items = items; } sum(deed) { let s = 0; for (let i = 0; i < this.items.length; i++) { s += this.items[i]; if (i === 1) deed(this); } return s; } }
const name = JSON.parse('"sum"'), key = JSON.parse('"items"');
const deeds = [b => { b[key] = [10.5, 20.5, 30.5, 40.5]; }, b => { b[key] = [1, 2, 3, 4, 5]; }, () => {}, b => { b[key].length = 2; }, b => { b[key].push(100.5); }, b => { b[key][2] = "x"; }];
for (const deed of deeds) console.log(new Box([0.5, 1.5, 2.5])[name](deed));
