interface Box { side: number }
function make(side: number): Box { if (side < 0) return make(-side); return { side }; }
function sum(read: () => number, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) total += read(); return total; }
const one = make(2), other = make(3);
console.log(sum(() => { one.side += 1; return one.side * one.side; }, 100), sum(() => other.side + 1, 100), one.side);
