// In every third turn nothing is there to be constructed.
class Ash { k = 1; } class Birch { k = 2; }
let sum = 0, refused = 0;
for (let i = 0; i < 999; i++) { const r = i % 3; const Tree: any = r === 0 ? Ash : r === 1 ? Birch : undefined; try { const tree = new Tree(); sum += tree.k; } catch (e: any) { refused += e.constructor === TypeError ? 1 : 1000; } }
console.log(sum, refused);
