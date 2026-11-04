// the object under `prototype` of a generator function gets a `return` in a turn of a loop that alone has the generator
function* count(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { console.log("finally"); } }
function firstOver(limit, bound, inTurn) { for (const value of count(limit)) { if (inTurn) inTurn(); if (value > bound) return value; } return -1; }
function deed() { count.prototype.return = function () { console.log("own return"); return {}; }; }
console.log(String(firstOver(5, 1, null)));
for (let i = 0; i < 3; i++) console.log(String(firstOver(5, i, null)));
console.log(String(firstOver(5, 1, deed)));
console.log(String(firstOver(5, 1, null)));
console.log(String(firstOver(1, 5, null)));
