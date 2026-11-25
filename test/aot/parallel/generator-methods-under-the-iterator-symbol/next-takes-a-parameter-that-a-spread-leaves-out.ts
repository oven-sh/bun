// What a loop, a spread or a pattern calls under Symbol.iterator, next and return: next takes a parameter that a spread leaves out.
class Count { private place = 0; constructor(private end: number) {} [Symbol.iterator]() { return this; } next(sent?: number) { if (sent !== undefined) return { done: true, value: -1 }; return this.place < this.end ? { done: false, value: this.place++ } : { done: true, value: -2 }; } }
function listed(count: Count): string { return [...count].join(); }
for (let turn = 0; turn < 3; turn++) console.log(listed(new Count(turn + 1)));
