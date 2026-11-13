// One of the two that may be constructed is an arrow function, which throws.
// STATISTIC: ConstructsDispatchedByCallee >= 1
class Ash { k = 1; } const arrow = () => ({ k: 2 });
let sum = 0, refused = 0;
for (let i = 0; i < 1000; i++) { const Tree: any = i & 1 ? Ash : arrow; try { const tree = new Tree(); sum += tree.k; } catch (e: any) { refused += e.constructor === TypeError ? 1 : 1000; } }
console.log(sum, refused);
