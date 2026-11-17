function Shelf(n) { this.n = n; }
globalThis.kept = Shelf;
function is(value) { return value instanceof Shelf; }
const early = Object.create(Shelf.prototype);
console.log(is(early), is({}));
Shelf.prototype = { later: true };
const late = new Shelf(1);
console.log(is(early), is(late), is({}));
console.log(is(early), is(late), is({}));
