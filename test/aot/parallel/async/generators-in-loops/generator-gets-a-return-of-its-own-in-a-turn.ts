// a turn of a loop over a parameter that is written to be a generator stores a `return` on the generator, and the loop is left behind that
function* count(limit: number) { try { for (let i = 0; i < limit; i++) yield i; } finally { console.log("finally"); } }
function firstOver(things: Generator<number>, bound: number, inTurn: ((things: Generator<number>) => void) | null) { for (const thing of things) { if (inTurn) inTurn(things); if (thing > bound) return thing; } return -1; }
function deed(things: Generator<number>) { (things as any).return = function () { console.log("own return"); return {}; }; }
console.log(String(firstOver(count(5), 1, null)));
for (let i = 0; i < 3; i++) console.log(String(firstOver(count(5), i, null)));
console.log(String(firstOver(count(5), 1, deed)));
console.log(String(firstOver(count(1), 5, deed)));
console.log(String(firstOver(count(5), 1, null)));
