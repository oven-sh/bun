// a loop over a parameter that is written to be a generator is handed a generator that has a `next` of its own, and one that gets it in a turn
function* count(limit: number) { for (let i = 0; i < limit; i++) yield i; }
function sum(things: Generator<number>, inTurn: ((things: Generator<number>) => void) | null) { let total = 0; for (const thing of things) { if (inTurn) inTurn(things); total += thing; } return total; }
function deed(things: Generator<number>) { let turns = 0; (things as any).next = function () { return { done: ++turns > 2, value: 100 }; }; }
function changed() { const things = count(4); deed(things); return things; }
console.log(String(sum(count(4), null)));
for (let i = 0; i < 3; i++) console.log(String(sum(count(i), null)));
console.log(String(sum(changed(), null)));
console.log(String(sum(count(4), deed)));
console.log(String(sum(count(4), null)));
