interface Box { side: number; left: number }
function make(side: number): Box { if (side < 0) return make(-side); return { side, left: 5 }; }
function sum(read: () => number, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) total += read(); return total; }
const one = make(2), other = make(3);
try { console.log(sum(() => { if (!one.left--) throw new Error("spent " + one.side); return one.side; }, 100)); } catch (error) { console.log((error as Error).message, one.left); }
console.log(sum(() => other.side, 100));
