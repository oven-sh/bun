function* guarded(log) { try { yield 1; yield 2; } finally { for (let i = 0; i < 3; i++) log.count += 1; } }
function* guardedByLoop(log) { try { for (let at = 1; at < 3; at++) yield at; } finally { for (let i = 0; i < 3; i++) log.count += 1; } }
class Mark { constructor(value) { this.value = value; } }
function weigh(last) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return last === undefined ? work : work + last.value; }
function weighToo(last) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return last === undefined ? work : work + last.value; }
function rounds() { const log = { count: 0 }; let total = 0, last = undefined; for (let round = 0; round < 300; round++) { for (const value of guarded(log)) { total += value; if (round % 2) break; } total += weigh(last); last = new Mark(round); } return total + log.count; }
function roundsToo() { const log = { count: 0 }; let total = 0, last = undefined; for (let round = 0; round < 300; round++) { for (const value of guardedByLoop(log)) { total += value; if (round % 2) break; } total += weighToo(last); last = new Mark(round); } return total + log.count; }
console.log(rounds(), roundsToo());
