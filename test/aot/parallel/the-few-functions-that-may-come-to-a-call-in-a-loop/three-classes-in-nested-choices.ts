// Three ways bring three classes through two choices, one inside the other.
// STATISTIC: JoinsWalkedOnceForEachCallee >= 1
class Ash { k = 1; } class Birch { k = 20; } class Cedar { k = 300; }
let sum = 0;
for (let i = 0; i < 999; i++) { const r = i % 3; const Tree = r === 0 ? Ash : r === 1 ? Birch : Cedar; const tree = new Tree(); sum += tree.k; }
console.log(sum);
