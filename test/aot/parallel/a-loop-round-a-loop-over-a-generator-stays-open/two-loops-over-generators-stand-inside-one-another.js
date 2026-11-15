function* one(value) { yield value; }
function* pair(first, second) { yield first; yield second; }
function* oneByLoop(value) { for (let at = 0; at < 1; at++) yield value; }
function* pairByLoop(first, second) { for (let at = 0; at < 2; at++) yield at ? second : first; }
class Mark { constructor(value) { this.value = value; } }
function weigh(last) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return last === undefined ? work : work + last.value; }
function weighToo(last) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return last === undefined ? work : work + last.value; }
function rounds() { let total = 0, last = undefined; for (let round = 0; round < 300; round++) { for (const outer of one(10)) { for (const inner of pair(1, 2)) total += outer + inner; } total += weigh(last); last = new Mark(round); } return total; }
function roundsToo() { let total = 0, last = undefined; for (let round = 0; round < 300; round++) { for (const outer of oneByLoop(10)) { for (const inner of pairByLoop(1, 2)) total += outer + inner; } total += weighToo(last); last = new Mark(round); } return total; }
console.log(rounds(), roundsToo());
