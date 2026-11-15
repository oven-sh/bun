interface Box { side: number }
function make(side: number): Box { if (side < 0) return make(-side); return { side }; }
function reader(box: Box, grows: boolean): () => number { return () => { if (grows) box.side += 1; return box.side; }; }
function sum(read: () => number, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) total += read(); return total; }
const one = make(2), other = make(3);
console.log(sum(reader(one, false), 100), sum(reader(other, true), 100), sum(() => one.side + other.side, 100));
