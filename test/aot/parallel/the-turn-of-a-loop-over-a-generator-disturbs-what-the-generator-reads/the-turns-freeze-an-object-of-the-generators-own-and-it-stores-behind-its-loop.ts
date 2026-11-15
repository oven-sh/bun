// The loop of a generator is walked with the turn of its consumer inside it: the turns freeze an object of the generators own and it stores behind its loop.
class Shelf { total = 0; constructor(private books: number[]) {} *[Symbol.iterator](): Generator<number | { v: number }> { const box = { v: 0 }; yield box; for (const book of this.books) yield book; try { box.v = 1; } catch (error) { this.total = -1; } this.total += box.v; } }
"use strict";
function told(shelf: Shelf): string { let keep: { v: number } | null = null; for (const x of shelf) { if (keep === null) keep = x as { v: number }; else Object.freeze(keep); } return String(shelf.total); }
for (let run = 0; run < 2; run++) console.log(told(new Shelf([1, 2, 3 + run])));
