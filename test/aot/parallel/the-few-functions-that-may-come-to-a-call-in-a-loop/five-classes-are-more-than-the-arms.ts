// Five classes may come, more than are told apart by tests.
class A1 { k = 1; } class A2 { k = 20; } class A3 { k = 300; } class A4 { k = 4000; } class A5 { k = 50000; }
let sum = 0;
for (let i = 0; i < 1000; i++) { const r = i % 5; let Tree: any = A1; if (r === 1) Tree = A2; else if (r === 2) Tree = A3; else if (r === 3) Tree = A4; else if (r === 4) Tree = A5; const tree = new Tree(); sum += tree.k; }
console.log(sum);
