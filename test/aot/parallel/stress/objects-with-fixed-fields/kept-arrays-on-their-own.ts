// Long-lived and short-lived arrays that belong to nobody's cell: literals, copies, arrays filled by push, and arrays that outgrow what they were born with.
interface Item { id: number; next: Item | null }
function literals(n: number): number[][] { const all: number[][] = []; for (let i = 0; i < n; i++) all.push([i, i + 1, i + 2]); return all; }
function pairs(n: number, item: Item): (Item | string)[][] { const all: (Item | string)[][] = []; for (let i = 0; i < n; i++) all.push(["k", item]); return all; }
function pushed(n: number, each: number): number[][] { const all: number[][] = []; for (let i = 0; i < n; i++) { const a: number[] = []; for (let k = 0; k < each; k++) a.push(i + k); all.push(a); } return all; }
function copies(from: number[][]): number[][] { const all: number[][] = []; for (let i = 0; i < from.length; i++) all.push(from[i].slice()); return all; }
function sum(all: number[][]): number { let t = 0; for (let i = 0; i < all.length; i++) { const a = all[i]; t += a[0] + a[a.length - 1] + a.length; } return t; }
const item: Item = { id: 1, next: null };
let answer = 0;
const keptLiterals = literals(1000000), keptPairs = pairs(1000000, item), keptShort = pushed(500000, 2), keptLong = pushed(250000, 11), keptCopies = copies(keptLiterals);
for (let round = 0; round < 20; round++) answer += sum(keptLiterals) + sum(keptShort) + sum(keptLong) + sum(keptCopies) + keptPairs[round].length;
for (let round = 0; round < 20; round++) answer += sum(literals(100000)) + sum(pushed(50000, 2)) + sum(pushed(25000, 11)) + sum(copies(literals(50000))) + pairs(100000, item).length;
console.log(answer);
