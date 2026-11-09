function* pair(first, second) { yield first; yield second; }
function* pairByLoop(first, second) { for (let at = 0; at < 2; at++) yield at ? second : first; }
class Mark { constructor(value) { this.value = value; } }
function weigh(last) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return last === undefined ? work : work + last.value; }
function weighToo(last) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return last === undefined ? work : work + last.value; }
function sweep(count, visit) { let total = 0, last = undefined; for (let round = 0; round < count; round++) { for (const value of pair(1, 2)) total += value; total += visit(last); last = new Mark(round); } return total; }
function sweepToo(count, visit) { let total = 0, last = undefined; for (let round = 0; round < count; round++) { for (const value of pairByLoop(1, 2)) total += value; total += visit(last); last = new Mark(round); } return total; }
function rounds() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return sweep(300, (last) => weigh(last)) + work; }
function roundsToo() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return sweepToo(300, (last) => weighToo(last)) + work; }
console.log(rounds(), roundsToo());
