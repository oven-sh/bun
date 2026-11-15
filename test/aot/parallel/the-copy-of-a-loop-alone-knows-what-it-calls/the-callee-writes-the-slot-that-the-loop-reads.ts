interface Box { side: number }
function make(side: number): Box { if (side < 0) return make(-side); return { side }; }
function sum(box: Box, step: () => void, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { total += box.side; step(); } return total; }
const one = make(2), other = make(3);
console.log(sum(one, () => { one.side += 2; }, 100), sum(other, () => { one.side -= 1; }, 100), sum(other, () => { other.side *= 2; }, 10), one.side, other.side);
