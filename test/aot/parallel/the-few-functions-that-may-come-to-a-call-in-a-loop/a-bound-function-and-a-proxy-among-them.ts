// A bound function and a proxy stand among what may be constructed.
class Ash { k = 1; } class Birch { k = 2; } const Bound = Birch.bind(null); const Veiled = new Proxy(Ash, { construct() { return { k: 50 }; } });
let sum = 0;
for (let i = 0; i < 999; i++) { const r = i % 3; const Tree: any = r === 0 ? Ash : r === 1 ? Bound : Veiled; const tree = new Tree(); sum += tree.k; }
console.log(sum);
