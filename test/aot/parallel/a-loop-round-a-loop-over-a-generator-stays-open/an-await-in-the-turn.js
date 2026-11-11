function* pair(first, second) { yield first; yield second; }
function* pairByLoop(first, second) { for (let at = 0; at < 2; at++) yield at ? second : first; }
class Mark { constructor(value) { this.value = value; } }
function weigh(last) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return last === undefined ? work : work + last.value; }
function weighToo(last) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return last === undefined ? work : work + last.value; }
async function rounds() { let total = 0, last = undefined; for (let round = 0; round < 300; round++) { for (const value of pair(1, 2)) total += await value; total += weigh(last); last = new Mark(round); } return total; }
async function roundsToo() { let total = 0, last = undefined; for (let round = 0; round < 300; round++) { for (const value of pairByLoop(1, 2)) total += await value; total += weighToo(last); last = new Mark(round); } return total; }
rounds().then((first) => roundsToo().then((second) => console.log(first, second)));
