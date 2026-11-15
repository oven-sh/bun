const all: Array<() => number> = [];
function callNow(f: () => number): number { return f(); }
function callAndKeep(f: () => number): number { all.push(f); return f(); }
let sum = 0;
for (let i = 0; i < 4; i++) { sum += callNow(() => i); sum += callAndKeep(() => i * 10); }
console.log(sum, all.length, new Set(all).size, all.map(f => f()).join());
