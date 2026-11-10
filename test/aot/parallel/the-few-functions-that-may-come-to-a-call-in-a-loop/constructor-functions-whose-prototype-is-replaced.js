// The prototype of each of two constructor functions is replaced in the middle of the loop that constructs them.
// STATISTIC: ConstructsDispatchedByCallee >= 1
function Ash() { this.k = 1; } function Birch() { this.k = 2; }
Ash.prototype.more = function () { return 10; }; Birch.prototype.more = function () { return 20; };
let sum = 0;
for (let i = 0; i < 1000; i++) { const Tree = i & 1 ? Ash : Birch; if (i === 500) Ash.prototype = { more() { return 7000; } }; if (i === 700) Birch.prototype = { more() { return 90000; } }; const tree = new Tree(); sum += tree.k + tree.more(); }
console.log(sum);
