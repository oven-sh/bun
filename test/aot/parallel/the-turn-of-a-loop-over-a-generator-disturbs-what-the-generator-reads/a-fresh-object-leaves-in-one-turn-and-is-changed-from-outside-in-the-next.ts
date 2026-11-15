// The loop of a generator is walked with the turn of its consumer inside it: a fresh object leaves in one turn and is changed from outside in the next.
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
const leaked: { n: number }[] = [];
const deeds = [() => { if (leaked.length) leaked[leaked.length - 1].n += 10; }, () => { if (leaked.length) leaked[leaked.length - 1].n += 100; }];
function told(shelf: Shelf): string { const box = { n: 0 }; let out = ""; for (const book of shelf) { out += box.n + ","; if (book === 1) leaked.push(box); deeds[book & 1](); } return out + box.n; }
for (let run = 0; run < 3; run++) console.log(told(new Shelf([1, 2, 3 + run])));
