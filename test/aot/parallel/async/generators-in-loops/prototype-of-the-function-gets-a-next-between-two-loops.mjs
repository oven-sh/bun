// the object under `prototype` of a generator function gets a `next` between two loops that each alone have a generator of it
function* count(limit) { console.log("body"); for (let i = 0; i < limit; i++) yield i; }
function sum(limit) { let total = 0; for (const value of count(limit)) total += value; return total; }
function deed() { let turns = 0; count.prototype.next = function () { console.log("own next"); return { done: ++turns > 2, value: 10 }; }; }
console.log(String(sum(4)));
for (let i = 0; i < 3; i++) console.log(String(sum(i)));
deed();
console.log(String(sum(4)));
delete count.prototype.next;
console.log(String(sum(4)));
