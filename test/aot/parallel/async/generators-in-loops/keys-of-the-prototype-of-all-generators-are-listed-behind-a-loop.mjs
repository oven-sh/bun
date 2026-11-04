// the own keys of the object that all generators stand below are listed behind a loop that has read `next` and `return` off it by the protocol
function* count(limit) { for (let i = 0; i < limit; i++) yield i; }
function firstOver(limit, bound) { for (const value of count(limit)) { if (value > bound) return value; } return -1; }
function deed() { return Reflect.ownKeys(Object.getPrototypeOf(count.prototype)).map(String).join(); }
console.log(String(firstOver(4, 1)));
console.log(deed());
for (let i = 0; i < 3; i++) console.log(String(firstOver(4, i)));
console.log(deed());
