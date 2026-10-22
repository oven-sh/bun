// The analysis keeps one set for all the positions of a tuple, so for it the function reaches `c` too. `c === 0` holds for a number alone, so the arrow captures a number: a validating build must not stop here.
const made: Record<number, () => unknown> = {};
function f(c: number): Array<() => unknown> { const all: Array<() => unknown> = []; if (c === 0) all.push(() => made[c]); return all; }
function other(): void {}
const table: Array<[number, () => void]> = []; table.push([0, other]);
for (const [c, h] of table) for (const g of f(c)) console.log(g());
