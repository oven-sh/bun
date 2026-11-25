function* pair() { yield 1; yield 2; }
let total = 0; let last = "";
for (let round = 0; round < 5; round++) { for (const value of pair()) total += value; total += last.length; last += round & 1 ? "ab" : "c"; }
console.log(total, last);
