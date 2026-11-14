// Each turn evaluates a class anew and constructs it: the prototype is that of the class object at hand.
// STATISTIC: ConstructsDispatchedByCallee >= 1
function ashOf(n: number) { return class { k = n; twice() { return n * 2; } }; }
function birchOf(n: number) { return class { k = -n; twice() { return n * 3; } }; }
let sum = 0;
for (let i = 0; i < 1000; i++) { const Tree = i & 1 ? ashOf(i) : birchOf(i); const tree = new Tree(); sum += tree.k + tree.twice(); if (Object.getPrototypeOf(tree) !== Tree.prototype) sum += 1e9; }
console.log(sum);
