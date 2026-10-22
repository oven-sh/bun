// What the method hands on out of a receiver that is no array is still followed: the items come back through the result and through the callback, and are changed there.
class Item { constructor(n) { this.n = n; this.tag = "t"; } }
const like = { length: 2, 0: new Item(1), 1: new Item(2), slice: Array.prototype.slice, forEach: Array.prototype.forEach, reduce: Array.prototype.reduce };
const copy = like.slice();
copy[0].n = "text"; delete copy[1].tag; copy[1].late = 5;
let seen = "";
like.forEach(item => { seen += typeof item.n + item.tag + item.late; });
console.log(seen, like.reduce((sum, item) => sum + String(item.n), ""));
function total(items) { let sum = 0; for (let i = 0; i < items.length; i++) sum += items[i].n.length ?? items[i].n; return sum; }
console.log(total(copy), total(like));
