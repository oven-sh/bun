// The loop of a generator is walked with the turn of its consumer inside it: the method counts up to a field that the turn lowers.
class Shelf { end: number; constructor(public books: number[]) { this.end = books.length + 2; } *[Symbol.iterator]() { for (let place = 0; place < this.end; place++) yield place; } }
function told(shelf: Shelf): string { let out = ""; for (const place of shelf) { out += place + ","; if (place === 1) shelf.end = 2; } return out; }
for (let run = 0; run < 3; run++) console.log(told(new Shelf([1, 2, 3 + run])));
