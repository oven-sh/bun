// What a loop, a spread or a pattern calls under Symbol.iterator, next and return: a generator method named next under a spread whose results say done.
class Odd { [Symbol.iterator]() { return this; } *next(): Generator<number> { yield 1; } }
(Odd.prototype.next as any).prototype.done = true;
function listed(odd: Odd): number { return [...(odd as any)].length; }
console.log(listed(new Odd()));
