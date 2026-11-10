// What a loop, a spread or a pattern calls under Symbol.iterator, next and return: a plain method answers this and next stands on the class.
class Count { private place = 0; constructor(private end: number) {} [Symbol.iterator]() { return this; } next() { return this.place < this.end ? { done: false, value: this.place++ } : { done: true, value: undefined }; } }
function total(count: Count): number { let sum = 0; for (const value of count) sum += value as number; return sum; }
for (let turn = 0; turn < 3; turn++) console.log(total(new Count(turn + 2)), [...new Count(turn)].join());
